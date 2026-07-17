// AtPathPopover — `@path/file.ts` 自动补全 (REPL SuggestionsDisplay 等价, v0.1.x)
//
// 触发: BottomBar textarea 内容里 caret 之前最近的 `@xxx` token (xxx 中不能有空白)。
//   - 用户打 "@" → query = ""           → 弹"最近 N 个文件"清单
//   - 继续打 "@src/fo"  → query = "src/fo" → IPC project.fileSearch substring 匹配
//   - Tab / Enter → 接受当前 active 项,把 `@token` 换成 `@selected/path`
//   - ↑/↓ → 移动 active
//   - Esc / 空格 / caret 离开 `@token` → 关弹层
//
// 键盘事件: BottomBar onKeyDown 优先派发到本 popover (如果 open); 否则走原逻辑 (history 翻 / send 等)。

import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider.js';

interface Props {
  /** 当前 textarea 全文 + caret 位置 — BottomBar 传 (在 onChange / focus 时计算)。 */
  readonly text: string;
  readonly caret: number;
  /** 当前 project root — 用来打 IPC */
  readonly projectRoot: string | null;
  /** 用户选中一项: 把 textarea 中 [tokenStart, caret) 区间替换为 `@<chosenPath>`,加一个空格。
   *  newCaretOffset 是替换后新的 caret 位置 (相对于 token 起点的 `@` + path + ' ' 长度)。*/
  readonly onAccept: (replacementText: string, tokenStart: number, tokenEnd: number) => void;
  /** keydown 注入接口 — BottomBar 把原始 e 传进来,popover 消费 Tab/Enter/↑/↓/Esc 返回 true,
   *  否则返回 false 让 BottomBar 继续处理。 */
  readonly registerKeyHandler: (handler: ((e: KeyboardEvent) => boolean) | null) => void;
}

/** 找 caret 前最近的 `@token`,返回 { start, query } 或 null。token 边界: 起始 = 行首/空白/@前;
 *  结束 = caret (用户还在打字);中间不许含空白。 */
function findAtToken(text: string, caret: number): { start: number; query: string } | null {
  if (caret === 0) return null;
  // 从 caret 往回扫,找最后一个 '@';期间不许遇到空白
  let i = caret - 1;
  while (i >= 0) {
    const ch = text.charAt(i);
    if (ch === '@') {
      // '@' 前必须是 行首 / 空白 (避免 email 等被误识)
      if (i === 0 || /\s/.test(text.charAt(i - 1))) {
        return { start: i, query: text.slice(i + 1, caret) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

export function AtPathPopover({
  text,
  caret,
  projectRoot,
  onAccept,
  registerKeyHandler,
}: Props): JSX.Element | null {
  const { t } = useI18n();
  const token = findAtToken(text, caret);
  const [matches, setMatches] = useState<readonly string[]>([]);
  const [active, setActive] = useState(0);
  // Esc-dismissed state: 用户在当前 @token 上按过 Esc → 标记 (tokenStart,length) 为 dismissed,
  // 直到 caret 离开或者 token 又变了才重新启用 (审查 M2)。
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const currentKey = token !== null ? `${token.start}:${token.query}` : null;
  const isDismissed = currentKey !== null && dismissedKey === currentKey;
  const open = token !== null && projectRoot !== null && !isDismissed;
  // 离开 token 后允许下次再开
  useEffect(() => {
    if (currentKey === null && dismissedKey !== null) {
      setDismissedKey(null);
    }
  }, [currentKey, dismissedKey]);

  // IPC 查询: token.query 变化时去拉,empty query 也会拉 (前 N 个文件清单)。
  // 加 120ms debounce — 用户快速打 "@src/foo" 时每按一键都打 IPC,虽然 main cache 命中
  // 快但 IPC 还有 round-trip + zod 校验开销;debounce 把多次塞成一次 (审查 M3)。
  useEffect(() => {
    if (!open || !window.kodaxSpace || !projectRoot || !token) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const debounceTimer = setTimeout(() => {
      if (cancelled) return;
      if (!window.kodaxSpace) return;
      void window.kodaxSpace
        .invoke('project.fileSearch', {
          projectRoot,
          query: token.query,
          limit: 20,
        })
        .then((r) => {
          if (cancelled || !r.ok) return;
          setMatches(r.data.paths);
          setActive(0);
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
    };
    // 故意只依赖 token?.query：整个 token 对象每次渲染换引用，纳入会导致无谓重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectRoot, token?.query]);

  // 注册键盘 handler (open 时消费 Tab/Enter/↑↓/Esc; close 时还原 null)
  useEffect(() => {
    if (!open || matches.length === 0) {
      registerKeyHandler(null);
      return;
    }
    const handler = (e: KeyboardEvent): boolean => {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const picked = matches[active];
        if (picked && token) {
          onAccept(`@${picked} `, token.start, caret);
        }
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i - 1 + matches.length) % matches.length);
        return true;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (i + 1) % matches.length);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        // 真关弹层: 标记当前 (tokenStart, query) 为 dismissed → open 立即变 false,
        // popover 卸载。用户改 token (移光标 / 改 query) 后 dismissedKey 自动失效重新开。
        if (currentKey !== null) setDismissedKey(currentKey);
        return true;
      }
      return false;
    };
    registerKeyHandler(handler);
    return () => registerKeyHandler(null);
  }, [open, matches, active, token, caret, currentKey, onAccept, registerKeyHandler]);

  if (!open || matches.length === 0) return null;

  return (
    <div className="absolute left-1 bottom-full mb-2 w-80 max-h-72 overflow-auto bg-surface-4 border border-border-default rounded-lg shadow-xl text-[12px] z-50">
      <div className="px-2 py-1 text-[11px] text-fg-muted uppercase tracking-wider border-b border-border-default/60">
        {t('atPath.files')} {token?.query ? `· "${token.query}"` : ''}
      </div>
      <ul>
        {matches.map((p, i) => {
          const isActive = i === active;
          const basename = p.slice(p.lastIndexOf('/') + 1);
          const dirname = p.slice(0, p.length - basename.length);
          return (
            <li key={p}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  if (token) onAccept(`@${p} `, token.start, caret);
                }}
                className={`w-full text-left px-2 py-1 font-mono truncate ${
                  isActive ? 'bg-surface-3 text-fg-primary' : 'text-fg-muted hover:bg-hover-bg'
                }`}
                title={p}
              >
                <span className="text-fg-primary">{basename}</span>
                {dirname && <span className="text-fg-muted"> · {dirname.replace(/\/$/, '')}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="px-2 py-1 text-[11px] text-fg-faint border-t border-border-default/60">
        {t('atPath.insertNavigateHint')}
      </div>
    </div>
  );
}
