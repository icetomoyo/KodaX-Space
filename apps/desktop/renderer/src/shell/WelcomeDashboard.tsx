// WelcomeDashboard — alpha.1 → v0.1.x
//
// 无 session 首屏的"KodaX-Space 使用统计" dashboard，对标 Claude Desktop 的 "What's up
// next" 卡片但数据全本地 — sessions / events / userMessages 累计统计 + 7×N 活动热力图。
//
// 数据来源：renderer 本地 store（不增 IPC）
//   - Sessions count       = filtered sessions.length
//   - Messages             = Σ userMessagesBySession[sid].length
//   - Tokens               = 每个 session 最后一次 iteration_end.tokenCount 累加（无则用近似）
//   - Active days          = sessions[].lastActivityAt 截天去重数
//   - Current streak       = 从今天倒数连续 active day
//   - Longest streak       = 历史最长连续 active day 段
//   - Peak hour            = lastActivityAt 小时众数
//   - Favorite model       = sessions[].model 众数（无 model 退回 provider）
//   - Heatmap              = 过去 91 天按日 message count 4 档热度（GitHub 风格 7×13 网格）
//
// Time range tab（All / 30d / 7d）按 lastActivityAt 截断 sessions。
// Models tab 列各 model 的对话占比。

import { useEffect, useMemo, useState } from 'react';
import type { ProjectGitStatsDaily } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { useI18n } from '../i18n/I18nProvider.js';

type Range = 'all' | '30d' | '7d';
type View = 'overview' | 'models' | 'project';

interface GitStats {
  isGitRepo: boolean;
  commits: number;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  contributors: number;
  dailyCommits: readonly ProjectGitStatsDaily[];
  currentBranch: string | null;
}

const RANGE_DAYS: Record<Range, number | null> = {
  all: null,
  '30d': 30,
  '7d': 7,
};

