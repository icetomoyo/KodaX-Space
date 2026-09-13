// Opt-in live acceptance: node --import tsx e2e/rc2-live-acceptance.mjs
// Uses an isolated desktop profile and the existing DeepSeek credential in memory.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as keyring from '@napi-rs/keyring/keytar.js';
import { launchSpace } from '../tests/e2e/fixtures.ts';

const reportDir = path.resolve('artifacts/rc2-live-acceptance');
await mkdir(reportDir, { recursive: true });
const credential =
  process.env.DEEPSEEK_API_KEY || (await keyring.getPassword('kodax-space', 'deepseek'));
assert.ok(credential, 'A configured DeepSeek credential is required for live acceptance');
const report = {
  sdk: '0.7.96-rc.2',
  provider: 'deepseek',
  model: 'deepseek-flash',
  checks: [],
  errors: [],
};
let space;
const step = (name) => process.stdout.write(`[live-e2e] ${name}\n`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label, probe, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await delay(500);
  }
  throw new Error(`Timed out: ${label}`);
}

async function invoke(name, input) {
  const response = await space.page.evaluate(
    async ({ name, input }) => window.kodaxSpace.invoke(name, input),
    { name, input },
  );
  if (!response.ok) throw new Error(`${name}: ${response.error?.message}`);
  return response.data;
}

async function send(prompt) {
  const textarea = space.page.locator('textarea').first();
  await textarea.fill(prompt);
  await textarea.press('Enter');
}

async function live(sessionId) {
  try {
    return await invoke('session.liveSnapshot', { sessionId });
  } catch (error) {
    // Space creates its local Session before the first Run is admitted by the owner.
    if (error.message.includes('Session not found:')) return { activeRun: null };
    if (error.message.includes('Session data changed during the read boundary:')) {
      report.snapshotReadConflicts = (report.snapshotReadConflicts ?? 0) + 1;
      return { activeRun: null };
    }
    throw error;
  }
}

async function waitStarted(sessionId, previousRunId) {
  return waitFor(
    'new Run admission',
    async () => {
      const snapshot = await live(sessionId);
      return snapshot.activeRun && snapshot.activeRun.runId !== previousRunId
        ? snapshot.activeRun
        : null;
    },
    45000,
  );
}

async function waitTerminal(sessionId, runId) {
  return waitFor(
    'Run settlement',
    async () => {
      const snapshot = await live(sessionId);
      return !snapshot.activeRun && snapshot.lastTerminalRun?.runId === runId
        ? snapshot.lastTerminalRun
        : null;
    },
    240000,
  );
}

async function shot(name) {
  await space.page.screenshot({ path: path.join(reportDir, `${name}.png`) });
}

