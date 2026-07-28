# KodaX Space Design QA

## Context Window Popover

## Comparison target

- Source visual truth: selected generated Context Window Popover direction.
- Implementation screenshot: `C:\Works\GitProj\KodaX-AI\KodaX-Space\artifacts\responsive-layout-audit\03b-coder-context-breakdown-panel.png`
- Full Electron screenshot: `C:\Works\GitProj\KodaX-AI\KodaX-Space\artifacts\responsive-layout-audit\03b-coder-context-breakdown.png`
- Combined comparison evidence: `C:\Works\GitProj\KodaX-AI\KodaX-Space\artifacts\responsive-layout-audit\context-window-comparison.png`
- State: dark theme, context popover open after a completed deterministic mock model call.
- App viewport: `980 x 680` CSS pixels.
- Source pixels: `1299 x 1211`.
- Implementation component pixels and CSS size: `385 x 366` at device scale factor `1`.
- Density normalization: the source popover crop and implementation component were both scaled to `720` pixels high for the combined comparison (`770 x 720` and `757 x 720` respectively).

## Intentional product decisions

- The source title `上下文压力` was changed back to the established product term `上下文窗口` / `Context window` at the user's request.
- `输出预留` was removed from the popover because it is response capacity, not space before automatic compaction.
- The old `680k` physical headroom / `自动压缩保护区` segment was removed.
- The source's output-reservation fact was replaced by the two facts that define this surface: model maximum context and auto-compaction threshold.
- The deterministic Electron fixture uses English and smaller token values than the Chinese design reference. This changes visible data density but not the layout or budget semantics.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation uses the product's existing Geist and JetBrains Mono families. Numeric hierarchy, labels, and compact legend density match the selected reference at the real component size.
- Spacing and layout rhythm: the implementation preserves the reference order and grouping: title, primary reading, segmented effective-window bar, remaining capacity, two-column composition legend, two policy facts, and scope note. Padding, divider rhythm, radius, and elevation are consistent with adjacent KodaX Space popovers.
- Colors and visual tokens: the implementation maps the reference palette to existing semantic tokens (`--ok`, `--info`, `--thinking`, `--run`, `--warn`, `--danger`) and uses the existing dark floating-surface tokens. Contrast remains consistent with the product.
- Image quality and asset fidelity: the target contains no raster imagery, logos, illustrations, or non-standard icons. The segmented bar is live data visualization rather than a substituted image asset.
- Copy and content: the incorrect percentage-policy explanation and ambiguous reserve labels are absent. Current-input percentages are calculated against the effective auto-compaction threshold.
- Interaction and accessibility: the existing context button remains keyboard reachable and labelled. The primary bar exposes `progressbar`, `aria-valuemin`, `aria-valuemax`, and `aria-valuenow`. Popover and segment entrance motion honor both the product's minimal-motion mode and `prefers-reduced-motion`.
- Responsiveness: Electron E2E coverage verifies the popover at the `980 x 680` viewport and the surrounding composer at `760 x 620`; no clipping or toolbar overlap was observed.

## Full-view comparison evidence

The combined comparison shows the same primary hierarchy, effective-window bar, two-column composition legend, compact policy-fact row, dark surface treatment, and green pressure status. The two visible content differences are intentional user-directed changes: the stable `Context window` title and removal of output reservation.

## Focused region comparison

The implementation screenshot is already an element-level capture of the complete popover at `385 x 366`; all important typography, spacing, color, and copy surfaces are readable in that focused capture. No additional crop was needed.

## Comparison history

- Capture 0 was rejected before comparison because the screenshot landed mid entrance animation and showed temporary reduced opacity.
- Capture 1 waited for computed opacity `1`, then produced the component and full-window evidence listed above.
- No P0, P1, or P2 visual finding was produced from the stable comparison, so no design-fix loop was required.

## Verification

- Focused context reading tests: passed (`5/5`).
- Desktop renderer TypeScript check: passed.
- Desktop production renderer build: passed.
- Focused Electron Coder layout and context-popover E2E: passed (`1/1`).
- Primary interactions tested: context popover open/close, context/session popover mutual exclusion, effective-threshold semantics, facts visibility, reserve-label absence, and compact-layout preservation.

## Follow-up polish

- P3: the generated reference includes a small pointer tail while the product's existing popovers do not. The implementation intentionally keeps the established KodaX Space popover geometry.

Context window result: passed

## Unified Button Interaction

### Comparison target

