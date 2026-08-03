// Breadcrumb — F011-revised
//
// 顶部面包屑：`Project / Session ▾`
// 点 session name 弹下拉切换；点 project name 触发 project picker。

import { useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { SessionMenu } from './SessionMenu.js';
import { useI18n } from '../i18n/I18nProvider.js';
import { ViewportTooltip } from '../components/ViewportTooltip.js';

export function Breadcrumb(): JSX.Element {
  const { t } = useI18n();
  const projectPath = useAppStore((s) => s.currentProjectPath);
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const session = sessions.find((x) => x.sessionId === currentSessionId);
  const [menuOpen, setMenuOpen] = useState(false);

  const projectName = projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : null;
  const sessionTitle =
    session?.title ?? (session ? t('breadcrumb.untitledSession') : t('breadcrumb.newSession'));

  async function pickProject(): Promise<void> {
    if (!window.kodaxSpace) return;
    const result = await window.kodaxSpace.invoke('project.openDialog', undefined);
    if (result.ok && result.data.path !== null) {
      useAppStore.getState().setCurrentProject(result.data.path);
      await window.kodaxSpace.invoke('project.recent.add', { path: result.data.path });
    }
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 text-sm text-fg-secondary">
      {projectName ? (
        <ViewportTooltip
          content={projectPath ?? projectName}
          className="flex min-w-0 max-w-[35%] flex-shrink"
        >
          <button
            type="button"
            onClick={() => void pickProject()}
            className="min-w-0 truncate rounded px-1.5 py-0.5 hover:bg-hover-bg"
          >
            {projectName}
          </button>
        </ViewportTooltip>
      ) : (
        <button
          type="button"
          onClick={() => void pickProject()}
          className="px-1.5 py-0.5 rounded hover:bg-hover-bg text-fg-muted"
        >
          {t('breadcrumb.openFolder')}
        </button>
      )}
      <span className="flex-shrink-0 text-fg-muted">/</span>
      <div className="relative flex min-w-0 flex-1 items-center">
        <ViewportTooltip content={sessionTitle} className="min-w-0 flex-1">
          <span className="block truncate px-1.5 py-0.5 text-fg-muted">{sessionTitle}</span>
        </ViewportTooltip>
        {session && (
          <>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex-shrink-0 px-1 py-0.5 text-xs text-fg-muted hover:text-fg-secondary"
              aria-label={t('breadcrumb.sessionOptions')}
            >
              ▾
            </button>
            {menuOpen && (
              <SessionMenu sessionId={session.sessionId} onClose={() => setMenuOpen(false)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
