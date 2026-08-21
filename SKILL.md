---
name: prototype-annotation
description: Low-intrusion product-logic annotation workflow for existing prototypes and frontend projects. Use when Codex needs to add, initialize, update, or export page-level business annotations for already-built HTML, React, Vue, SPA, admin-system, Axure-like, Figma-exported, or static prototype pages by reading business PRDs, mapping requirements to UI elements, injecting a lightweight annotation runtime, and writing separate Markdown annotation documents without polluting the original PRD or business code.
---

# Vitamin Prototype Annotation

## Core Principle

Treat annotations as an external explanation layer, not as business UI. Keep the original prototype and business PRD clean. Add only the smallest required runtime hook, selector hints, and annotation documents.

## Annotation Language Standard (Product View — Mandatory)

Annotations are read by **business stakeholders and reviewers**, not developers. Write in business language, not technical language:

- **Page identification**: use breadcrumb path (e.g. "线索管理/线索列表"), NOT URL/route (e.g. `/leads`).
- **Status / enum values**: use Chinese business names as primary text (待分配/跟进中/已转客户/已作废), English enum (PENDING_ASSIGN etc.) only in parentheses for developer cross-reference — never as the main description.
- **Tabs / filters**: use Chinese names (全部/待分配/我的线索/公海/已转客户/已作废).
- **Rules**: business language ("分配后48小时未首次跟进自动回收，回退待分配"), NOT code logic.
- **Fields**: use Chinese labels (线索名称/手机号), not field names (leadName/phone).
- **Audience**: business reviewers — developers look up English enums in the PRD; annotations do not carry developer-facing references.

Annotation blocks whose main descriptions are English enums or technical routes are non-compliant and must be rewritten.

## Annotation Classification & Panel UI Standard (Mandatory)

