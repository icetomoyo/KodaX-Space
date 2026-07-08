// confirmStore — in-app confirmation dialog (replaces native window.confirm).
//
// 为什么不用 window.confirm：在 Electron (sandbox=true) 下原生 confirm/alert 会把 OS
// 键盘焦点从 webContents 夺走，关闭后 renderer 不可靠地拿不回来——表现为"删 session 后
// 输入栏点不动、打字不进 textarea"。`.focus()` 在 webContents 无 OS 焦点时是 no-op，
// 重试多少次都没用。团队此前已因同类问题把 window.prompt 换成 inline edit（见
// SessionContextMenu / SessionList 注释）。这里把 confirm 也换成应用内模态，从根上消除
// 原生对话框，焦点永远留在 webContents 内。
//
// API（promise 风格，调用点最小改动）：
//   const ok = await requestConfirm({ message, danger: true });
//   if (!ok) return;

import { create } from 'zustand';
import { translateMessage } from '../i18n/I18nProvider.js';

export interface ConfirmRequest {
  readonly id: number;
  readonly title?: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** danger=true 时确认按钮走红色样式（删除等不可逆操作）。 */
  readonly danger: boolean;
  readonly resolve: (ok: boolean) => void;
}

export interface ConfirmOptions {
  readonly title?: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly danger?: boolean;
}

interface ConfirmState {
  /** 同一时刻只显示一个 confirm；新请求若已有挂起的，先 resolve(false) 旧的再替换。 */
  readonly current: ConfirmRequest | null;
  request(opts: ConfirmOptions): Promise<boolean>;
  settle(id: number, ok: boolean): void;
}

let counter = 0;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  current: null,
  request: (opts) =>
    new Promise<boolean>((resolve) => {
      // 抢占式：丢弃上一个未决 confirm（视为取消），避免叠加。
      const prev = get().current;
      if (prev) prev.resolve(false);
      counter += 1;
      set({
        current: {
          id: counter,
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel ?? translateMessage('common.confirm'),
          cancelLabel: opts.cancelLabel ?? translateMessage('common.cancel'),
          danger: opts.danger ?? false,
          resolve,
        },
      });
    }),
  settle: (id, ok) =>
    set((s) => {
      if (!s.current || s.current.id !== id) return s;
      s.current.resolve(ok);
      return { current: null };
    }),
}));

/** 便捷 helper — 业务代码不必持有 zustand handle。 */
export function requestConfirm(opts: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().request(opts);
}