function dayKey(d: Date): string {
  // YYYY-MM-DD (local time，跟用户实际感知一致，不用 UTC 切错日期)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function WelcomeDashboard(): JSX.Element {
  const { t } = useI18n();
  const sessions = useAppStore((s) => s.sessions);
  const userMessagesBySession = useAppStore((s) => s.userMessagesBySession);
  // tokensBySession 是派生稳定表 (只在 iteration_end / session_complete 时变)，避免订阅
  // raw eventsBySession 让 dashboard 每个 text_delta 都重算 stats。
  const tokensBySession = useAppStore((s) => s.tokensBySession);
  const providers = useAppStore((s) => s.providers);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);

  const [range, setRange] = useState<Range>('all');
  const [view, setView] = useState<View>('overview');

  // Git stats — 切 project 或 range 都重拉；main 端有 5s mtime cache 抗连点。
  const [gitStats, setGitStats] = useState<GitStats | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  useEffect(() => {
    if (!currentProjectPath || !window.kodaxSpace) {
      setGitStats(null);
      return;
    }
    let cancelled = false;
    setGitLoading(true);
    const sinceDays = range === 'all' ? null : range === '30d' ? 30 : 7;
    void window.kodaxSpace
      .invoke('project.gitStats', { projectRoot: currentProjectPath, sinceDays })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) setGitStats(r.data);
        else setGitStats(null);
      })
      .finally(() => {
        if (!cancelled) setGitLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectPath, range]);

  // 时间范围过滤
  const filteredSessions = useMemo(() => {
    const days = RANGE_DAYS[range];
    if (days === null) return sessions;
    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    return sessions.filter((s) => s.lastActivityAt >= cutoff);
  }, [sessions, range]);

  const stats = useMemo(() => {
    let messages = 0;
    let tokens = 0;
    const activeDays = new Set<string>();
    const hourCount = new Map<number, number>();
    const modelCount = new Map<string, number>();
    const messagesPerDay = new Map<string, number>();
    const modelTokens = new Map<string, number>();
    const modelMessages = new Map<string, number>();
    const modelToProvider = new Map<string, string>();

    for (const s of filteredSessions) {
      const userMsgs = userMessagesBySession[s.sessionId] ?? [];
      // 优先用 SDK summary 透出的 msgCount（重启后仍准确）；in-flight session 没有
      // msgCount 字段 → 退回 in-memory buffer 长度。两路在 session 切到 lazy-restore
      // 那一瞬间会有 1 帧差异，对统计无感。
      const sessionMessages = s.msgCount ?? userMsgs.length;
      messages += sessionMessages;

      // tokens 三级 fallback：
      //   1. tokensBySession (派生稳定表): iteration_end 或 session_complete 时已经计算好
      //   2. msgCount × 1500：从未打开过的 session, SDK summary 给的 msgCount 估算
      //   3. 0：连 msgCount 都没有 (in-flight session 第一条 prompt 之前)
      // **不再扫 raw events buffer**——之前订阅 eventsBySession 让 dashboard 在每个
      // text_delta 时全量重算 stats (O(sessions × events))，背景流式时 30+ rerenders/sec.
      // 现在订阅 tokensBySession 后只在 turn 结束时更新，几乎不抖动。
      const sessionTokenInfo = tokensBySession[s.sessionId];
      let sessionTokens = sessionTokenInfo?.tokens ?? 0;
      if (sessionTokens === 0 && (s.msgCount ?? 0) > 0) {
        sessionTokens = (s.msgCount ?? 0) * 1500;
      }
      tokens += sessionTokens;

      const d = new Date(s.lastActivityAt);
      const k = dayKey(d);
      activeDays.add(k);
      hourCount.set(d.getHours(), (hourCount.get(d.getHours()) ?? 0) + 1);
      // 用 sessionMessages 让 heatmap 在 dashboard 启动后立即准确（不依赖 buffer
      // restore）。近似：一个 session 的全部消息算到 lastActivityAt 当天——跨天对话
      // 会被分到尾天，但对总热度感知够用。
      messagesPerDay.set(k, (messagesPerDay.get(k) ?? 0) + sessionMessages);

      // 模型偏好：三级 fallback——
      //   1. s.model：用户 /model 设过；in-flight session 透出来的（最准确）
      //   2. provider.defaultModel：persisted session 没存 model，但每个 provider 都
      //      有 default model alias（"ark-coding" 默认 "deepseek-v4-pro"）作合理猜测
      //   3. s.provider：连 provider 表都没找到时，退回 provider id 字符串
      // Legacy sessions without a runtime sidecar use today's defaults only to
      // remain runnable. Do not turn that fallback into false historical model analytics.
      if (s.runtimeMetadataSource !== 'current-default-fallback') {
        const providerInfo = providers.find((p) => p.id === s.provider);
        const modelKey = s.model ?? providerInfo?.defaultModel ?? s.provider;
        modelCount.set(modelKey, (modelCount.get(modelKey) ?? 0) + 1);
        modelTokens.set(modelKey, (modelTokens.get(modelKey) ?? 0) + sessionTokens);
        modelMessages.set(modelKey, (modelMessages.get(modelKey) ?? 0) + sessionMessages);
        modelToProvider.set(modelKey, s.provider);
      }
    }

    // Streak（基于当前 range 内的 activeDays）
    const today = new Date();
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      if (activeDays.has(dayKey(d))) streak++;
      else break;
    }
    // Longest streak
    const sortedDays = Array.from(activeDays).sort();
    let longest = 0;
    let run = 0;
    let prev: string | null = null;
    for (const day of sortedDays) {
      if (prev === null) {
        run = 1;
      } else {
        const prevDate = new Date(prev);
        const curDate = new Date(day);
        const diff = Math.round((curDate.getTime() - prevDate.getTime()) / (24 * 3600 * 1000));
        run = diff === 1 ? run + 1 : 1;
      }
      if (run > longest) longest = run;
      prev = day;
    }

    // Peak hour
    let peakHour = 0;
    let peakCount = 0;
    for (const [h, c] of hourCount) {
      if (c > peakCount) {
        peakHour = h;
        peakCount = c;
      }
    }
    const peakHourStr =
      peakCount === 0
        ? '—'
        : peakHour === 0
          ? '12 AM'
          : peakHour < 12
            ? `${peakHour} AM`
            : peakHour === 12
              ? '12 PM'
              : `${peakHour - 12} PM`;

    // Favorite model
    let favModel = '—';
    let favCount = 0;
    for (const [id, c] of modelCount) {
      if (c > favCount) {
        favModel = id;
        favCount = c;
      }
    }
    // favModel 可能是 model alias 或 provider id（取决于 SessionMeta.model 字段是否有值）
    const favProviderId = modelToProvider.get(favModel);
    // 真有 model 字段时 favModel !== favProviderId（前者类似 'deepseek-v4-pro'，后者 'ark-coding'）
    const favIsRealModel = favProviderId !== undefined && favModel !== favProviderId;

    // Models breakdown
    const modelBreakdown = Array.from(modelCount.keys())
      .map((id) => ({
        id,
        providerId: modelToProvider.get(id) ?? id,
        sessions: modelCount.get(id) ?? 0,
        messages: modelMessages.get(id) ?? 0,
        tokens: modelTokens.get(id) ?? 0,
      }))
      .sort((a, b) => b.tokens - a.tokens || b.sessions - a.sessions);

    return {
      sessions: filteredSessions.length,
      messages,
      tokens,
      activeDays: activeDays.size,
      streak,
      longest,
      peakHourStr,
      favModel,
      favProviderId,
      favIsRealModel,
      activeDaysSet: activeDays,
      messagesPerDay,
      modelBreakdown,
    };
  }, [filteredSessions, userMessagesBySession, tokensBySession, providers]);

  // 用户名：从项目路径末尾 segment 抓
  const userName = useMemo(() => {
    if (!currentProjectPath) return 'there';
    const segs = currentProjectPath.split(/[\\/]/).filter(Boolean);
    return segs[segs.length - 1] ?? 'there';
  }, [currentProjectPath]);

  // Heatmap：固定 7×26 网格（~6 个月），行=weekday (周日→周六)，列=周
  // 计算：每格按"距今天 N 天"反向定位；今天放在最右列对应 weekday 行；今天之后的
  // weekday（同列下方位置）填 null 作 trailing pad——保证严格 26 列，不再因 leading-pad
  // 让总长度对 7 取余溢出到第 27 列。
  const heatmap = useMemo(() => {
    const today = new Date();
    const todayWeekday = today.getDay(); // 0 = Sunday
    const TOTAL_WEEKS = 26;
    const cols: (HeatmapCell | null)[][] = [];
    for (let ci = 0; ci < TOTAL_WEEKS; ci++) {
      const col: (HeatmapCell | null)[] = [];
      const weeksFromLast = TOTAL_WEEKS - 1 - ci;
      for (let r = 0; r < 7; r++) {
        // r=0 是 Sunday；今天在最右列 row=todayWeekday 的位置
        const daysFromToday = weeksFromLast * 7 + (todayWeekday - r);
        if (daysFromToday < 0) {
          // "今天之后"的 weekday — trailing pad
          col.push(null);
        } else {
          const d = new Date(today);
          d.setDate(today.getDate() - daysFromToday);
          const key = dayKey(d);
          const count = stats.messagesPerDay.get(key) ?? 0;
          const level: 0 | 1 | 2 | 3 | 4 =
            count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 10 ? 3 : 4;
          col.push({ date: key, count, level });
        }
      }
      cols.push(col);
    }
    return cols;
  }, [stats.messagesPerDay]);

  // tokens 比喻：Dune 全本 ~200k tokens
  const duneMul = stats.tokens > 0 ? Math.max(1, Math.round(stats.tokens / 200_000)) : 0;

  // Favorite model 渲染信息：provider displayName + 可选 model alias 分两行显示
  const favoriteRender = useMemo(() => {
    if (stats.favModel === '—') return { providerLabel: '—', modelLabel: null as string | null };
    const providerId = stats.favProviderId ?? stats.favModel;
    const p = providers.find((px) => px.id === providerId);
    const providerLabel = p?.displayName ?? providerId;
    const modelLabel = stats.favIsRealModel ? stats.favModel : null;
    return { providerLabel, modelLabel };
  }, [stats.favModel, stats.favProviderId, stats.favIsRealModel, providers]);

  return (
    <div className="ix-zone flex-1 overflow-auto px-6 py-6 flex flex-col items-center">
      {/* 大标题 */}
      <h1 className="text-2xl text-fg-primary mb-6 flex items-center gap-2">
        <span className="text-warn" aria-hidden>
          ✱
        </span>
        What&apos;s up next, <span className="font-semibold">{userName}</span>?
      </h1>

      {/* Overview 卡 */}
      <div className="glass lift lift-hover w-full max-w-3xl bg-surface-2/60 border border-border-default rounded-lg p-5">
        {/* View tab + 时间范围 */}
        <div className="flex justify-between items-center mb-4 text-xs">
          <div className="flex gap-1">
            <TabButton
              active={view === 'overview'}
              onClick={() => setView('overview')}
              label="Overview"
            />
            <TabButton
              active={view === 'models'}
              onClick={() => setView('models')}
              label="Models"
            />
            <TabButton
              active={view === 'project'}
              onClick={() => setView('project')}
              label="Project"
            />
          </div>
          <div className="flex gap-1">
            <RangeButton active={range === 'all'} onClick={() => setRange('all')} label="All" />
            <RangeButton active={range === '30d'} onClick={() => setRange('30d')} label="30d" />
            <RangeButton active={range === '7d'} onClick={() => setRange('7d')} label="7d" />
          </div>
        </div>

        {view === 'overview' ? (
          <>
            {/* Stats — 4 列 × 2 行布局；cells 等宽撑满父容器，与 heatmap 父宽对齐
                Favorite model 占第 8 cell（col-span-1）但允许内容 wrap 2-3 行。 */}
            <div className="grid grid-cols-4 gap-x-4 gap-y-3 mb-5">
              <StatCell label="Sessions" value={formatNum(stats.sessions)} />
              <StatCell label="Messages" value={formatNum(stats.messages)} />
              <StatCell label="Total tokens" value={formatTokensBig(stats.tokens)} />
              <StatCell label="Active days" value={String(stats.activeDays)} />
              <StatCell label="Current streak" value={`${stats.streak}d`} />
              <StatCell label="Longest streak" value={`${stats.longest}d`} />
              <StatCell label="Peak hour" value={stats.peakHourStr} />
              <FavoriteModelCell
                providerLabel={favoriteRender.providerLabel}
                modelLabel={favoriteRender.modelLabel}
                sessions={stats.modelBreakdown[0]?.sessions ?? 0}
              />
            </div>

            {/* Heatmap：7×13 网格 + weekday + 月份标签 + hover + 图例 */}
            <Heatmap cols={heatmap} />

            {/* 一句话 */}
            {duneMul > 0 ? (
              <div className="text-xs text-fg-muted">
                You&apos;ve used ~{duneMul}× more tokens than Dune (full novel).
              </div>
            ) : stats.sessions === 0 ? (
              <div className="text-xs text-fg-muted italic">
                {t('welcome.noSessionsStartBelow')}
              </div>
            ) : (
              <div className="text-xs text-fg-muted italic">
                {t('welcome.sendMessagesForTokens')}
              </div>
            )}
          </>
        ) : view === 'models' ? (
          <ModelsView breakdown={stats.modelBreakdown} providers={providers} />
        ) : (
          <ProjectView gitStats={gitStats} loading={gitLoading} projectRoot={currentProjectPath} />
        )}
      </div>
    </div>
  );
}

