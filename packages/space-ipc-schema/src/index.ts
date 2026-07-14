// Public surface of @kodax-space/space-ipc-schema.
//
// 消费端：
//   - main:     import { invokeChannels, ok, fail } from '@kodax-space/space-ipc-schema'
//   - preload:  import { INVOKE_CHANNEL_NAMES, PUSH_CHANNEL_NAMES } from '...'
//   - renderer: import type { ChannelInput, ChannelOutput, IpcResult } from '...'
//
// FEATURE_001 时这里只有一个最小 versionChannel；FEATURE_002 起完整 envelope + registry。

export {
  IPC_ERROR_CODES,
  ipcErrorSchema,
  ok,
  fail,
  type IpcError,
  type IpcErrorCode,
  type IpcResult,
} from './envelope.js';

export { truncateZodError, type SafeZodIssue, type SafeZodErrorDetails } from './utils.js';

export { canonProjectRoot } from './path-canon.js';

export { invokeChannels, pushChannels } from './channels/index.js';
export type { InvokeChannels, PushChannels } from './channels/index.js';

export {
  versionChannel,
  spaceCapabilitySchema,
  spaceCapabilityStatusSchema,
  type SpaceCapability,
  type SpaceCapabilityStatus,
  type SpaceVersionOutput,
} from './channels/version.js';

export {
  runtimeProfileSnapshotChannel,
  runtimeProfileChangedChannel,
  runtimeConnectionChangedChannel,
  sessionLiveSnapshotChannel,
  sessionLiveChangedChannel,
  spaceRuntimeCursorSchema,
  spaceRuntimeInitiatorSchema,
  spaceRuntimeCapabilitySchema,
  spaceCoderConnectionStateSchema,
  spaceCoderConnectionProjectionSchema,
  spaceRuntimeRunPhaseSchema,
  spaceRuntimeRunProjectionSchema,
  spaceRuntimeSessionProfileSchema,
  spaceRuntimeInteractionSchema,
  spaceRuntimeNotificationSchema,
  spaceRuntimeProfileProjectionSchema,
  spaceRuntimeDraftSchema,
  spaceRuntimeActiveToolSchema,
  spaceRuntimeTodoSchema,
  spaceRuntimeManagedTaskSchema,
  spaceRuntimeSessionSettingsSchema,
  spaceRuntimeQueuedInputSchema,
  spaceSessionLiveProjectionSchema,
  spaceSessionLiveDomainChangeSchema,
  spaceSessionLiveChangedSchema,
  type SpaceRuntimeCursorT,
  type SpaceRuntimeInitiatorT,
  type SpaceRuntimeCapabilityT,
  type SpaceCoderConnectionStateT,
  type SpaceCoderConnectionProjectionT,
  type SpaceRuntimeRunPhaseT,
  type SpaceRuntimeRunProjectionT,
  type SpaceRuntimeInteractionT,
  type SpaceRuntimeProfileProjectionT,
  type SpaceRuntimeSessionSettingsT,
  type SpaceSessionLiveProjectionT,
  type SpaceSessionLiveDomainChangeT,
  type SpaceSessionLiveChangedT,
} from './channels/runtime.js';

export {
  diagnosticsLevelSchema,
  diagnosticsComponentSchema,
  diagnosticsExportCategorySchema,
  diagnosticsReportChannel,
  diagnosticsExportChannel,
  type DiagnosticsExportCategory,
} from './channels/diagnostics.js';

export {
  spaceActionIdSchema,
  spaceActionValueSchema,
  spaceActionArgsSchema,
  spaceControlRequestedChannel,
  spaceControlResultSchema,
  spaceControlResolveChannel,
  type SpaceActionIdT,
  type SpaceActionValueT,
  type SpaceActionArgsT,
  type SpaceControlResultT,
} from './channels/space-control.js';

export {
  repointelStatusChannel,
  repointelPrewarmChannel,
  repointelStatusItemSchema,
  type RepointelStatusItemT,
  type RepointelStatusOutput,
} from './channels/repointel.js';

