// IPC channel registration helper — wraps ipcMain.handle with zod parse + envelope.
//
// 设计：
// - 每个 channel 入参强制 zod parse，失败返回 { ok:false, error:{code:'SCHEMA_INVALID',...} }
// - handler 抛异常被 catch，转 { ok:false, error:{code:'HANDLER_ERROR',...} }
// - 出参也 zod parse（防 main 端"协议漂移"——返回的 shape 与 schema 不符也立即暴露）
// - main 永远不向 renderer throw

import { createRequire } from 'node:module';
import {
  invokeChannels,
  fail,
  ok,
  truncateZodError,
  type IpcResult,
  type InvokeChannelName,
  type ChannelInput,
  type ChannelOutput,
} from '@kodax-space/space-ipc-schema';
import type { IpcMainInvokeEvent } from 'electron';

// 惰性拿 ipcMain —— **不**在 top-level `import { ipcMain } from 'electron'`。
// 否则任何 import 本模块的代码（含测试经 slash.ts / ipc handler 的依赖链）在 tsx
// 测试环境（无 electron runtime）的 import 期就撞 "electron has no export 'ipcMain'"。
// 改惰性：仅生产 main 调 registerChannel 时才求值 electron；测试 import 但不注册 channel → 不触发。
// require/createRequire 双轨同 catalog.ts：main build 输出 CJS 走 require，tsx 走 createRequire。
let ipcMainCache: typeof import('electron').ipcMain | null = null;
function getIpcMain(): typeof import('electron').ipcMain {
  if (ipcMainCache !== null) return ipcMainCache;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = typeof require !== 'undefined' ? null : (import.meta as any);
  const req = meta ? createRequire(meta.url) : require;
  const m = req('electron').ipcMain as typeof import('electron').ipcMain;
  ipcMainCache = m;
  return m;
}

type Handler<C extends InvokeChannelName> = (
  input: ChannelInput<C>,
) => Promise<ChannelOutput<C>> | ChannelOutput<C>;

type EventHandler<C extends InvokeChannelName> = (
  input: ChannelInput<C>,
  event: IpcMainInvokeEvent,
) => Promise<ChannelOutput<C>> | ChannelOutput<C>;

const registeredChannels = new Set<string>();

export function registerChannel<C extends InvokeChannelName>(name: C, handler: Handler<C>): void {
  registerChannelInternal(name, (input) => handler(input));
}

/** Register a channel whose authorization needs the Electron sender identity. */
export function registerChannelWithEvent<C extends InvokeChannelName>(
  name: C,
  handler: EventHandler<C>,
): void {
  registerChannelInternal(name, handler);
}

function registerChannelInternal<C extends InvokeChannelName>(
  name: C,
  handler: EventHandler<C>,
): void {
  if (registeredChannels.has(name)) {
    throw new Error(`[ipc] channel already registered: ${name}`);
  }
  const def = invokeChannels[name];
  registeredChannels.add(name);

  getIpcMain().handle(name, async (_event, rawInput): Promise<IpcResult<ChannelOutput<C>>> => {
    const parsedInput = def.input.safeParse(rawInput);
    if (!parsedInput.success) {
      // OC-09 安全：用 truncateZodError 替代 .flatten() —— flatten() 会把所有
      // issue 全塞进去，对大 payload (>1MB prompt) 可能产出 KB 级 details，进而
      // 流到 main 日志 / renderer console。truncateZodError 剥掉原值字段、限到 1KB。
      return fail(
        'SCHEMA_INVALID',
        `[${name}] input failed schema validation`,
        truncateZodError(parsedInput.error),
      );
    }

    let result: ChannelOutput<C>;
    try {
      result = await handler(parsedInput.data as ChannelInput<C>, _event);
    } catch (err) {
      // 不把 err 原对象塞进 envelope——可能携带敏感字段（FEATURE_003 接 LLM 后尤其重要）
      const message = err instanceof Error ? err.message : String(err);
      return fail('HANDLER_ERROR', `[${name}] handler threw: ${message}`);
    }

    const parsedOutput = def.output.safeParse(result);
    if (!parsedOutput.success) {
      // OC-09 同入参：output 也走 truncate，handler 可能返回包含敏感字段的对象
      return fail(
        'OUTPUT_INVALID',
        `[${name}] handler returned schema-invalid output`,
        truncateZodError(parsedOutput.error),
      );
    }

    return ok(parsedOutput.data as ChannelOutput<C>);
  });
}

export function listRegisteredChannels(): readonly string[] {
  return [...registeredChannels];
}