// 5 档强度梯度 (GitHub 贡献图风)。F054 修正：原来用裸 blue-900→300 写死 shade，
// 在 light 模式下 (bg-blue-* 无 light override) 是"少=深navy / 多=浅蓝"——方向反了。
// 改用单一 --info hue 的**透明度阶梯**：少→多 = 透明度递增 = 越活跃越显眼，两主题方向一致。
//   light: info=深蓝, /15 淡 → 实色 深; dark: info=亮蓝, /15 微 → 实色 亮。
// 0 档用极淡中性 fill 让空网格本身可读。
const LEVEL_BG: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-surface-3/40',
  1: 'bg-info/25',
  2: 'bg-info/45',
  3: 'bg-info/70',
  4: 'bg-info',
};

interface HeatmapCell {
  readonly date: string;
  readonly count: number;
  readonly level: 0 | 1 | 2 | 3 | 4;
}

/**
 * 7×N 网格热力图：
 *   - CSS grid `repeat(N, 1fr)` + `aspect-square`，cells 自适应撑满父容器宽度
 *   - 顶部月份标签（看到 month 分界）
 *   - 每格 hover 显示 tooltip + ring 高亮
 *   - 右下 "Less ▢▢▢▢▢ More" 色阶图例
 *
 * 不带左侧 weekday 标签——为了让 heatmap 主体跟上面 stats grid 父容器左缘精确对齐
 * （避免 weekday label 占额外 ~28px 把 heatmap 主体推到右侧造成上下错位）。
 * GitHub-style 网格用户通常熟悉"行=weekday 周日→周六、列=week"，无标签也可读。
 */
