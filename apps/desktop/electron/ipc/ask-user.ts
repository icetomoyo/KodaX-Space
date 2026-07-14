// askUser IPC handler — FEATURE_032
//
// 单 invoke channel：renderer 回答 main 端 askUserBroker pending request。
// pending 不存在（超时 / session cancel）返回 { ok: false }——不抛错，让 renderer
// 把残留 modal 关掉就好。

import { registerChannel } from './register.js';
import { askUserBroker } from '../permission/ask-user-broker.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';

export function registerAskUserChannels(): void {
  registerChannel('askUser.reply', async (input) => {
    if (runtimeHostAdapter.hasPendingUserInput(input.reqId)) {
      const ok = await runtimeHostAdapter.respondUserInput(
        input.reqId,
        'cancelled' in input
          ? { cancelled: true }
          : { value: 'value' in input ? input.value : input.verdict },
      );
      return { ok };
    }
    const ok = askUserBroker.resolve(input.reqId, input);
    return { ok };
  });
}
