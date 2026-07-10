// PartnerWelcome — Partner 中栏无 session 时的落地态（对应 Coder 的 WelcomeDashboard）。
//
// doc-workspace 取向：不堆编码 dashboard 的指标，给一句"把文档/代码库/研究问题交给 Partner"
// 的引导。用户在下方 BottomBar 描述任务 → ensureSession 懒建一个 Partner 会话（surface=partner）。

import { Handshake } from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';
import { useI18n } from '../../i18n/I18nProvider.js';

export function PartnerWelcome(): JSX.Element {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center overflow-y-auto">
      <Handshake className="w-8 h-8 text-accent-ink" strokeWidth={1.5} aria-hidden />
      <div className="text-[15px] text-fg-primary font-medium">{t('partner.welcome.title')}</div>
      <div className="text-[13px] text-fg-secondary max-w-[420px] leading-relaxed">
        {t('partner.welcome.description')}
      </div>
      {!currentProjectPath && (
        <div className="text-[12px] text-fg-muted max-w-[420px]">
          {t('partner.welcome.openFolderFirst')}
        </div>
      )}
    </div>
  );
}
