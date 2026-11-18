# Prerequisite enforcement readiness (assessment only — nothing is enabled)

**Recommendation: do not enable blocking enforcement yet.** Shadow mode is unchanged. Approval is requested below for each stage; none has been taken.

## Evidence

| Measurement (all reproducible) | Result |
|---|---|
| Official default ME 2027 path (`scripts/audit_default_board_prerequisites.ts`) | **4 official placements would be blocked** if flexible semesters go in A, **2** if in B (0542-3804, 0542-4020; plus 0542-3620/3792 when 2500 shares Y3/A). All are graded `verified` — i.e. *record* confidence is not the same as *safe to enforce*. |
| Official default EE 2027 path | 0 blocked in either variant |
| Planner output, 12 ME scenarios, previous baseline (`planner-evaluation.md`) | 60 verified-grade violations (avg 5 per plan); 36 are *not* forced by locked official placements — e.g. 0512-1202 placed without 0512-1201, 0555-4562 without 0512-1203 |
| Blocking-capable retired ids without an approved mapping | 0512-4262 and 0555-2250 (`prerequisite-discrepancy-register.md`, computed section) |
| Courses whose "no prerequisites" is only one-source/assumed | 26–28 per board (`coverage-report.md`) |

**False positives of strict enforcement (would wrongly block a legitimate student):** D1 (0542-3804 needs an EE Python course the official ME plan never schedules — registrar inconsistency), D2 (Y4 `either` windows vs official semester 7/8), D3 (Fluid Mechanics / Thermodynamics window). Every official ME plan would be invalid today.
**False negatives (invalid plan passes):** courses with `none_listed`/assumed data and courses whose prerequisite is an unresolved retired id (D6, D7) cannot be checked; inferred equivalences (D4) would let a plan pass on SYLLO's say-so, not the university's.

## What is safe to enforce, and what must stay advisory

- **Enforce-eligible (after approval):** `verified` records, sources agree, no unresolved/retired leaf, program/year *not* touched by D1–D3, and requirement satisfied by completed or strictly earlier courses. Today this is the `enforcementGrade: 'verified'` set minus the D1–D3 courses.
- **Advisory only:** `none_listed`, `assumed_none_no_syllabus`, `not_in_catalog` leaves, `sources_disagree`, anything resting on an **inferred** equivalence (D4), student-attested non-course requirements (not modelled yet).
- **Semantics already correct and tested:** AND/OR, same-semester ≠ satisfied, corequisites may share a semester, equivalences scoped per program, completed courses count.

## Blockers to clear first (need your decision)

1. Resolve D1–D3 (spec window rules / ask the department). 2. Decide D5 (official program-page statement for 0509-1510 ≡ 0542-1510). 3. Planner readiness ranking evaluated and approved (below). 4. Surfaces: manual placement, AI proposals, Apply and replanning must share one evaluator — today only the warnings path (PR #152) and the shadow audit use it.

## Staged rollout with rollback

| Stage | Behaviour | Switch (default) | Rollback |
|---|---|---|---|
| 0 (current) | Shadow audit + warnings | always on | — |
| 1 | **Readiness ranking** in the planner: proposals prefer prerequisite-ready plans; never blocks | `AI_PREREQ_READINESS_OBJECTIVE=on` (**off**, implemented) | unset the variable |
| 2 | Block AI proposals/Apply for enforce-eligible violations on one program-year only (ME 2027) | *to be built*, per program/year/confidence allow-list | remove from allow-list |
| 3 | Manual placement and replanning enforce the same rule | same allow-list | same |
| 4 | Widen to EE, then other years | allow-list | same |

Each stage needs a replay of the official default boards (0 blocked required) and the evaluation suite (0 new violations, no loss of mandatory coverage) before promotion.

### Stage-1 trade-off you should know about (measured)

Readiness ranking cut non-forced violations from 36 to 13 but also cut focus-aligned courses from 36 to 18, and made interest-specific plans much more alike (0.47 → 0.10). Reason: many interest electives (e.g. biomedical) need background the evaluated student had not completed. It needs a UI that says "to take X you first need Y" before it is useful; see conversation-evaluation W3.

## Approvals requested

- [ ] Stage 1 on Preview only (soft ranking, reversible)
- [ ] Mapping decisions D1–D5 in the discrepancy register
- [ ] Building the Stage-2 allow-list mechanism (code only, off by default)