export {
  handoffAcceptChannel,
  handoffChangedChannel,
  handoffDismissChannel,
  handoffFileSchema,
  handoffListChannel,
  handoffStatusSchema,
  type HandoffFileT,
  type HandoffStatusT,
} from './channels/handoff.js';

export {
  sessionCreateChannel,
  sessionPromoteEphemeralChannel,
  sessionSendChannel,
  sessionCancelChannel,
  sessionListChannel,
  sessionDeleteChannel,
  sessionSetTitleChannel,
  sessionSetReasoningModeChannel,
  sessionSetProviderChannel,
  sessionSetPermissionModeChannel,
  sessionSetAutoModeEngineChannel,
  sessionSetAgentModeChannel,
  sessionForkChannel,
  sessionRewindChannel,
  sessionAgentsMdChannel,
  sessionAgentsMdSaveChannel,
  type AgentsFileMeta,
  sessionHistoryChannel,
  sessionLocalNoticeAppendChannel,
  sessionLocalNoticeReplaceChannel,
  sessionListRunningChannel,
  type RunningSessionInfoT,
  type SessionHistoryItem,
  type SessionLocalNotice,
  sessionEventChannel,
  type PermissionMode,
  type AutoModeEngine,
  type AgentMode,
  type ReasoningMode,
  type Surface,
  type SessionMeta,
  type SessionEvent,
  type SessionEventKind,
  type InputArtifact,
  type InputArtifactSource,
  type SessionSendQueueMode,
} from './channels/session.js';

export {
  clipboardSaveImageChannel,
  clipboardReadImageChannel,
  clipboardCleanupSessionChannel,
} from './channels/clipboard.js';

export {
  projectListChannel,
  projectOpenDialogChannel,
  projectRecentAddChannel,
  projectRecentRemoveChannel,
  projectRecentRenameChannel,
  projectRecentSetArchivedChannel,
  projectGitStatsChannel,
  projectGitStatusChannel,
  projectGitChangesChannel,
  projectGitFileDiffChannel,
  projectFileSearchChannel,
  projectGitDiffChannel,
  type Project,
  type ProjectGitStatsDaily,
} from './channels/project.js';

export {
  ASK_USER_BACK_SIGNAL,
  ASK_USER_CUSTOM_INPUT_SIGNAL,
  askUserRequestChannel,
  askUserReplyChannel,
  askUserCancelledChannel,
  type AskUserVerdict,
  type AskUserSignal,
  type AskUserToolCall,
  type AskUserQuestionOption,
  type AskUserQuestionAnswer,
  type AskUserReplyValue,
  type AskUserReplyInput,
  type AskUserRequestPayload,
} from './channels/ask-user.js';

export {
  slashDiscoverChannel,
  slashExecChannel,
  type SlashCommandMeta,
  type SlashCommandSource,
} from './channels/slash.js';

export {
  skillDiscoverChannel,
  skillInstallChannel,
  skillInvokeChannel,
  skillMetaSchema,
  type SkillMeta,
  type SkillSource,
} from './channels/skill.js';

export {
  agentDiscoverChannel,
  externalAgentStatusChannel,
  externalAgentRegistrationListChannel,
  externalAgentReferenceUpsertChannel,
  externalAgentRegistrationRemoveChannel,
  externalAgentDispatchableListChannel,
  externalAgentPreflightChannel,
  externalAgentTaskListChannel,
  externalAgentTaskStartChannel,
  externalAgentTaskEventsChannel,
  externalAgentTaskSendInputChannel,
  externalAgentTaskCancelChannel,
  externalAgentTaskReconcileChannel,
  type AgentMeta,
  type AgentSource,
  type AgentFailure,
  type ExternalAgentRegistrationSummaryT,
  type DispatchableAgentListingT,
  type ExternalAgentTaskT,
  type ExternalAgentTaskEventT,
} from './channels/agent.js';

