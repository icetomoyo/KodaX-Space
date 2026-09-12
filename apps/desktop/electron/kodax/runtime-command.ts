import type { RuntimeCommandInfo, RuntimeDaemonKodaXOptions } from '@kodax-ai/kodax/runtime';

export type RuntimeToolInvocation = NonNullable<RuntimeDaemonKodaXOptions['toolInvocation']>;

/** Resolve explicit operations from the owner catalog; never ask the model to dispatch them. */
export async function resolveRuntimeToolInvocation(
  prompt: string,
  resolveCommand: (name: string) => Promise<RuntimeCommandInfo | null>,
): Promise<RuntimeToolInvocation | undefined> {
  if (prompt.startsWith('!') && prompt.slice(1).trim()) {
    return { name: 'bash', input: { command: prompt.slice(1).trim() } };
  }
  const match = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/i.exec(prompt.trim());
  if (!match) return undefined;
  const command = await resolveCommand(match[1]!);
  if (command?.source !== 'extension') return undefined;
  return {
    name: `extension_command__${command.name}`,
    input: {
      args: [...(match[2] ?? '').matchAll(/"([^"]*)"|(\S+)/g)].map((part) => part[1] ?? part[2]!),
    },
  };
}
