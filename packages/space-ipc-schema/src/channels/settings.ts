// Space user-level settings channels — alpha.1
//
// 只走标量；secrets/API keys 通过 provider.setKey 走 keychain。
//
// 当前 surface：
//   - settings.get → 拿全部当前设置
//   - settings.setDefaultWorkspace { path } → 改默认 workspace + ensureExists 一次

import { z } from 'zod';
import {
  agentModeSchema,
  autoModeEngineSchema,
  permissionModeSchema,
  reasoningModeSchema,
} from './session.js';

export const supportedLocaleSchema = z.enum(['zh-CN', 'en-US']);
export type SupportedLocaleT = z.infer<typeof supportedLocaleSchema>;

export const languageModeSchema = z.enum(['system', 'zh-CN', 'en-US']);
export type LanguageModeT = z.infer<typeof languageModeSchema>;

const spaceRuntimeDefaultsSchema = z
  .object({
    permissionMode: permissionModeSchema.optional(),
    autoModeEngine: autoModeEngineSchema.optional(),
    reasoningMode: reasoningModeSchema.optional(),
    agentMode: agentModeSchema.optional(),
  })
  .strict();

export type SpaceRuntimeDefaultsT = z.infer<typeof spaceRuntimeDefaultsSchema>;

export function resolveEffectiveLocale(
  languageMode: LanguageModeT,
  preferredLanguages: readonly string[],
): SupportedLocaleT {
  if (languageMode === 'zh-CN' || languageMode === 'en-US') return languageMode;

  for (const raw of preferredLanguages) {
    const value = raw.trim().toLowerCase();
    if (value === '' || value === 'c' || value === 'posix') continue;
    if (
      value === 'zh-cn' ||
      value === 'zh-hans' ||
      value.startsWith('zh-cn-') ||
      value.startsWith('zh-hans-')
    ) {
      return 'zh-CN';
    }
    if (value === 'zh') return 'zh-CN';
  }

  return 'en-US';
}

const spaceSettingsSchema = z.object({
  defaultWorkspace: z.string().min(1).max(4096),
  languageMode: languageModeSchema,
  effectiveLocale: supportedLocaleSchema,
  preferredSystemLanguages: z.array(z.string().min(1).max(128)),
  runtimeDefaults: spaceRuntimeDefaultsSchema.default({}),
});

export type SpaceSettingsT = z.infer<typeof spaceSettingsSchema>;

export const KODAX_COMPACTION_TRIGGER_PERCENT_MIN = 15;
export const KODAX_COMPACTION_TRIGGER_PERCENT_MAX = 90;

export const kodaxCompactionSettingsSchema = z
  .object({
    enabled: z.literal(true).default(true),
    triggerPercent: z
      .number()
      .int()
      .min(KODAX_COMPACTION_TRIGGER_PERCENT_MIN)
      .max(KODAX_COMPACTION_TRIGGER_PERCENT_MAX)
      .optional(),
    triggerTokens: z.number().int().min(0).max(10_000_000).optional(),
    contextWindow: z.number().int().min(1024).max(10_000_000).optional(),
  })
  .strict();
export type KodaxCompactionSettingsT = z.infer<typeof kodaxCompactionSettingsSchema>;

const kodaxConfigErrorSchema = z
  .object({
    path: z.string().min(1).max(4096),
    error: z.string().min(1).max(512),
  })
  .strict();

const kodaxMcpConfigSummarySchema = z
  .object({
    globalPath: z.string().min(1).max(4096),
    projectPath: z.string().min(1).max(4096).optional(),
    globalConfigExists: z.boolean(),
    projectConfigExists: z.boolean().optional(),
    globalServers: z.number().int().min(0).max(128),
    projectServers: z.number().int().min(0).max(128),
  })
  .strict();

const kodaxSkillStorageSchema = z
  .object({
    userSkillsDir: z.string().min(1).max(4096),
    projectSkillsDir: z.string().min(1).max(4096).optional(),
  })
  .strict();

const kodaxConfigOverviewSchema = z
  .object({
    configPath: z.string().min(1).max(4096),
    configExists: z.boolean(),
    compaction: kodaxCompactionSettingsSchema,
    mcp: kodaxMcpConfigSummarySchema,
    skills: kodaxSkillStorageSchema,
    errors: z.array(kodaxConfigErrorSchema).max(8),
  })
  .strict();

export type KodaxConfigOverviewT = z.infer<typeof kodaxConfigOverviewSchema>;

export const settingsGetChannel = {
  name: 'settings.get',
  direction: 'invoke',
  input: z.object({}).strict(),
  output: spaceSettingsSchema,
} as const;

export const settingsSetDefaultWorkspaceChannel = {
  name: 'settings.setDefaultWorkspace',
  direction: 'invoke',
  input: z.object({
    path: z.string().min(1).max(4096),
  }),
  output: spaceSettingsSchema,
} as const;

export const settingsSetLanguageModeChannel = {
  name: 'settings.setLanguageMode',
  direction: 'invoke',
  input: z.object({
    languageMode: languageModeSchema,
  }),
  output: spaceSettingsSchema,
} as const;

export const settingsSetRuntimeDefaultsChannel = {
  name: 'settings.setRuntimeDefaults',
  direction: 'invoke',
  input: z.object({
    runtimeDefaults: spaceRuntimeDefaultsSchema.partial().strict(),
  }),
  output: spaceSettingsSchema,
} as const;

export const settingsKodaxConfigGetChannel = {
  name: 'settings.kodaxConfig.get',
  direction: 'invoke',
  input: z
    .object({
      projectRoot: z.string().min(1).max(4096).optional(),
    })
    .strict(),
  output: kodaxConfigOverviewSchema,
} as const;

export const settingsKodaxConfigSetCompactionChannel = {
  name: 'settings.kodaxConfig.setCompaction',
  direction: 'invoke',
  input: z
    .object({
      projectRoot: z.string().min(1).max(4096).optional(),
      compaction: kodaxCompactionSettingsSchema,
    })
    .strict(),
  output: kodaxConfigOverviewSchema,
} as const;
