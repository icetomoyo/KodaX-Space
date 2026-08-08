// Markdown 渲染封装。
//
// 选 react-markdown 而不是手撸 / markdown-it：
//   - 与 React 集成原生，节点级注入安全（不走 dangerouslySetInnerHTML）
//   - rehype-highlight 一行接入语法高亮，subset 可控（不要把 150+ 语言全打进 bundle）
//   - remark-gfm 加表格 / 删除线 / task list，覆盖 LLM 常见输出格式
//
// **2026-05 排版升级**：原 alpha.1 版本 `list-inside` + 全 text-sm heading 导致:
//   - 嵌套 list 不缩进 (`<ul><li>foo<ul><li>bar` 渲染成两条同高 bullet,失去层级感)
//   - H1/H2/H3 全 14-16px,跟正文没有视觉差异,长文档结构全平
//   - 段落间距太挤,长 prose 看上去像一块墙
// 重写为标准排版规则: list 用 outside + pl,heading 阶梯放大,p 加呼吸,补 hr/strong/em/table。
//
// CSP 兼容：rehype-highlight 通过 <span class="hljs-..."> 注入 class，不需要 inline style。
// 配套的 highlight.js CSS 主题在 styles.css 全局引入。

import {
  createContext,
  memo,
  useContext,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  openFileSmart,
  openExternalUrl,
  openGeneratedResourceHref,
  isAbsolutePathOutsideProject,
  looksLikeFilePath,
} from '../../../lib/openPath.js';
import { useAppStore } from '../../../store/appStore.js';
import { useI18n } from '../../../i18n/I18nProvider.js';
import { parsePartnerDeliveryUri } from '@kodax-space/space-ipc-schema';
import {
  openPartnerEvidence,
  parsePartnerCitationHref,
} from '../../partner/partnerEvidenceEvents.js';
import { FileActionMenu } from '../../../shell/FileActionMenu.js';

interface MarkdownProps {
  readonly content: string;
}

// OC-19 流式 markdown LRU memoization
//
// 同一份 markdown content 多次渲染时（虚拟列表回滚、主题切换、parent 重 render 等）
// ReactMarkdown 走全量 parse + remark-gfm + rehype-highlight 链路，长 prose 容易
// 占 10-30ms 主线程。模块级 LRU cache 把 content → 渲染 JSX 节点缓存下来，命中即返。
//
// 注意：cache 只对**完整 final content** 有意义；text_delta 期间每条都是新字符串，
// 不会命中。真正受益场景 = 长会话回滚 / 历史会话切换 / 主题切换重 render。
//
// 配合下方 export default React.memo(Markdown) 让 parent 重 render 但 content 未变时
// 整个组件 short-circuit；两层一起把"内容稳定的 markdown 渲染"开销压到接近 0。
//
// **缓存键安全性**：cache key 只是 `content` 字符串。这要求 `components` 覆盖里所有
// 样式 / 行为**仅依赖 content**，不能依赖 props 或外部 reactive 值。如果未来要给
// Markdown 加 prop（`theme` / `tableStyle` / `linkPrefix` 等让 components 变量化），
// **必须**把这些 prop 也纳入 cache key（如 `${theme}:${content}`），否则会返回旧主题的
// JSX 元素。当前 components 内联在 MarkdownInner 里、零外部依赖，安全。
const LRU_CAP = 500;
const lruCache = new Map<string, JSX.Element>();

function rememberInLru(content: string, rendered: JSX.Element): JSX.Element {
  // 命中已存在的 entry —— delete + set 让它跳到 insertion-order 最末（LRU "最近用过"）
  if (lruCache.has(content)) lruCache.delete(content);
  lruCache.set(content, rendered);
  // 上限保护：超 cap 删最早 entry（Map 迭代按插入顺序，第一个就是 oldest）
  if (lruCache.size > LRU_CAP) {
    const oldest = lruCache.keys().next().value;
    if (oldest !== undefined) lruCache.delete(oldest);
  }
  return rendered;
}

