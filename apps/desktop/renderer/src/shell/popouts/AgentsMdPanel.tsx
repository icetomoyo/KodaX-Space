// AgentsMdPanel — FEATURE_034 + FEATURE_197
//
// 一个 popout 容纳两类 agent 配置：
//   - Context tab: AGENTS.md 文件（global + project，对话被注入的隐式 system 上下文）
//   - Custom tab : ~/.kodax/agents/*.md 和 <project>/.kodax/agents/*.md 用户自定义 agents
//     （KodaX v0.7.43 FEATURE_191 加载、FEATURE_197 暴露 discovery）
//
// 数据每次 popout 打开或 session/项目切换都重拉，与磁盘保持同步。

import { useEffect, useRef, useState } from 'react';
import { FileText, Bot } from 'lucide-react';
import type { AgentsFileMeta, AgentMeta, AgentFailure } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import { FileNameText } from '../../components/FileNameText.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';

type Tab = 'context' | 'custom';

const SCOPE_LABEL_KEYS: Record<Exclude<AgentsFileMeta['scope'], 'global'>, MessageKey> = {
  project: 'agents.scope.project',
  directory: 'agents.scope.directory',
};

const SCOPE_COLORS: Record<AgentsFileMeta['scope'], string> = {
  global: 'text-warn',
  project: 'text-ok',
  directory: 'text-run',
};

const AGENT_SOURCE_COLORS: Record<AgentMeta['source'], string> = {
  'markdown:user': 'text-warn',
  'markdown:project': 'text-ok',
};

export function AgentsMdPanel(): JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('context');
  return (
    <div className="h-full flex flex-col text-xs">
      <div className="px-2 py-1 border-b border-border-default flex gap-1 flex-shrink-0">
        <TabButton
          active={tab === 'context'}
          onClick={() => setTab('context')}
          label={t('agents.context')}
        />
        <TabButton
          active={tab === 'custom'}
          onClick={() => setTab('custom')}
          label={t('agents.custom')}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'context' ? <ContextTab /> : <CustomAgentsTab />}
      </div>
    </div>
  );
}

function scopeLabel(scope: AgentsFileMeta['scope'], t: Translate): string {
  return scope === 'global' ? '~/.kodax' : t(SCOPE_LABEL_KEYS[scope]);
}

