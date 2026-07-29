# web/ — Next.js frontend

The modern frontend for the TAU course planner. Hebrew, RTL, Tailwind,
light/dark via `prefers-color-scheme`.

## Current state (migration slice 1)

| Surface | Where it lives |
|---|---|
| Landing / entry | `app/page.tsx` (Next, real UI). Primary CTA → `/planner` (the working embedded assistant); no direct jump into raw HTML |
| Main planner (board, repo, AI) | `/planner` — Next **product-shell page** (`ProductShell fullBleed` + `LegacyPlannerFrame`) that embeds the canonical planner via a same-origin iframe. Gradient, brand and cross-navigation frame it; theme + saved program persist across the frame. Cross-cutting legacy actions (my courses / change degree / reset), the current-program label, the live `hdr-chips` status (סה״כ/מוצבים/במאגר/חסרות שעות — mirrored verbatim via a same-origin `MutationObserver` on `#hdr-chips`, `lib/chip-status.ts`) and a theme toggle are mirrored as product-styled controls in an outer toolbar — they call the legacy globals same-origin (reset is confirmation-gated). The theme toggle writes the legacy's own `tau_theme` and sets `data-theme` on both the shell and the iframe (a pre-paint bootstrap in `layout.tsx` seeds the shell from `tau_theme` so the two never desync across reloads/pages; `suppressHydrationWarning` covers the bootstrap mutation). With every control mirrored outward, the iframe requests `?embed=1`, which `/planner/legacy` (serve-time only, via `lib/embed-html.ts`) uses to collapse the now-redundant legacy `.page-hdr` — one unified header, no seam. The legacy in-frame toolbar/controls remain in the DOM (untouched, just visually collapsed) so raw `/planner/legacy` (no `embed`) is unaffected |
| Raw legacy planner | `/planner/legacy` — the canonical `app/web/semester_board_viewer.html` served unchanged (own document context, all scripts intact). Also the honest fallback if the frame fails |
| Semester board (read-only) | `/board` — Next-native components (`lib/board.ts` adapter, `CourseCard`, `SemesterColumn`, `ui.tsx` primitives) over the same board JSON |
| Course repository (read-only) | `/repository` — `lib/repository.ts` adapter over `metadata.program_repository_courses`, client-side search (`RepositoryExplorer`, `RepositoryCourseCard`). Selecting a course opens a Next-native, read-only **course-details modal** (`CourseDetailsPanel` + `lib/course-details.ts`) — no board mutation, decoupled from the legacy iframe |
| AI planning entry | `/ai-plan` — **retired**; redirects to `/planner`. It was a presentation-only placeholder (`AiPlanningExperience`) that faked a build animation and never called the planner API, so it was removed. Real AI planning is the embedded assistant at `/planner` |

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
  same `color1/2/3` values so there is no visual jump. `.syllo-bg` is a
  viewport-exact (`inset:0`), `overflow:hidden` clip boundary; the drift
  animation's `-10%` overscan (so `scale(1.02)` never reveals a hard edge)
  lives on `.syllo-bg::before` instead, clipped by the parent — keeps the same
  drift headroom without inflating `document.scrollHeight`/`scrollWidth` on
  mobile (a real, verified ~81px/21px phantom-scroll bug on every
  `ProductShell` route, fixed without touching `ShaderGradientBackground.tsx`).
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
| Header (emoji buttons: הקורסים שלי / החלפת תואר / איפוס / לילה, hdr-chips status) | pure UI + localStorage state | **done** — Next shell mirrors every control and the live status; embedded `.page-hdr` is collapsed via serve-time CSS (`?embed=1`, `lib/embed-html.ts`). Raw `/planner/legacy` (no embed) still shows the original header for debugging/fallback |
| Program-selection modal | UI + program registry (embedded list) | extracted read-only — `/programs` renders the family cards from `lib/programs.ts`, a typed mirror of the embedded registry (drift-guarded by `tests/ui/programs_adapter.test.ts`); selection travels as `?program=` across `/plan`, `/board`, `/repository` (default omitted). The HTML modal remains canonical for the interactive planner |
| Sidebar repository panel (search, categories, add-to-board) | UI + board mutations | medium — read-only part already exists at `/repository` |
| Progress panel (התקדמות בתוכנית, category counters) | renders `metadata.program_requirements_*` | extracted read-only — `/plan` renders `program_requirements_validation` as shipped (`lib/requirements.ts` + `RequirementsProgressPanel`); the HTML panel remains canonical until cutover |
| Semester board (drag/placement, locks, legality feedback) | heavy behavior | high — needs planner rules server-side |
| AI assistant panel (chat, drafts, plan preview/apply) | heavy behavior + `/api/ai/*` | high — active parallel workstream, served today by the embedded assistant at `/planner`. A native presentation entry (`AiPlanningExperience` at `/ai-plan`) was tried but faked generation, so it was retired (`/ai-plan` now redirects to `/planner`) until a real native flow is built |
| Course details / My-Courses / exam-preference modals | UI + localStorage | course-details **extracted read-only** — `CourseDetailsPanel` (`lib/course-details.ts` VM) renders name/id/hours/credits/category/offered/prereqs/syllabus from the repository fields at `/repository`, decoupled from the iframe; a live `/planner`-iframe selection bridge is the deferred follow-up (needs a sanctioned legacy hook — reading `courseMap` on card click would double-open the legacy modal). My-Courses / exam-preference still legacy-only |
| Theme toggle (`tau_theme`) | pure UI | bridged — `/planner` seeds it from the OS scheme |

### Next-native pieces that already exist
`ProductShell`, `ShaderGradientBackground`, `BrandLogo`, `Card`/`Badge`/
`EmptyState`, `CourseCard`, `SemesterColumn`, `RepositoryExplorer` +
`RepositoryCourseCard`, `CourseDetailsPanel`, adapters
`lib/board.ts` (+ `planOverview`), `lib/repository.ts`, `lib/course-details.ts`,
`lib/chip-status.ts` and `lib/embed-html.ts`, routes `/plan`, `/board`,
`/repository`, `/ai-plan`.

### Recommended next 3 slices
1. **Wire the AI entry** — post the `/ai-plan` preference form to the existing
   `/api/ai/*` contract (logic untouched) and render a real draft in place of
   the presentation-only result shell; coordinate with the planner workstream.
2. ~~**Course details modal** (read-only)~~ — **done.** `CourseDetailsPanel`
   renders the repository course fields (name/id/hours/credits/category/offered/
   prereqs/syllabus) as a decoupled read-only modal at `/repository`. Follow-up:
   a same-origin `/planner`-iframe selection bridge (needs a sanctioned legacy
   hook so it does not double-open the legacy modal).
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