/**
 * 测试 hook：清缓存。生产路径不该调用。
 */
export function _clearMarkdownLruCacheForTesting(): void {
  lruCache.clear();
}

// OC-25 代码块复制按钮：常驻显示 (低 opacity)、hover 后 100% + 强对比配色。
// per-message copy 已经在 MessageFooter；这里给每个 ``` 块单独一个按钮，
// 长回复里有多个代码片段时不用整段复制再剪。
//
// **2026-06 调整 (v0.1.9)**: 之前 `opacity-0 + hover 才出` + `bg-surface-3`
// 在 pre 的 `bg-surface` 上对比度太弱，用户反馈"hover 出来都看不清是什么按钮"。
// 改成：
//   1. 默认 opacity-60 常驻 (不打扰阅读但能看到有按钮)，hover/focus opacity-100
//   2. bg 提高一档 + 加 1px border 让轮廓清晰
//   3. 字号 text-xs，图标 12×12，与文字 baseline 对齐
//   4. 文字 "Copy" 大小写正常（之前 "copy" 全小写显得像 placeholder）
type MarkdownCopyKind = 'code' | 'text';

function CopyCodeButton({
  getText,
  kind,
}: {
  readonly getText: () => string;
  readonly kind: MarkdownCopyKind;
}): JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const idleLabel = kind === 'code' ? t('markdown.copyCode') : t('markdown.copyText');
  const idleAria = kind === 'code' ? t('markdown.copyCodeAria') : t('markdown.copyTextAria');
  const copiedAria = kind === 'code' ? t('markdown.codeCopiedAria') : t('markdown.textCopiedAria');
  async function onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard 不可用 (隐私模式等) — 静默；mainly desktop Electron 不会进这里
    }
  }
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className={[
        'content-copy-button absolute top-1.5 right-1.5 px-2 py-0.5 text-xs rounded flex items-center gap-1 leading-none',
        'opacity-60 hover:opacity-100 focus:opacity-100 group-hover/codeblock:opacity-100 transition-[opacity,background-color,color,border-color]',
        // Material chip stays readable on both light and dark content layers.
      ].join(' ')}
      data-markdown-copy-kind={kind}
      title={copied ? t('markdown.copied') : idleLabel}
      aria-label={copied ? copiedAria : idleAria}
    >
      {copied ? (
        <span className="text-ok font-medium">✓ {t('markdown.copied')}</span>
      ) : (
        <>
          <svg
            aria-hidden
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="14" height="14" x="8" y="8" rx="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
          {idleLabel}
        </>
      )}
    </button>
  );
}

