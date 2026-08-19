export type BackgroundTrayLocale = 'zh-CN' | 'en-US';

export interface BackgroundRuntimeStatus {
  readonly state: 'checking' | 'ready' | 'unavailable' | 'exiting';
  readonly activeWork: number;
  readonly otherClients: number;
  readonly canStop: boolean;
  readonly blockers: readonly string[];
  readonly exitElapsedSeconds?: number;
  readonly exitPhase?: 'runtime' | 'finalizing-local';
}

export interface BackgroundTrayPresentation {
  readonly tooltip: string;
  readonly status: string;
  readonly details: string;
  readonly open: string;
  readonly openEnabled: boolean;
  readonly closeWindow: string;
  readonly quitCompletely: string;
}

export function resolveBackgroundTrayLocale(
  languageMode: 'system' | 'zh-CN' | 'en-US',
  preferredLanguages: readonly string[],
): BackgroundTrayLocale {
  if (languageMode !== 'system') return languageMode;
  return preferredLanguages.some((language) => language.toLowerCase().startsWith('zh'))
    ? 'zh-CN'
    : 'en-US';
}

export function buildBackgroundTrayPresentation(
  locale: BackgroundTrayLocale,
  runtime: BackgroundRuntimeStatus,
): BackgroundTrayPresentation {
  if (runtime.state === 'exiting') {
    const elapsedSeconds = Math.max(0, Math.floor(runtime.exitElapsedSeconds ?? 0));
    const finalizingLocal = runtime.exitPhase === 'finalizing-local';
    return locale === 'zh-CN'
      ? {
          tooltip: 'KodaX Space 正在后台安全退出',
          status: finalizingLocal
            ? `Runtime 已停止，正在完成应用收尾 · ${elapsedSeconds} 秒`
            : `正在安全清理 Runtime · ${elapsedSeconds} 秒`,
          details: finalizingLocal
            ? '应用收尾正在后台完成，完成后会自动退出'
            : '已转入后台清理，完成后会自动退出',
          open: '查看退出进度',
          openEnabled: !finalizingLocal,
          closeWindow: '退出进度已在后台',
          quitCompletely: '正在自主完成清理…',
        }
      : {
          tooltip: 'KodaX Space is quitting safely in the background',
          status: finalizingLocal
            ? `Runtime stopped; finalizing Space · ${elapsedSeconds}s`
            : `Cleaning Runtime safely · ${elapsedSeconds}s`,
          details: finalizingLocal
            ? 'Local finalization continues in the background and exits automatically'
            : 'Cleanup continues in the background and exits automatically',
          open: 'View exit progress',
          openEnabled: !finalizingLocal,
          closeWindow: 'Exit progress is in the background',
          quitCompletely: 'Finishing cleanup automatically…',
        };
  }
  if (locale === 'zh-CN') {
    const status =
      runtime.state === 'checking'
        ? 'KodaX Runtime：正在检查'
        : runtime.state === 'ready'
          ? `KodaX Runtime：${runtime.activeWork === 0 ? '空闲' : '正在工作'}`
          : 'KodaX Runtime：暂时不可用';
    return {
      tooltip:
        runtime.state === 'ready'
          ? `KodaX Space 后台运行 · 任务 ${runtime.activeWork} · 其他客户端 ${runtime.otherClients}`
          : 'KodaX Space 在后台运行',
      status,
      details: `任务 ${runtime.activeWork} · 其他客户端 ${runtime.otherClients}`,
      open: '打开 KodaX Space',
      openEnabled: true,
      closeWindow: '关闭 Space 界面',
      quitCompletely: '彻底退出…',
    };
  }
  const status =
    runtime.state === 'checking'
      ? 'KodaX Runtime: checking'
      : runtime.state === 'ready'
        ? `KodaX Runtime: ${runtime.activeWork === 0 ? 'idle' : 'working'}`
        : 'KodaX Runtime: unavailable';
  return {
    tooltip:
      runtime.state === 'ready'
        ? `KodaX Space background · tasks ${runtime.activeWork} · other clients ${runtime.otherClients}`
        : 'KodaX Space is running in the background',
    status,
    details: `Tasks ${runtime.activeWork} · other clients ${runtime.otherClients}`,
    open: 'Open KodaX Space',
    openEnabled: true,
    closeWindow: 'Close Space window',
    quitCompletely: 'Quit completely…',
  };
}
