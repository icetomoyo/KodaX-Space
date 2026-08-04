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

export const terminalShellPreferenceSchema = z.enum([
  'auto',
  'pwsh',
  'powershell',
  'cmd',
  'bash',
  'zsh',
]);
export type TerminalShellPreferenceT = z.infer<typeof terminalShellPreferenceSchema>;

export const windowCloseBehaviorSchema = z.enum(['ask', 'minimize-to-tray', 'quit-completely']);
export type WindowCloseBehaviorT = z.infer<typeof windowCloseBehaviorSchema>;

export const coderRuntimeModeSchema = z.enum(['daemon', 'embedded']);
export type CoderRuntimeModeT = z.infer<typeof coderRuntimeModeSchema>;

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
  terminalShell: terminalShellPreferenceSchema,
  windowCloseBehavior: windowCloseBehaviorSchema,
  coderRuntimeMode: coderRuntimeModeSchema,
  effectiveLocale: supportedLocaleSchema,
  preferredSystemLanguages: z.array(z.string().min(1).max(128)),
  runtimeDefaults: spaceRuntimeDefaultsSchema.default({}),
});

export type SpaceSettingsT = z.infer<typeof spaceSettingsSchema>;

export const KODAX_COMPACTION_TRIGGER_PERCENT_MIN = 15;
export const KODAX_COMPACTION_TRIGGER_PERCENT_MAX = 90;
export const KODAX_SANDBOX_ENV_PASS_MAX = 128;
export const KODAX_SANDBOX_ENV_NAME_MAX = 256;

export const kodaxCompactionSettingsSchema = z
  .object({
    enabled: z.literal(true).default(true),
    triggerPercent: z
      .number()
      .int()
      .safe()
      .transform((value) =>
        Math.min(
          KODAX_COMPACTION_TRIGGER_PERCENT_MAX,
          Math.max(KODAX_COMPACTION_TRIGGER_PERCENT_MIN, value),
        ),
      )
      .optional(),
    triggerTokens: z.number().int().min(0).max(10_000_000).optional(),
    contextWindow: z.number().int().min(1024).max(10_000_000).optional(),
  })
  .strict();
export type KodaxCompactionSettingsT = z.infer<typeof kodaxCompactionSettingsSchema>;

export const kodaxSandboxEnvironmentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(KODAX_SANDBOX_ENV_NAME_MAX)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

export const kodaxSandboxSettingsSchema = z
  .object({
    envPass: z.array(kodaxSandboxEnvironmentNameSchema).max(KODAX_SANDBOX_ENV_PASS_MAX),
  })
  .strict();
export type KodaxSandboxSettingsT = z.infer<typeof kodaxSandboxSettingsSchema>;

/**
 * Bounded renderer projection of KodaX's intentionally unbounded run config.
 * `editable=false` prevents the settings UI from saving a partial projection
 * when an existing CLI-authored allow-list exceeds the IPC editing limits.
 */
const kodaxSandboxConfigOverviewSchema = kodaxSandboxSettingsSchema.extend({
  totalEnvPass: z.number().int().safe().min(0),
  editable: z.boolean(),
});

const kodaxConfigErrorSchema = z
  .object({
    path: z.string().min(1).max(4096),
    error: z.string().min(1).max(512),
  })
  .strict();

export const kodaxIntegrationConfigSourceSchema = z.enum(['user', 'legacy-user', 'default']);
export type KodaxIntegrationConfigSourceT = z.infer<typeof kodaxIntegrationConfigSourceSchema>;

const kodaxMcpConfigSummarySchema = z
  .object({
    globalPath: z.string().min(1).max(4096),
    projectPath: z.string().min(1).max(4096).optional(),
    globalSource: kodaxIntegrationConfigSourceSchema,
    projectSource: kodaxIntegrationConfigSourceSchema.optional(),
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
    sandbox: kodaxSandboxConfigOverviewSchema,
    mcp: kodaxMcpConfigSummarySchema,
    skills: kodaxSkillStorageSchema,
    errors: z.array(kodaxConfigErrorSchema).max(8),
  })
  .strict();

