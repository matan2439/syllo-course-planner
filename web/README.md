# web/ — Next.js frontend

The modern frontend for the TAU course planner. Hebrew, RTL, Tailwind,
light/dark via `prefers-color-scheme`.

## Current state (migration slice 1)

| Surface | Where it lives |
|---|---|
| Landing / entry | `app/page.tsx` (Next, real UI). Primary CTA → `/ai-plan` (guided flow); no direct jump into raw HTML |
| Main planner (board, repo, AI) | `/planner` — Next **product-shell page** (`ProductShell fullBleed` + `LegacyPlannerFrame`) that embeds the canonical planner via a same-origin iframe. Gradient, brand and cross-navigation frame it; theme + saved program persist across the frame. Cross-cutting legacy actions (my courses / change degree / reset) are mirrored as product-styled buttons in an outer toolbar labelled "הממשק המלא" — they call the legacy globals same-origin (reset is confirmation-gated); the legacy in-frame toolbar is untouched and still works |
| Raw legacy planner | `/planner/legacy` — the canonical `app/web/semester_board_viewer.html` served unchanged (own document context, all scripts intact). Also the honest fallback if the frame fails |
| Semester board (read-only) | `/board` — Next-native components (`lib/board.ts` adapter, `CourseCard`, `SemesterColumn`, `ui.tsx` primitives) over the same board JSON |
| Course repository (read-only) | `/repository` — `lib/repository.ts` adapter over `metadata.program_repository_courses`, client-side search (`RepositoryExplorer`, `RepositoryCourseCard`) |
| AI planning entry (presentation) | `/ai-plan` — `AiPlanningExperience` preference form + staged loading/result/error choreography. No planner call yet; hands off to the canonical assistant at `/planner` |

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
- **Product shell:** every Next surface renders inside `ProductShell` (gradient,
  brand, section nav, `?program` preservation). The planner uses its
  `fullBleed` variant to frame the embedded legacy iframe.
- **Route transitions:** `app/template.tsx` (Next remounts it per navigation) +
  the `.route-fade` class in globals give one subtle, vertical-only (RTL-safe)
  entrance for every route. No motion library.
- **Reduced motion:** the global `prefers-reduced-motion` rule freezes all
  animation (including `.route-fade` and the gradient) — do not add
  per-component opt-outs.

## Guard test

`tests/ui/web_next_wiring.test.js` (run from repo root:
`npx jest --config jest.ui.config.js tests/ui/web_next_wiring.test.js`)
fails if the canonical HTML, the `/planner` wiring, or the brand assets move.

## Static-HTML reduction roadmap

### What still lives only in `app/web/semester_board_viewer.html`
| Section | Nature | Extraction difficulty |
|---|---|---|
| Header (emoji buttons: הקורסים שלי / החלפת תואר / איפוס / לילה) | pure UI + localStorage state | low — Next shell already replaces the frame |
| Program-selection modal | UI + program registry (embedded list) | extracted read-only — `/programs` renders the family cards from `lib/programs.ts`, a typed mirror of the embedded registry (drift-guarded by `tests/ui/programs_adapter.test.ts`); selection travels as `?program=` across `/plan`, `/board`, `/repository` (default omitted). The HTML modal remains canonical for the interactive planner |
| Sidebar repository panel (search, categories, add-to-board) | UI + board mutations | medium — read-only part already exists at `/repository` |
| Progress panel (התקדמות בתוכנית, category counters) | renders `metadata.program_requirements_*` | extracted read-only — `/plan` renders `program_requirements_validation` as shipped (`lib/requirements.ts` + `RequirementsProgressPanel`); the HTML panel remains canonical until cutover |
| Semester board (drag/placement, locks, legality feedback) | heavy behavior | high — needs planner rules server-side |
| AI assistant panel (chat, drafts, plan preview/apply) | heavy behavior + `/api/ai/*` | high — active parallel workstream. Presentation entry extracted at `/ai-plan` (`AiPlanningExperience`): preference form + loading/result/error states, no planner call yet, hands off to `/planner` |
| Course details / My-Courses / exam-preference modals | UI + localStorage | medium |
| Theme toggle (`tau_theme`) | pure UI | bridged — `/planner` seeds it from the OS scheme |

### Next-native pieces that already exist
`ProductShell`, `ShaderGradientBackground`, `BrandLogo`, `Card`/`Badge`/
`EmptyState`, `CourseCard`, `SemesterColumn`, `RepositoryExplorer` +
`RepositoryCourseCard`, `AiPlanningExperience`, adapters `lib/board.ts`
(+ `planOverview`) and `lib/repository.ts`, routes `/plan`, `/board`,
`/repository`, `/ai-plan`.

### Recommended next 3 slices
1. **Wire the AI entry** — post the `/ai-plan` preference form to the existing
   `/api/ai/*` contract (logic untouched) and render a real draft in place of
   the presentation-only result shell; coordinate with the planner workstream.
2. **Course details modal** (read-only) — syllabus summary/links from the
   repository course fields, reusing the shared Card primitives.
3. **My-Courses status view** (read-only) — render the localStorage-backed
   personal statuses the HTML tracks, without mutating them.

Known limitation: only the 2027 board JSON ships in this checkout, so
non-default programs render a calm "not available here" fallback on
`/plan`, `/board` and `/repository` (production boards come from
`/api/board`).

Cutover (point `vercel.json` `/` at Next, retire the HTML) stays last, after
board interactivity and the AI panel reach parity.

Planner logic, constraints, and AI runtime belong to the planner workstream —
do not modify them from here.
