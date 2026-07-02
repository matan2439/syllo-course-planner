# web/ — Next.js frontend

The modern frontend for the TAU course planner. Hebrew, RTL, Tailwind,
light/dark via `prefers-color-scheme`.

## Current state (migration slice 1)

| Surface | Where it lives |
|---|---|
| Landing / entry | `app/page.tsx` (Next, real UI) |
| Planner (board, repo, AI) | `/planner` route → serves the canonical static `app/web/semester_board_viewer.html` unchanged |
| Semester board (read-only) | `/board` — Next-native components (`lib/board.ts` adapter, `CourseCard`, `SemesterColumn`, `ui.tsx` primitives) over the same board JSON |

The static HTML file remains the **single source of truth** for the planner UI
and is what production Vercel serves at `/` (see root `vercel.json`). The Next
app wraps it rather than duplicating it, so both stay in sync.

## Running locally

```bash
# Terminal 1 — APIs + production-style serving (root of repo)
vercel dev            # serves api/* and the static HTML on :3000

# Terminal 2 — Next frontend
cd web && npm run dev # :3001, /planner wraps the HTML, /api/* proxied to :3000
```

Set `PLANNER_API_ORIGIN` to point `/api/*` at a different backend origin.

Without `vercel dev`, `/planner` still works: the HTML's board loader falls
back to static JSON, served by `app/data/parsed_json/[file]/route.ts` from the
repo's `data/parsed_json/` (AI endpoints still need the backend).

## Conventions

- **Brand assets:** `public/brand/logo-light.svg` + `public/brand/logo-dark.svg`,
  switched natively by `app/components/BrandLogo.tsx` (`<picture>` +
  `prefers-color-scheme`, zero JS).
- **Animated background:** `app/components/ShaderGradientBackground.tsx` — CSS
  port of the canonical Syllo ShaderGradient config (documented in that file
  and in the HTML). A future `@shadergradient/react` integration should use the
  same `color1/2/3` values so there is no visual jump.
- **Design tokens:** `app/globals.css` `:root` variables mirror the planner
  HTML's palette; dark mode is the OS scheme.
- **Reduced motion:** the global `prefers-reduced-motion` rule freezes all
  animation — do not add per-component opt-outs.

## Guard test

`tests/ui/web_next_wiring.test.js` (run from repo root:
`npx jest --config jest.ui.config.js tests/ui/web_next_wiring.test.js`)
fails if the canonical HTML, the `/planner` wiring, or the brand assets move.

## Remaining migration phases (not yet done)

1. ~~Board read-only view~~ — done: `/board` (reads the static JSON directly;
   switch its data source to `/api/board/:programId` when the backend is
   wired).
2. **Course repository** — searchable repo panel as components (reuse
   `CourseCard`; data comes from `metadata.program_repository_courses`).
3. **Board interactivity** — placement/moves in React state (must reuse the
   planner's legality rules server-side; do not reimplement them in UI).
4. **AI panel** — chat entry + draft plan presentation (UI only; planner logic
   stays server-side, untouched).
5. **Cutover** — point `vercel.json` `/` at the Next app, keep the HTML
   reachable until parity is verified, then retire it.

Planner logic, constraints, and AI runtime belong to the planner workstream —
do not modify them from here.
