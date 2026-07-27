// transcript-dedup — 整段对话重复渲染修复的核心(见 ipc/session.ts + 机制说明)。
// 覆盖两种重复源:新 session 的 [compacted] 占位、旧 session 的真内容 re-clone;并保证去重**限定
// 在 inactive 旧岛**——活动分支永不折叠(合法重复的活动消息必须保留)。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  entryContentKey,
  isCompactedPlaceholder,
  isRewindMarker,
  dedupeTranscriptEntries,
} from '../ipc/transcript-dedup.js';

// ── entryContentKey ──────────────────────────────────────────────────────────

test('entryContentKey: 克隆副本(新 entryId/timestamp、内容相同)得到同一个 key', () => {
  const original = { entryId: 'e_aaa', timestamp: '2026-06-01T00:00:00.000Z', type: 'message', message: { role: 'user', content: '帮我审查一下改动' } };
  const clone = { entryId: 'e_zzz', timestamp: '2026-06-02T09:30:00.000Z', type: 'message', message: { role: 'user', content: '帮我审查一下改动' } };
  assert.equal(entryContentKey(original), entryContentKey(clone), '克隆副本必须折叠');
});

test('entryContentKey: 内容不同 → key 不同(压缩前独有历史不被误折叠)', () => {
  const a = { type: 'message', message: { role: 'assistant', content: '第一步分析' } };
  const b = { type: 'message', message: { role: 'assistant', content: '第二步分析' } };
  assert.notEqual(entryContentKey(a), entryContentKey(b));
});

test('entryContentKey: role 参与身份(相同文本不同角色不折叠)', () => {
  assert.notEqual(
    entryContentKey({ type: 'message', message: { role: 'user', content: 'ok' } }),
    entryContentKey({ type: 'message', message: { role: 'assistant', content: 'ok' } }),
  );
});

test('entryContentKey: 不同压缩摘要(summary)→ key 不同(两次压缩的 notice 都保留)', () => {
  const c1 = { type: 'compaction', message: { role: 'system', content: '[对话历史摘要]\n\nA' }, summary: 'A' };
  const c2 = { type: 'compaction', message: { role: 'system', content: '[对话历史摘要]\n\nB' }, summary: 'B' };
  assert.notEqual(entryContentKey(c1), entryContentKey(c2));
});

// ── isCompactedPlaceholder ───────────────────────────────────────────────────

test('isCompactedPlaceholder: 规范块形状 / 裸字符串都识别;真消息不误判', () => {
  assert.equal(isCompactedPlaceholder({ type: 'message', message: { content: [{ type: 'text', text: '[compacted]' }] } }), true);
  assert.equal(isCompactedPlaceholder({ type: 'message', message: { content: '[compacted]' } }), true);
  assert.equal(isCompactedPlaceholder({ type: 'message', message: { content: [{ type: 'text', text: '真实内容' }] } }), false);
  // 正文里含 "[compacted]" 但不是纯占位、多块、非 message 类型 → 都不算
  assert.equal(isCompactedPlaceholder({ type: 'message', message: { content: [{ type: 'text', text: '提到 [compacted] 但还有别的字' }] } }), false);
  assert.equal(isCompactedPlaceholder({ type: 'message', message: { content: [{ type: 'text', text: '[compacted]' }, { type: 'text', text: 'x' }] } }), false);
  assert.equal(isCompactedPlaceholder({ type: 'compaction', message: { content: '[compacted]' } }), false);
});

// ── dedupeTranscriptEntries(限定 inactive 去重)────────────────────────────────

test('新 session:跳过 [compacted] 占位,保留活动分支 + 各岛摘要', () => {
  const entries = [
    { type: 'message', active: false, message: { role: 'user', content: [{ type: 'text', text: '[compacted]' }] } },
    { type: 'message', active: false, message: { role: 'assistant', content: [{ type: 'text', text: '[compacted]' }] } },
    { type: 'compaction', active: false, summary: '摘要一', message: { role: 'system', content: '[对话历史摘要]\n\n摘要一' } },
    { type: 'compaction', active: true, summary: '摘要二', message: { role: 'system', content: '[对话历史摘要]\n\n摘要二' } },
    { type: 'message', active: true, message: { role: 'user', content: 'M6 存活消息' } },
    { type: 'message', active: true, message: { role: 'assistant', content: 'A6' } },
  ];
  const out = dedupeTranscriptEntries(entries);
  // 2 个占位被跳;摘要一(inactive 独有)、摘要二(active)、M6、A6 保留
  assert.deepEqual(
    out.map((e) => e.summary ?? (e.message.content as string)),
    ['摘要一', '摘要二', 'M6 存活消息', 'A6'],
  );
});

