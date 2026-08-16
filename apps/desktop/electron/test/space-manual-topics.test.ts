import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KODAX_UNDERLYING_CAPABILITY_TOPICS,
  MANUAL_REGISTRY,
  resolveKodaXManual,
} from '@kodax-ai/kodax/coding';
import { buildSpaceManual, SPACE_PRODUCT_NAME } from '../kodax/space-manual-topics.js';

const sdkManual = buildSpaceManual({
  KODAX_UNDERLYING_CAPABILITY_TOPICS,
  MANUAL_REGISTRY,
});
const SPACE_MANUAL_BASE_TOPICS = sdkManual.baseTopics;
const SPACE_MANUAL_TOPICS = sdkManual.topics;

test('Space kodax_manual preserves the installed SDK mechanism manual', () => {
  assert.deepEqual(SPACE_MANUAL_BASE_TOPICS, [...KODAX_UNDERLYING_CAPABILITY_TOPICS]);

  const overlays = new Map(SPACE_MANUAL_TOPICS.map((topic) => [topic.id, topic]));
  for (const id of KODAX_UNDERLYING_CAPABILITY_TOPICS) {
    const overlay = overlays.get(id);
    if (!overlay) continue;
    const sdkTopic = MANUAL_REGISTRY[id];
    assert.ok(
      overlay.body.includes(sdkTopic.body),
      `${id} must retain the exact installed SDK manual body`,
    );
    for (const source of sdkTopic.sources) {
      assert.ok(
        overlay.sources?.some(
          (candidate) => candidate.label === source.label && candidate.path === source.path,
        ),
        `${id} must retain SDK source ${source.path}`,
      );
    }
    for (const alias of sdkTopic.aliases ?? []) {
      assert.ok(overlay.aliases?.includes(alias), `${id} must retain SDK alias ${alias}`);
    }
  }

  const index = resolveKodaXManual(
    {},
    {
      productName: SPACE_PRODUCT_NAME,
      baseTopics: SPACE_MANUAL_BASE_TOPICS,
      extraTopics: SPACE_MANUAL_TOPICS,
    },
  );
  const effectiveIds = new Set(index.topics.map((topic) => topic.id));
  for (const id of KODAX_UNDERLYING_CAPABILITY_TOPICS) {
    assert.ok(effectiveIds.has(id), `effective manual must retain SDK topic ${id}`);
  }
  for (const topic of SPACE_MANUAL_TOPICS) {
    assert.ok(effectiveIds.has(topic.id), `effective manual must include Space topic ${topic.id}`);
  }

  const config = resolveKodaXManual(
    { topic: 'config' },
    {
      productName: SPACE_PRODUCT_NAME,
      baseTopics: SPACE_MANUAL_BASE_TOPICS,
      extraTopics: SPACE_MANUAL_TOPICS,
    },
  );
  assert.match(config.content, /~\/\.kodax\/integrations\/mcp\.json/);
  assert.match(config.content, /~\/\.kodax\/integrations\/a2a\.json/);
  assert.match(config.content, /~\/\.kodax\/integrations\/extensions\.json/);
  assert.match(config.content, /kodax integrations migrate --apply/);
  assert.match(config.content, /只创建缺失的目标文件/);
  assert.match(config.content, /目标文件已存在时不会被覆盖/);
  assert.match(config.content, /--cleanup-legacy/);
});

test('Space kodax_manual documents the required current KodaX capability boundary', () => {
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
  assert.match(topics.get('runtime-host')?.body ?? '', /session\.status/);
  assert.match(topics.get('runtime-host')?.body ?? '', /session\.diagnostics/);
  assert.match(topics.get('runtime-host')?.body ?? '', /不会根据已出现回答文本伪造完成/);
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
  assert.match(topics.get('permissions')?.body ?? '', /classifier reason/);
  assert.match(topics.get('sessions')?.body ?? '', /删除中/);
  assert.match(topics.get('agent-coordination')?.body ?? '', /mailbox yield/);
  assert.match(topics.get('agent-coordination')?.body ?? '', /普通 progress.*不会唤醒父模型/);
  assert.match(topics.get('agent-coordination')?.body ?? '', /每条队列消息只出队一次/);
  assert.match(topics.get('tools')?.body ?? '', /Goal 生命周期工具.*完整常驻契约/);
});

