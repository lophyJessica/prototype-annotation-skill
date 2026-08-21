# Integration Patterns

## Decision Tree

Use the smallest viable integration:

1. Source cannot be changed: use browser injection or a bookmarklet to display existing annotation Markdown.
2. Static HTML can be edited: copy `annotation-kit/` and inject one stylesheet plus one module script into each HTML entry.
3. React/Vite/Vue SPA: copy `public/annotation-kit/` or root `annotation-kit/`, then inject tags in `index.html`.
4. Next/Nuxt or SSR: prefer public asset folder plus layout/head injection; avoid client component rewrites unless necessary.
5. Generated prototype output: add runtime files beside output `index.html`; avoid editing generated bundles.

## Static HTML

Expected target shape:

```html
<link rel="stylesheet" href="./annotation-kit/runtime.css">
<script type="module" src="./annotation-kit/runtime.js"></script>
```

Place the compiled `annotation-kit/annotation.bundle.json` beside `runtime.js`. The runtime uses `annotation.config.json` only as a legacy or tiny-demo fallback.

For production-like use, compile source Markdown into `annotation-kit/annotation.bundle.json`. When several modules share the runtime, compile their configs through `annotation.workspace.json`; do not hand-merge the module configs.

### Route and initial-mode configuration

- For one static HTML page, set annotation `page` to `"*"`; do not force a route matcher merely to name that file.
- For routed pages, use the real path or `routeMatcher`. The runtime compares both the raw URL path and its decoded form, so a Chinese filename can be written in readable form.
- Set `runtime.initialMode` to `"preview"` by default. Set it to `"annotate"` only for teaching, review or other annotation-first pages where badges should appear immediately.

## React, Vite, Vue, and Plain SPA

Prefer public assets:

```txt
public/
  annotation-kit/
    runtime.js
    runtime.css
    annotation.bundle.json
```

Inject into root `index.html`:

```html
<link rel="stylesheet" href="/annotation-kit/runtime.css">
<script type="module" src="/annotation-kit/runtime.js"></script>
```

Do not import the runtime into app components unless the HTML entry is unavailable.

## Built Output Only

If only `dist/` or exported static files exist, copy `annotation-kit/` into that output and inject tags into the exported HTML. Document that the integration must be repeated after rebuilding unless the source project is also updated.

## Selector Hinting

Add `data-anno` only when needed:

```jsx
<section data-anno="product-filter-bar">
  ...
</section>
```

Rules:

- Add hints to module roots, not every button.
- Use lowercase kebab-case.
- Keep names business-readable.
- Do not add state or behavior through `data-anno`.
- For a modal, drawer, popover, accordion or tab panel, place `data-anno` on the visible module root. The runtime hides its badge until that root has a visible on-screen rectangle, then remeasures after DOM or attribute changes.

## Runtime Behavior Requirements

The runtime must:

- Render badges in an overlay layer using DOM measurement.
- Recalculate on scroll, resize, route changes, and DOM mutations.
- Skip hidden, detached, zero-size, and off-viewport targets instead of clamping their badges to a viewport corner.
- Avoid changing target element layout, dimensions, or positioning.
- Use `z-index` above business UI, with popups above badges.
- Read `runtime.zIndexBase` from the bundle when the host page has a higher stacking scale; never rewrite host z-index values.
- Keep the popup at least 8px away from its triggering badge so resize handles cannot block other badges in the same column.
- Stop event propagation inside badges, popups, toolbar controls, and resize handles.
- Support static pages and SPA navigation without framework-specific APIs.

## Read-Only Content Flow

The runtime has no persistence or editing mode. Its content flow is one-way:

- User or Codex updates annotation Markdown in the project.
- Compiler validates coverage and creates `annotation.bundle.json`.
- The normal Git/build/deployment flow publishes the bundle, not the business PRD.
- Runtime fetches and renders the published bundle.
- Refresh performs a no-cache bundle read, reconciles open popups and stale badges, and does not reload the business page.
- View-all renders the combined document and offers a Markdown download. The compiler may also emit a rendered standalone HTML document via `htmlOutput`.

Do not introduce edit controls, drafts, save adapters, write APIs, or authentication into the annotation runtime.

## Mermaid Rendering

Mermaid support is optional and should not break low-intrusion integration.

Config options:

```json
{
  "mermaid": {
    "enabled": true,
    "src": "/annotation-kit/vendor/mermaid.min.js",
    "options": {
      "theme": "default"
    }
  }
}
```

Rules:

- Use fenced Markdown blocks: ```` ```mermaid ````.
- Reuse `window.mermaid` if the host app already provides Mermaid.
- Load `mermaid.src` only when configured.
- Prefer a local vendored Mermaid file over a CDN for internal/admin prototypes.
- Fall back to source display if Mermaid cannot load.