- Source visual truth: user-supplied Token-usage button reference.
- Browser-rendered implementation: `C:\Works\GitProj\KodaX-AI\KodaX-Space\artifacts\button-interaction-audit\03-unified-focus-feedback.png`
- Light-theme implementation: `C:\Works\GitProj\KodaX-AI\KodaX-Space\artifacts\button-interaction-audit\05-unified-focus-light-theme.png`
- Settings-modal implementation: `C:\Works\GitProj\KodaX-AI\KodaX-Space\artifacts\button-interaction-audit\08-settings-button-coverage.png`
- Combined comparison evidence: `C:\Works\GitProj\KodaX-AI\KodaX-Space\artifacts\button-interaction-audit\07-reference-vs-unified-interaction.png`
- State: dark theme with a compact filter button keyboard-focused; the source Token-usage button supplies the selected soft-sweep, luminous-edge material language.
- Browser viewport and CSS size: `1280 x 720` CSS pixels at device scale factor `1`.
- Source pixels: `459 x 509`.
- Implementation pixels: `1280 x 720`.
- Density normalization: the full implementation was scaled to `905 x 509` beside the unscaled source for the combined overview. Focused source and implementation button crops were enlarged independently for material-detail inspection; no pixel-perfect geometry comparison was inferred from those differently shaped controls.

### Intentional product decisions

- The Token-usage button keeps its dedicated blue/green sweep and orbit animation. It is the reference, not a target for replacement.
- The shared layer adapts the same material language rather than cloning one color everywhere: neutral/information actions use blue, primary actions use accent gold, success actions use green, reasoning actions use violet, warnings use amber, and dangerous actions use red.
- Full-width menu and list rows use a quieter edge and lower sweep opacity so repeated controls do not produce visual noise.
- Windows title-bar controls, Monaco, xterm, disabled buttons, `.no-ix`, and `.no-button-sheen` keep their own interaction contracts.
- Keyboard focus is intentionally more persistent than hover. Hover uses a transient `560ms` sweep plus a soft edge; focus uses a stable two-pixel semantic outline and a static internal highlight.

### Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: no font, weight, line-height, wrapping, truncation, or antialiasing rules were changed. The overlay paints beneath button content, preserving the existing Geist and JetBrains Mono hierarchy.
- Spacing and layout rhythm: the interaction layer does not change padding, size, gap, border radius, or document flow. Absolute, fixed, and sticky buttons retain their original positioning instead of being forced to `position: relative`.
- Colors and visual tokens: the sweep reuses the existing semantic RGB tokens and keeps the reference's blue/green luminous character without making destructive or warning actions look informational. Dark and light theme captures retain readable foreground contrast.
- Image quality and asset fidelity: this change contains no raster imagery, logos, illustrations, or custom icon substitutions. Existing Lucide icons and the Token-usage glyph remain untouched.
- Copy and content: no application copy or localization keys changed.
- Interaction and accessibility: enabled buttons receive hover, active, and `focus-visible` feedback. `prefers-reduced-motion` removes sweep travel and leaves a static highlight. Disabled controls receive no decorative interaction.
- Responsiveness: the overlay is inset to the owning button and inherits its radius. It does not add width, height, overflow, or layout-dependent geometry.

### Full-view comparison evidence

The combined comparison shows that the full application keeps its established dark glass hierarchy while the focused filter button gains the same cool luminous edge seen on the Token-usage reference. The interaction does not introduce a competing card style, change control density, or wash out nearby content.

### Focused region comparison

The focused crop compares the Token-usage button's soft edge and illuminated dark material with the unified compact-button state. Exact shape and iconography differ intentionally; the matched surfaces are edge luminosity, controlled blue highlight, preserved dark fill, and legible foreground content.

### Comparison history

- Pass 0 found a P1 coverage gap: the initial selector was scoped to `#root`, so portal-mounted Settings and Quick Ask buttons did not receive the shared interaction.
- Fix: the selector scope moved to `body`, which covers both the application root and portal surfaces while still leaving iframe content isolated.
- Pass 1 browser evidence confirmed `22/22` enabled Settings buttons and `1/1` enabled Quick Ask buttons receive the shared layer. The visible main screen covered `31/31` eligible enabled buttons; its three enabled exceptions are the native Windows window controls.
- Pass 1 found no remaining P0, P1, or P2 visual differences.

### Verification

