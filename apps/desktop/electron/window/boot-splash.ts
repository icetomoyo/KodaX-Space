export const BOOT_SPLASH_VARIANTS = ['orbit-trace', 'signal-weave', 'aurora-gate'] as const;
export type BootSplashVariant = (typeof BOOT_SPLASH_VARIANTS)[number];

export interface BootSplashOptions {
  readonly variant?: BootSplashVariant;
  readonly brandImageDataUrl?: string;
}

const STATUS_BY_VARIANT: Readonly<Record<BootSplashVariant, string>> = {
  'orbit-trace': 'Preparing your workspace',
  'signal-weave': 'Connecting the pieces',
  'aurora-gate': 'Opening your workspace',
};

function normalizeRandomValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999_999_999, Math.max(0, value));
}

export function selectBootSplashVariant(randomValue = Math.random()): BootSplashVariant {
  const index = Math.floor(normalizeRandomValue(randomValue) * BOOT_SPLASH_VARIANTS.length);
  return BOOT_SPLASH_VARIANTS[index] ?? BOOT_SPLASH_VARIANTS[0];
}

function safeBrandImageDataUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^data:image\/(?:png|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=]+$/i.test(value)
    ? value
    : undefined;
}

function createBootSplashHtml(
  options: Required<Pick<BootSplashOptions, 'variant'>> & BootSplashOptions,
) {
  const brandImageDataUrl = safeBrandImageDataUrl(options.brandImageDataUrl);
  const brandImage = brandImageDataUrl
    ? `<img class="brand-mark" src="${brandImageDataUrl}" alt="" draggable="false">`
    : '<div class="brand-fallback" aria-hidden="true">K</div>';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      :root{color-scheme:dark;--bg:#18181b;--fg:#ededef;--muted:#8f8f9a;--green:#10b981;--gold:#f5b544;--violet:#9d67f7}
      *{box-sizing:border-box}
      html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--fg)}
      body{display:grid;place-items:center;font-family:"Geist Variable","Segoe UI",ui-sans-serif,sans-serif;-webkit-app-region:drag}
      body::before{position:fixed;inset:-20%;content:"";pointer-events:none;background:radial-gradient(circle at 50% 46%,rgba(112,63,173,.12),transparent 32%),radial-gradient(circle at 50% 56%,rgba(245,181,68,.035),transparent 30%);filter:blur(28px)}
      .boot{position:relative;isolation:isolate;display:grid;width:min(100%,920px);min-height:520px;place-items:center;text-align:center}
      .scene{position:relative;display:grid;width:100%;height:300px;place-items:center}
      .brand{position:relative;z-index:4;display:grid;width:148px;height:148px;place-items:center}
      .brand-mark{display:block;width:148px;height:148px;object-fit:cover;user-select:none}
      .brand-fallback{display:grid;width:130px;height:130px;place-items:center;color:var(--green);font-size:116px;font-weight:650;line-height:1}
      .copy{position:relative;z-index:5;margin-top:-8px}
      .title{font-size:34px;font-weight:520;line-height:1.15;letter-spacing:-.035em}
      .status{display:flex;min-height:22px;align-items:center;justify-content:center;gap:9px;margin-top:14px;color:var(--muted);font-size:14px;line-height:1.4;letter-spacing:.005em}
      .status-pulse{display:inline-block;width:22px;height:2px;overflow:hidden;border-radius:999px;background:rgba(157,103,247,.18)}
      .status-pulse::after{display:block;width:10px;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--violet),var(--gold));content:"";animation:status-sweep 1.8s ease-in-out infinite}

      .orbit,.signals,.auroras{position:absolute;inset:0;pointer-events:none}
      .orbit{display:none}
      [data-variant="orbit-trace"] .orbit{display:block}
      .orbit-ring{position:absolute;top:50%;left:50%;width:310px;height:132px;border-radius:50%;background:conic-gradient(from 12deg,transparent 0 16%,rgba(245,181,68,.12) 27%,var(--gold) 46%,rgba(245,181,68,.1) 67%,transparent 79%);filter:drop-shadow(0 0 8px rgba(245,181,68,.28));mask:radial-gradient(ellipse,transparent 64%,#000 66% 68%,transparent 70%);transform:translate(-50%,-50%) rotate(-11deg);animation:orbit-turn 3.8s linear infinite}
      .orbit-dot{position:absolute;top:calc(50% - 70px);left:calc(50% + 112px);width:9px;height:9px;border-radius:50%;background:#ffe2a3;box-shadow:0 0 7px 2px rgba(245,181,68,.72),0 0 22px rgba(245,181,68,.45);animation:orbit-glow 1.9s ease-in-out infinite}

      .signals{display:none}
      [data-variant="signal-weave"] .signals{display:block}
      .signal{position:absolute;left:50%;width:min(46vw,520px);height:72px;border-top:1px solid color-mix(in srgb,var(--signal-color) 58%,transparent);border-radius:50%;filter:drop-shadow(0 0 6px color-mix(in srgb,var(--signal-color) 35%,transparent));transform-origin:0 50%}
      .signal::after{position:absolute;top:-4px;left:var(--dot-x);width:7px;height:7px;border-radius:50%;background:var(--signal-color);box-shadow:0 0 10px var(--signal-color);content:"";animation:signal-pulse 2.5s ease-in-out infinite}
      .signal-left{left:auto;right:50%;transform-origin:100% 50%}
      .signal-a{--signal-color:var(--gold);--dot-x:66%;top:42px;transform:rotate(8deg)}
      .signal-b{--signal-color:var(--violet);--dot-x:72%;top:112px;transform:rotate(3deg)}
      .signal-c{--signal-color:var(--gold);--dot-x:58%;bottom:43px;transform:rotate(-8deg)}
      .signal-d{--signal-color:var(--violet);--dot-x:70%;bottom:108px;transform:rotate(-3deg)}
      .signal-left.signal-a,.signal-left.signal-c{transform:rotate(-8deg)}
      .signal-left.signal-b,.signal-left.signal-d{transform:rotate(-3deg)}

      .auroras{display:none;inset:-40px -120px}
      [data-variant="aurora-gate"] .auroras{display:block}
      .aurora{position:absolute;top:-22%;width:48%;height:142%;border-radius:48%;filter:blur(22px);opacity:.34;mix-blend-mode:screen}
      .aurora-left{left:2%;background:linear-gradient(106deg,transparent 26%,rgba(157,103,247,.08) 42%,rgba(157,103,247,.7) 50%,rgba(157,103,247,.08) 58%,transparent 72%);transform:rotate(10deg);animation:aurora-left 5.4s ease-in-out infinite alternate}
      .aurora-right{right:2%;background:linear-gradient(74deg,transparent 26%,rgba(245,181,68,.06) 42%,rgba(245,181,68,.62) 50%,rgba(245,181,68,.07) 58%,transparent 72%);transform:rotate(-10deg);animation:aurora-right 5.8s ease-in-out infinite alternate}
      .aurora-line{position:absolute;right:29%;bottom:24px;left:29%;height:2px;border-radius:999px;background:linear-gradient(90deg,transparent,rgba(245,181,68,.86),transparent);box-shadow:0 0 12px rgba(245,181,68,.35);animation:aurora-line 2.4s ease-in-out infinite}

      @keyframes status-sweep{0%,100%{transform:translateX(-110%);opacity:.45}50%{transform:translateX(125%);opacity:1}}
      @keyframes orbit-turn{to{transform:translate(-50%,-50%) rotate(349deg)}}
      @keyframes orbit-glow{0%,100%{opacity:.58;transform:scale(.82)}50%{opacity:1;transform:scale(1.14)}}
      @keyframes signal-pulse{0%,100%{opacity:.38;transform:translateX(-32px) scale(.75)}50%{opacity:1;transform:translateX(30px) scale(1.08)}}
      @keyframes aurora-left{to{transform:translateX(24px) rotate(5deg) scaleX(1.07);opacity:.43}}
      @keyframes aurora-right{to{transform:translateX(-24px) rotate(-5deg) scaleX(1.07);opacity:.4}}
      @keyframes aurora-line{0%,100%{opacity:.36;transform:scaleX(.52)}50%{opacity:1;transform:scaleX(1)}}
      @media (max-width:720px){.boot{min-height:420px}.scene{height:250px}.brand,.brand-mark{width:118px;height:118px}.title{font-size:29px}.signal{width:48vw}.auroras{inset:-20px -40px}}
      @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important}.status-pulse::after{transform:translateX(55%)}.orbit-dot{opacity:.85}.aurora{opacity:.3}}
    </style>
  </head>
  <body data-variant="${options.variant}">
    <main class="boot" role="status" aria-live="polite">
      <div class="scene" aria-hidden="true">
        <div class="orbit"><span class="orbit-ring"></span><span class="orbit-dot"></span></div>
        <div class="signals">
          <span class="signal signal-left signal-a"></span><span class="signal signal-a"></span>
          <span class="signal signal-left signal-b"></span><span class="signal signal-b"></span>
          <span class="signal signal-left signal-c"></span><span class="signal signal-c"></span>
          <span class="signal signal-left signal-d"></span><span class="signal signal-d"></span>
        </div>
        <div class="auroras"><span class="aurora aurora-left"></span><span class="aurora aurora-right"></span><span class="aurora-line"></span></div>
        <div class="brand">${brandImage}</div>
      </div>
      <div class="copy">
        <div class="title">KodaX Space</div>
        <div class="status"><span data-boot-status>${STATUS_BY_VARIANT[options.variant]}</span><span class="status-pulse" aria-hidden="true"></span></div>
      </div>
    </main>
  </body>
</html>`;
}

export const BOOT_SPLASH_URL_PREFIX = 'data:text/html;charset=utf-8,';

export function createBootSplashUrl(options: BootSplashOptions = {}): string {
  const variant = options.variant ?? selectBootSplashVariant();
  return `${BOOT_SPLASH_URL_PREFIX}${encodeURIComponent(
    createBootSplashHtml({ ...options, variant }),
  )}`;
}

export function describeUrlForLog(url: string): string {
  if (url.startsWith(BOOT_SPLASH_URL_PREFIX)) return 'data:boot-splash';
  if (url.length <= 240) return url;
  return `${url.slice(0, 237)}...`;
}

export function bootStatusScript(message: string): string {
  return `
    (() => {
      const target = document.querySelector('[data-boot-status]');
      if (target) target.textContent = ${JSON.stringify(message)};
    })();
  `;
}