// 从 children 里抽出代码文本 —— ReactMarkdown 给 pre 的 children 是 React element 树
// (一个 <code> 包着字符串)。textContent 会丢 highlight.js 加的换行 fidelity，
// 用 React.Children 递归收 string node 拼接更稳。
function extractTextFromNode(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractTextFromNode).join('');
  if (typeof node === 'object' && 'props' in node) {
    return extractTextFromNode((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

const MarkdownCodeBlockContext = createContext(false);

function explicitCodeLanguage(node: ReactNode): string | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const language = explicitCodeLanguage(child);
      if (language) return language;
    }
    return null;
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return null;

  const props = (node as { props: { className?: unknown; children?: ReactNode } }).props;
  if (typeof props.className === 'string') {
    const match = /(?:^|\s)language-([^\s]+)/.exec(props.className);
    if (match?.[1]) return match[1];
  }
  return explicitCodeLanguage(props.children);
}

function MarkdownPre({ children }: { readonly children?: ReactNode }): JSX.Element {
  const language = explicitCodeLanguage(children);
  const kind: MarkdownCopyKind = language ? 'code' : 'text';

  return (
    <pre
      className="content-code markdown-code-block group/codeblock relative border rounded-md px-3 pb-3 pt-9 my-2.5 overflow-x-auto text-[0.857em] leading-relaxed"
      data-markdown-code-kind={language ? 'source' : 'plain'}
      data-markdown-code-language={language ?? undefined}
    >
      <MarkdownCodeBlockContext.Provider value>
        {language ? <span className="markdown-code-language">{language}</span> : null}
        <CopyCodeButton getText={() => extractTextFromNode(children)} kind={kind} />
        {children}
      </MarkdownCodeBlockContext.Provider>
    </pre>
  );
}

interface FileActionMenuPosition {
  readonly x: number;
  readonly y: number;
}

interface FileActionTriggerProps {
  readonly onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
  readonly 'aria-haspopup'?: 'menu';
  readonly 'aria-expanded'?: boolean;
  readonly 'aria-controls'?: string;
  readonly 'data-file-action-path'?: string;
}

function MarkdownFileActionTarget({
  path,
  children,
}: {
  readonly path: string;
  readonly children: (props: FileActionTriggerProps) => JSX.Element;
}): JSX.Element {
  const [menu, setMenu] = useState<FileActionMenuPosition | null>(null);
  const menuId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const projectRoot = useAppStore((state) => state.currentProjectPath);
  const menuAvailable =
    typeof projectRoot === 'string' &&
    projectRoot.length > 0 &&
    !isAbsolutePathOutsideProject(path, projectRoot);

  function onContextMenu(event: ReactMouseEvent<HTMLElement>): void {
    event.preventDefault();
    event.stopPropagation();
    triggerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      x: event.clientX || rect.left,
      y: event.clientY || rect.bottom,
    });
  }

  return (
    <>
      {children(
        menuAvailable
          ? {
              onContextMenu,
              'aria-haspopup': 'menu',
              'aria-expanded': menu !== null,
              'aria-controls': menu !== null ? menuId : undefined,
              'data-file-action-path': path,
            }
          : {},
      )}
      {menuAvailable && menu && (
        <FileActionMenu
          id={menuId}
          path={path}
          x={menu.x}
          y={menu.y}
          primary="artifact"
          trigger={triggerRef.current}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

function localFileTarget(value: string): string | null {
  try {
    const decoded = decodeURI(value);
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded) && !/^[A-Za-z]:[\\/]/.test(decoded)) {
      return null;
    }
    return looksLikeFilePath(decoded) ? decoded : null;
  } catch {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !/^[A-Za-z]:[\\/]/.test(value)) {
      return null;
    }
    return looksLikeFilePath(value) ? value : null;
  }
}

/** @internal Exported for deterministic Markdown target tests. */
export function markdownFilePath(children: ReactNode, href: string | undefined): string | null {
  if (typeof href === 'string') return localFileTarget(href);
  const label = extractTextFromNode(children).trim();
  return localFileTarget(label);
}

/** @internal Exported for deterministic Markdown target tests. */
export function markdownUrlTransform(url: string): string {
  return parsePartnerDeliveryUri(url) || parsePartnerCitationHref(url)
    ? url
    : localFileTarget(url)
      ? url
      : defaultUrlTransform(url);
}

type MarkdownCodeProps = ComponentPropsWithoutRef<'code'> & { readonly node?: unknown };

function MarkdownCode({ className, children, node, ...props }: MarkdownCodeProps): JSX.Element {
  void node;
  const { t } = useI18n();
  const isBlock = useContext(MarkdownCodeBlockContext);

  if (isBlock) {
    return (
      <code
        className={['markdown-code-block-content', className].filter(Boolean).join(' ')}
        {...props}
      >
        {children}
      </code>
    );
  }

  // 2026-06-18: inline code 若“长得像文件路径”（src/index.html、app.tsx…）→ 渲染成
  // 可点击按钮，点 → openFileSmart（html/svg/md 进 File Viewer、代码进 diff、其它定位）。
  const inlineText = extractTextFromNode(children);
  if (looksLikeFilePath(inlineText)) {
    return (
      <MarkdownFileActionTarget path={inlineText}>
        {(fileActionProps) => (
          <button
            type="button"
            onClick={() => void openFileSmart(inlineText)}
            {...fileActionProps}
            title={t('markdown.openInlinePath', { path: inlineText })}
            className="markdown-inline-path bg-info/12 text-info hover:bg-info/20 px-1.5 py-0.5 rounded text-[12px] font-mono underline decoration-info/40 underline-offset-2 cursor-pointer"
          >
            {children}
          </button>
        )}
      </MarkdownFileActionTarget>
    );
  }

  return (
    <code className="markdown-inline-code px-1.5 py-0.5 rounded text-[12px] font-mono" {...props}>
      {children}
    </code>
  );
}

