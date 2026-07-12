// F026 ⌘K 命令面板候选源
//
// 4 个 kind：
//   - action  — store / 全局 UI 动作（New session / Toggle theme 等）
//   - session — 当前项目下最近 session（点击切过去）
//   - file    — 当前项目内文件（点击插 `@path` 到 BottomBar input）
//   - slash   — 已注册 slash 命令（点击插 `/cmd ` 到 BottomBar input）
//
// Action 候选是 const 列表 + 几个动态项；session/file/slash 走 IPC 异步获取。
//
// 通用契约：每项 onPick() 触发后由 CommandPalette 关闭自身；onPick 自己 fire-and-forget
// 副作用（store action / DOM event / IPC）。错误自己 catch（弹 toast 而非 throw 上去）。

import { pushToast } from '../store/toastStore.js';
import { useAppStore } from '../store/appStore.js';
import type { SupportedLocaleT } from '@kodax-space/space-ipc-schema';
import { slashCommandDescription, type Translate } from './slashCommandDescriptions.js';
import { setSpaceTheme } from '../space-control/semanticActions.js';

export type CommandKind = 'action' | 'session' | 'file' | 'slash';

export interface CommandItem {
  readonly id: string;
  readonly kind: CommandKind;
  readonly label: string;
  readonly hint?: string;
  readonly searchText: string;
  readonly onPick: () => void | Promise<void>;
}

export interface CommandContext {
  readonly projectPath: string | null;
  readonly sessionId: string | null;
  /** 关闭命令面板回调 — onPick 内部用，关 modal 之后再触发可能的异步 IPC */
  readonly close: () => void;
  readonly t: Translate;
  readonly locale: SupportedLocaleT;
  /**
   * BottomBar 暴露的 insert 接口（通过 CustomEvent 桥接，避免命令面板硬依赖 BottomBar 实例）。
   * 把字符串插到 textarea caret 处并 focus；caret 之后的内容保留。
   */
  readonly insertToInput: (text: string) => void;
}

/** Action 候选 — 全局 UI 行为，不需 IPC */
function actionCommands(ctx: CommandContext): readonly CommandItem[] {
  const store = useAppStore.getState();
  const items: CommandItem[] = [];

  items.push({
    id: 'action:new-session',
    kind: 'action',
    label: ctx.t('command.action.newSession'),
    hint: ctx.t('command.action.newSessionHint'),
    searchText: 'new session start chat create',
    onPick: () => {
      ctx.close();
      // 让 BottomBar 自动创建 session — 把焦点回到 textarea，
      // 用户打字时 BottomBar 的 sendMessage 会触发 createSession 路径。
      // 这里仅清掉当前 sessionId 指引 BottomBar 进入 "no session" 状态。
      store.setCurrentSession(null);
    },
  });

  items.push({
    id: 'action:toggle-theme',
    kind: 'action',
    label: ctx.t('command.action.theme', {
      current: themeLabel(store.theme, ctx.t),
      next: themeLabel(nextTheme(store.theme), ctx.t),
    }),
    hint: ctx.t('command.action.themeHint'),
    searchText: 'theme dark light system appearance toggle',
    onPick: () => {
      ctx.close();
      setSpaceTheme(nextTheme(store.theme));
    },
  });

  if (ctx.sessionId) {
    const sid = ctx.sessionId;
    items.push({
      id: 'action:clear-conversation',
      kind: 'action',
      label: ctx.t('command.action.clearConversation'),
      hint: ctx.t('command.action.clearConversationHint'),
      searchText: 'clear conversation reset view',
      onPick: () => {
        ctx.close();
        store.resetSessionMessages(sid);
      },
    });
  }

  return items;
}

function nextTheme(curr: 'dark' | 'light' | 'system'): 'dark' | 'light' | 'system' {
  if (curr === 'dark') return 'light';
  if (curr === 'light') return 'system';
  return 'dark';
}

function themeLabel(theme: 'dark' | 'light' | 'system', t: Translate): string {
  if (theme === 'dark') return t('theme.dark');
  if (theme === 'light') return t('theme.light');
  return t('theme.system');
}