- Source inventory: `324` native buttons across `85` renderer TSX files.
- Production renderer build: passed.
- CSS formatting and diff whitespace checks: passed.
- Primary interactions tested in the in-app browser: main-screen compact button focus, dark/light theme switching, Settings modal open/focus/close, Quick Ask open/close, disabled-button exclusion, and portal coverage.
- Console errors and warnings after the interaction run: none.
- Residual evidence limit: the in-app browser reliably exposed focus and click states but did not retain a programmatic mouse-hover state for a stable screenshot. Hover travel was therefore verified through the applied CSS state and reduced-motion rules, while the stable focus state supplied the visual comparison capture.

### Follow-up polish

- P3: after broader daily use, the default neutral sweep opacity can be tuned globally with `--button-sheen-opacity` without revisiting individual components.

final result: passed

## Randomized Early Boot Splash

### Comparison target

- Three selected directions were compared at the production launch size: Orbit
  Trace, Signal Weave, and Aurora Gate.
- Each implementation was reviewed beside its selected direction in a combined
  reference/production viewport before the temporary review captures were
  discarded.
- Production implementation viewport: `1280 x 800` CSS pixels.
- Combined comparison viewport: `1600 x 720` CSS pixels.
- State: trusted dependency-free startup page before React renderer and application IPC readiness.

### Intentional product decisions

- A new BrowserWindow selects Orbit Trace, Signal Weave, or Aurora Gate once with equal random thirds. Renderer retries and crash recovery in the same window reuse that choice so the loading surface does not change unexpectedly.
- The production splash embeds the shipped `resources/icon.png` mark. The generated directions use a larger isolated `K`; retaining the real app asset avoids a second, unofficial logo treatment in the first visible frame.
- Motion is implemented with inline trusted CSS and contains no remote dependency, canvas, SVG, or renderer bundle requirement. All animation stops under `prefers-reduced-motion`.
- Each direction keeps its own short status line. Main-process retries may replace the line through `textContent` only.

### Findings

No actionable P0, P1, or P2 visual differences remain.

- Fonts and typography: all three variants retain the selected centered product-name hierarchy, compact muted status copy, and readable contrast on the existing dark KodaX Space surface.
- Spacing and layout rhythm: the production window keeps a stable logo, title, and status anchor while the decorative motion changes around it. The composition remains centered at the real `1280 x 800` launch size.
- Colors and visual tokens: the three variants consistently use the product green mark with violet and KodaX gold light treatments. Decorative glows remain subordinate to the brand and status text.
- Image quality and asset fidelity: the real generated `1024 x 1024` PNG app mark is embedded as a data URL before renderer readiness; packaging now ships and smoke-checks the same PNG beside `app.asar`.
- Copy and content: no progress percentage or false completion promise is shown. Retry, recovery, and failure copy remains concise and can be updated without executable markup.
- Interaction and accessibility: the splash exposes a polite status region, prevents image dragging, supports the frameless window drag region, and supplies a reduced-motion state.
- Responsiveness: the layout includes a compact breakpoint below `720px`; the primary comparison and implementation screenshots were captured at the production `1280 x 800` size.

### Comparison history

- Pass 0 confirmed Orbit Trace and Aurora Gate at production size.
- Pass 0 found a P1 Signal Weave mirror error: left-side signal paths were transformed onto the right side.
- Fix: left-side paths now rotate around their right-hand origin without horizontal inversion.
- Pass 1 confirmed that Signal Weave renders paths on both sides of the brand mark. No P0, P1, or P2 visual difference remains.
- Pass 2 removed the retired renderer-document loader. The transition from the
  trusted splash to React now uses an empty, color-matched bootstrap root, so
  the old K mark and spinner cannot flash between surfaces.

### Verification

- Boot-splash selection, trusted-markup, reduced-motion, and status-sanitization tests pass 3/3.
- Renderer startup-gate tests pass 3/3.
- Latest-generation renderer recovery scheduling tests pass 3/3.
- Renderer bootstrap-document regression coverage confirms the retired loader
  markup is absent and the dark transition background remains color matched.
- Focused Electron renderer boot, Windows close-preference, and background-tray lifecycle coverage passes 3/3.
- Electron main-process TypeScript checks, focused ESLint, production main bundle build, and Git whitespace checks pass.
- Windows directory packaging passes; the packaged resource smoke confirms `icon.png` matches the source, and the packaged renderer/Runtime boot smoke passes.

### Follow-up polish

- P3: Signal Weave uses smoother continuous orbital arcs than the tighter inward bends of the generated direction.
- P3: Aurora Gate uses broader blurred ribbons to keep the CSS-only first frame inexpensive.

Randomized early boot splash result: passed
