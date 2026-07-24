export type BackgroundTrayLocale = 'zh-CN' | 'en-US';

export interface BackgroundRuntimeStatus {
  readonly state: 'checking' | 'ready' | 'unavailable';
  readonly activeWork: number;
  readonly otherClients: number;
  readonly canStop: boolean;
  readonly blockers: readonly string[];
}

export interface BackgroundTrayPresentation {
  readonly tooltip: string;
  readonly status: string;
  readonly details: string;
  readonly open: string;
  readonly closeWindow: string;
  readonly quitKeepRuntime: string;
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
      closeWindow: '关闭 Space 界面',
      quitKeepRuntime: '退出 Space（保留 Runtime）',
      quitCompletely: '彻底退出（同时停止空闲 Runtime）',
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
    closeWindow: 'Close Space window',
    quitKeepRuntime: 'Quit Space (keep Runtime)',
    quitCompletely: 'Quit completely (stop idle Runtime)',
  };
}