export {
  mcpDiscoverChannel,
  mcpServersChannel,
  mcpStartChannel,
  mcpStopChannel,
  mcpLogsChannel,
  mcpToolsChannel,
  mcpReloadChannel,
  type McpServerMeta,
  type McpTransport,
  type McpServerStatusT,
  type McpRuntimeStatusT,
} from './channels/mcp.js';

export { kodaxGetDefaultsChannel, type KodaxUserDefaults } from './channels/kodax.js';

export {
  adminPolicySchemaVersion,
  adminAuditCategorySchema,
  adminAuditOutcomeSchema,
  adminPolicySchema,
  adminPolicyUpdateSchema,
  adminAuditEventSchema,
  adminPolicyGetChannel,
  adminPolicySetChannel,
  adminPolicyExportChannel,
  adminAuditListChannel,
  adminAuditExportChannel,
  type AdminAuditCategoryT,
  type AdminAuditOutcomeT,
  type AdminPolicyT,
  type AdminPolicyUpdateT,
  type AdminAuditEventT,
} from './channels/admin.js';

export {
  kodaxQueueGetChannel,
  kodaxQueueChangedChannel,
  type QueuedMessageT,
  type MessagePriorityT,
  type MessageModeT,
  type QueueEventKindT,
} from './channels/queue.js';

export {
  permissionRequestChannel,
  permissionCancelledChannel,
  permissionAnswerChannel,
  permissionListChannel,
  permissionRevokeChannel,
  type PermissionRisk,
  type PermissionDecision,
  type PermissionToolCall,
  type PermissionRule,
  type PermissionRequestPayload,
  type PermissionCancelledPayload,
} from './channels/permission.js';

export {
  providerListChannel,
  providerSetKeyChannel,
  providerRemoveKeyChannel,
  providerTestChannel,
  providerSetDefaultChannel,
  providerAddCustomChannel,
  providerUpdateCustomChannel,
  providerRemoveCustomChannel,
  providerModelContextWindowChannel,
  customProviderReasoningSchema,
  type ProviderInfo,
  type ProviderProtocol,
  type CustomProviderReasoning,
} from './channels/provider.js';

export {
  filesTreeChannel,
  filesReadChannel,
  filesReadBinaryChannel,
  filesStatChannel,
  filesDiffChannel,
  fileNodeSchema,
  MAX_FILE_BYTES,
  MAX_TREE_NODES,
  type FileNodeT,
  type FileStatKindT,
} from './channels/files.js';

export {
  partnerSourceKindSchema,
  partnerSourceTargetKindSchema,
  partnerSourceSchema,
  partnerSourcesListChannel,
  partnerSourcesAddChannel,
  partnerSourcesRemoveChannel,
  type PartnerSourceKindT,
  type PartnerSourceTargetKindT,
  type PartnerSourceT,
} from './channels/partner-source.js';

export {
  partnerKbSummaryChannel,
  partnerKbPagesChannel,
  partnerKbReadPageChannel,
  partnerKbWritePageChannel,
  partnerKbSearchChannel,
  partnerKbRebuildIndexChannel,
  partnerKbLintChannel,
  partnerKbConfigGetChannel,
  partnerKbConfigSetChannel,
  partnerKbMaintenanceRunChannel,
  partnerKbMaintenanceLastChannel,
  partnerKbPageTypeSchema,
  partnerKbConfidenceSchema,
  partnerKbPageStatusSchema,
  partnerKbPageRefSchema,
  partnerKbPageSchema,
  partnerKbSearchMatchSchema,
  partnerKbLintIssueSchema,
  partnerKbClaimPolicySchema,
  partnerKbConfigSchema,
  partnerKbConfigDiagnosticSchema,
  partnerKbMaintenanceReportSchema,
  type PartnerKbPageTypeT,
  type PartnerKbConfidenceT,
  type PartnerKbPageStatusT,
  type PartnerKbPageRefT,
  type PartnerKbPageT,
  type PartnerKbSearchMatchT,
  type PartnerKbLintIssueT,
  type PartnerKbClaimPolicyT,
  type PartnerKbConfigT,
  type PartnerKbConfigDiagnosticT,
  type PartnerKbMaintenanceReportT,
} from './channels/partner-kb.js';

