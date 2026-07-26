import assert from 'node:assert/strict';
import test from 'node:test';

import { SPACE_MANUAL_TOPICS } from '../kodax/space-manual-topics.js';

test('Space kodax_manual documents the required KodaX 0.7.77 capability boundary', () => {
  const topics = new Map(SPACE_MANUAL_TOPICS.map((topic) => [topic.id, topic]));
  const ids = [...topics.keys()];

  assert.equal(ids.length, SPACE_MANUAL_TOPICS.length, 'manual topic ids must be unique');
  for (const topic of SPACE_MANUAL_TOPICS) {
    for (const nextTopic of topic.nextTopics ?? []) {
      assert.ok(topics.has(nextTopic), `${topic.id} references missing next topic ${nextTopic}`);
    }
  }
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

test('Space kodax_manual distinguishes effective context pressure from cumulative session usage', () => {
  const topic = SPACE_MANUAL_TOPICS.find(
    (candidate) => candidate.id === 'context-window-and-session-tokens',
  );

  assert.ok(topic, 'context-window-and-session-tokens topic must exist');
  assert.match(topic.body, /自动压缩阈值为有效分母/);
  assert.match(topic.body, /模型最大上下文.*自动压缩阈值.*两个独立事实/);
  assert.match(topic.body, /输出容量不是活动输入/);
  assert.match(topic.body, /根 Agent 和所有子 Agent/);
  assert.match(topic.body, /缓存命中与缓存创建都是输入子集/);
  assert.match(topic.body, /跨模型应比较输入总量和输出/);
  assert.match(topic.body, /Skills \/ MCP.*六项/);
  assert.match(topic.body, /本次请求输入.*不是仍在等待处理的队列/);
  assert.match(topic.body, /当前为 0 的类别也会保留/);
  assert.match(topic.body, /不含系统提示词、消息、工具输入或工具输出正文/);
  assert.match(topic.body, /en-US.*zh-CN/);
});