try {
  step('launch packaged Space with real provider and isolated profile');
  space = await launchSpace(`rc2-live-${Date.now()}`, {
    executablePath: path.resolve('out/win-unpacked/KodaX Space.exe'),
    env: { KODAX_FORCE_MOCK: '0', DEEPSEEK_API_KEY: credential },
    onPageError: (error) => report.errors.push(error.message),
  });
  const projectRoot = path.join(space.testDataDir, 'workspace');
  await mkdir(projectRoot, { recursive: true });
  await space.seedProject(projectRoot);
  await waitFor(
    'Runtime ready',
    async () => (await invoke('runtime.profileSnapshot', undefined)).connection.state === 'ready',
    90000,
  );
  const profile = await invoke('runtime.profileSnapshot', undefined);
  report.connection = profile.connection;
  const daemon = JSON.parse(
    await readFile(path.join(space.testDataDir, 'runtime/daemon/coder/daemon.json'), 'utf8'),
  );
  assert.equal(daemon.version, report.sdk);
  report.actualSdkVersion = daemon.version;
  const session = await invoke('session.create', {
    projectRoot,
    provider: 'deepseek',
    model: 'deepseek-flash',
    permissionMode: 'full-access',
    reasoningMode: 'medium',
    agentMode: 'ama',
    surface: 'code',
  });
  report.sessionId = session.sessionId;
  await invoke('session.setTitle', { sessionId: session.sessionId, title: 'rc.2 live acceptance' });
  await space.page.reload();
  await space.page.waitForSelector('[data-space-shell-ready]', { timeout: 45000 });
  await space.page
    .locator(`[data-testid="sidebar-session-row"][data-session-id="${session.sessionId}"]`)
    .click({ timeout: 30000 });
  await shot('01-ready');

  step('real DeepSeek response');
  await send('只回复 LIVE_RC2_READY，不调用工具。');
  const first = await waitStarted(session.sessionId);
  const firstEnd = await waitTerminal(session.sessionId, first.runId);
  assert.equal(firstEnd.phase, 'completed');
  const history = await invoke('session.history', {
    sessionId: session.sessionId,
    requestId: randomUUID(),
  });
  assert.ok(
    history.items.some((item) => item.kind === 'assistant' && item.text.includes('LIVE_RC2_READY')),
  );
  report.checks.push({ name: 'real-provider', runId: first.runId, phase: firstEnd.phase });
  await shot('02-real-response');

  step('verify unsupported daemon explicit command is rejected before a new Run');
  await send('!node -e "process.stdout.write(\'EXPLICIT_TOOL_SHOULD_NOT_RUN\')"');
  await waitFor(
    'explicit command capability rejection',
    async () =>
      (await space.page.getByTestId('conversation-stream').innerText()).includes(
        'toolInvocation v1',
      ),
    30000,
  );
  const rejectedCommand = await live(session.sessionId);
  assert.ok(!rejectedCommand.activeRun);
  assert.equal(rejectedCommand.lastTerminalRun?.runId, first.runId);
  report.unsupportedCapabilities = [
    'daemon toolInvocation v1: explicit commands unavailable; Space rejects before admission',
  ];

  step('UI Stop during a real running tool');
  await send(
    '请使用 bash 工具执行并等待完成，不要后台执行、不要启动子代理：node -e "setTimeout(() => process.stdout.write(\'UNEXPECTED_LONG_FINISH\'), 90000)"',
  );
  const stopped = await waitStarted(session.sessionId, first.runId);
  await waitFor(
    'running shell tool',
    async () => (await live(session.sessionId)).activeTools?.some((tool) => tool.name === 'bash'),
    45000,
  );
  await space.page
    .locator('button[aria-label="Stop generation"], button[aria-label="停止生成"]')
    .click();
  const stoppedEnd = await waitTerminal(session.sessionId, stopped.runId);
  assert.ok(['interrupted', 'cancelled'].includes(stoppedEnd.phase), JSON.stringify(stoppedEnd));
  report.checks.push({ name: 'ui-stop', runId: stopped.runId, phase: stoppedEnd.phase });
  await shot('03-stopped');

  step('old Stop retry while a successor is active');
  await send(
    '请使用 bash 工具执行 node -e "setTimeout(() => process.stdout.write(\'SUCCESSOR_SURVIVED\'), 6000)"，命令结束后只回复 SUCCESSOR_SURVIVED，不要启动子代理。',
  );
  const successor = await waitStarted(session.sessionId, stopped.runId);
  const retryButton = space.page.getByRole('button', { name: 'Retry pending Stop request' });
  if (await retryButton.isVisible()) {
    await retryButton.click();
    await waitFor(
      'pending Stop retry cleared',
      async () => !(await retryButton.isVisible()),
      30000,
    );
    report.retryPath = 'renderer button';
  } else {
    const replay = await invoke('session.cancel', {
      sessionId: session.sessionId,
      runId: stopped.runId,
      requestId: randomUUID(),
      retry: 'unconfirmed',
    });
    assert.equal(replay.stop?.runId, stopped.runId);
    report.retryPath = 'IPC stale request (initial Stop already confirmed)';
  }
  const successorEnd = await waitTerminal(session.sessionId, successor.runId);
  assert.equal(successorEnd.phase, 'completed');
  report.checks.push({
    name: 'terminal-retry-preserves-successor',
    oldRunId: stopped.runId,
    successorRunId: successor.runId,
    phase: successorEnd.phase,
  });
  await shot('04-successor-survived');

  step('two native child agents read PNGs and write verifiable outputs');
  const png = await space.app.evaluate(({ nativeImage }) =>
    nativeImage
      .createFromBitmap(Buffer.alloc(64 * 64 * 4).fill(Buffer.from([255, 0, 0, 255])), {
        width: 64,
        height: 64,
      })
      .toPNG()
      .toString('base64'),
  );
  await writeFile(path.join(projectRoot, 'sample.png'), Buffer.from(png, 'base64'));
  await writeFile(path.join(reportDir, 'sample.png'), Buffer.from(png, 'base64'));
  await send(
    '这是子代理验收。请使用 spawn_agent 启动两个原生子代理，task_name 分别为 image_a 和 image_b。每个子代理必须自己用 read 工具读取工作区 sample.png，然后用 write 工具分别创建 child-a.txt 和 child-b.txt，内容写 PNG_READ_OK 和图片主色。父代理不要代读或代写，必须等待两个子代理均完成后总结。不要启动其他子代理。',
  );
  const parent = await waitStarted(session.sessionId, successor.runId);
  const parentEnd = await waitTerminal(session.sessionId, parent.runId);
  const actors = await invoke('agent.actor.snapshot', { sessionId: session.sessionId });
  report.actors = actors;
  report.childFiles = await Promise.all(
    ['child-a.txt', 'child-b.txt'].map(async (name) => ({
      name,
      content: await readFile(path.join(projectRoot, name), 'utf8'),
    })),
  );
  const children = actors.actors.filter((actor) => ['image_a', 'image_b'].includes(actor.taskName));
  assert.equal(children.length, 2);
  assert.ok(
    children.every((actor) => actor.latestTurn?.state === 'completed'),
    JSON.stringify(children),
  );
  for (const file of report.childFiles) {
    assert.match(file.content, /PNG_READ_OK/);
  }
  report.vision = {
    expectedColor: 'blue',
    passed: report.childFiles.every((file) => /蓝|blue/i.test(file.content)),
  };
  for (const child of children) {
    const activity = child.latestTurn.recentActivity.map((entry) => entry.summary).join('\n');
    assert.match(activity, /→ read /);
    assert.match(activity, /→ write /);
  }
  assert.equal(parentEnd.phase, 'completed');
  report.checks.push({
    name: 'native-children-png',
    runId: parent.runId,
    completedChildren: children.length,
  });
  await shot('05-children-completed');

  step('renderer reload restores the completed conversation');
  await space.page.reload();
  await space.page.waitForSelector('[data-space-shell-ready]', { timeout: 45000 });
  await space.page
    .locator(`[data-testid="sidebar-session-row"][data-session-id="${session.sessionId}"]`)
    .click();
  await waitFor(
    'restored history',
    async () =>
      (await space.page.getByTestId('conversation-stream').innerText()).includes('LIVE_RC2_READY'),
    30000,
  );
  await shot('06-reloaded');
  report.checks.push({ name: 'renderer-reload' });
  assert.deepEqual(report.errors, []);
  assert.ok(report.vision.passed, 'A child misidentified the blue PNG; see childFiles');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = String(error.message).replaceAll(credential, '<REDACTED>');
  if (space) {
    await shot('failure').catch(() => undefined);
    report.visibleText = (
      await space.page
        .locator('body')
        .innerText()
        .catch(() => '')
    ).slice(-12000);
    if (report.sessionId) report.lastLive = await live(report.sessionId).catch(() => null);
  }
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(reportDir, 'report.json'),
    JSON.stringify(report, null, 2).replaceAll(credential, '<REDACTED>'),
  );
  await space?.close();
}
step(JSON.stringify({ passed: report.passed, checks: report.checks, failure: report.failure }));