export {
  partnerFileProposalOperationSchema,
  partnerFileProposalStatusSchema,
  partnerFileProposalRiskSchema,
  partnerFileProposalClassificationSchema,
  partnerFileProposalSafetySchema,
  partnerFileProposalDiffSchema,
  partnerFileProposalSummarySchema,
  partnerFileProposalSchema,
  partnerFileProposalsListChannel,
  partnerFileProposalsGetChannel,
  partnerFileProposalsApplyChannel,
  partnerFileProposalsRejectChannel,
  partnerFileProposalsExportChannel,
  MAX_PARTNER_FILE_PROPOSAL_CONTENT_BYTES,
  MAX_PARTNER_FILE_PROPOSAL_DIFF_BYTES,
  type PartnerFileProposalOperationT,
  type PartnerFileProposalStatusT,
  type PartnerFileProposalSafetyT,
  type PartnerFileProposalDiffT,
  type PartnerFileProposalSummaryT,
  type PartnerFileProposalT,
} from './channels/partner-file-proposal.js';

export {
  MAX_PARTNER_DELIVERY_INLINE_BYTES,
  partnerDeliveryRootKindSchema,
  partnerDeliveryKindSchema,
  partnerDeliveryRefSchema,
  partnerDeliveriesListChannel,
  partnerDeliveriesGetChannel,
  partnerDeliveriesOutputRootChannel,
  partnerDeliveriesReadBinaryChannel,
  partnerDeliveriesChangedChannel,
  type PartnerDeliveryRootKindT,
  type PartnerDeliveryKindT,
  type PartnerDeliveryRefT,
} from './channels/partner-delivery.js';

export {
  MAX_PARTNER_CHECKPOINT_DIFF_BYTES,
  partnerCheckpointOperationSchema,
  partnerCheckpointStatusSchema,
  partnerCheckpointDiffSchema,
  partnerCheckpointSchema,
  partnerCheckpointsListChannel,
  partnerCheckpointsGetChannel,
  partnerCheckpointsRollbackChannel,
  partnerCheckpointsChangedChannel,
  type PartnerCheckpointOperationT,
  type PartnerCheckpointStatusT,
  type PartnerCheckpointDiffT,
  type PartnerCheckpointT,
} from './channels/partner-checkpoint.js';

export { titlebarSetOverlayChannel } from './channels/titlebar.js';

export {
  settingsGetChannel,
  settingsKodaxConfigGetChannel,
  settingsKodaxConfigSetCompactionChannel,
  settingsSetDefaultWorkspaceChannel,
  settingsSetLanguageModeChannel,
  settingsSetRuntimeDefaultsChannel,
  kodaxCompactionSettingsSchema,
  languageModeSchema,
  supportedLocaleSchema,
  resolveEffectiveLocale,
  type KodaxCompactionSettingsT,
  type KodaxConfigOverviewT,
  type SpaceSettingsT,
  type SpaceRuntimeDefaultsT,
  type LanguageModeT,
  type SupportedLocaleT,
} from './channels/settings.js';

export {
  licenseBindingSchema,
  licenseDisplayEditionSchema,
  licenseEditionSchema,
  licenseEnforcementSourceSchema,
  licenseEntitlementEnvelopeSchema,
  licenseEntitlementPayloadSchema,
  licenseExportRequestChannel,
  licenseFeatureIdSchema,
  licenseGetStatusChannel,
  licenseHasFeatureChannel,
  licenseImportEntitlementChannel,
  licenseKindSchema,
  isLicenseActive,
  licenseRequireEntitlementChannel,
  licenseRuntimeStatusSchema,
  licenseStatusSchema,
  type LicenseBindingT,
  type LicenseDisplayEditionT,
  type LicenseEditionT,
  type LicenseEnforcementSourceT,
  type LicenseEntitlementEnvelopeT,
  type LicenseEntitlementPayloadT,
  type LicenseKindT,
  type LicenseRuntimeStatusT,
  type LicenseStatusT,
} from './channels/license.js';

