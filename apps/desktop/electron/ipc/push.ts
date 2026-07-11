// main → renderer push 工具。
//
// 为什么不直接 import 一个 BrowserWindow 变量：window 在 dev HMR / 用户重开窗口时会重建。
// 我们维护一个 "current webContents getter"，main.ts 在 createMainWindow 时调
// setRendererTarget(getter) 注入，handler/host 用 pushToRenderer 走这个 getter 间接拿当前 webContents。

import {
  PUSH_CHANNEL_NAMES,
  getPushChannel,
  type PushChannelName,
  type PushPayload,
} from '@kodax-space/space-ipc-schema';
import type { WebContents } from 'electron';

let targetGetter: (() => WebContents | null) | null = null;

/** main.ts 在窗口创建后注入；窗口 destroy 时不必清空（getter 自己处理失效）。*/
export function setRendererTarget(getter: () => WebContents | null): void {
  targetGetter = getter;
}

/** True only for the current primary application renderer. */
export function isRendererTarget(sender: WebContents): boolean {
  const target = targetGetter?.();
  return (
    target !== null && target !== undefined && !target.isDestroyed() && sender.id === target.id
  );
}

/**
 * push 一条事件到 renderer。
 * 防御：channel 名必须在 PUSH_CHANNEL_NAMES 里（防 main 端代码顺手用了未注册名）；
 * payload 必须通过对应 channel 的 zod parse（防协议漂移，与 invoke 的出参校验对称）。
 * window 缺席（启动早期、关闭中）静默丢弃——push 是 fire-and-forget。
 */
export function pushToRenderer<C extends PushChannelName>(
  channel: C,
  payload: PushPayload<C>,
): void {
  if (!PUSH_CHANNEL_NAMES.has(channel)) {
    console.error(`[push] channel not in PUSH_CHANNEL_NAMES: ${channel}`);
    return;
  }
  const def = getPushChannel(channel);
  if (!def) {
    console.error(`[push] no schema for channel: ${channel}`);
    return;
  }
  // review F008 M-code-3：work_budget.used > cap 是不变量违反。schema 没法 enforce
  // （zod discriminatedUnion 不接受 refined 分支），这里在 push 前 clamp + warn。
  // 用 unknown 转换 + duck typing 避开 narrow——这层就是兜底
  if (channel === 'session.event' && payload && typeof payload === 'object') {
    const p = payload as { kind?: unknown; used?: unknown; cap?: unknown };
    if (
      p.kind === 'work_budget' &&
      typeof p.used === 'number' &&
      typeof p.cap === 'number' &&
      p.used > p.cap
    ) {
      console.warn(`[push] work_budget used (${p.used}) > cap (${p.cap}); clamping`);
      p.used = p.cap;
    }
  }
  const parsed = def.payload.safeParse(payload);
  if (!parsed.success) {
    // 只打 issue paths，不打值——payload 在 Real adapter 接入后可能携带 prompt / API key / 文件内容
    const paths = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    console.error(`[push] ${channel} payload schema invalid at: ${paths}`);
    return;
  }

  // 区分两种"无窗口"——便于调试启动期事件丢失
  if (targetGetter === null) {
    // 不应该发生：main.ts 在 createMainWindow 前就调 setRendererTarget。
    // 出现这种情况通常是 test 漏 setup 或 main.ts wire 顺序被改坏了。
    console.warn(`[push] ${channel} dropped: target getter not initialized (wire bug?)`);
    return;
  }
  const wc = targetGetter();
  if (!wc || wc.isDestroyed()) {
    // 正常 fire-and-forget——窗口未创建 / 已销毁。静默丢弃。
    return;
  }
  try {
    wc.send(channel, parsed.data);
  } catch (err) {
    // wc.send 在 webContents 进入异常状态时会 throw；不让一次 push 失败拖垮整个事件流
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[push] ${channel} wc.send threw: ${msg}`);
  }
}
