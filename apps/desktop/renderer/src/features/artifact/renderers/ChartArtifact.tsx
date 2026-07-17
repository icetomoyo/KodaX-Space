// ChartArtifact (F056, static tier) — render a declarative chart spec with
// recharts in the renderer. No eval, no iframe, no LiveCanvas. A malformed spec
// degrades to a fallback message instead of crashing the panel.

import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  AreaChart,
  Line,
  Bar,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import { parseChartSpec, seriesColor, type ChartSpec } from '../chartSpec';
import { useI18n } from '../../../i18n/I18nProvider.js';

function ChartFallback({ message }: { message: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex items-center justify-center p-4 text-[11px] text-fg-muted text-center leading-relaxed">
      {t('artifact.chartRenderFailed', { message })}
    </div>
  );
}

function renderChart(spec: ChartSpec): JSX.Element {
  const data = spec.data as Array<Record<string, string | number | null>>;
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
      <XAxis dataKey={spec.xKey} tick={{ fontSize: 11 }} />
      <YAxis tick={{ fontSize: 11 }} />
      <Tooltip />
      <Legend wrapperStyle={{ fontSize: 11 }} />
    </>
  );

  // Exhaustive switch: a future ChartSpec type addition without a branch fails to
  // compile (the `never` guard) instead of silently rendering the wrong chart.
  switch (spec.type) {
    case 'bar':
      return (
        <BarChart data={data}>
          {axes}
          {spec.series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={seriesColor(spec, i)} />
          ))}
        </BarChart>
      );
    case 'area':
      return (
        <AreaChart data={data}>
          {axes}
          {spec.series.map((s, i) => {
            const color = seriesColor(spec, i);
            return (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label ?? s.key}
                stroke={color}
                fill={color}
                fillOpacity={0.2}
              />
            );
          })}
        </AreaChart>
      );
    case 'line':
      return (
        <LineChart data={data}>
          {axes}
          {spec.series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label ?? s.key}
              stroke={seriesColor(spec, i)}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      );
    default: {
      const _exhaustive: never = spec.type;
      return <ChartFallback message={`unknown chart type: ${String(_exhaustive)}`} />;
    }
  }
}

export interface ChartArtifactProps {
  /** Untrusted chart spec (validated by parseChartSpec). */
  spec: unknown;
}

export function ChartArtifact({ spec: raw }: ChartArtifactProps): JSX.Element {
  const parsed = parseChartSpec(raw);
  if (!parsed.ok) return <ChartFallback message={parsed.error} />;
  const spec = parsed.spec;
  return (
    <div className="flex-1 min-h-0 p-3 flex flex-col">
      {spec.title && (
        <div className="text-[12px] font-medium text-fg-secondary mb-2">{spec.title}</div>
      )}
      <div className="flex-1 min-h-[200px]">
        {/* minHeight floors the height so a flex parent with no definite height
            (height:auto) doesn't collapse ResponsiveContainer's 100% to 0. */}
        <ResponsiveContainer width="100%" height="100%" minHeight={200}>
          {renderChart(spec)}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