Annotations are displayed in a **panel UI** (like Axure's annotation sidebar), not only as page badges. Every annotation block must carry a **type** classification for tab filtering:

### 1. Type Classification (each annotation block must have one)
- `page` 页面: page-level description (page path, layout overview, global behavior)
- `interaction` 交互: click behavior, tab switching, state transitions, expand/collapse
- `rule` 规则: business rules, validation, permissions, exceptions
- `field` 字段: field-level description (Chinese labels, constraints, defaults)
- `pending` 待确认: rules whose source is unclear or awaiting confirmation

- **Entry buttons are floating & draggable**: the annotation entries ("标注清单" and "原型标注") must NOT occupy layout space or cover page controls — they are floating (fixed position), draggable by mouse (user can move them to a non-blocking spot). Implementation: fixed-position container with drag-to-reposition (pointer events), remember position in sessionStorage, no impact on page layout/flow

## Annotation ID Numbering Standard (Mandatory — hard-won lesson 2026-08-19)

- **Each page's annotation blocks must be numbered independently starting from 1** — do NOT continue the previous page's numbering globally.
- The badge number shown on the page = `annotation.id` (runtime.js reads `badge.textContent = annotation.id`). If IDs are numbered globally across pages (e.g. list page = 1..9, then create page = 10..18, then detail = 19..28), then entering each new page shows badges starting from 10/19 instead of 1, and a large module accumulates to 100+.
- **Correct pattern**: in `annotation.config.json` (and the annotation `.md` source blocks), each `page` restarts its block IDs from `1` and counts up consecutively within that page (list=1..9, create=1..9, detail=1..10). Same ID number may reappear on a different page — that is fine, because badges are rendered per-page (`routeMatcher` scopes to the current page).
- Verify after compile: every page's blocks have IDs `1..N` with no gaps/duplications within the page.
- **Golden rule**: badge number = per-page order, never a global running counter.

## Drag & Click Coexistence Standard (Mandatory — hard-won lesson)

Floating draggable toolbars must support BOTH drag AND button clicks. Known pitfalls:

- **NEVER use `setPointerCapture` on the drag container** — it steals pointer/click targets from child buttons; child buttons become unclickable (verified bug: toolbar click dead, 3 rounds of fixes).
- **Correct pattern**: listen to pointerdown on the drag handle/container, track move/up on `window` (no capture); if movement stays under a threshold → let native `click` fire; if movement exceeds threshold → update position and suppress that one click (to avoid accidental toggle after drag).
- **Ensure `pointer-events: auto`** explicitly on the floating container and buttons (a full-screen `.vpa-root` must be `pointer-events: none` so it never blocks).
- **z-index**: floating toolbar must sit above the annotation panel (raise z-index so the panel never covers the toolbar).
- Verify in browser: click button → works; drag toolbar → position changes without triggering click; drag then click → click still works.

## Panel Tab State Persistence Standard (Mandatory — hard-won lesson)

Panel detail tabs must survive re-renders (scroll triggers `scheduleMeasure` → panel `innerHTML` rebuild → tab resets to default without persistence).

- **Root cause pattern**: scroll/resize listeners rebuild the panel DOM (`renderAnnotationPanel` + `innerHTML`), destroying the detail-tab node; reading the tab from the new DOM falls back to the default (`all`).
- **Correct pattern**: store UI state OUTSIDE the re-rendered DOM — keep a `Map` keyed by card identity (e.g. `detailTabByCard: Map` keyed by `data-annotation-key`); save the current tab on switch, restore it on rebuild:
  ```js
  const cardKey = container.closest('[data-annotation-key]')?.dataset.annotationKey;
  const savedTab = cardKey ? VPA_STATE.detailTabByCard.get(cardKey) : null;
  const requestedTab = savedTab || container.dataset.detailTab || initialTab;
  if (cardKey) VPA_STATE.detailTabByCard.set(cardKey, currentTab);
  ```
- **Golden rule**: DOM is only a presentation layer; state lives in a persistent store (`VPA_STATE`) outside the rebuilt DOM.
- Verify in browser: select a detail tab (e.g. 页面内容), scroll the page, confirm the tab stays selected.

## Scroll Event Must Not Rebuild Scrollable Containers (Mandatory — hard-won lesson)

A scrollable container must NOT be rebuilt from within its own scroll event (scroll → `scheduleMeasure` → `renderAnnotationPanel` rebuilds the container → `scrollTop/scrollLeft` reset to 0 → scrollbar dead).

- **Correct pattern**: on scroll, only update elements that follow the business page (e.g. `measureBadges()`); do NOT re-render the panel. Panel re-render should be triggered only by explicit user/data actions (tab switch, expand/collapse, data refresh):
  ```js
  window.requestAnimationFrame(() => {
    VPA_STATE.measureScheduled = false;
    measureBadges();
    // never call renderAnnotationPanel() during scroll
  });
  ```
- **Golden rule**: scroll events only update positioning; structural updates (rebuild) are driven by explicit actions, never by the scroll event of the container itself.
- Verify in browser: panel list `scrollTop` changes 0 → N and stays; inner detail tabs `scrollLeft` changes; tab stays selected after scroll.

## Pending-Items (待确认) as Review Issue Tracker (Mandatory)

The 待确认 tab is NOT extracted from the PRD — it is a **human-entered review issue tracker**. During review, the reviewer types problems they spot into the 待确认 input; these become actionable todo items.

### Data model (per issue)
```
- id: stable id (annotation block key + timestamp)
- description: issue text (typed by reviewer)
- source: which annotation block / page region it belongs to
- status: open / resolved (checkbox)
- resolution: solution text (filled when resolving)
```

### Requirements
- **Per-block**: each annotation block's 待确认 tab has an input field to add issues (tied to that block)
- **Global**: the global 待确认 tab aggregates all issues from all blocks (grouped by block, filterable)
- **Persistence**: save to `localStorage` (key: project+page+annotation key; array of issues) — survives refresh
- **Resolution flow**: each issue has a checkbox (open/resolved) AND a `解决方法` text field — when resolving, write the solution; the resolution is displayed (not just a checkmark)
- **Export**: button exports a **PRD todo Markdown block** for pasting into the PRD file:
  ```
  ## 待办项
  - [ ] 问题描述（来源：标注块X / 页面区域）
    - 解决方法：（待补充）
  - [x] 已解决问题（来源：标注块Y）
    - 解决方法：已解决方式描述
  ```
- **Per-block export**: each annotation block's 待确认 tab (inside its detail view) also has its own "导出待办" button — exports ONLY that block's issues (not global). So a block with issues can be exported individually during review. **Per-block export must ALSO include the block title + todo list** (same grouped format as global, but only that one block):
  ```
  ## 待办项
  ### 序号 X（该块标题）
  - [ ] 问题描述
    - 解决方法：（待补充）
  - [x] 已解决问题
    - 解决方法：解决方式
  ```
- **Global export grouping**: the global "导出待办" must group issues by annotation block, prefixed with 序号（标题）:
  ```
  ## 待办项
  ### 序号 1（线索列表页面）
  - [ ] 问题描述
    - 解决方法：（待补充）
  - [x] 已解决问题
    - 解决方法：...
  ### 序号 2（状态页签与线索池视图）
  - [ ] ...
  ```
  Group header uses the annotation badge number + block title, so reviewers can trace which region each todo belongs to.
- **PRD sync**: browser cannot write PRD files directly (sandbox) — export block → user/Codex merges into PRD; the Markdown todo format enables state to be read back (双向 via the block format)
- Golden rule: 待确认 = human review input (never auto-extracted from PRD); it is the review-side complement to PRD-side rules
- **Scrollability**: the per-block issue list and the global issue list must be scrollable (they are new dynamic containers — verify `overflow-y: auto` + a max-height; do NOT rely on the panel's own scroll, and do NOT rebuild them from within their own scroll event). Test: add many issues → list scrolls; panel scroll and tab persistence still work.

### 2. Panel UI Requirements (runtime must support)
- **Interaction flow (mandatory, must match)**:
  1. Page shows a "原型标注" entry button (white, document icon) — click to toggle annotation mode
  2. When annotation mode is ON, page displays **numbered badges on each annotated region** (green circle with number, floating on the region edge, not covering content) — the user sees WHICH region each annotation belongs to
  3. Click a badge → shows that region's annotation content (popup/panel with source line)
  4. Clicking a badge also highlights the corresponding region (border/background flash)
  5. The side panel (if present) lists items; clicking an item locates the region
- **Initial mode**: `preview` by default — badges hidden until the button is clicked (NOT directly showing annotation content on load)
- **CRITICAL**: clicking the button must NOT directly show annotation content — it shows the numbered badges first; content appears only after clicking a badge. This is the key difference from a simple popup.
- **Entry button**: "原型标注" button on the page (white, document icon) — click to open/close annotation mode
- **Entry buttons are floating & draggable**: the annotation entries ("标注清单" and "原型标注") must NOT occupy layout space or cover page controls — they are floating (fixed position), draggable by mouse (user can move them to a non-blocking spot). Implementation: fixed-position container with drag-to-reposition (pointer events), remember position in sessionStorage, no impact on page layout/flow
- **Panel**: floating panel (white card, shadow, rounded corners), title "原型标注" + total item count badge + close button, subtitle "点击条目定位页面中的对应区域"
- **Tabs**: 全部/页面/交互/规则/字段/待确认 — current tab highlighted (brand green), filters items by type
- **Item cards**: number badge (green circle) + title + type tag + one-line summary + "展开详细说明 (N 项)" expand/collapse
- **Expanded detail**: structured rules (general behavior / per-item rules), long text with collapse
- **Locate**: click item → scroll/highlight the corresponding page region (via data-anno anchor)
- **Style**: white card + shadow + rounded corners + brand green highlight, clean scrollbar

## Annotation Content Structure Standard (Mandatory)

Annotation detail content must be **structured as grouped item lists**, NOT long paragraphs. Format:

### 1. Structure per annotation block
```
需求描述：【模块名】              ← title (module name)
来源：xxx.md#章节                 ← source line (gray code box)
分组标题 A                        ← behavior group (small heading)
- 项名1：描述（一句话）          ← item: name + description (one line each)
- 项名2：描述
分组标题 B                        ← second group
- 项名1：描述
- 项名2：描述
```

### 2. Rules
- Split content into **behavior groups** (e.g. 页签通用行为 / 状态说明 / 显示样式 / 交互规则), each with a small heading
- Under each group, write **item lists** as `- 项名：描述` — one rule point per item, concise one-line description
- Do NOT write long paragraph prose for rules that can be itemized
- Keep 来源 line at top (gray code box)
- Long content: items can be further grouped; the panel supports expand/collapse per item group
- Reference format: title → source → group headings → `- 项名：描述` item lists (see panel UI reference)

## Annotation Detail Tab Standard (Mandatory)

Each annotation block's **detail content** must be organized into **tab pages** (not a single flat body). Tabs:

```
全部             ← combined view of all sections below (default tab)
页面内容         ← page-level description: page path, layout, what the region displays
交互说明         ← interaction behavior: click, hover, tab switching, state transitions, expand/collapse
业务规则         ← business rules: validation, permissions, exceptions, calculation logic
字段说明         ← field-level details: field labels, defaults, constraints, formats
待确认           ← unresolved items: source unclear / rules awaiting confirmation
```

### Rules
- **Every annotation block detail must have all 6 tabs** — even empty tabs are shown (as an extension placeholder, e.g. "待确认" shows 0 items). Do NOT hide empty tabs.
- `全部` = combined rendering of all populated tabs (页面内容+交互说明+业务规则+字段说明+待确认)
- Content under each tab uses the grouped item-list format (`分组标题` + `- 项名：描述`) from Annotation Content Structure Standard
- Each tab's content must be accurate to the PRD: 交互说明 covers click/state behaviors, 业务规则 covers validation/permissions/exceptions, 字段说明 covers field-level rules
- Tab filter (`type` classification) remains: page/interaction/rule/field/pending — the detail tabs provide richer in-block organization

Maintain one current annotation set for the current prototype. Update Markdown blocks in place; the runtime must display only the latest rules. Do not create or maintain changelogs, version folders, or historical annotation copies unless the user explicitly asks for them. Keep a readable `来源` line in each Markdown block and retain `sourceRefs` in configuration so current annotations can point back to the current PRD files and sections.

The page annotation runtime is strictly read-only. Never add annotation editing, drafts, save APIs, or browser-to-Markdown write-back. Annotation content is changed only by editing Markdown files directly or by asking Codex to update them.

Use this skill for two workflows:

- Initialization: existing page or prototype has no annotation layer yet.
- Incremental update: annotation layer already exists and PRD, page code, or annotation content changed.

If the user does not clearly request initialization or update, ask which workflow to run before editing files.

## Required Inputs

Before generating annotations, discover these inputs in the target project:

- Existing prototype implementation: static HTML, React/Vite/Next, Vue/Nuxt, plain SPA, or other frontend output.
- Business PRD files: search for `prd.md`, `PRD.md`, `requirements.md`, `docs/**/*.md`, product docs, or user-specified files.
- Existing annotation files: search for `annotations/**/*.md`, `**/annotations/**/*.md`, `annotation.config.json`, `annotation.workspace.json`, `annotation-kit`, or prior runtime injection.
- Available run command: inspect `package.json`, static `index.html`, or documented scripts.
- Deployment target: determine whether the user needs local-only use, static cloud viewing, cloud collaboration, or Git-reviewed annotation updates.

Never assume the current demo structure exists in the target project.

## Low-Intrusion Strategy

Choose the least invasive viable integration:

1. Zero-source-change mode: use bookmarklet, extension, or browser-injected runtime when source files cannot be edited.
2. One-line runtime mode: copy `assets/annotation-kit/` into the project and add one script/link pair to the HTML entry.
3. Selector-hint mode: add only stable `data-anno` attributes to key UI modules when selectors are unstable.
4. Component integration mode: use framework code only when the page cannot be reliably annotated from DOM selectors.

Do not rewrite UI components to support annotations. Do not move layout nodes. Do not couple annotation state to business state.

## Annotation Directory Decision

Choose the annotation document directory in this order:

1. Use the directory explicitly specified by the user.
2. If existing annotation Markdown files are found, keep using that directory.
3. If a main business PRD is found, create an `annotations/` folder beside that PRD.
   - Example: `docs/prd.md` -> `docs/annotations/`
   - Example: `requirements/product/prd.md` -> `requirements/product/annotations/`
4. If multiple PRDs exist, keep each module's annotation source beside its relevant PRD. Add one `annotation.workspace.json` at their nearest practical common annotation parent to aggregate compilation; do not move all module files into one directory merely to share a runtime.
5. If no PRD location is discoverable, create `annotations/` at the target project root and state this fallback in the final response.

Never hard-code a global path such as `docs/annotations/` unless that is the directory selected by the above rules.

## History Is Explicit Only

Do not create `changelog.md` or `versions/` by default. The business PRD and requirement documents retain the change history; annotations only explain the current page. If the user explicitly asks for annotation restore points or audit history, keep them inside the selected annotation directory and exclude them from default runtime input.

## Source And Runtime Separation

Treat annotation Markdown files as authoring source and `annotation.bundle.json` as the deployable read-only artifact. Do not require source PRDs or source annotation Markdown to be publicly served.

Use this mapping:

- Each module's `annotation.config.json` stores its `scope`, page, target selector, `markdownFile`, `blockId`, and requirement source references.
- `annotation.workspace.json` optionally aggregates multiple module configs into one runtime bundle while allowing each module to keep local numbering such as `1`, `2`, `3`.
- The Markdown file stores one or more blocks delimited by `<!-- anno:start id=... -->` and `<!-- anno:end id=... -->`.
- `scripts/compile_annotations.py` validates the mapping and compiles Markdown blocks into `annotation.bundle.json`.
- Runtime reads the bundle, renders matching badges/popups, and refreshes the deployed bundle without writing source files.

Use inline `markdown` only for tiny demos or legacy fallback. For real projects, compile external Markdown before browser verification and deployment.

## Read-Only Boundary

The runtime only reads and presents annotations:

- Local changes: the user edits annotation Markdown directly, or Codex updates it in the workspace.
- Published changes: commit and deploy the changed Markdown through the project's normal release flow.
- Browser behavior: read the compiled bundle, render badges/popups, refresh content, view all annotations, and download/export.

Never add an edit button, Markdown editor, `contenteditable`, textarea editor, draft storage, `saveEndpoint`, persistence adapter, authentication, or annotation write API to the page runtime. Export is a read-only delivery action, not an editing workflow.

## Mermaid Support

Support Mermaid as optional Markdown enhancement:

- Render fenced blocks written as ```` ```mermaid ````.
- If `window.mermaid` already exists, reuse it.
- If `annotation.config.json` provides `mermaid.src`, load that script before rendering diagrams.
- If Mermaid is unavailable, show the Mermaid source as a readable code block rather than failing the annotation popup.
- Do not require internet CDN access by default; prefer a local Mermaid asset when projects need offline reliability.

## Workflow A: Initialization

1. Inspect the project type and entry point.
   - React/Vite/SPA: inspect `package.json`, `src`, and root `index.html`.
   - Static HTML: inspect each relevant `.html` file.
   - Built output only: prefer runtime injection or bookmarklet mode.
2. Read business PRDs and extract all page-relevant logic.
   - Preserve business rules, field rules, states, roles, exceptions, and flow relations.
   - Do not summarize away implementation-critical details.
   - For form pages, separately extract field constraints and page-global handling such as mode entry, save or submit boundaries, validation scope, success return, and unsaved-leave handling.
   - Do not infer generic component behavior when the PRD does not make it business-specific.
3. Open or run the page and build a DOM target inventory.
   - Prefer stable module targets over every small element.
   - Record target label, selector candidates, visible text, role, page path, and visibility state.
   - For a modal, drawer, popover, accordion or tab panel, record the action that reveals it and inspect the target after it is visible.
4. Aggregate requirements by UI module.
   - One closely related module gets one annotation badge.
   - Filter bars, table operations, tabs, forms, modals, drawers, field groups, and batch tools are typical modules.
   - Add one page-global badge only when cross-field rules would otherwise be scattered across field groups; do not add it to ordinary display-only pages.
5. Write separate annotation Markdown files.
   - Store them in the selected annotation directory from "Annotation Directory Decision".
   - Add stable source requirement ids and map them through each annotation's `sourceRefs`.
   - Add a readable `来源：{PRD文件或章节}` line near the top of every block.
   - Create or update `changelog.md` only when annotation history is explicitly requested.
   - Keep business PRD unchanged.
6. Generate or update each module's `annotation.config.json`.
   - Assign a stable lowercase kebab-case `scope` and map each annotation id to page path, target selector, module name, `markdownFile`, and `blockId`.
   - When one deployed runtime covers multiple module configs, add or update a project-level `annotation.workspace.json` instead of manually merging module configs.
7. Compile and validate the read-only bundle.
   - Single module: run `scripts/compile_annotations.py <config> --output <public-runtime-dir>/annotation.bundle.json --coverage <annotation-dir>/coverage.md`.
   - Multiple modules: run the same command with `<workspace>`; workspace output, coverage, and optional `htmlOutput` may be declared in the manifest.
   - Do not continue with unmapped source requirements, duplicate ids, missing blocks, or missing selectors.
8. Install runtime with the smallest integration.
   - Use `scripts/install_annotation_kit.py` when copying bundled runtime assets is appropriate.
   - Existing project config must be preserved unless the user explicitly requests replacement.
9. Verify in browser.
   - Badges are positioned by absolute/fixed overlay, not by changing business layout.
   - Verify the initial mode matches `runtime.initialMode`; use `"preview"` by default and `"annotate"` only when badges should appear on first load.
   - Verify hidden modules do not render corner badges before reveal, then open each relevant module and verify its badge appears on the correct visible target.
   - Popups are clickable, draggable, resizable, read-only, and isolated from page events.
   - Markdown renders headings, lists, blockquotes, emphasis, inline code, and tables.
   - Initial mode is visibly `preview`; switching mode shows a toast.
   - Runtime refresh performs a no-cache bundle read, updates open popups, and removes deleted annotations without reloading the business page.

## Workflow B: Incremental Update

1. Compare current PRD/page/annotation files.
2. Classify changes as added, modified, deleted, or moved.
3. Update only affected annotation Markdown blocks and selector mappings.
   - Keep field-group blocks concise but preserve PRD-defined requiredness, editable conditions, defaults, range, length, precision, format, uniqueness, and validation timing.
   - Keep save, submit, return, mode, and dirty-form handling in the page-global block when one exists instead of repeating them in every field block.
   - Refresh each affected block's readable `来源` line and its configured `sourceRefs` against the current PRD.
4. Keep runtime styles, badge shape, offsets, and popup behavior unchanged unless the user explicitly asks for visual changes.
5. Remove stale badges only when their target module or requirement is truly removed.
6. Preserve supplemental annotation ids.
7. Recompile the owning module config or project workspace, then regenerate the bundle, coverage matrix, and configured HTML output before browser verification.

## Identifier Rules

Use stable ids rather than implying priority:

- Auto-generated initial annotations: `1`, `2`, `3`.
- Supplemental annotations: `A1`, `A2`, `A3`.
- Nested additions under a known module: `1a`, `1b` only when the user wants explicit relationship to an existing module.

Display ids are local to a module. The compiler creates the runtime key as `scope:id`, so `product:1` and `purchase:1` may coexist while both page badges display `1`. View-all and exported documents use `scope:id` to remain unambiguous.

When exporting all annotations, sort by page order first, then DOM order, then id.

## Selector Rules

Use selector priority:

1. Existing `data-anno`
2. Existing stable `data-testid`, `id`, `aria-label`, `name`, `role`
3. Stable semantic selector plus visible text fingerprint
4. Stable class selector
5. Generated CSS path as a temporary fallback

If no selector is stable, add one `data-anno` to the module root. Keep the attribute descriptive, such as `data-anno="product-filter-bar"`.

Read `references/integration-patterns.md` before modifying a new project type. Read `references/annotation-authoring.md` before generating or updating annotation content. Read `references/collaboration-deployment.md` before implementing local/cloud collaboration.

## Bundled Resources

- `assets/annotation-kit/runtime.js`: framework-neutral annotation overlay runtime.
- `assets/annotation-kit/runtime.css`: annotation badge, popup, and Markdown rendering styles.
- `assets/annotation-kit/annotation.config.json`: config template.
- `assets/annotation-kit/annotation.schema.json`: config schema.
- `assets/annotation-kit/annotation.workspace.json`: multi-module compilation manifest template.
- `assets/annotation-kit/annotation.workspace.schema.json`: workspace manifest schema.
- `scripts/compile_annotations.py`: validates source coverage and compiles a deployable read-only bundle.
- `scripts/install_annotation_kit.py`: copies runtime assets into a target project and can inject script/link tags into HTML entries.

## Validation Checklist

Before final response, verify:

- The selected workflow was initialization or update.
- Business PRD was not polluted with page annotation content.
- Annotation Markdown is separate and complete enough for developers.
- Runtime annotations represent the current prototype only; every block has a readable source line and valid `sourceRefs`.
- Form pages with cross-field processing have one page-global annotation; field-group annotations preserve the PRD-defined core constraints without expanding generic component conventions.
- Every declared source requirement maps to at least one annotation, or the user explicitly accepted an unmapped item.
- Compiled bundle contains no source PRD content outside mapped annotation blocks.
- Same module does not receive redundant badges.
- Runtime injection is minimal for the project type.
- Multiple modules sharing one runtime compile through a workspace manifest; no hand-merged config is required.
- Badges do not alter layout.
- Popup placement leaves the badge column clickable, and `runtime.zIndexBase` resolves host stacking conflicts without changing host styles.
- Popups support click-to-open, close button, drag, resize, read-only export, and event isolation.
- Runtime contains no edit controls, browser drafts, save endpoint, or write-back path.
- Runtime refresh re-reads the deployed bundle and reconciles existing badges and open popups.
- Configured `page` or `routeMatcher` matches the browser route; for a static one-page prototype, use `page: "*"`.
- Optional standalone HTML output contains rendered Markdown rather than raw source text.
- Markdown preview renders tables, nested ordered/unordered lists, task lists, headings, blockquotes, links, emphasis, and inline code.
- Build or browser verification ran, or the reason it could not run is stated.
