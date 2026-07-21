// DiffPanel — F011-revised
//
// Diff popout：复用 F009 的 MonacoDiffViewer + store 里 lastDiffPath（tool_call write/edit 写入）。
// 切换 popout 时如果有未读 lastDiffPath，自动用之；否则等用户输入路径。

import { useEffect, useState } from 'react';
import { Copy, FolderOpen } from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';
import { FileNameText } from '../../components/FileNameText.js';
import { MonacoDiffViewer } from '../../features/code/MonacoDiffViewer.js';
import { revealPath } from '../../lib/openPath.js';
import { pushToast } from '../../store/toastStore.js';
import { useI18n } from '../../i18n/I18nProvider.js';

// F044 (v0.1.10): diff 数据来源标记。
//   - tool-call: AI write/edit 那一瞬的 before/after (现有 cache 路径,实时 session)
//   - git-tracked: working tree vs HEAD,已 tracked 文件
//   - git-untracked: 新加但未 commit (before='')
type DiffSource = 'tool-call' | 'git-tracked' | 'git-untracked';

export function DiffPanel(): JSX.Element {
  const { t } = useI18n();
  const projectRoot = useAppStore((s) => s.currentProjectPath);
  const lastDiffPath = useAppStore((s) => s.lastDiffPath);
  const clearLastDiffPath = useAppStore((s) => s.clearLastDiffPath);

  const [path, setPath] = useState<string | null>(() => lastDiffPath);
  const [diff, setDiff] = useState<{ before: string; after: string; source: DiffSource } | null>(
    null,
  );
  const [err, setErr] = useState<string | null>(null);

  // 接住 store 的 lastDiffPath（tool_call 自动注入）
  useEffect(() => {
    if (lastDiffPath !== null) {
      setErr(null);
      setDiff(null);
      setPath(lastDiffPath);
      clearLastDiffPath();
    }
  }, [lastDiffPath, clearLastDiffPath]);

  useEffect(() => {
    if (!path || !projectRoot || !window.kodaxSpace) return;
    let cancelled = false;

    // F044: 优先 tool-call cache (现有,语义最精确"AI 改那一瞬"),miss 时 fallback 到 git working tree diff。
    // v0.1.10 fix: 整个 fetch 包 try/catch — 之前 invoke 抛同步错误 (preload 没 allowlist
    // 该 channel / handler 还没注册 / 网络层异常) 时 Promise reject 不被处理,UI 卡在
    // null/null 永远显示 "loading…"。catch 后 setErr 让用户看到具体错误。
    const fetchDiff = async (): Promise<void> => {
      setErr(null);
      setDiff(null);

      const bridge = window.kodaxSpace!;
      const settle = async <T,>(
        promise: Promise<T>,
      ): Promise<{ value: T } | { error: unknown }> => {
        try {
          return { value: await promise };
        } catch (error) {
          return { error };
        }
      };

      const cachePromise = settle(bridge.invoke('files.diff', { projectRoot, path }));
      const gitPromise = settle(bridge.invoke('project.gitFileDiff', { projectRoot, path }));

      const cacheSettled = await cachePromise;
      if (cancelled) return;
      if ('value' in cacheSettled) {
        const cacheR = cacheSettled.value;
        if (cacheR.ok && cacheR.data.available) {
          setDiff({ before: cacheR.data.before, after: cacheR.data.after, source: 'tool-call' });
          return;
        }
      }

      const gitSettled = await gitPromise;
      if (cancelled) return;
      if ('error' in gitSettled) {
        const fallbackError = 'error' in cacheSettled ? cacheSettled.error : gitSettled.error;
        const msg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        setErr(t('popout.diff.loadFailed', { message: msg }));
        return;
      }

      const gitR = gitSettled.value;
      if (gitR.ok && gitR.data.available) {
        setDiff({
          before: gitR.data.before,
          after: gitR.data.after,
          source: gitR.data.isUntracked ? 'git-untracked' : 'git-tracked',
        });
        return;
      }

      if (gitR.ok) {
        switch (gitR.data.reason) {
          case 'is-binary':
            setErr(t('popout.diff.binary'));
            break;
          case 'file-too-large':
            setErr(t('popout.diff.tooLarge'));
            break;
          case 'not-a-git-repo':
            setErr(t('popout.diff.notGitRepo'));
            break;
          case 'no-such-file':
            setErr(t('popout.diff.notFound'));
            break;
          default:
            setErr(t('popout.diff.none'));
        }
      } else {
        setErr(
          `${gitR.error?.code ?? 'ERR_UNKNOWN'}: ${gitR.error?.message ?? t('common.unknownError')}`,
        );
      }
    };
    void fetchDiff();
    return () => {
      cancelled = true;
    };
  }, [path, projectRoot, t]);

  if (!path) {
    return (
      <div className="h-full flex items-center justify-center text-fg-faint text-xs p-4 text-center">
        {t('popout.diff.noSelection')}
      </div>
    );
  }
  if (err) {
    return <div className="p-3 text-xs text-fg-muted font-mono">{err}</div>;
  }
  if (!diff) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-3 py-1 border-b border-border-default text-xs text-fg-muted font-mono flex-shrink-0 flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded text-[11px] font-medium flex-shrink-0 bg-surface-3 text-fg-muted">
            {t('popout.diff.loading')}
          </span>
          <FileNameText name={path} className="flex-1" />
        </div>
        <div className="p-3 text-xs text-fg-muted flex items-center gap-2">
          <span className="activity-spinner-comet" aria-hidden />
          <span>{t('popout.diff.loadingData')}</span>
        </div>
      </div>
    );
  }
  // F044: 头部加 source pill 让用户分辨数据来源
  const sourcePill = (() => {
    switch (diff.source) {
      case 'tool-call':
        return { text: t('popout.diff.toolCall'), cls: 'bg-warn/15 text-warn' };
      case 'git-tracked':
        return { text: t('popout.diff.workingTree'), cls: 'bg-info/15 text-info' };
      case 'git-untracked':
        return { text: t('popout.diff.untracked'), cls: 'bg-ok/15 text-ok' };
    }
  })();
  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-1 border-b border-border-default text-xs text-fg-muted font-mono flex-shrink-0 flex items-center gap-2">
        <span
          className={`px-1.5 py-0.5 rounded text-[11px] font-medium flex-shrink-0 ${sourcePill.cls}`}
        >
          {sourcePill.text}
        </span>
        <FileNameText name={path} className="flex-1" />
        {/* 2026-06-18: 路径不再是死文本 —— 复制 + 在文件管理器中定位。 */}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(path)
              .then(() => pushToast(t('popout.diff.pathCopied'), 'success'))
              .catch(() => pushToast(t('popout.diff.copyFailed'), 'error'));
          }}
          title={t('popout.diff.copyPath')}
          aria-label={t('popout.diff.copyFilePath')}
          className="flex-shrink-0 w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
        >
          <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => void revealPath(path, projectRoot)}
          title={t('popout.diff.reveal')}
          aria-label={t('popout.diff.reveal')}
          className="flex-shrink-0 w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
        >
          <FolderOpen className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <MonacoDiffViewer path={path} before={diff.before} after={diff.after} />
      </div>
    </div>
  );
}
