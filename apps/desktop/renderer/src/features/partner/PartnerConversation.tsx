// PartnerConversation — Partner 三栏之中栏：对话 + 输入。
//
// 复用 Coder 的 ConversationStreamV2（transcript，surface 无关，按 currentSessionId 取数）
// 与 BottomBar（输入框，F046 已按 surface 裁剪 Coder 专属控件）。无 Partner session 时
// 显示 PartnerWelcome；用户在 BottomBar 发首条消息 → ensureSession 懒建 surface=partner 会话。
//
// 不另造对话引擎（ADR-007：Partner 是同一 runtime 上的画像组合，不是新内核）。

import { useAppStore } from '../../store/appStore.js';
import { ConversationStreamV2 } from '../../shell/ConversationStreamV2.js';
import { BottomBar } from '../../shell/BottomBar.js';
import { PartnerWelcome } from './PartnerWelcome.js';
import { PartnerWorkbenchPanel } from './PartnerWorkbenchPanel.js';

export function PartnerConversation(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  return (
    <div
      className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden relative"
      data-testid="partner-conversation"
    >
      <PartnerWorkbenchPanel />
      {currentSessionId ? <ConversationStreamV2 key={currentSessionId} /> : <PartnerWelcome />}
      <BottomBar />
    </div>
  );
}
