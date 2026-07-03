# web/ — Next.js frontend

The modern frontend for the TAU course planner. Hebrew, RTL, Tailwind,
light/dark via `prefers-color-scheme`.

## Current state (migration slice 1)

| Surface | Where it lives |
|---|---|
| Landing / entry | `app/page.tsx` (Next, real UI) |
| Planner (board, repo, AI) | `/planner` route → serves the canonical static `app/web/semester_board_viewer.html` unchanged |
| Semester board (read-only) | `/board` — Next-native components (`lib/board.ts` adapter, `CourseCard`, `SemesterColumn`, `ui.tsx` primitives) over the same board JSON |
| Course repository (read-only) | `/repository` — `lib/repository.ts` adapter over `metadata.program_repository_courses`, client-side search (`RepositoryExplorer`, `RepositoryCourseCard`) |

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

## Static-HTML reduction roadmap

### What still lives only in `app/web/semester_board_viewer.html`
| Section | Nature | Extraction difficulty |
|---|---|---|
| Header (emoji buttons: הקורסים שלי / החלפת תואר / איפוס / לילה) | pure UI + localStorage state | low — Next shell already replaces the frame |
| Program-selection modal | UI + program registry (embedded list) | low-medium |
| Sidebar repository panel (search, categories, add-to-board) | UI + board mutations | medium — read-only part already exists at `/repository` |
| Progress panel (התקדמות בתוכנית, category counters) | renders `metadata.program_requirements_*` | medium — read-only render is safe; do NOT recompute requirements |
| Semester board (drag/placement, locks, legality feedback) | heavy behavior | high — needs planner rules server-side |
| AI assistant panel (chat, drafts, plan preview/apply) | heavy behavior + `/api/ai/*` | high — active parallel workstream |
| Course details / My-Courses / exam-preference modals | UI + localStorage | medium |
| Theme toggle (`tau_theme`) | pure UI | bridged — `/planner` seeds it from the OS scheme |

### Next-native pieces that already exist
`ProductShell`, `ShaderGradientBackground`, `BrandLogo`, `Card`/`Badge`/
`EmptyState`, `CourseCard`, `SemesterColumn`, `RepositoryExplorer` +
`RepositoryCourseCard`, adapters `lib/board.ts` (+ `planOverview`) and
`lib/repository.ts`, routes `/plan`, `/board`, `/repository`.

### Recommended next 3 slices
1. **Progress panel (read-only)** on `/plan` — render
   `metadata.program_requirements_categories` counts as shipped (display
   only, no requirement recomputation).
2. **Program picker** as a Next page/modal reusing the embedded program
   registry shape — entry point for multi-program support.
3. **AI entry presentation** — Next-native preference form + loading/result
   layout posting to the existing `/api/ai/*` contract (logic untouched);
   coordinate with the planner workstream before starting.

Cutover (point `vercel.json` `/` at Next, retire the HTML) stays last, after
board interactivity and the AI panel reach parity.

Planner logic, constraints, and AI runtime belong to the planner workstream —
do not modify them from here.
