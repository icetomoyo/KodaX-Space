// ArtifactWindow (F059c L3) — the standalone, maximized artifact page rendered in a
// SEPARATE BrowserWindow (opened via artifact.openWindow). It has its own fresh
// renderer + store, so it can't use useArtifacts (which needs the main window's
// currentSessionId); it reads the artifact directly by id via useArtifactRead.
//
// Mounted by main.tsx when location.hash is `#artifact?id=…`. Lean toolbar (version
// switcher + 复制 + 导出) — no "再改一版" here (that prefills the *main* window's
// composer, which this window can't reach).

import { useEffect, useMemo, useState } from 'react';
import { FileOutput, Copy, Check, Download } from 'lucide-react';
import { ArtifactView } from './ArtifactView';
import { useArtifactRead } from './useArtifacts';
import { toArtifactContent } from './toArtifactContent';
import { TEXT_COPY_KINDS } from './artifactKind';
import { useI18n } from '../../i18n/I18nProvider';

export interface ArtifactHashParams {
  readonly id: string;
  readonly version?: number;
  readonly projectRoot: string | null;
  readonly title: string | null;
}

/**
 * Sanitize an LLM-authored title before it reaches document.title / OS titlebar:
 * strip BiDi override controls (titlebar visual-spoofing) + cap to the IPC schema's 256.
 * U+200F, U+202A–202E, U+2066–2069.
 */
export function sanitizeTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.replace(/[\u200f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 256) || null;
}

/** NUL/CR/LF reject — defense-in-depth on path-ish strings arriving via the URL hash. */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0 || c === 10 || c === 13) return true;
  }
  return false;
}

/** Parse `#artifact?id=…&v=…&projectRoot=…&title=…`; returns null if not an artifact hash. */
export function parseArtifactHash(hash: string): ArtifactHashParams | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  const prefix = 'artifact?';
  if (!h.startsWith(prefix)) return null;
  const p = new URLSearchParams(h.slice(prefix.length));
  const id = p.get('id');
  // id is an opaque store key, never a path — reject anything path-like / oversize
  // before the IPC round-trip (matches artifact.read's min(1).max(128)).
  if (!id || id.length > 128 || /[\\/]|\.\./.test(id)) return null;
  const vRaw = p.get('v');
  const v = vRaw ? Number(vRaw) : NaN;
  const rawRoot = p.get('projectRoot');
  return {
    id,
    version: Number.isInteger(v) && v > 0 ? v : undefined,
    // projectRoot feeds doc-kind file reads downstream (scope-gated); drop control chars here too.
    projectRoot: rawRoot && !hasControlChar(rawRoot) ? rawRoot : null,
    // title is LLM-authored; sanitize (BiDi titlebar-spoof) + cap to the IPC schema's 256.
    title: sanitizeTitle(p.get('title')),
  };
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex-1 flex items-center justify-center text-[12px] text-fg-muted">
      {children}
    </div>
  );
}

export function ArtifactWindow({ params }: { params: ArtifactHashParams }): JSX.Element {
  const { t } = useI18n();
  const [version, setVersion] = useState<number | undefined>(params.version);
  const { ref, payload, loading, error } = useArtifactRead(params.id, version);
  const [copied, setCopied] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const content = useMemo(
    () =>
      ref && payload
        ? toArtifactContent(ref.kind, payload, params.projectRoot, ref.permissions, {
            id: ref.id,
            version: version ?? ref.currentVersion,
          })
        : null,
    [ref, payload, params.projectRoot, version],
  );

  // 展示标题：ref.title 来自 store（LLM 产出，未净化）→ sanitize 后用于 OS 标题栏 + header。
  const displayTitle = sanitizeTitle(ref?.title) ?? params.title ?? 'Artifact';

  // Reflect the (sanitized) artifact title in the OS window title.
  useEffect(() => {
    document.title = displayTitle;
  }, [displayTitle]);

  const canCopy = payload?.content !== undefined && ref !== null && TEXT_COPY_KINDS.has(ref.kind);
  const canSave = payload?.content !== undefined || payload?.fileSource === 'artifact-store';
  const effectiveVersion = version ?? ref?.currentVersion;

  async function onCopy(): Promise<void> {
    if (payload?.content == null) return;
    try {
      await navigator.clipboard.writeText(payload.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setActionMsg(t('artifact.copyFailed'));
    }
  }

  async function onSave(): Promise<void> {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    setActionMsg(null);
    const r = await bridge.invoke(
      'artifact.export',
      effectiveVersion !== undefined
        ? { id: params.id, version: effectiveVersion }
        : { id: params.id },
    );
    if (!r.ok) {
      setActionMsg(t('artifact.saveFailed'));
      return;
    }
    if (r.data.ok)
      setActionMsg(
        r.data.path ? t('artifact.savedPath', { path: r.data.path }) : t('artifact.saved'),
      );
    else if (!r.data.canceled) setActionMsg(r.data.error ?? t('artifact.saveFailed'));
    else return; // user cancelled — leave the toolbar quiet
    setTimeout(() => setActionMsg(null), 2500);
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-surface text-fg-primary">
      <header className="flex items-center gap-2 px-4 h-11 border-b border-border-default flex-shrink-0">
        <FileOutput
          className="w-4 h-4 text-fg-muted flex-shrink-0"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="font-medium truncate" title={displayTitle}>
          {displayTitle}
        </span>
        {ref && ref.versions.length > 1 && (
          <select
            className="text-[11px] bg-surface-raised border border-border-default rounded px-1.5 py-1 text-fg-secondary ml-1"
            value={effectiveVersion ?? ''}
            onChange={(e) => setVersion(Number(e.target.value))}
            aria-label={t('artifact.version')}
          >
            {ref.versions
              .slice()
              .sort((a, b) => b.v - a.v)
              .map((vm) => (
                <option key={vm.v} value={vm.v}>
                  v{vm.v}
                  {vm.v === ref.currentVersion ? t('artifact.latestSuffix') : ''}
                </option>
              ))}
          </select>
        )}
        {actionMsg && (
          <span className="text-[11px] text-fg-muted truncate max-w-[40%]">{actionMsg}</span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {canCopy && (
            <button
              type="button"
              onClick={() => void onCopy()}
              title={t('artifact.copyContent')}
              aria-label={t('artifact.copyContent')}
              className="w-7 h-7 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
            >
              {copied ? (
                <Check className="w-4 h-4 text-ok" strokeWidth={2} />
              ) : (
                <Copy className="w-4 h-4" strokeWidth={1.75} />
              )}
            </button>
          )}
          {canSave && (
            <button
              type="button"
              onClick={() => void onSave()}
              title={t('artifact.saveAs')}
              aria-label={t('artifact.saveAsAria')}
              className="w-7 h-7 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
            >
              <Download className="w-4 h-4" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </header>
      <div className="flex-1 min-h-0 flex flex-col">
        {loading && !content ? (
          <Centered>{t('artifact.loading')}</Centered>
        ) : error ? (
          <Centered>{error}</Centered>
        ) : content ? (
          <ArtifactView {...content} />
        ) : (
          <Centered>{t('artifact.cannotPreview')}</Centered>
        )}
      </div>
    </div>
  );
}
