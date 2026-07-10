// F045 — Surface 一等抽象（HLD §9.4 / ADR-007）。
//
// Surface = 同一 KodaX runtime 上的「画像组合」。把 renderer 从隐式单态
// （处处假设 Coder）升级为可在 Coder / Partner 两个 surface 间手动切换的一等状态。
//
// 切换是**渲染层路由**，不重启 main 进程的 KodaX runtime。
//
// 范围边界（本版只做地基）：
//   - ✅ surface 概念 + 手动 tab 切换 + 布局路由。
//   - ⏳ session 分面（Coder/Partner 会话列表彼此独立）：依赖 SDK 给 session 加
//     自定义 tag + listSessions 按 tag 过滤的原生能力（已转交需求）。SDK 到位前
//     不做消费端索引 workaround（生命周期不同步、脆弱）。
//   - ⏳ Partner 受限工具集（F047）/ 自定义画像（F053，依赖 SDK R1/R2）。

import { create } from 'zustand';
import { canonProjectRoot, type SessionMeta, type Surface } from '@kodax-space/space-ipc-schema';
import { useAppStore } from './appStore.js';

// F045: Surface 联合的**权威定义**在 IPC schema 包（surfaceSchema = z.enum(['code','partner'])）
// ——renderer 从那里 import 并 re-export，避免两处独立声明 drift（新增面只改 schema 一处）。
export type { Surface };

/** 工具策略：理想态由 SDK 工具能力维度元数据驱动（R3）；交付前按名单裁剪（F047）。 */
export type ToolPolicy = 'all-coding' | 'non-bash-subset';

/** Surface 的静态形态（HLD §9.4 的权威 SurfaceSpec）。 */
export interface SurfaceSpec {
  readonly sessionKind: 'code' | 'partner';
  readonly tools: ToolPolicy;
  readonly layout: 'code-workspace' | 'doc-workspace';
  readonly scope: 'git-root' | 'any-dir';
  readonly artifacts: boolean;
  readonly agentProfile: 'coding-default' | 'partner';
}

export const SURFACES: Record<Surface, SurfaceSpec> = {
  code: {
    sessionKind: 'code',
    tools: 'all-coding',
    layout: 'code-workspace',
    scope: 'git-root',
    artifacts: false,
    agentProfile: 'coding-default',
  },
  partner: {
    sessionKind: 'partner',
    tools: 'non-bash-subset', // read/grep/glob + 富格式 IO + web；默认无 bash（F047）
    layout: 'doc-workspace', // 三栏：Sources | 对话+任务进度 | Artifact 预览（F046）
    scope: 'any-dir',
    artifacts: true,
    agentProfile: 'partner', // 自定义画像走完整 harness 留 F053（依赖 SDK R1/R2）
  },
};

export const DEFAULT_SURFACE: Surface = 'code';

/**
 * Partner surface availability gate.
 *
 * Partner is enabled after the v0.1.30 workspace-first redesign landed:
 * arbitrary run-output deliverables, checkpointed workspace-session writes,
 * Office/PDF convenience artifacts, reviewed strict fallbacks, KB, sources,
 * and local policy/audit controls. Partner still does not receive raw
 * write/edit/bash tools.
 */
export const PARTNER_ENABLED = true;

// F046: currentSurface 持久化——重启回到上次停留的面（Coder/Partner）。
// 仅持久化"哪个面"，不持久化"哪个 session"——与 Coder 现状一致（重启都回各面 dashboard）。
const LS_KEY_SURFACE = 'kodax-space.currentSurface';
const IS_WIN_SURFACE = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

function sessionSurface(session: SessionMeta): Surface {
  return session.surface ?? 'code';
}

function sessionMatchesCurrentProject(
  session: SessionMeta,
  currentProjectPath: string | null,
): boolean {
  if (currentProjectPath === null) return true;
  return (
    canonProjectRoot(session.projectRoot, IS_WIN_SURFACE) ===
    canonProjectRoot(currentProjectPath, IS_WIN_SURFACE)
  );
}

function lsGetSurface(): Surface {
  // Partner 暂禁用：即使上次停留在 Partner，也不从持久化恢复进去（否则绕过灰态按钮）。
  if (!PARTNER_ENABLED) return DEFAULT_SURFACE;
  if (typeof window === 'undefined') return DEFAULT_SURFACE;
  try {
    return window.localStorage.getItem(LS_KEY_SURFACE) === 'partner' ? 'partner' : 'code';
  } catch {
    return DEFAULT_SURFACE;
  }
}
function lsSetSurface(surface: Surface): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY_SURFACE, surface);
  } catch {
    // localStorage 不可用（隐私模式 / 配额满）—— 静默，仅丢失"记住面"持久化
  }
}

interface SurfaceState {
  /** 当前显示的 surface。默认 Coder，不破坏 v0.1.10 单 surface 行为。 */
  readonly currentSurface: Surface;
  /**
   * F046: 每个 surface 上次停留的 session（Coder/Partner 列表独立 → 当前 session 也按面记忆）。
   * **仅内存**：切面时快照当前面的 session、恢复目标面的；不跨重启持久化（重启两面都回 dashboard，
   * 与 Coder 现状一致）。
   */
  readonly sessionIdBySurface: Record<Surface, string | null>;
  /**
   * 显式切换（SurfaceTabs 点击）。原子地：① 快照离开面的当前 session（捕获实时值）
   * → ② 切 currentSurface + 持久化 → ③ 把 appStore.currentSessionId 恢复成目标面上次的
   * session（null → 该面 welcome/dashboard）。
   */
  setSurface: (surface: Surface) => void;
}

export const useSurfaceStore = create<SurfaceState>((set, get) => ({
  currentSurface: lsGetSurface(),
  sessionIdBySurface: { code: null, partner: null },
  setSurface: (surface) => {
    const prev = get().currentSurface;
    if (prev === surface) return;
    // ① 快照离开面的当前 session（appStore 是单向依赖：surface → app，无 cycle）。
    const app = useAppStore.getState();
    const leavingSessionId = app.currentSessionId;
    const stored = get().sessionIdBySurface[surface] ?? null;
    // 校验：目标面上次的 session 可能已在另一面被删除（review HIGH-1）。不在当前
    // sessions 列表里就回退到 null（该面 dashboard），避免 currentSessionId 指向 orphan id
    // 让 ConversationStreamV2 渲染一个已不存在的 session。
    const restoredSession =
      stored !== null ? app.sessions.find((s) => s.sessionId === stored) : undefined;
    const restored =
      restoredSession !== undefined &&
      sessionSurface(restoredSession) === surface &&
      sessionMatchesCurrentProject(restoredSession, app.currentProjectPath)
        ? stored
        : null;
    set((s) => ({
      currentSurface: surface,
      sessionIdBySurface: { ...s.sessionIdBySurface, [prev]: leavingSessionId },
    }));
    lsSetSurface(surface);
    // ③ 路由到目标面上次停留的 session（null → 该面 dashboard）。
    app.setCurrentSession(restored);
  },
}));

/** spec 取用便捷器（组件里读 layout/tools/scope 用）。 */
export function surfaceSpec(surface: Surface): SurfaceSpec {
  return SURFACES[surface];
}