function agentSourceLabel(source: AgentMeta['source'], t: Translate): string {
  return source === 'markdown:user' ? '~/.kodax' : t('agents.scope.project');
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded text-xs font-medium ${
        active
          ? 'bg-surface-3 text-fg-primary'
          : 'text-fg-muted hover:text-fg-secondary hover:bg-hover-bg'
      }`}
    >
      {label}
    </button>
  );
}

// ---- Context tab — 既有 AGENTS.md 展示 ----

function ContextTab(): JSX.Element {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const [files, setFiles] = useState<readonly AgentsFileMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  // 编辑态: editing!=null 时显示 textarea。draft 是 textarea 当前值; saving = IPC 飞行
  const [editing, setEditing] = useState<{
    scope: 'global' | 'project';
    sourcePath?: string;
  } | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 取消令牌: useRef 让 cancelToken 跨 render 稳定,并允许从外部 (commitEdit 等)
  // 调 reload 时也能合并到同一个 token 序列。每次 reload 自递增,旧 IPC 回来后比对就知道
  // 自己已经过期 (审查 H3)。
  const reloadTokenRef = useRef(0);
  const reload = (): void => {
    if (!currentSessionId || !window.kodaxSpace) {
      setFiles([]);
      return;
    }
    reloadTokenRef.current += 1;
    const myToken = reloadTokenRef.current;
    setLoading(true);
    setError(null);
    void window.kodaxSpace
      .invoke('session.agentsMd', { sessionId: currentSessionId })
      .then((r) => {
        // 期间用户切了 session / 又调了 reload → 当前 token 已经不是我了 → 丢弃结果
        if (reloadTokenRef.current !== myToken) return;
        if (!r.ok) {
          setError(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'unknown error'}`);
          setFiles([]);
          return;
        }
        setFiles(r.data.files);
        setActiveIdx(0);
      })
      .finally(() => {
        if (reloadTokenRef.current === myToken) setLoading(false);
      });
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

  function startEdit(
    scope: 'global' | 'project',
    initialContent: string,
    sourcePath?: string,
  ): void {
    setDraft(initialContent);
    setEditing({ scope, sourcePath });
    setSaveError(null);
  }
  function cancelEdit(): void {
    setEditing(null);
    setDraft('');
    setSaveError(null);
  }
  async function commitEdit(): Promise<void> {
    if (!editing || !currentSessionId || !window.kodaxSpace) return;
    if (draft.length > 262_144) {
      setSaveError(t('agents.contentLimit'));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await window.kodaxSpace.invoke('session.agentsMd.save', {
        sessionId: currentSessionId,
        scope: editing.scope,
        content: draft,
      });
      if (!r.ok) {
        setSaveError(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'save failed'}`);
        return;
      }
      // 成功 → 退编辑 + 重读磁盘 (新文件路径出现在 files 列表里)
      cancelEdit();
      reload();
    } finally {
      setSaving(false);
    }
  }

  if (!currentSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-fg-faint text-xs">
        {t('agents.noActiveSession')}
      </div>
    );
  }

  // 编辑模式: textarea + Save / Cancel (REPL /memory inline 等价)
  if (editing !== null) {
    return (
      <div className="h-full flex flex-col text-xs">
        <header className="px-3 py-2 border-b border-border-default/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={SCOPE_COLORS[editing.scope]}>●</span>
            <span className="text-fg-secondary font-medium">
              {t('agents.editing', { scope: scopeLabel(editing.scope, t) })}
            </span>
            {editing.sourcePath && (
              <FileNameText
                name={editing.sourcePath}
                className="max-w-[240px] font-mono text-[11px] text-fg-muted"
              />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="px-2 py-0.5 text-[11px] rounded text-fg-muted hover:text-fg-primary hover:bg-hover-bg disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void commitEdit()}
              disabled={saving}
              className={[
                'px-2 py-0.5 text-[11px] rounded disabled:opacity-50',
                'bg-ok/15 text-ok border border-ok/50 hover:bg-ok/25 font-medium',
              ].join(' ')}
            >
              {saving ? t('workflow.manager.saving') : t('common.save')}
            </button>
          </div>
        </header>
        {saveError !== null && (
          <div className="px-3 py-1 text-xs text-danger font-mono border-b border-border-default">
            {saveError}
          </div>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={saving}
          spellCheck={false}
          autoFocus
          className="flex-1 min-h-0 bg-surface text-fg-primary text-[12px] font-mono px-3 py-2 focus:outline-none resize-none leading-relaxed disabled:opacity-50"
          placeholder={t('agents.placeholder', { scope: scopeLabel(editing.scope, t) })}
        />
        <div className="px-3 py-1 text-[11px] text-fg-muted border-t border-border-default flex justify-between">
          <span>{t('agents.charCount', { count: draft.length.toLocaleString() })}</span>
          <span>{editing.scope === 'global' ? '~/.kodax/AGENTS.md' : '<project>/AGENTS.md'}</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-fg-faint text-xs">
        {t('agents.loadingAgentsMd')}
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="h-full p-4 text-xs text-danger font-mono">
        {t('agents.failed', { message: error })}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-fg-faint text-xs p-4 gap-2">
        <FileText className="w-7 h-7 text-fg-faint" strokeWidth={1.5} aria-hidden />
        <div className="text-fg-muted">{t('agents.noLoaded')}</div>
        <div className="text-center max-w-[300px]">
          {t('agents.noLoadedHelp', {
            globalPath: '~/.kodax/AGENTS.md',
            projectPath: '<project>/AGENTS.md',
          })}
        </div>
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => startEdit('global', '# AGENTS.md (global)\n\n')}
            className={[
              'px-2.5 py-1 text-xs rounded',
              'bg-warn/15 text-warn border border-warn/30 hover:bg-warn/25',
            ].join(' ')}
          >
            {t('agents.createGlobal')}
          </button>
          <button
            type="button"
            onClick={() => startEdit('project', '# AGENTS.md (project)\n\n')}
            className={[
              'px-2.5 py-1 text-xs rounded',
              'bg-ok/15 text-ok border border-ok/30 hover:bg-ok/25',
            ].join(' ')}
          >
            {t('agents.createProject')}
          </button>
        </div>
      </div>
    );
  }

  const active = files[activeIdx] ?? files[0];
  // 编辑按钮: 只有 global/project scope 可编辑 (directory 不开放写,见 main handler)
  const editableScope: 'global' | 'project' | null =
    active.scope === 'global' || active.scope === 'project' ? active.scope : null;

  return (
    <div className="h-full flex flex-col text-xs">
      <header className="px-3 py-2 border-b border-border-default/60 flex items-center justify-between">
        <div className="text-fg-secondary font-medium">
          AGENTS.md{' '}
          <span className="text-fg-muted font-normal">
            ({t('agents.loadedCount', { count: files.length })})
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {editableScope !== null && (
            <button
              type="button"
              onClick={() => startEdit(editableScope, active.content, active.path)}
              className="px-2 py-0.5 text-[11px] rounded text-fg-muted hover:text-fg-primary hover:bg-hover-bg"
              title={t('agents.editTitle', { scope: scopeLabel(editableScope, t) })}
            >
              ✎ {t('agents.edit')}
            </button>
          )}
          {/* Create the OTHER scope if it's not in the loaded list */}
          {!files.some((f) => f.scope === 'global') && (
            <button
              type="button"
              onClick={() => startEdit('global', '# AGENTS.md (global)\n\n')}
              className="px-2 py-0.5 text-[11px] rounded text-warn/80 hover:text-warn hover:bg-warn/30"
              title={t('agents.createGlobal')}
            >
              {t('agents.globalButton')}
            </button>
          )}
          {!files.some((f) => f.scope === 'project') && (
            <button
              type="button"
              onClick={() => startEdit('project', '# AGENTS.md (project)\n\n')}
              className="px-2 py-0.5 text-[11px] rounded text-ok/80 hover:text-ok hover:bg-ok/30"
              title={t('agents.createProject')}
            >
              {t('agents.projectButton')}
            </button>
          )}
        </div>
      </header>

      {files.length > 1 && (
        <div className="px-2 py-1 border-b border-border-default flex gap-1 flex-wrap">
          {files.map((f, idx) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setActiveIdx(idx)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                idx === activeIdx
                  ? 'bg-surface-3 text-fg-primary'
                  : 'text-fg-muted hover:text-fg-secondary hover:bg-hover-bg'
              }`}
              title={f.path}
            >
              <span className={SCOPE_COLORS[f.scope]}>●</span> <span>{scopeLabel(f.scope, t)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex min-w-0 items-center gap-1 px-3 py-1.5 font-mono text-[11px] text-fg-muted">
        <span className={`flex-shrink-0 ${SCOPE_COLORS[active.scope]}`}>
          {scopeLabel(active.scope, t)}
        </span>
        <FileNameText name={active.path} className="flex-1" />
      </div>

      <pre className="flex-1 overflow-auto px-3 pb-3 text-xs text-fg-secondary whitespace-pre-wrap font-mono leading-relaxed">
        {active.content}
      </pre>
    </div>
  );
}

// ---- Custom tab — F197 markdown agents ----

function CustomAgentsTab(): JSX.Element {
  const { t } = useI18n();
  const projectRoot = useAppStore((s) => s.currentProjectPath);
  const [agents, setAgents] = useState<readonly AgentMeta[]>([]);
  const [failed, setFailed] = useState<readonly AgentFailure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (!projectRoot || !window.kodaxSpace) {
      setAgents([]);
      setFailed([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.kodaxSpace
      .invoke('agent.discover', { projectRoot })
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setError(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'unknown error'}`);
          setAgents([]);
          setFailed([]);
          return;
        }
        setAgents(r.data.agents);
        setFailed(r.data.failed);
        setActiveIdx(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  if (!projectRoot) {
    return (
      <div className="h-full flex items-center justify-center text-fg-faint text-xs p-4 text-center">
        {t('agents.noProject')}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-fg-faint text-xs">
        {t('agents.loadingAgents')}
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="h-full p-4 text-xs text-danger font-mono">
        {t('agents.failed', { message: error })}
      </div>
    );
  }

  if (agents.length === 0 && failed.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-fg-faint text-xs p-4 gap-2">
        <Bot className="w-7 h-7 text-fg-faint" strokeWidth={1.5} aria-hidden />
        <div className="text-fg-muted">{t('agents.noCustom')}</div>
        <div className="text-center max-w-[320px]">
          {t('agents.noCustomHelp', {
            userPath: '~/.kodax/agents/',
            projectPath: '<project>/.kodax/agents/',
          })}
        </div>
      </div>
    );
  }

  const active = agents[activeIdx];

  return (
    <div className="h-full flex flex-col text-xs">
      <header className="px-3 py-2 border-b border-border-default/60 flex items-center justify-between">
        <div className="text-fg-secondary font-medium">
          {t('agents.customAgents')}{' '}
          <span className="text-fg-muted font-normal">({agents.length})</span>
        </div>
      </header>

      {failed.length > 0 && (
        <div
          className="px-3 py-1.5 text-[11px] text-warn bg-warn/15 border-b border-warn/40 flex-shrink-0"
          role="status"
          aria-label={t('agents.failureAria')}
        >
          {t('agents.loadFailures', { count: failed.length })}{' '}
          <span
            className="text-warn"
            title={failed.map((f) => `${f.path}: ${f.reason}`).join('\n')}
          >
            {t('agents.hoverDetails')}
          </span>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Left: agent list */}
        <ul
          className="w-[180px] border-r border-border-default overflow-auto flex-shrink-0"
          role="listbox"
          aria-label={t('agents.customAgentsAria')}
        >
          {agents.map((a, idx) => (
            <li key={a.path}>
              <button
                type="button"
                onClick={() => setActiveIdx(idx)}
                className={`w-full text-left px-2.5 py-1.5 flex flex-col gap-0.5 ${
                  idx === activeIdx
                    ? 'bg-surface-3/80 text-fg-primary'
                    : 'text-fg-muted hover:text-fg-primary hover:bg-hover-bg'
                }`}
                title={a.path}
                role="option"
                aria-selected={idx === activeIdx}
              >
                <span className="font-mono text-xs truncate">
                  <span className={AGENT_SOURCE_COLORS[a.source]}>●</span> {a.name}
                </span>
                <span className="text-[11px] text-fg-muted truncate">
                  {agentSourceLabel(a.source, t)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {/* Right: detail */}
        <div className="flex-1 min-w-0 overflow-auto px-3 py-2">
          {active ? (
            <div className="flex flex-col gap-2">
              <div>
                <div className="text-xs text-fg-primary font-mono">{active.name}</div>
                <div className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-fg-muted">
                  <span className={`flex-shrink-0 ${AGENT_SOURCE_COLORS[active.source]}`}>
                    {agentSourceLabel(active.source, t)}
                  </span>
                  <FileNameText name={active.path} className="flex-1" />
                </div>
              </div>
              <div className="text-xs text-fg-secondary whitespace-pre-wrap leading-relaxed">
                {active.description}
              </div>
              {active.tools && active.tools.length > 0 && (
                <div className="text-[11px] text-fg-muted">
                  <span className="text-fg-muted">{t('agents.toolsLabel')} </span>
                  <span className="font-mono">{active.tools.join(', ')}</span>
                </div>
              )}
              {active.model !== undefined && (
                <div className="text-[11px] text-fg-muted">
                  <span className="text-fg-muted">{t('agents.modelLabel')} </span>
                  <span className="font-mono">{active.model}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-fg-faint text-xs py-4">{t('agents.selectAgent')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
