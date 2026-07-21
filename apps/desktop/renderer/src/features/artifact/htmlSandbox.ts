import {
  ARTIFACT_PERMISSION_MAX_SOURCES,
  WEB_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE,
  looksLikeInteractiveHtml,
  type ArtifactHtmlPermissionsT,
} from '@kodax-space/space-ipc-schema';

export { looksLikeInteractiveHtml };

// Common generated pages depend on these CDN origins. Authored HTTPS script origins are also
// inferred per document so browser-visible presentations do not collapse. Containment stays in the
// outer boundary: the iframe has an opaque origin and no Node/Electron/IPC or parent access;
// connect/forms/frames remain policy-gated; main-process navigation guards deny child escape.
// Declared before INTERACTIVE_HTML_CSP, which calls buildInteractiveHtmlCsp at module load.
const DEFAULT_SCRIPT_CDNS: readonly string[] = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
  'https://cdnjs.cloudflare.com',
];

export const INTERACTIVE_HTML_CSP = buildInteractiveHtmlCsp();

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function originSource(raw: string): string | null {
  try {
    const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
    const url = new URL(normalized);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function websocketOriginSource(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return `wss://${url.host}`;
  } catch {
    return null;
  }
}

function scriptSource(raw: string): string | null {
  try {
    const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
    const url = new URL(normalized);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function sourceList(sources: readonly string[], fallback: string): string {
  return sources.length > 0 ? unique(sources).join(' ') : fallback;
}

function originList(rawSources: readonly string[] | undefined): string[] {
  return (rawSources ?? []).map(originSource).filter((source): source is string => source !== null);
}

function connectList(rawSources: readonly string[] | undefined): string[] {
  return unique([
    ...originList(rawSources),
    ...(rawSources ?? [])
      .map(websocketOriginSource)
      .filter((source): source is string => source !== null),
  ]);
}

function scriptList(permissions: ArtifactHtmlPermissionsT | undefined): string[] {
  return (permissions?.scripts ?? [])
    .map((entry) => scriptSource(entry.url))
    .filter((source): source is string => source !== null);
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cspMeta(
  permissions?: ArtifactHtmlPermissionsT,
  authoredScriptOrigins: readonly string[] = [],
): string {
  return `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(buildInteractiveHtmlCsp(permissions, authoredScriptOrigins))}">`;
}

function diagnosticScript(): string {
  return `<script data-kodax-preview-runtime>(()=>{const type=${JSON.stringify(WEB_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE)};const clean=(value)=>String(value??'').replace(/[\\r\\n]+/g,' ').slice(0,240);const send=(kind,message,directive)=>{try{parent.postMessage({type,kind,message:clean(message),directive:clean(directive)},'*')}catch{}};const memoryStorage=(name)=>{try{const current=window[name],probe='__kodax_preview_probe__';current.setItem(probe,'1');current.removeItem(probe);return}catch{}const values=new Map(),api={get length(){return values.size},key:(index)=>[...values.keys()][Number(index)]??null,getItem:(key)=>values.has(String(key))?values.get(String(key)):null,setItem:(key,value)=>values.set(String(key),String(value)),removeItem:(key)=>values.delete(String(key)),clear:()=>values.clear()},storage=new Proxy(api,{get:(target,key,receiver)=>typeof key==='string'&&!(key in target)?values.get(key):Reflect.get(target,key,receiver),set:(target,key,value,receiver)=>{if(typeof key==='string'&&!(key in target)){values.set(key,String(value));return true}return Reflect.set(target,key,value,receiver)},deleteProperty:(target,key)=>{if(typeof key==='string'&&!(key in target))return values.delete(key);return false}});try{Object.defineProperty(window,name,{value:storage,configurable:false})}catch{}};memoryStorage('localStorage');memoryStorage('sessionStorage');addEventListener('error',(event)=>{const target=event.target;if(target&&target!==window){const tag=clean(target.tagName||'resource').toLowerCase();send('resource',tag);return}send('runtime',event.message||'Script error')},true);addEventListener('unhandledrejection',(event)=>{const reason=event.reason;send('runtime',reason&&reason.message?reason.message:reason||'Unhandled promise rejection')});addEventListener('securitypolicyviolation',(event)=>send('policy','',event.effectiveDirective||event.violatedDirective||'content-security-policy'));send('ready','')})();</script>`;
}

export function buildInteractiveHtmlCsp(
  permissions?: ArtifactHtmlPermissionsT,
  authoredScriptOrigins: readonly string[] = [],
): string {
  const scripts = unique([...scriptList(permissions), ...authoredScriptOrigins]);
  const connects = connectList(permissions?.connect);
  const styles = originList(permissions?.style);
  const imgs = originList(permissions?.img);
  const media = originList(permissions?.media);
  const fonts = originList(permissions?.font);
  const forms = originList(permissions?.forms);

  return [
    "default-src 'none'",
    `script-src ${sourceList(["'unsafe-inline'", 'blob:', ...DEFAULT_SCRIPT_CDNS, ...scripts], "'none'")}`,
    'worker-src blob:',
    `style-src ${sourceList(["'unsafe-inline'", ...styles], "'none'")}`,
    `img-src ${sourceList(['data:', 'blob:', ...imgs], "'none'")}`,
    `font-src ${sourceList(['data:', ...fonts], "'none'")}`,
    `media-src ${sourceList(['data:', 'blob:', ...media], "'none'")}`,
    `connect-src ${sourceList(connects, "'none'")}`,
    "frame-src 'none'",
    "child-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    `form-action ${sourceList(forms, "'none'")}`,
  ].join('; ');
}

export function sandboxForInteractiveHtml(permissions?: ArtifactHtmlPermissionsT): string {
  const tokens = ['allow-scripts'];
  if ((permissions?.forms?.length ?? 0) > 0) tokens.push('allow-forms');
  if (permissions?.popups === 'confirm-external') tokens.push('allow-popups');
  return tokens.join(' ');
}

function stripAttribute(attrs: string, name: string): string {
  const pattern = new RegExp(`\\s+${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'gi');
  return attrs.replace(pattern, '');
}

function srcFromAttributes(attrs: string): string | null {
  return attrFromAttributes(attrs, 'src');
}

function attrFromAttributes(attrs: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = attrs.match(
    new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

function addOrigin(target: Set<string>, raw: string | null | undefined): void {
  if (!raw) return;
  const origin = originSource(raw.trim());
  if (origin && target.size < ARTIFACT_PERMISSION_MAX_SOURCES) target.add(origin);
}

function addSrcsetOrigins(target: Set<string>, raw: string | null | undefined): void {
  if (!raw) return;
  for (const candidate of raw.split(',')) {
    const url = candidate.trim().split(/\s+/)[0];
    addOrigin(target, url);
  }
}

function isFontUrl(raw: string): boolean {
  try {
    const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
    const url = new URL(normalized);
    return /\.(?:woff2?|ttf|otf|eot)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function permissionsFromSets(sets: {
  style: Set<string>;
  img: Set<string>;
  media: Set<string>;
  font: Set<string>;
}): ArtifactHtmlPermissionsT | undefined {
  const out: ArtifactHtmlPermissionsT = {};
  if (sets.style.size > 0) out.style = Array.from(sets.style);
  if (sets.img.size > 0) out.img = Array.from(sets.img);
  if (sets.media.size > 0) out.media = Array.from(sets.media);
  if (sets.font.size > 0) out.font = Array.from(sets.font);
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Compatibility layer for generated interactive HTML: scripts still cannot add
 * arbitrary network access, but stylesheet/image/media/font URLs already present
 * in the document may load so existing visual artifacts do not collapse.
 */
export function inferPassiveHtmlPermissions(html: string): ArtifactHtmlPermissionsT | undefined {
  const sets = {
    style: new Set<string>(),
    img: new Set<string>(),
    media: new Set<string>(),
    font: new Set<string>(),
  };

  for (const match of html.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const tag = match[1]?.toLowerCase();
    const attrs = match[2] ?? '';
    if (tag === 'link') {
      const rel = (attrFromAttributes(attrs, 'rel') ?? '').toLowerCase();
      const as = (attrFromAttributes(attrs, 'as') ?? '').toLowerCase();
      const href = attrFromAttributes(attrs, 'href');
      if (rel.includes('stylesheet') || as === 'style') {
        addOrigin(sets.style, href);
        if (originSource(href ?? '') === 'https://fonts.googleapis.com') {
          addOrigin(sets.font, 'https://fonts.gstatic.com');
        }
      } else if (as === 'font') {
        addOrigin(sets.font, href);
      } else if (rel.includes('icon') || as === 'image') {
        addOrigin(sets.img, href);
      } else if (as === 'audio' || as === 'video') {
        addOrigin(sets.media, href);
      }
      continue;
    }

    if (tag === 'img' || tag === 'image') {
      addOrigin(sets.img, attrFromAttributes(attrs, 'src'));
      addSrcsetOrigins(sets.img, attrFromAttributes(attrs, 'srcset'));
      continue;
    }

    if (tag === 'video' || tag === 'audio') {
      addOrigin(sets.media, attrFromAttributes(attrs, 'src'));
      addOrigin(sets.img, attrFromAttributes(attrs, 'poster'));
      continue;
    }

    if (tag === 'source') {
      addOrigin(sets.media, attrFromAttributes(attrs, 'src'));
      addSrcsetOrigins(sets.img, attrFromAttributes(attrs, 'srcset'));
    }
  }

  const importedStyles = new Set<string>();
  for (const match of html.matchAll(
    /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^'"\s;)]+))\s*\)?/gi,
  )) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw) continue;
    importedStyles.add(raw);
    addOrigin(sets.style, raw);
  }

  for (const match of html.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'" ]+))\s*\)/gi)) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw || importedStyles.has(raw)) continue;
    addOrigin(isFontUrl(raw) ? sets.font : sets.img, raw);
  }

  return permissionsFromSets(sets);
}

function inferAuthoredScriptOrigins(html: string): readonly string[] {
  const origins = new Set<string>();
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    addOrigin(origins, srcFromAttributes(match[1] ?? ''));
  }
  return Array.from(origins);
}

/**
 * C11: merge the auto-inferred PASSIVE resource permissions (style/img/media/font already present
 * in the markup) with any EXPLICIT permissions the caller supplied. Previously supplying any
 * explicit permission (e.g. `{connect: [...]}` to unblock a fetch) skipped passive inference
 * entirely, so the same artifact's fonts/images silently stopped loading. Arbitrary connections,
 * forms, and popups stay explicit. Authored script origins are inferred separately and remain
 * confined by the opaque iframe, no-connect default, and navigation guards.
 */
function mergePassiveWithExplicit(
  inferred: ArtifactHtmlPermissionsT | undefined,
  explicit: ArtifactHtmlPermissionsT | undefined,
): ArtifactHtmlPermissionsT | undefined {
  if (!explicit) return inferred;
  if (!inferred) return explicit;
  const mergeCat = (
    a: readonly string[] | undefined,
    b: readonly string[] | undefined,
  ): string[] | undefined => {
    const merged = unique([...(a ?? []), ...(b ?? [])]).slice(0, ARTIFACT_PERMISSION_MAX_SOURCES);
    return merged.length > 0 ? merged : undefined;
  };
  const out: ArtifactHtmlPermissionsT = { ...explicit };
  for (const cat of ['style', 'img', 'media', 'font'] as const) {
    const merged = mergeCat(inferred[cat], explicit[cat]);
    if (merged) out[cat] = merged;
    else delete out[cat];
  }
  return out;
}

function injectScriptIntegrity(html: string, permissions?: ArtifactHtmlPermissionsT): string {
  const scripts = permissions?.scripts ?? [];
  if (scripts.length === 0) return html;
  const integrityByUrl = new Map(scripts.map((entry) => [entry.url, entry.integrity]));

  return html.replace(/<script\b([^>]*)>/gi, (full, attrs: string) => {
    const src = srcFromAttributes(attrs);
    if (!src) return full;
    const integrity = integrityByUrl.get(src);
    if (!integrity) return full;
    let nextAttrs = stripAttribute(attrs, 'integrity');
    nextAttrs = stripAttribute(nextAttrs, 'crossorigin');
    return `<script${nextAttrs} integrity="${escapeAttribute(integrity)}" crossorigin="anonymous">`;
  });
}

/**
 * Add an in-document CSP to generated interactive HTML. The iframe sandbox
 * supplies the hard process/origin boundary; this CSP keeps generated scripts on
 * an explicit allow-list for network, external scripts, forms, and embeds.
 */
export function buildInteractiveHtmlSrcDoc(
  html: string,
  permissions?: ArtifactHtmlPermissionsT,
): string {
  const htmlWithIntegrity = injectScriptIntegrity(html, permissions);
  // C11: always fold in the passive resources present in the markup, even when explicit permissions
  // were supplied — otherwise granting one category (e.g. connect) silently revokes the others.
  const effectivePermissions = mergePassiveWithExplicit(
    inferPassiveHtmlPermissions(html),
    permissions,
  );
  // Authored HTTPS scripts are presentation dependencies, not an implicit data/API grant.
  // Origin scope lets an ESM entry point import adjacent chunks; connect-src, navigation,
  // frames, Electron and parent-page access remain blocked by the inner and outer sandboxes.
  const bootstrap = `${cspMeta(effectivePermissions, inferAuthoredScriptOrigins(html))}${diagnosticScript()}`;
  const headOpen = htmlWithIntegrity.match(/<head\b[^>]*>/i);
  if (headOpen?.index !== undefined) {
    const insertAt = headOpen.index + headOpen[0].length;
    return `${htmlWithIntegrity.slice(0, insertAt)}${bootstrap}${htmlWithIntegrity.slice(insertAt)}`;
  }

  const htmlOpen = htmlWithIntegrity.match(/<html\b[^>]*>/i);
  if (htmlOpen?.index !== undefined) {
    const insertAt = htmlOpen.index + htmlOpen[0].length;
    return `${htmlWithIntegrity.slice(0, insertAt)}<head>${bootstrap}</head>${htmlWithIntegrity.slice(insertAt)}`;
  }

  return `${bootstrap}${htmlWithIntegrity}`;
}
