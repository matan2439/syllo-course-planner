# web/ — Next.js frontend

The modern frontend for the TAU course planner. Hebrew, RTL, Tailwind,
light/dark via `prefers-color-scheme`.

## Routes

| Route | What it is |
|---|---|
| `/` | Landing page. Primary CTA opens `/planner` |
| `/planner` | The full planner: one React workspace (`UnifiedPlannerWorkspace`) with board, course repository and the Academic Decision Agent. Manual add/move/remove goes through `/api/ai/edit-board`; generate/apply through `/api/ai/*` |
| `/planner/native/agent-preview` | Full agent, gated on `ENABLE_ACADEMIC_AGENT_PREVIEW=1` |
| `/programs` | Program picker; each card opens `/planner?program=...` |
| `/board`, `/repository`, `/plan` | Read-only board, course repository and requirements views |

The single-file HTML planner that used to live at `app/web/` has been removed.
Planner rules (legality, scoring, repair) live server-side in `api/ai/*`.

## Running locally

```bash
# Terminal 1 - APIs (root of repo)
vercel dev            # serves api/* on :3000

# Terminal 2 - Next frontend
cd web && npm run dev # :3001, /api/* proxied to :3000
```

Set `PLANNER_API_ORIGIN` to point `/api/*` at a different backend origin.

## Tests

```bash
cd web && npm test    # jest + RTL (ts-jest, jsdom)
```

Server rules are tested from the repo root: `npx jest --testPathPattern=tests/api`.

## Conventions

- **Brand assets:** `public/brand/logo-light.svg` + `public/brand/logo-dark.svg`,
  switched natively by `app/components/BrandLogo.tsx` (`<picture>` +
  `prefers-color-scheme`, zero JS).
- **Animated background:** `app/components/ShaderGradientBackground.tsx` — CSS
  port of the canonical Syllo ShaderGradient config (documented in that file). A future `@shadergradient/react` integration should use the
  same `color1/2/3` values so there is no visual jump. `.syllo-bg` is a
  viewport-exact (`inset:0`), `overflow:hidden` clip boundary; the drift
  animation's `-10%` overscan (so `scale(1.02)` never reveals a hard edge)
  lives on `.syllo-bg::before` instead, clipped by the parent — keeps the same
  drift headroom without inflating `document.scrollHeight`/`scrollWidth` on
  mobile (a real, verified ~81px/21px phantom-scroll bug on every
  `ProductShell` route, fixed without touching `ShaderGradientBackground.tsx`).
- **Design tokens:** `app/globals.css` `:root` variables mirror the planner
  planner's palette; dark mode is the OS scheme.
- **Product shell:** every Next surface renders inside `ProductShell` (gradient,
  brand, section nav, `?program` preservation).
- **Route transitions:** `app/template.tsx` (Next remounts it per navigation) +
  the `.route-fade` class in globals give one subtle, vertical-only (RTL-safe)
  entrance for every route. No motion library.
- **Reduced motion:** the global `prefers-reduced-motion` rule freezes all
  animation (including `.route-fade` and the gradient) — do not add
  per-component opt-outs.