test('Space kodax_manual explains the customer runtime-mode switch without replacing SDK facts', () => {
  const topics = new Map(SPACE_MANUAL_TOPICS.map((topic) => [topic.id, topic]));
  const runtimeHost = topics.get('runtime-host')?.body ?? '';
  const settings = topics.get('settings')?.body ?? '';
  const troubleshooting = topics.get('troubleshooting')?.body ?? '';

  assert.match(runtimeHost, /Settings -> Runtime -> Coder runtime mode/);
  assert.match(runtimeHost, /Daemon 是推荐模式/);
  assert.match(runtimeHost, /Embedded 是.*兼容回退/);
  assert.match(runtimeHost, /admission gate/);
  assert.match(runtimeHost, /KODAX_SPACE_RUNTIME_HOST=.*一次迁移种子/);
  assert.match(runtimeHost, /version 3.*coderRuntimeMode/);
  assert.match(settings, /Coder runtime mode/);
  assert.match(troubleshooting, /选择 Embedded.*切换并重启/);
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

test('Space kodax_manual documents the daemon host-tool path for artifact creation', () => {
  const topics = new Map(SPACE_MANUAL_TOPICS.map((topic) => [topic.id, topic]));

  const artifacts = topics.get('artifacts')?.body ?? '';
  assert.match(artifacts, /mcp_search（server 为 "host"）/);
  assert.match(artifacts, /host:<leaseId>:create_artifact/);
  assert.match(artifacts, /子 Agent 随父 run 继承同一通道/);

  const mcp = topics.get('mcp')?.body ?? '';
  assert.match(mcp, /内置 host 能力源（server 名 "host"）/);
  assert.match(mcp, /按 run 绑定的 lease 作用域经 mcp_search\/mcp_call 暴露/);
});

test('Space kodax_manual describes the v0.1.42 runtime safety, recovery, close, and shell controls', () => {
  const topics = new Map(SPACE_MANUAL_TOPICS.map((topic) => [topic.id, topic]));

  assert.match(topics.get('runtime-host')?.body ?? '', /v0\.1\.42/);
  assert.match(topics.get('background-runtime')?.body ?? '', /F140/);
  assert.match(topics.get('background-runtime')?.body ?? '', /Close button behavior/);
  assert.match(topics.get('background-runtime')?.body ?? '', /macOS Cmd\+Q/);
  assert.match(topics.get('background-runtime')?.body ?? '', /30 秒 orphan grace/);
  assert.match(topics.get('background-runtime')?.body ?? '', /daemon\.json/);
  assert.match(topics.get('background-runtime')?.body ?? '', /kill -TERM/);
  assert.match(topics.get('background-runtime')?.body ?? '', /不要使用 `killall KodaX Space`/);
  assert.match(topics.get('runtime-host')?.body ?? '', /daemonOrphanExit v1/);
  assert.match(topics.get('runtime-host')?.body ?? '', /daemonShutdownVerification v1/);
  assert.match(topics.get('runtime-host')?.body ?? '', /sandboxRuntime v3/);
  assert.match(topics.get('overview')?.body ?? '', /stale inline owner reconciliation/);
  assert.match(topics.get('runtime-host')?.body ?? '', /managedRunDurability v1/);
  assert.match(topics.get('runtime-host')?.body ?? '', /runtimeEventCoalescing v1/);
  assert.match(topics.get('runtime-host')?.body ?? '', /integration config resilience v1/);
  assert.match(topics.get('runtime-host')?.body ?? '', /Auto LLM guardrail v4/);
  assert.match(topics.get('runtime-host')?.body ?? '', /Sandbox fallback/);
  assert.match(topics.get('runtime-host')?.body ?? '', /provider\.recovery/);
  assert.match(topics.get('runtime-host')?.body ?? '', /Ctrl\+R/);
  assert.match(topics.get('mcp')?.body ?? '', /last-known-good/);
  assert.match(topics.get('mcp')?.body ?? '', /revision.*watcher.*最近 reload/);
  assert.match(topics.get('settings')?.body ?? '', /Terminal Shell/);
  assert.match(topics.get('preview-terminal')?.body ?? '', /Coder 命令工具/);
});
