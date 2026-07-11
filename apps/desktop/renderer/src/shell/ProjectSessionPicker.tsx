// ProjectSessionPicker — v0.1.9
//
// 项目下 session 数量大（KodaX 项目实测 200+）时全部塞 sidebar 把别的项目挤下面。
// SessionTree 默认只显示少量最近活跃；溢出走"展示全部"按钮唤出本 modal。
//
// Modal 形态对齐 F026 ⌘Shift+P 命令面板：中央 overlay + 搜索 input + 列表 + 上下箭头 nav +
// Enter 选中 + Esc 关。但这里只关心**单项目 session**，不混 actions/files/slash。

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionMeta, Surface } from '@kodax-space/space-ipc-schema';
import { createMatcher } from '../lib/fuzzy.js';
import { Portal } from '../components/Portal.js';
import { useI18n } from '../i18n/I18nProvider.js';

interface ProjectSessionPickerProps {
  readonly projectName: string;
  readonly projectPath: string;
  readonly surface: Surface;
  readonly sessions: readonly SessionMeta[]; // 已 sort 好 (按 lastActivityAt desc)
  readonly currentSessionId: string | null;
  readonly onSelect: (sessionId: string) => void;
  readonly onClose: () => void;
}

function formatAgo(ts: number, now: number, locale: string): string {
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (sec < 60) return rtf.format(0, 'second');
  const min = Math.floor(sec / 60);
  if (min < 60) return rtf.format(-min, 'minute');
  const hr = Math.floor(min / 60);
  if (hr < 24) return rtf.format(-hr, 'hour');
  const day = Math.floor(hr / 24);
  if (day < 7) return rtf.format(-day, 'day');
  const wk = Math.floor(day / 7);
  if (wk < 4) return rtf.format(-wk, 'week');
  const mo = Math.floor(day / 30);
  if (mo < 12) return rtf.format(-mo, 'month');
  return rtf.format(-Math.floor(day / 365), 'year');
}