function Heatmap({
  cols,
}: {
  cols: ReadonlyArray<ReadonlyArray<HeatmapCell | null>>;
}): JSX.Element {
  const { effectiveLocale, t } = useI18n();
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(effectiveLocale, { month: 'short' }),
    [effectiveLocale],
  );
  // 每列对应的月份：取列中第一个非空 cell 的月份；用于决定哪些列显示月标签
  const monthLabels: ({ month: string; key: number } | null)[] = cols.map((col, ci) => {
    const firstCell = col.find((c): c is HeatmapCell => c !== null);
    if (!firstCell) return null;
    const d = new Date(firstCell.date);
    const monthIdx = d.getMonth();
    const month = monthFormatter.format(d);
    if (ci === 0) return { month, key: monthIdx };
    const prevCol = cols[ci - 1];
    const prevFirst = prevCol.find((c): c is HeatmapCell => c !== null);
    if (!prevFirst) return { month, key: monthIdx };
    const prevMonth = new Date(prevFirst.date).getMonth();
    return prevMonth !== monthIdx ? { month, key: monthIdx } : null;
  });

  const gridCols = cols.length;
  const gridStyle = {
    gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
  } as const;

  return (
    <div className="mb-3 flex flex-col gap-1">
      {/* 顶部月份标签：跟网格用同样 grid template 让 label 对齐到对应列 */}
      <div className="grid gap-1 h-[14px]" style={gridStyle}>
        {monthLabels.map((m, ci) => (
          <div
            key={ci}
            className="text-[11px] text-fg-muted font-mono leading-none whitespace-nowrap overflow-visible"
          >
            {m?.month ?? ''}
          </div>
        ))}
      </div>

      {/* 网格本体 — grid 列等宽自适应；每格 aspect-square 保持正方形 */}
      <div className="grid gap-1" style={gridStyle}>
        {cols.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-1">
            {col.map((cell, ri) =>
              cell === null ? (
                <div key={ri} className="aspect-square" aria-hidden />
              ) : (
                <div
                  key={cell.date}
                  className={`aspect-square rounded-sm transition-all hover:ring-1 hover:ring-border-strong hover:scale-110 cursor-default ${LEVEL_BG[cell.level]}`}
                  title={t('welcome.messageCount', { date: cell.date, count: cell.count })}
                />
              ),
            )}
          </div>
        ))}
      </div>

      {/* 图例 — 靠右贴 heatmap 右缘 */}
      <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-fg-muted font-mono justify-end">
        <span>{t('welcome.less')}</span>
        <div className={`w-3 h-3 rounded-sm ${LEVEL_BG[0]}`} aria-hidden />
        <div className={`w-3 h-3 rounded-sm ${LEVEL_BG[1]}`} aria-hidden />
        <div className={`w-3 h-3 rounded-sm ${LEVEL_BG[2]}`} aria-hidden />
        <div className={`w-3 h-3 rounded-sm ${LEVEL_BG[3]}`} aria-hidden />
        <div className={`w-3 h-3 rounded-sm ${LEVEL_BG[4]}`} aria-hidden />
        <span>{t('welcome.more')}</span>
      </div>
    </div>
  );
}

