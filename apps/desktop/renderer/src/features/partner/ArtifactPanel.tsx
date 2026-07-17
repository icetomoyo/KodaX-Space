// ArtifactPanel — Partner 三栏之右栏：产物（artifact）。F059 / F059b。
//
// 仅是 Partner 右栏的外壳（aside + 标题）；artifact 展示主体抽到共享 `ArtifactsView`
// （features/artifact），Coder 的 RightSidebar Artifact section + 全屏 popout 复用同一主体，
// 让 artifact 真正全局（Coder+Partner）。

import { useEffect, useState } from 'react';
import { ArchiveRestore, FileCheck2, FileOutput } from 'lucide-react';
import { ArtifactsView } from '../artifact/ArtifactsView';
import { FOCUS_ARTIFACT_EVENT } from '../artifact/transientArtifact.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import { FileProposalsPanel } from './FileProposalsPanel.js';
import { DeliveriesPanel } from './DeliveriesPanel.js';

export function ArtifactPanel(): JSX.Element {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'artifacts' | 'deliveries' | 'fileProposals'>(
    'artifacts',
  );
  useEffect(() => {
    const showFocusedArtifact = (): void => setActiveTab('artifacts');
    window.addEventListener(FOCUS_ARTIFACT_EVENT, showFocusedArtifact);
    return () => window.removeEventListener(FOCUS_ARTIFACT_EVENT, showFocusedArtifact);
  }, []);
  return (
    <aside
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface"
      data-testid="partner-artifact-panel"
    >
      <div className="px-3 h-9 flex items-center gap-2 border-b border-border-default flex-shrink-0">
        <div className="flex min-w-0 items-center gap-1 rounded bg-surface-2 p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab('artifacts')}
            className={`h-6 inline-flex items-center gap-1 rounded px-1.5 text-[11px] ${
              activeTab === 'artifacts'
                ? 'bg-surface-raised text-fg-primary'
                : 'text-fg-muted hover:bg-hover-bg hover:text-fg-primary'
            }`}
            title={t('partner.fileProposals.tab.artifacts')}
            aria-label={t('partner.fileProposals.tab.artifacts')}
            aria-pressed={activeTab === 'artifacts'}
          >
            <FileOutput className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
            <span>{t('partner.fileProposals.tab.artifacts')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('fileProposals')}
            className={`h-6 inline-flex items-center gap-1 rounded px-1.5 text-[11px] ${
              activeTab === 'fileProposals'
                ? 'bg-surface-raised text-fg-primary'
                : 'text-fg-muted hover:bg-hover-bg hover:text-fg-primary'
            }`}
            title={t('partner.fileProposals.tab.files')}
            aria-label={t('partner.fileProposals.tab.files')}
            aria-pressed={activeTab === 'fileProposals'}
            data-testid="partner-file-proposals-tab"
          >
            <FileCheck2 className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
            <span>{t('partner.fileProposals.tab.files')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('deliveries')}
            className={`h-6 inline-flex items-center gap-1 rounded px-1.5 text-[11px] ${
              activeTab === 'deliveries'
                ? 'bg-surface-raised text-fg-primary'
                : 'text-fg-muted hover:bg-hover-bg hover:text-fg-primary'
            }`}
            title={t('partner.fileProposals.tab.deliveries')}
            aria-label={t('partner.fileProposals.tab.deliveries')}
            aria-pressed={activeTab === 'deliveries'}
            data-testid="partner-deliveries-tab"
          >
            <ArchiveRestore className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
            <span>{t('partner.fileProposals.tab.deliveries')}</span>
          </button>
        </div>
      </div>
      {/* ArtifactsView 根用 h-full：需一个有界高度的 flex 子容器（aside 满高减去 header）。 */}
      <div className="flex-1 min-h-0">
        {activeTab === 'artifacts' ? (
          <ArtifactsView />
        ) : activeTab === 'fileProposals' ? (
          <FileProposalsPanel />
        ) : (
          <DeliveriesPanel />
        )}
      </div>
    </aside>
  );
}