/** Session 候选 — 当前项目下最近 N 个 */
async function sessionCommands(ctx: CommandContext): Promise<readonly CommandItem[]> {
  if (!window.kodaxSpace || !ctx.projectPath) return [];
  const r = await window.kodaxSpace.invoke('session.list', { projectRoot: ctx.projectPath });
  // 防御 IPC schema 漂移：r.ok=true 但 payload 形状异常时静默退到空列表，避免崩溃
  if (!r.ok || !Array.isArray(r.data?.sessions)) return [];
  // 按 lastActivityAt 倒序，cap 30 — 命令面板需要"最近"语义
  // 缺失字段用 0 兜底（NaN 比较会让 sort 不稳）
  const sessions = [...r.data.sessions]
    .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
    .slice(0, 30);
  return sessions.map((s) => ({
    id: `session:${s.sessionId}`,
    kind: 'session' as const,
    label: s.title || s.sessionId.slice(0, 8),
    hint: `${s.provider} - ${new Date(s.lastActivityAt).toLocaleString(ctx.locale)}`,
    searchText: `${s.title ?? ''} ${s.sessionId} ${s.provider}`.trim(),
    onPick: () => {
      ctx.close();
      useAppStore.getState().setCurrentSession(s.sessionId);
    },
  }));
}

/** File 候选 — project.fileSearch IPC（已有），空 query 取前 N 项 */
async function fileCommands(ctx: CommandContext): Promise<readonly CommandItem[]> {
  if (!window.kodaxSpace || !ctx.projectPath) return [];
  const r = await window.kodaxSpace.invoke('project.fileSearch', {
    projectRoot: ctx.projectPath,
    query: '',
    limit: 200, // 拉多点本地 fuzzy 二次 rank
  });
  if (!r.ok || !Array.isArray(r.data?.paths)) return [];
  return r.data.paths.map((p) => {
    const basename = p.slice(p.lastIndexOf('/') + 1);
    const dirname = p.slice(0, Math.max(0, p.length - basename.length - 1));
    return {
      id: `file:${p}`,
      kind: 'file' as const,
      label: basename,
      hint: dirname || undefined,
      searchText: p,
      onPick: () => {
        ctx.close();
        // 插 `@path` — KodaX SDK 会把文件内容塞进上下文（与 AtPathPopover 行为一致）
        ctx.insertToInput(`@${p} `);
      },
    };
  });
}

/** Slash 候选 — 已注册 slash 命令清单 */
async function slashCommands(ctx: CommandContext): Promise<readonly CommandItem[]> {
  if (!window.kodaxSpace) return [];
  const r = await window.kodaxSpace.invoke('slash.discover', undefined);
  if (!r.ok || !Array.isArray(r.data?.commands)) return [];
  return r.data.commands.map((c) => {
    const description = slashCommandDescription(c, ctx.t);
    return {
      id: `slash:${c.name}`,
      kind: 'slash' as const,
      label: `/${c.name}`,
      hint: description || c.source,
      searchText: `${c.name} ${description} ${c.description}`.trim(),
      onPick: () => {
        ctx.close();
        // 插命令名 — 用户可再补 args 后回车
        ctx.insertToInput(`/${c.name} `);
      },
    };
  });
}

/** 聚合 4 个 kind；IPC 并发拉 */
export async function gatherCommands(ctx: CommandContext): Promise<readonly CommandItem[]> {
  const actions = actionCommands(ctx);
  try {
    const [sessions, files, slashes] = await Promise.all([
      sessionCommands(ctx).catch(() => []),
      fileCommands(ctx).catch(() => []),
      slashCommands(ctx).catch(() => []),
    ]);
    return [...actions, ...sessions, ...files, ...slashes];
  } catch {
    // 内层 Promise.all 已用 .catch(() => []) 吞掉单 IPC 错误，到这里通常是逻辑 bug。
    // 不 echo err.message — 主进程不通过 IPC 把 raw error 字符串送过来，但 renderer 端
    // 异常可能含敏感栈帧，对用户也无意义。
    pushToast(ctx.t('command.loadFailed'), 'error');
    return actions;
  }
}
