import assert from 'node:assert/strict';
import test from 'node:test';

import { SPACE_MANUAL_TOPICS } from '../kodax/space-manual-topics.js';

test('Space kodax_manual documents the required KodaX 0.7.74 capability boundary', () => {
  const topics = new Map(SPACE_MANUAL_TOPICS.map((topic) => [topic.id, topic]));
  const ids = [...topics.keys()];

  assert.equal(ids.length, SPACE_MANUAL_TOPICS.length, 'manual topic ids must be unique');
  assert.match(topics.get('runtime-host')?.body ?? '', /contextCompaction v3/);
  assert.match(topics.get('runtime-host')?.body ?? '', /transcriptSearch v1/);
  assert.match(topics.get('runtime-host')?.body ?? '', /精确 checkpoint 字节/);
  assert.match(topics.get('runtime-host')?.body ?? '', /精确 flat Session history/);
  assert.match(topics.get('composer')?.body ?? '', /interrupt input/);
  assert.match(topics.get('composer')?.body ?? '', /保留 queued input/);
  assert.match(topics.get('composer')?.body ?? '', /不含用户正文/);
  assert.match(topics.get('sessions')?.body ?? '', /跳过空的 ACP 占位会话/);
  assert.match(topics.get('sessions')?.body ?? '', /workspace runtime.*UI history.*artifacts/);
  assert.match(topics.get('permissions')?.body ?? '', /-LiteralPath/);
  assert.match(topics.get('permissions')?.body ?? '', /方括号通配符/);
  assert.match(topics.get('permissions')?.body ?? '', /Auto\[LLM\].*Auto\[RULES\]/);
  assert.match(topics.get('permissions')?.body ?? '', /最后一次动作/);
  assert.match(topics.get('permissions')?.body ?? '', /\/auto-engine llm/);
  assert.match(topics.get('agent-coordination')?.body ?? '', /mailbox yield/);
  assert.match(topics.get('agent-coordination')?.body ?? '', /普通 progress.*不会唤醒父模型/);
  assert.match(topics.get('agent-coordination')?.body ?? '', /每条队列消息只出队一次/);
  assert.match(topics.get('tools')?.body ?? '', /Goal 生命周期工具.*完整常驻契约/);
});
