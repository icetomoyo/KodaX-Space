// pathClassify — openPath 智能路由的**纯**分类/归一化逻辑（无 window / 无 store 依赖）。
//
// 拆出来的原因：openPath.ts 触达 window.kodaxSpace + zustand store，不能被 electron 的
// node:test 直接 import（会拖进 window 全局类型）。这些纯函数单独成模块，既可单测，也让
// 路径分类规则有单一真理源。

/** 可在 Artifact 面板内预览的扩展名（sandbox iframe / 语法高亮）。 */
const MARKUP_PREVIEW_EXTS = new Set(['html', 'htm', 'svg', 'md', 'markdown']);

// 视为"文本/代码"、点击走 App 内 diff 查看器的扩展名。
// 注意：html/htm/svg/md **不**放进来 —— 它们归 PREVIEWABLE_EXTS。这样无 session（开不了
// Artifact 预览）时 html 会落到 reveal 分支让 OS 用浏览器打开，而不是在 diff 里看源码。
export const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'json5', 'jsonc',
  'css', 'scss', 'sass', 'less', 'xml', 'vue', 'svelte', 'astro',
  'py', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs',
  'rb', 'php', 'swift', 'dart', 'lua', 'sh', 'bash', 'zsh', 'fish', 'ps1',
  'sql', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'txt', 'log', 'csv', 'tsv', 'gradle', 'makefile', 'mk', 'dockerfile',
]);

const RICH_FILE_PREVIEW_EXTS = new Set([
  'pdf', 'docx', 'xlsx', 'xls',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif',
  'ppt', 'pptx', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm',
  'mp4', 'm4v', 'mov', 'webm', 'ogv', 'mkv', 'avi',
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'opus', 'ogg', 'oga',
]);

export const PREVIEWABLE_EXTS = new Set([
  ...MARKUP_PREVIEW_EXTS,
  ...CODE_EXTS,
  ...RICH_FILE_PREVIEW_EXTS,
]);

/** 已知扩展名总集（含上面两类 + 常见二进制/文档）——用于判断 inline code 是否"长得像文件路径"。 */
export const KNOWN_EXTS = new Set([
  ...PREVIEWABLE_EXTS, ...CODE_EXTS,
  'zip', 'tar', 'gz',
  'lock', 'map', 'wasm', 'ttf', 'woff', 'woff2',
]);

/** 抽扩展名（小写，无点）。无扩展名返 ''。 */
export function extOf(p: string): string {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const base = slash >= 0 ? p.slice(slash + 1) : p;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** 该路径是否可在 Artifact 面板预览（html/svg/md）。 */
export function isPreviewablePath(p: string): boolean {
  return PREVIEWABLE_EXTS.has(extOf(p));
}

/** 该路径是否走 App 内 diff 查看器（代码/文本类）。 */
export function isCodePath(p: string): boolean {
  const ext = extOf(p);
  if (ext === '') {
    // 无扩展名但 basename 是常见纯文本工程文件（Dockerfile / Makefile / .gitignore 等）→ 走 diff。
    const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    const base = (slash >= 0 ? p.slice(slash + 1) : p).toLowerCase();
    return ['dockerfile', 'makefile', '.gitignore', '.editorconfig', '.env'].includes(base);
  }
  return CODE_EXTS.has(ext);
}

function basenameLower(p: string): string {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return (slash >= 0 ? p.slice(slash + 1) : p).toLowerCase();
}

function isSensitiveDotEnvPath(p: string): boolean {
  const base = basenameLower(p);
  return base === '.env' || base.startsWith('.env.');
}

/**
 * inline code 文本是否"长得像一个文件路径"（给 Markdown linkify 用，宁缺毋滥）：
 *   - 无空白、长度合理
 *   - 以已知文件扩展名结尾（避免把 `a.b` / `e.g` / `npm run dev` 误判成路径）
 */
export function looksLikeFilePath(text: string): boolean {
  const s = text.trim();
  if (s.length === 0 || s.length > 260) return false;
  if (/\s/.test(s)) return false;
  if (s.includes('://')) return false; // URL 不是文件路径
  if (s.split(/[\\/]+/).includes('..')) return false;
  if (isSensitiveDotEnvPath(s)) return false;
  return KNOWN_EXTS.has(extOf(s));
}

/**
 * 绝对/混合路径 → 相对 projectRoot 的 posix 路径（artifact.previewFile / files.diff 要相对形态）。
 * 不在 projectRoot 下的路径原样（去盘符外的前导斜杠），交由 main 端 resolveInsideProject 兜底拒绝。
 */
export function toProjectRelative(p: string, projectRoot: string | null): string {
  let s = p.replace(/\\/g, '/');
  if (projectRoot) {
    const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    if (s.toLowerCase().startsWith(root.toLowerCase() + '/')) {
      s = s.slice(root.length + 1);
    }
  }
  return s.replace(/^\/+/, '');
}