export { notificationShowChannel, notificationClickedChannel } from './channels/notification.js';

export {
  windowActivityChannel,
  windowActivityStateSchema,
  windowControlActionSchema,
  windowControlChannel,
  windowStateChannel,
  windowStateSchema,
  type WindowActivityPayload,
  type WindowActivityStateT,
  type WindowControlActionT,
  type WindowStateT,
} from './channels/window.js';

export {
  updaterCheckChannel,
  updaterInstallChannel,
  updaterStatusChannel,
  type UpdaterStateT,
} from './channels/updater.js';

export {
  mcpbInstallChannel,
  mcpbUninstallChannel,
  mcpbListChannel,
  mcpbChangedChannel,
  type McpbExtensionT,
} from './channels/mcpb.js';

export {
  terminalCreateChannel,
  terminalWriteChannel,
  terminalResizeChannel,
  terminalKillChannel,
  terminalOutputChannel,
  terminalExitChannel,
  type TerminalCreateInput,
  type TerminalCreateOutput,
  type TerminalOutputPayload,
  type TerminalExitPayload,
} from './channels/terminal.js';

export {
  artifactKindSchema,
  artifactHtmlPermissionsSchema,
  artifactRefSchema,
  artifactCreateChannel,
  artifactListChannel,
  artifactReadChannel,
  artifactReadBinaryChannel,
  artifactDeleteChannel,
  artifactExportChannel,
  artifactOpenWindowChannel,
  artifactPreviewFileChannel,
  artifactChangedChannel,
  looksLikeInteractiveHtml,
  MAX_ARTIFACT_CONTENT_BYTES,
  ARTIFACT_MAX_VERSIONS,
  ARTIFACT_PERMISSION_MAX_SOURCES,
  type ArtifactKindT,
  type ArtifactHtmlPermissionsT,
  type ArtifactRefT,
} from './channels/artifact.js';

export {
  workflowListChannel,
  workflowGetChannel,
  workflowEventChannel,
  workflowRerunChannel,
  workflowSaveChannel,
  workflowSavedRenameChannel,
  workflowSavedDeleteChannel,
  workflowProcessItemSchema,
  workflowProcessSnapshotSchema,
  workflowRunSchema,
  type WorkflowProcessStatusT,
  type WorkflowProcessSnapshotT,
  type WorkflowProcessItemT,
  type WorkflowProcessItemStatusT,
  type WorkflowProcessItemKindT,
  type WorkflowProcessSummaryStatusT,
  workflowActivityChannel,
  type WorkflowRunT,
  type WorkflowEventPayload,
  type WorkflowActivityPayload,
  type WorkflowPolicyT,
} from './channels/workflow.js';

export {
  memoryListChannel,
  memoryProposalChannel,
  memoryApproveChannel,
  memoryRejectChannel,
  memoryReadRefChannel,
  memoryCurateChannel,
  memoryPackChannel,
  memoryItemRefSchema,
  memoryActionProposalSchema,
  memoryApplyPreviewSchema,
  memoryApplyResultSchema,
  memoryRejectResultSchema,
  memoryBodySnapshotSchema,
  memoryGovernanceReportSchema,
  memoryPackSchema,
  memoryReviewPlanSchema,
  type MemoryItemRefT,
  type MemoryRefFilterT,
  type MemoryApplyPreviewT,
  type MemoryActionProposalT,
  type MemoryApplyResultT,
  type MemoryRejectResultT,
  type MemoryBodySnapshotT,
  type MemoryGovernanceReportT,
  type MemoryPackT,
  type MemoryReviewPlanT,
} from './channels/memory.js';

export {
  INVOKE_CHANNEL_NAMES,
  PUSH_CHANNEL_NAMES,
  getInvokeChannel,
  getPushChannel,
  type InvokeChannelName,
  type PushChannelName,
  type ChannelInput,
  type ChannelOutput,
  type PushPayload,
} from './registry.js';
