// Terminal IPC — FEATURE_011.
//
// 4 invoke channels wired to ptyHost singleton, plus push wiring (output + exit).
// Listeners registered once on first import — handlers are idempotent so calling
// registerTerminalChannels multiple times is safe.

import { promises as fs } from 'node:fs';
import { registerChannel } from './register.js';
import { pushToRenderer } from './push.js';
import { projectStore } from '../projects/store.js';
import { getPtyHost } from '../terminal/ptyHost.js';
import { settingsStore } from '../settings/store.js';

let listenersBound = false;

// F023 sec-MEDIUM: 把 renderer 端 MAX_TABS=10 UI cap 升级为 main 端硬上限，
// 防 renderer bug 或将来多窗口绕过 UI 直调 terminal.create 拉爆 PTY 数量。
const MAX_CONCURRENT_PTYS = 10;

export function registerTerminalChannels(): void {
  const host = getPtyHost();

  if (!listenersBound) {
    host.setListeners({
      onOutput: (ev) => {
        pushToRenderer('terminal.output', {
          terminalId: ev.terminalId,
          data: ev.data,
        });
      },
      onExit: (ev) => {
        pushToRenderer('terminal.exit', {
          terminalId: ev.terminalId,
          exitCode: ev.exitCode,
          signal: ev.signal,
        });
      },
    });
    listenersBound = true;
  }

  registerChannel('terminal.create', async (input) => {
    // F023: PTY 数硬上限 — 防资源耗尽
    if (host.count() >= MAX_CONCURRENT_PTYS) {
      throw new Error(`PTY limit reached (max ${MAX_CONCURRENT_PTYS} concurrent terminals)`);
    }
    // cwd 必须是 recent projects allowlist 内的目录 — 与 F005 / files/session 一致。
    // 然后 fs.realpath + 再次 assertAllowed —— 抓 "allowlist 中的项目是 symlink 指向其他位置"
    // 的逃逸（与 files-core.ts resolveInsideProject 对齐，security review HIGH-1）。
    const cwd = await projectStore.assertAllowed(input.cwd);
    const realCwd = await fs.realpath(cwd);
    if (realCwd !== cwd) {
      // 解析出与原路径不同的真实路径 → 再过一次 allowlist
      await projectStore.assertAllowed(realCwd);
    }
    const settings = await settingsStore.load();
    const created = host.create({
      cwd: realCwd,
      cols: input.cols,
      rows: input.rows,
      shellPreference: settings.terminalShell,
    });
    return { terminalId: created.terminalId, shell: created.shell, pid: created.pid };
  });

  registerChannel('terminal.write', async (input) => {
    const ok = host.write(input.terminalId, input.data);
    return { ok };
  });

  registerChannel('terminal.resize', async (input) => {
    const ok = host.resize(input.terminalId, input.cols, input.rows);
    return { ok };
  });

  registerChannel('terminal.kill', async (input) => {
    const ok = host.kill(input.terminalId);
    return { ok };
  });
}