/**
 * Favorite model 专用 cell — col-span-2 给它 2 倍宽度，长 displayName "Volcengine
 * Ark Coding" 在 base 字号下能完整显示一行。下方第二行用 dim 小字显示 "N sessions"
 * 让 cell 信息更密、视觉更平衡（其它 cell 都是单数字，这格是"+ 类别 + 量"两层信息）。
 *
 * `col-span-2` + `min-w-0` 是组合关键：让 grid cell 实际占 2 倍空间且允许内部 truncate。
 */
function FavoriteModelCell({
  providerLabel,
  modelLabel,
  sessions,
}: {
  providerLabel: string;
  modelLabel: string | null;
  sessions: number;
}): JSX.Element {
  const { t } = useI18n();
  // 单 grid cell（col-span-1 = 父宽 1/4 ≈ 160px）;
  // 主名用 text-sm 字号 + break-words 允许多行 wrap，不再 truncate 切名字；
  // 副名 dim 一档 + 多行（provider · sessions 计数）。
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-fg-muted uppercase tracking-wider mb-0.5">
        {t('welcome.favoriteModel')}
      </div>
      <div className="flex items-start gap-1.5 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full bg-thinking flex-shrink-0 mt-1.5" aria-hidden />
        <div className="min-w-0 flex-1">
          {/* 主名：有 model 时优先显示 model alias（更精确）；允许 break-words 多行 wrap */}
          <div
            className="text-sm text-fg-primary leading-tight break-words"
            title={modelLabel ?? providerLabel}
          >
            {modelLabel ?? providerLabel}
          </div>
          {/* 副名：当有 model 时，下一行显示 provider；否则显示 sessions 数 */}
          {modelLabel ? (
            <>
              <div className="text-[11px] text-fg-muted mt-0.5 break-words leading-tight">
                {providerLabel}
              </div>
              {sessions > 0 && (
                <div className="text-[11px] text-fg-muted mt-0.5">
                  {t('welcome.sessionsCount', { count: sessions })}
                </div>
              )}
            </>
          ) : (
            sessions > 0 && (
              <div className="text-[11px] text-fg-muted mt-0.5">
                {t('welcome.sessionsCount', { count: sessions })}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

interface ModelsBreakdownItem {
  id: string;
  providerId: string;
  sessions: number;
  messages: number;
  tokens: number;
}

function ModelsView({
  breakdown,
  providers,
}: {
  breakdown: readonly ModelsBreakdownItem[];
  providers: ReadonlyArray<{ id: string; displayName: string }>;
}): JSX.Element {
  const { t } = useI18n();
  if (breakdown.length === 0) {
    return (
      <div className="text-xs text-fg-muted italic py-8 text-center">
        {t('welcome.noModelUsage')}
      </div>
    );
  }
  const maxTokens = Math.max(...breakdown.map((b) => b.tokens), 1);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 text-[11px] text-fg-muted uppercase tracking-wider pb-1 border-b border-border-default">
        <span>{t('welcome.model')}</span>
        <span className="text-right">{t('welcome.sessions')}</span>
        <span className="text-right">{t('welcome.messages')}</span>
        <span className="text-right">{t('welcome.tokens')}</span>
      </div>
      {breakdown.map((b) => {
        // 真 model alias 时显示 "model · provider"；只有 provider id 时退回 displayName
        const providerName =
          providers.find((p) => p.id === b.providerId)?.displayName ?? b.providerId;
        const isRealModel = b.id !== b.providerId;
        const displayName = isRealModel ? `${b.id} · ${providerName}` : providerName;
        const pct = (b.tokens / maxTokens) * 100;
        return (
          <div
            key={b.id}
            className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 items-center text-xs py-1"
          >
            <div className="min-w-0">
              <div className="text-fg-primary truncate font-medium" title={displayName}>
                {displayName}
              </div>
              <div className="h-1 bg-surface-3 rounded overflow-hidden mt-1">
                <div className="h-full bg-info" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <span className="text-fg-secondary text-right font-mono">{formatNum(b.sessions)}</span>
            <span className="text-fg-secondary text-right font-mono">{formatNum(b.messages)}</span>
            <span className="text-fg-secondary text-right font-mono">
              {formatTokensBig(b.tokens)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ProjectView({
  gitStats,
  loading,
  projectRoot,
}: {
  gitStats: GitStats | null;
  loading: boolean;
  projectRoot: string | null;
}): JSX.Element {
  const { t } = useI18n();
  if (!projectRoot) {
    return (
      <div className="text-xs text-fg-muted italic py-8 text-center">
        {t('welcome.openProjectGit')}
      </div>
    );
  }
  if (loading && gitStats === null) {
    return (
      <div className="text-xs text-fg-muted italic py-8 text-center">
        {t('welcome.readingGitHistory')}
      </div>
    );
  }
  if (!gitStats || !gitStats.isGitRepo) {
    return (
      <div className="text-xs text-fg-muted italic py-8 text-center">
        {t('welcome.notGitRepo', { gitDir: '.git/' })}
      </div>
    );
  }

  // 每日 commits 柱状图（最近 30 天对齐）
  const today = new Date();
  const bars: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    const found = gitStats.dailyCommits.find((x) => x.date === key);
    bars.push({ date: key, count: found?.count ?? 0 });
  }
  const maxCount = Math.max(...bars.map((b) => b.count), 1);

  return (
    <div className="flex flex-col gap-4">
      {/* Branch + key stats */}
      <div className="grid grid-cols-3 gap-x-6 gap-y-4">
        <StatCell label={t('welcome.branch')} value={gitStats.currentBranch ?? '?'} truncate />
        <StatCell label={t('welcome.commits')} value={formatNum(gitStats.commits)} />
        <StatCell label={t('welcome.contributors')} value={String(gitStats.contributors)} />
        <StatCell label={t('welcome.filesChanged')} value={formatNum(gitStats.filesChanged)} />
        <StatCell label={t('welcome.linesAdded')} value={`+${formatNum(gitStats.linesAdded)}`} />
        <StatCell
          label={t('welcome.linesDeleted')}
          value={`?${formatNum(gitStats.linesDeleted)}`}
        />
      </div>

      {/* 每日 commits 柱状图 (最近 30 天) */}
      {gitStats.commits > 0 && (
        <div>
          <div className="text-[11px] text-fg-muted uppercase tracking-wider mb-1.5">
            {t('welcome.commitsPerDay')}
          </div>
          <div className="flex items-end gap-0.5 h-16">
            {bars.map((b) => {
              const heightPct = (b.count / maxCount) * 100;
              return (
                <div
                  key={b.date}
                  className="flex-1 bg-surface-3/60 rounded-sm relative overflow-hidden"
                  title={t('welcome.commitCount', { date: b.date, count: b.count })}
                >
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-ok"
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {gitStats.commits === 0 && (
        <div className="text-xs text-fg-muted italic py-4 text-center">
          {t('welcome.noCommits')}
        </div>
      )}
    </div>
  );
}

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
        active ? 'bg-surface-3 text-fg-primary' : 'text-fg-muted hover:text-fg-secondary'
      }`}
    >
      {label}
    </button>
  );
}

function RangeButton({
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
      className={`px-2 py-1 rounded text-[11px] font-mono ${
        active ? 'bg-surface-3 text-fg-primary' : 'text-fg-muted hover:text-fg-secondary'
      }`}
    >
      {label}
    </button>
  );
}

function StatCell({
  label,
  value,
  truncate,
}: {
  label: string;
  value: string;
  truncate?: boolean;
}): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-fg-muted uppercase tracking-wider mb-0.5">{label}</div>
      <div className={`text-lg text-fg-primary ${truncate ? 'truncate' : ''}`} title={value}>
        {value}
      </div>
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatTokensBig(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