function MarkdownInner({ content }: MarkdownProps): JSX.Element {
  const { effectiveLocale } = useI18n();
  // OC-19 module-level LRU 命中即返。命中率高=稳定内容反复 render；流式 delta 不会命中。
  const cacheKey = `${effectiveLocale}\0${content}`;
  const cached = lruCache.get(cacheKey);
  if (cached !== undefined) {
    // 触发 LRU "刚用过"重排
    lruCache.delete(cacheKey);
    lruCache.set(cacheKey, cached);
    return cached;
  }

  // 注：不用 tailwindcss/typography 的 prose class——本仓库未装 @tailwindcss/typography。
  // 每个 element 用 components 里的覆盖样式手动控制。
  // 全 zinc-100 文字 + styles.css light-override 自动翻成深色,亮暗双主题都吃得下。
  const rendered = (
    <div className="markdown-body text-fg-primary leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
        // **2026-06 v0.1.9**: detect:false —— LLM 包 git status / 文件路径列表 / shell 输出
        // 等"非代码"内容时,detect:true 会硬猜成 javascript / perl / diff,把 `M filename.js`
        // 第一行识别成 hljs-deletion (粉红色) 而后续行不在 token 内,视觉上第一行颜色与后续
        // 不一致,被用户当作"缩进错位"。改成"非显式 language 不高亮"——LLM 现在普遍会写
        // ```python / ```diff / ```bash 这种带语言的 fence,纯文本块就显示成纯文本。
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          // ---- 代码 ----
          // group/codeblock 让 CopyCodeButton 的 hover 作用域限定到本 pre 而非整个消息
          pre: MarkdownPre,
          code: MarkdownCode,

          // ---- 链接 ----
          // http(s) 链接经 shell.openExternal 走系统浏览器（http 也放行，不止 https）；
          // 非 http 链接（锚点 / 相对）保持默认 <a> 行为。
          a: ({ children, href, ...props }) => {
            const isHttp = typeof href === 'string' && /^https?:\/\//i.test(href);
            const isGeneratedResource =
              typeof href === 'string' && parsePartnerDeliveryUri(href) !== null;
            const partnerCitationId = parsePartnerCitationHref(href);
            const filePath =
              !isHttp && !isGeneratedResource && !partnerCitationId
                ? markdownFilePath(children, href)
                : null;
            if (filePath) {
              return (
                <MarkdownFileActionTarget path={filePath}>
                  {(fileActionProps) => (
                    <a
                      {...props}
                      href={href}
                      onClick={(e) => {
                        e.preventDefault();
                        void openFileSmart(filePath);
                      }}
                      {...fileActionProps}
                      className="text-info/80 hover:text-info underline decoration-info/40 underline-offset-2"
                    >
                      {children}
                    </a>
                  )}
                </MarkdownFileActionTarget>
              );
            }
            return (
              <a
                {...props}
                href={href}
                {...(isHttp || isGeneratedResource || partnerCitationId
                  ? {
                      onClick: (e: ReactMouseEvent) => {
                        e.preventDefault();
                        if (partnerCitationId) {
                          openPartnerEvidence(partnerCitationId, e.currentTarget as HTMLElement);
                        } else if (isGeneratedResource) {
                          void openGeneratedResourceHref(href as string);
                        } else {
                          void openExternalUrl(href as string);
                        }
                      },
                    }
                  : {})}
                {...(isHttp ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                {...(isGeneratedResource ? { 'data-generated-resource': 'partner-delivery' } : {})}
                {...(partnerCitationId ? { 'data-partner-citation': partnerCitationId } : {})}
                className="text-info/80 hover:text-info underline decoration-info/40 underline-offset-2"
              >
                {children}
              </a>
            );
          },

          // ---- 段落 + 排版 ----
          // my-2 让段落之间有"呼吸"，单段也不会太紧贴边。
          p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
          // hr 给一条淡线分隔大块,跟段落 my-2 协调
          hr: () => <hr className="my-4 border-t border-border-default" />,
          strong: ({ children }) => (
            <strong className="font-semibold text-fg-primary">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-fg-primary">{children}</em>,
          del: ({ children }) => <del className="text-fg-muted line-through">{children}</del>,

          // ---- 列表 ----
          // list-outside + pl-5: bullet 在文字左侧外,文字保持对齐;嵌套 ul/ol 通过 ml-* 自动二级缩进
          // marker 用 zinc-500 让 bullet 弱化,文字才是主角
          ul: ({ children }) => (
            <ul className="my-2 ml-5 list-disc list-outside space-y-1 marker:text-fg-muted">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 ml-5 list-decimal list-outside space-y-1 marker:text-fg-muted">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1 leading-relaxed">{children}</li>,

          // ---- 引用 ----
          blockquote: ({ children }) => (
            <blockquote className="markdown-blockquote my-3 rounded-r-md border-l-[3px] px-3 py-1 [&>p]:my-1.5">
              {children}
            </blockquote>
          ),

          // ---- 标题阶梯 ----
          // H1 ~ H4 用明显的字号阶梯,LLM 输出"## Steps" "### Phase 1" 时一眼能看出层级
          h1: ({ children }) => (
            <h1 className="mt-4 mb-2 text-[1.429em] font-semibold text-fg-primary border-b border-border-default pb-1">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-4 mb-2 text-[1.286em] font-semibold text-fg-primary">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 mb-1.5 text-[1.143em] font-semibold text-fg-primary">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-3 mb-1 text-[1em] font-semibold text-fg-primary">{children}</h4>
          ),
          h5: ({ children }) => (
            <h5 className="mt-2 mb-1 text-[1em] font-medium text-fg-primary">{children}</h5>
          ),
          h6: ({ children }) => (
            <h6 className="mt-2 mb-1 text-[0.857em] font-medium text-fg-secondary uppercase tracking-wider">
              {children}
            </h6>
          ),

          // ---- GFM Table ----
          // remark-gfm 把 | a | b | 解析成 table;这里给 cell border + zebra stripe 让数据可读
          table: ({ children }) => (
            <div className="content-table my-3 overflow-x-auto rounded-md border">
              <table className="w-full text-[0.857em]">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="content-table-head text-fg-secondary uppercase tracking-wider">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="content-table-body divide-y">{children}</tbody>
          ),
          tr: ({ children }) => <tr>{children}</tr>,
          th: ({ children }) => (
            <th className="px-2.5 py-1.5 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-2.5 py-1.5 align-top">{children as ReactNode}</td>
          ),

          // ---- GFM task list (实际由 li 渲染,但 checkbox 单独定制让对齐更好) ----
          input: ({ type, checked, disabled, ...rest }) => {
            if (type === 'checkbox') {
              return (
                <input
                  type="checkbox"
                  checked={!!checked}
                  disabled={disabled ?? true}
                  readOnly
                  className="mr-2 align-middle accent-ok"
                  {...rest}
                />
              );
            }
            return <input type={type} {...rest} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );

  return rememberInLru(cacheKey, rendered);
}

// React.memo: parent 重 render 但 content prop 未变时整个组件 short-circuit。
// 配合 LRU cache 形成两层短路：
//   • content 引用未变 (parent reuse 同字符串) → React.memo 直接跳过
//   • content 引用变了但字符串相同 → LRU 命中返已渲染节点
// 流式 text_delta 期间两层都不命中（每条 delta 是新字符串），但流结束后的稳定
// 状态下重 render 几乎零成本。
export const Markdown = memo(MarkdownInner);