export function ProjectSessionPicker({
  projectName,
  projectPath,
  surface,
  sessions,
  currentSessionId,
  onSelect,
  onClose,
}: ProjectSessionPickerProps): JSX.Element {
  const { t, effectiveLocale } = useI18n();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [availableSessions, setAvailableSessions] = useState<readonly SessionMeta[]>(
    () => sessions,
  );
  const [loadingAll, setLoadingAll] = useState(true);
  const [loadAllFailed, setLoadAllFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const matcherRef = useRef(createMatcher());
  // 记当前打开时刻，避免 *秒级* 滚动让 ago label 抖
  const now = useMemo(() => Date.now(), []);

  // 常驻 sidebar 只保留最近 200 条；用户明确打开“展示全部”后，再按项目拉取
  // 完整候选窗口。搜索始终针对 availableSessions，而不是最近列表的子集。
  useEffect(() => {
    let cancelled = false;
    const bridge = window.kodaxSpace;
    if (!bridge) {
      setLoadingAll(false);
      setLoadAllFailed(true);
      return;
    }
    void bridge
      .invoke('session.list', { projectRoot: projectPath, surface, limit: 50_000 })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setLoadAllFailed(true);
          return;
        }
        setAvailableSessions(
          result.data.sessions.slice().sort((a, b) => b.lastActivityAt - a.lastActivityAt),
        );
      })
      .catch(() => {
        if (!cancelled) setLoadAllFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingAll(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, surface]);

  // fuzzy filter — query 空时按 lastActivity 原序；非空跑 fzf-lite
  const filtered = useMemo(() => {
    if (query.trim().length === 0) {
      return availableSessions.map((s, i) => ({ session: s, score: -i })); // 保留输入顺序
    }
    const matcher = matcherRef.current;
    matcher.setCandidates(availableSessions.map((s) => s.title || s.sessionId));
    const results = matcher.search(query, 200);
    const out: { session: SessionMeta; score: number }[] = [];
    // FIFO bucket 防同名 collision (F026 review HIGH-2 同款 pattern)
    const buckets = new Map<string, SessionMeta[]>();
    for (const s of availableSessions) {
      const k = s.title || s.sessionId;
      const arr = buckets.get(k);
      if (arr === undefined) buckets.set(k, [s]);
      else arr.push(s);
    }
    for (const r of results) {
      const arr = buckets.get(r.item);
      if (!arr || arr.length === 0) continue;
      const s = arr.shift()!;
      out.push({ session: s, score: r.score });
    }
    return out;
  }, [query, availableSessions]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // autoFocus 的兜底：portal 化后 native autoFocus 在某些开启路径(mousedown 期)可能被抑制，
  // 挂载后显式 focus 一次，保证 picker 一出现就能直接打字。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 自动滚 active 项到可见
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const child = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    if (child) child.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  // 键盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const picked = filtered[activeIdx];
        if (picked) {
          onSelect(picked.session.sessionId);
          onClose();
        }
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, activeIdx, onSelect, onClose]);

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[60] flex items-start justify-center pt-24 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        // v0.1.10 fix: window-level keydown 在某些状态下可能被其他 modal 抢走或卸载竞争,
        // 直接给 overlay 容器加 div 级 onKeyDown 兜底 — 用户在 picker 内部按 Esc 永远 work。
        // tabIndex 让 div 可接收 keyboard event (即便用户点 list 让 input 失焦也行)。
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('sessionPicker.label', { project: projectName })}
      >
        <div
          className="bg-surface border border-border-default rounded-lg shadow-2xl w-[560px] max-w-[90vw] max-h-[70vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border-default px-3 py-2 flex items-center gap-2">
            <span className="text-xs text-fg-muted truncate">{t('sessionPicker.prefix')}</span>
            <span
              className="text-[12px] text-fg-primary font-semibold truncate flex-1"
              title={projectName}
            >
              {projectName}
            </span>
            <span className="text-[11px] text-fg-muted font-mono">
              {loadingAll ? t('common.loading') : availableSessions.length}
            </span>
          </div>
          <div className="border-b border-border-default px-3 py-2">
            <input
              ref={inputRef}
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('sessionPicker.filterPlaceholder')}
              className="w-full bg-transparent text-fg-primary placeholder:text-fg-faint outline-none text-sm"
              aria-label={t('sessionPicker.filterAria')}
            />
          </div>
          <ul ref={listRef} className="overflow-y-auto flex-1 text-[12px]">
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-fg-muted text-center">
                {t('sessionPicker.noMatches')}
              </li>
            ) : (
              filtered.map(({ session }, idx) => {
                const isActive = idx === activeIdx;
                const isCurrent = session.sessionId === currentSessionId;
                return (
                  <li key={session.sessionId} data-idx={idx}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => {
                        onSelect(session.sessionId);
                        onClose();
                      }}
                      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${
                        isActive
                          ? 'bg-surface-3 text-fg-primary'
                          : 'text-fg-secondary hover:bg-hover-bg'
                      }`}
                    >
                      {isCurrent && (
                        <span className="text-ok text-[11px]" aria-hidden>
                          ●
                        </span>
                      )}
                      <span className="truncate flex-1" title={session.title || session.sessionId}>
                        {session.title || session.sessionId.slice(0, 8)}
                      </span>
                      <span
                        className="text-[11px] text-fg-muted font-mono flex-shrink-0"
                        title={new Date(session.lastActivityAt).toLocaleString(effectiveLocale)}
                      >
                        {formatAgo(session.lastActivityAt, now, effectiveLocale)}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="border-t border-border-default px-3 py-1.5 text-[11px] text-fg-muted flex gap-3">
            {loadAllFailed && <span className="text-warning">{t('sessionPicker.loadFailed')}</span>}
            <span>{t('sessionPicker.navigateHint')}</span>
            <span>{t('sessionPicker.openHint')}</span>
            <span>{t('sessionPicker.closeHint')}</span>
          </div>
        </div>
      </div>
    </Portal>
  );
}