test('活动压缩之前或之后的 inactive 压缩都保留，避免猜测 fork/rewind 谱系', () => {
  const entries = [
    {
      type: 'compaction',
      active: false,
      summary: '较早旁支摘要',
      message: { role: 'system', content: '较早旁支摘要' },
    },
    {
      type: 'compaction',
      active: true,
      summary: '活动摘要',
      message: { role: 'system', content: '活动摘要' },
    },
    {
      type: 'compaction',
      active: false,
      summary: '较晚废弃分支摘要',
      message: { role: 'system', content: '较晚废弃分支摘要' },
    },
  ];

  assert.deepEqual(
    dedupeTranscriptEntries(entries).map((entry) => entry.summary),
    ['较早旁支摘要', '活动摘要', '较晚废弃分支摘要'],
  );
});

test('旧 session:inactive 旧岛的真内容 re-clone 按内容折叠,保留一份(active)', () => {
  // 同一条消息 3 份:2 inactive(旧克隆)+ 1 active。全真内容、内容相同。
  const dup = (active: boolean, id: string) => ({ entryId: id, type: 'message', active, message: { role: 'user', content: '请你用workflow做review' } });
  const entries = [
    dup(false, 'e1'),
    { type: 'message', active: false, message: { role: 'user', content: '一条压缩前独有历史' } },
    dup(false, 'e2'),
    dup(true, 'e3'),
  ];
  const out = dedupeTranscriptEntries(entries);
  // 3 份 re-clone 折叠成 1(active 那份保留);独有历史保留 → 共 2 条
  assert.equal(out.length, 2);
  assert.equal(out.filter((e) => (e.message.content as string).includes('workflow')).length, 1, 're-clone 只剩一份');
  assert.ok(out.some((e) => (e.message.content as string).includes('压缩前独有历史')), '独有历史不丢');
});

test('活动分支永不折叠:两条逐字节相同的**活动**消息都保留(合法重复)', () => {
  const entries = [
    { type: 'message', active: true, message: { role: 'user', content: 'ok' } },
    { type: 'message', active: true, message: { role: 'assistant', content: '好的,开始' } },
    { type: 'message', active: true, message: { role: 'user', content: 'ok' } }, // 合法重复
  ];
  const out = dedupeTranscriptEntries(entries);
  assert.equal(out.length, 3, '活动分支的合法重复必须全保留');
  assert.equal(out.filter((e) => e.message.content === 'ok').length, 2);
});

test('inactive 独有历史里的两条相同短消息:折叠(旧岛重复必是克隆产物,低风险)', () => {
  const entries = [
    { type: 'message', active: false, message: { role: 'user', content: 'ok' } },
    { type: 'message', active: false, message: { role: 'user', content: 'ok' } },
  ];
  assert.equal(dedupeTranscriptEntries(entries).length, 1);
});

test('active 缺省(旧 SDK / mock 回退)→ 视作 inactive,按内容折叠,无压缩场景下等价原样', () => {
  const entries = [
    { type: 'message', message: { role: 'user', content: 'hi' } },
    { type: 'message', message: { role: 'assistant', content: 'hello' } },
  ];
  assert.equal(dedupeTranscriptEntries(entries).length, 2, '无重复 → 全保留');
});
test('rewind markers are not rendered as compaction notices', () => {
  const marker = {
    type: 'compaction',
    active: false,
    summary: '[Rewind] Rewound to entry entry_a (truncated 3 entries)',
    payload: { reason: 'rewind' },
    message: { role: 'system', content: '[history]\n\n[Rewind] Rewound to entry entry_a' },
  };
  assert.equal(isRewindMarker(marker), true);
  assert.deepEqual(
    dedupeTranscriptEntries([
      { type: 'message', active: true, message: { role: 'user', content: 'kept' } },
      marker,
    ]).map((e) => ('summary' in e ? e.summary : e.message.content)),
    ['kept'],
  );
});
