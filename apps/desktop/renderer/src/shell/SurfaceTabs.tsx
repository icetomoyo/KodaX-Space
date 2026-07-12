// SurfaceTabs — F045。
//
// [Coder] [Partner] 切换器，对齐 ADR-004 的常驻锚点。从 LeftSidebar 的 inline
// mode tab 抽出（避免两处 tab），接 surface store：Partner 自本版起有真实空壳，
// 不再灰态。点击即时切换布局（渲染层路由，不重启 runtime）。
//
// 纯显式切换：点击即切当前 surface。session 分面（切到 Partner 只看 Partner 会话）
// 依赖 SDK 给 session 加 tag + 列表过滤的原生能力，到位后在左栏接入。

import { Code2, Handshake } from 'lucide-react';
import { PARTNER_ENABLED, useSurfaceStore, type Surface } from '../store/surface.js';
import { useI18n } from '../i18n/I18nProvider.js';
import { setSpaceSurface } from '../space-control/semanticActions.js';

const TABS: readonly { surface: Surface; label: string; Icon: typeof Code2 }[] = [
  { surface: 'code', label: 'Coder', Icon: Code2 },
  { surface: 'partner', label: 'Partner', Icon: Handshake },
];

export function SurfaceTabs(): JSX.Element {
  const { t } = useI18n();
  const currentSurface = useSurfaceStore((s) => s.currentSurface);

  return (
    <div className="p-2 flex gap-1 border-b border-border-default flex-shrink-0">
      {TABS.map(({ surface, label, Icon }) => {
        const active = currentSurface === surface;
        const disabled = surface === 'partner' && !PARTNER_ENABLED;
        return (
          <button
            key={surface}
            type="button"
            disabled={disabled}
            title={disabled ? t('surface.partnerDisabled') : undefined}
            onClick={() => {
              if (!disabled) setSpaceSurface(surface);
            }}
            aria-pressed={active}
            className={`flex-1 text-xs py-1.5 rounded ${
              disabled
                ? 'text-fg-muted opacity-40 cursor-not-allowed'
                : active
                  ? 'bg-surface-3 text-fg-primary'
                  : 'text-fg-muted hover:text-fg-primary'
            }`}
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <Icon className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden /> {label}
              {disabled && (
                <span className="text-[10px] opacity-80">· {t('surface.inDevelopment')}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
