# Collaboration Deployment

## Read-Only Architecture

The page runtime is a read-only annotation viewer:

```txt
business PRD -> Codex or direct Markdown update -> annotations/*.md
module annotations/configs -> optional workspace manifest -> compiler/coverage check -> annotation.bundle.json
annotation.bundle.json -> Git/build/deploy -> annotation runtime -> page badges and popups
```

Do not add a browser editor, draft storage, save endpoint, persistence adapter, account system, or annotation write API.

## Local Use

Required pieces:

- `annotation-kit/runtime.js`
- `annotation-kit/runtime.css`
- `annotation-kit/annotation.bundle.json`
- selected `annotations/` directory beside the PRD or in the user-specified location

The user edits Markdown directly or asks Codex to update it. Recompile the owning config or the shared workspace manifest, then runtime refresh re-reads the bundle, updates open popups, and removes deleted annotations.

## Cloud Use

Deploy the compiled annotation bundle with the prototype. Source PRDs and source annotation Markdown may remain outside public assets. The cloud runtime can:

- Read the deployed bundle.
- Render Markdown and Mermaid.
- Display badges and popups.
- Refresh the deployed bundle without a page reload.
- View and download all annotations.

The cloud runtime cannot modify annotation Markdown. Changes go through the normal source-control and deployment process.

## Team Collaboration

Use the repository workflow already used by the project:

```txt
edit annotation Markdown or ask Codex to update it
  -> compile and validate coverage
  -> review diff or pull request
  -> merge
  -> deploy
  -> read-only runtime shows the new version
```

`changelog.md` records meaningful annotation changes. `versions/` remains optional when recoverable snapshots are explicitly required.

## Security Boundary

Because the runtime is read-only, it requires no annotation-specific user accounts, write authorization, database, conflict resolution, or file-write endpoint. Markdown and Mermaid output must still be rendered safely because deployed documents are page content.
