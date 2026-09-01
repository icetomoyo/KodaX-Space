import type { SlashCommandMeta } from '@kodax-space/space-ipc-schema';
import type { MessageKey } from '../i18n/messages.js';

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const SLASH_COMMAND_DESCRIPTION_KEYS: Readonly<Record<string, MessageKey>> = {
  mode: 'slash.command.mode.desc',
  provider: 'slash.command.provider.desc',
  reasoning: 'slash.command.reasoning.desc',
  model: 'slash.command.model.desc',
  thinking: 'slash.command.thinking.desc',
  clear: 'slash.command.clear.desc',
  'agent-mode': 'slash.command.agentMode.desc',
  workflow: 'slash.command.workflow.desc',
  new: 'slash.command.new.desc',
  copy: 'slash.command.copy.desc',
  cost: 'slash.command.cost.desc',
  compact: 'slash.command.compact.desc',
  tree: 'slash.command.tree.desc',
  history: 'slash.command.history.desc',
  help: 'slash.command.help.desc',
  repointel: 'slash.command.repointel.desc',
  doctor: 'slash.command.doctor.desc',
  status: 'slash.command.status.desc',
  review: 'slash.command.review.desc',
  auto: 'slash.command.auto.desc',
  fallback: 'slash.command.fallback.desc',
  'verifier-log': 'slash.command.verifierLog.desc',
  'stall-log': 'slash.command.stallLog.desc',
  goal: 'slash.command.goal.desc',
  learn: 'slash.command.learn.desc',
  exit: 'slash.command.exit.desc',
  paste: 'slash.command.paste.desc',
  reload: 'slash.command.reload.desc',
  extensions: 'slash.command.extensions.desc',
  mcp: 'slash.command.mcp.desc',
  recover: 'slash.command.recover.desc',
  save: 'slash.command.save.desc',
  load: 'slash.command.load.desc',
  sessions: 'slash.command.sessions.desc',
  delete: 'slash.command.delete.desc',
  fork: 'slash.command.fork.desc',
  rewind: 'slash.command.rewind.desc',
  skills: 'slash.command.skills.desc',
  skill: 'slash.command.skill.desc',
  memory: 'slash.command.memory.desc',
};

export function slashCommandDescription(meta: SlashCommandMeta, t: Translate): string {
  const key = meta.source === 'builtin' ? SLASH_COMMAND_DESCRIPTION_KEYS[meta.name] : undefined;
  return key ? t(key) : meta.description;
}