export type KodaxConfigOverviewT = z.infer<typeof kodaxConfigOverviewSchema>;

const kodaxRuntimeConfigReloadSchema = z
  .object({
    status: z.enum(['applied', 'not-required', 'failed']),
    warning: z.string().min(1).max(512).optional(),
  })
  .strict();
export type KodaxRuntimeConfigReloadT = z.infer<typeof kodaxRuntimeConfigReloadSchema>;

const kodaxIntegrationMigrationDomainPlanSchema = z
  .object({
    action: z.enum(['create', 'none']),
    entries: z.number().int().min(0).max(100_000),
    destination: z.string().min(1).max(4096),
    reason: z.string().min(1).max(256).optional(),
  })
  .strict();

export const kodaxIntegrationMigrationPlanSchema = z
  .object({
    mcp: kodaxIntegrationMigrationDomainPlanSchema,
    extensions: kodaxIntegrationMigrationDomainPlanSchema,
    warnings: z.array(z.string().min(1).max(1024)).max(64),
  })
  .strict();
export type KodaxIntegrationMigrationPlanT = z.infer<typeof kodaxIntegrationMigrationPlanSchema>;

export const kodaxIntegrationMigrationResultSchema = kodaxIntegrationMigrationPlanSchema.extend({
  applied: z.array(z.enum(['mcp', 'extensions'])).max(2),
  cleanedLegacy: z.boolean(),
  runtimeReload: kodaxRuntimeConfigReloadSchema,
});
export type KodaxIntegrationMigrationResultT = z.infer<
  typeof kodaxIntegrationMigrationResultSchema
>;

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

export const settingsSetCoderRuntimeModeChannel = {
  name: 'settings.setCoderRuntimeMode',
  direction: 'invoke',
  input: z
    .object({
      coderRuntimeMode: coderRuntimeModeSchema,
    })
    .strict(),
  output: z
    .object({
      settings: spaceSettingsSchema,
      restarting: z.boolean(),
    })
    .strict(),
} as const;

export const settingsSetLanguageModeChannel = {
  name: 'settings.setLanguageMode',
  direction: 'invoke',
  input: z.object({
    languageMode: languageModeSchema,
  }),
  output: spaceSettingsSchema,
} as const;

export const settingsSetTerminalShellChannel = {
  name: 'settings.setTerminalShell',
  direction: 'invoke',
  input: z
    .object({
      terminalShell: terminalShellPreferenceSchema,
    })
    .strict(),
  output: spaceSettingsSchema,
} as const;

export const settingsSetWindowCloseBehaviorChannel = {
  name: 'settings.setWindowCloseBehavior',
  direction: 'invoke',
  input: z
    .object({
      windowCloseBehavior: windowCloseBehaviorSchema,
    })
    .strict(),
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
  output: kodaxConfigOverviewSchema.extend({
    runtimeReload: kodaxRuntimeConfigReloadSchema,
  }),
} as const;

export const settingsKodaxConfigSetSandboxChannel = {
  name: 'settings.kodaxConfig.setSandbox',
  direction: 'invoke',
  input: z
    .object({
      projectRoot: z.string().min(1).max(4096).optional(),
      sandbox: kodaxSandboxSettingsSchema,
    })
    .strict(),
  output: kodaxConfigOverviewSchema.extend({
    runtimeReload: kodaxRuntimeConfigReloadSchema,
  }),
} as const;

export const settingsKodaxConfigPlanIntegrationMigrationChannel = {
  name: 'settings.kodaxConfig.planIntegrationMigration',
  direction: 'invoke',
  input: z.object({}).strict(),
  output: kodaxIntegrationMigrationPlanSchema,
} as const;

export const settingsKodaxConfigApplyIntegrationMigrationChannel = {
  name: 'settings.kodaxConfig.applyIntegrationMigration',
  direction: 'invoke',
  input: z.object({}).strict(),
  output: kodaxIntegrationMigrationResultSchema,
} as const;
