# Product Goal — Generic Academic Planning Engine

Status: **DRAFT — awaiting approval**
Baseline: production stable at master `a2ad0a4`. This document defines where the product is going; it is not an implementation plan and authorizes no code changes by itself.

---

## 1. Product North Star

Build a deterministic, data-trustworthy academic degree-planning engine that any student, at any institution, in any structured degree program, can use to:

- see exactly what they still need to complete their degree,
- get a legal, explainable draft plan toward that goal,
- understand precisely why the planner could or could not complete it,
- and apply that plan with confidence that it will not silently violate a real constraint.

TAU Mechanical Engineering, catalog year 2027, is the **first fixture and regression corpus** — a concrete instance used to build and prove the engine, not the product itself and not a template the engine core is allowed to assume. The product is the **engine**: the part that takes a structured institution/program/requirements model + a structured course catalog + a student's state, and produces a legal, explained plan, for any institution that can supply data in that shape. AI is a UX layer on top of that engine, never the source of truth for whether a plan is legal.

## 2. Target User Journey

1. **Select institution, program, track, and catalog year/requirement version.** The planner loads that combination's requirements model and course catalog; nothing about the UI or the planner core is specific to which one was chosen.
2. **State personal progress** — completed courses, currently-taking, planned, and/or a manual completed-credit override. The student should never need to re-enter their whole history if the system can infer it from per-course statuses.
3. **State preferences** — wanted courses, hard-avoided courses, max weekly/term load, assessment-type preferences (e.g. no final exam), free-text intent ("focus on X").
4. **Request a plan** — full rebuild or incremental update.
5. **Receive a draft** — every course in it is real, named, legally placed, and the result is honestly labeled as one of the four result types in §8, with concrete numeric and per-constraint reasons for any shortfall.
6. **Review and apply** — the student can edit the draft on the board before committing; the apply action's label always makes clear which of the four result types is being applied.
7. **Iterate** — the student asks for changes in chat; the planner re-validates and re-explains, never silently regressing a previously-explained constraint.

## 3. Generic Product Scope

In scope for the generic engine:
- Any degree program expressible as: a set of mandatory courses (each with a placement model — fixed / movable-among-legal-terms / annual-or-multi-term-bundle / already-completed), a set of **program requirement groups** (each needing N courses or N credit-hours from a defined course pool — e.g. an elective category requirement, or a general-education/distribution requirement), and a **program-specific credit/hour target** for graduation.
- Any course catalog expressible as: course id (institution-namespaced — see §4), title (required for user-visibility), credit/hour value, assessment type, prerequisite ids, term-offering data, and a data-quality status.
- Any institution's own **term/semester model** — number of terms per year, their names, and how a multi-term program maps onto them. The engine must not assume any fixed term count or naming; "year 3, semester A" is TAU's instance of this model, not the engine's.
- Multiple concurrent institutions, programs, tracks, and catalog years loaded by configuration/data, not by code branching per program. "Support for other universities" is a **data-model requirement**, not a future marketing claim — see §4.

Explicitly out of scope for now (acknowledged, not solved by this document):
- Cross-institution transfer credit equivalency.
- Multi-degree (double major) joint solving — single-program planning only for the current roadmap horizon.
- Non-academic scheduling (extracurriculars, work, personal calendar) beyond what's needed to express weekly-load preferences.

## 4. Multi-Institution Domain Model

This is the data model the engine is built against. Every entity below is first-class — the engine core may reference these entity *types*, never a specific institution's, program's, or course's identity or values.

| Entity | What it represents | Why it must be explicit |
|---|---|---|
| **Institution / university** | The top-level organization (e.g. a specific university). Owns its own term model, course-id namespace, and locale/language defaults. | Without this entity, "support other universities" has nowhere to attach data to — it stays aspirational. |
| **Faculty / school** | A sub-organization within an institution that owns a set of programs (e.g. an engineering faculty). Optional for a single-faculty institution, but must be representable. | Programs are usually administered at this level, not the institution level; requirement schemas can differ by faculty. |
| **Campus** | A physical/administrative location, where relevant (multi-campus institutions may offer the same program with different term structures or course availability). | Not needed by every institution, but the model must not assume a single campus when one institution has several. |
| **Degree / program** | A specific degree program (e.g. a B.Sc. in a named field) belonging to a faculty. Owns its requirement groups and credit/hour target. | The actual unit of "what is the student trying to complete." |
| **Track / specialization** | An optional sub-variant of a program with its own requirement overlay (additional or substituted requirement groups). | Many real programs have tracks; the engine must not assume a program is monolithic. |
| **Catalog year / requirement version** | The specific year's (or cohort's) version of a program's requirements and course offerings — requirements and catalogs legitimately change between cohorts. | A student's plan must be evaluated against the requirement version that actually applies to them, not "whatever the current data is." |
| **Institution-specific term/semester model** | The institution's own term count, names, and academic-year structure. | See §3 — must not be hard-coded as 2 or 4 terms with fixed names. |
| **Institution-specific course-id namespace** | Course identifiers are unique within an institution's own numbering scheme, not globally — the engine must key courses by `(institution_id, course_id)`, never by a bare course id assumed globally unique. | Prevents id collisions once a second institution's data is loaded, and makes clear course ids are institution data, not engine constants. |
| **Program requirement schema** | The structured definition of a program's mandatory-course list (with each course's mobility classification, §9), requirement groups, and credit/hour target — i.e., the data shape every program/track/catalog-year combination must supply. | This is the contract the engine core actually consumes; everything above exists to produce a valid instance of this schema. |

TAU Mechanical Engineering 2027 is one concrete instance of: one institution, one faculty, one program, no track variants yet modeled, one catalog year, a 4-term-per-degree-phase term model, and a course-id namespace using TAU's own numbering. Every one of those is **that fixture's data**, not an engine assumption.

## 5. Non-Negotiable Planner Invariants

These hold for every institution, every program, every catalog, every request, with no per-program exception:

1. **A course with no real, displayable title is never schedulable, never a candidate, never counted toward completion, and never shown as a normal card** — anywhere in the pipeline: candidate pools, AI payloads, deterministic fill, repair/balance, summaries, repository, picker search, drag sources, apply validation. A catalog-quality gap is reported as a data-audit item, never silently absorbed into a plan.
2. **A hard-avoided course is never newly placed.** If it is already on the committed board, the system explains why it remains (mandatory/locked) or warns explicitly that the preference is not satisfied while it remains — it never silently claims the preference is honored.
3. **A plan below the program's credit/hour target is never presented as complete.** It is labeled partial, with the exact missing amount and concrete blocking reasons, and the apply action is unmistakably distinguished from applying a complete plan.
4. **A plan never silently exceeds an explicit user constraint** (e.g. max weekly/term load) without an explanation that names the structural reason (e.g. "N mandatory courses with no legal alternative term sum to more than your max"). If the constraint can be honored without breaking a degree requirement, it must be.
5. **A summary/explanation is generated only from the final, post-validation plan.** Never from a raw AI proposal, a candidate pool, a pre-validation draft, or a stale cached preference set.
6. **Legality is never inferred by the AI.** Term legality, prerequisite order, multi-term-bundle integrity, and credit/hour totals are computed by deterministic code from structured data, and re-validated after every AI proposal and every repair pass — never trusted from the AI's own claims.
7. **An annual/multi-term course is placed as one atomic unit across all its required terms, or not at all.** It is never split.
8. **A movable mandatory course may be relocated only among its own data-declared legal alternative terms**, never to an arbitrary term, and any such move is explained by name.
9. **Every one of the above invariants holds identically regardless of which institution, program, catalog, or display language is loaded.** A program-specific number (e.g. a particular credit/hour target), a program-specific requirement-group name (e.g. a particular distribution-requirement label), or a specific course id must never appear in engine logic — only in that program's data. Any such value currently visible elsewhere in this document is an **example from the TAU fixture**, never a default the engine core is allowed to assume.

## 6. Data Trust Model

Three explicit trust tiers, and every consumer of course/program data must know which tier it's reading:

| Tier | Meaning | Example (TAU fixture) | Planner behavior |
|---|---|---|---|
| **Verified** | A real, structured value confirmed by an authoritative source (official catalog field, syllabus parse with high confidence, user-entered status) | a confirmed course title, `is_mandatory: true`, user marked "completed" | Used freely as ground truth |
| **Inferred/uncertain** | A value the system computed or guessed, with a recorded confidence | offering restricted to one term this year but program-level policy says flexible; AI-estimated difficulty | Used only with a visible "tentative"/"uncertain" marker; never silently treated as verified |
| **Missing/unknown** | The field is genuinely absent — no value, no confident inference | a null title, a null assessment type | Never schedulable, never counted, never silently defaulted to a "safe" assumption. Surfaced as a data-quality item. The one narrow exception: when the requirement truly cannot be met any other way, an unknown-data course may be offered as an explicit, manual-approval-only candidate — never auto-selected. |

A field's trust tier must be a first-class, queryable property of the data model (not re-derived ad hoc per call site), so every pipeline stage applies the same rule.

## 7. Planner Pipeline Target Architecture

Target shape, named by role rather than by any specific module/file (the current TAU implementation already has working versions of most of these stages under TAU-fixture-specific names; the goal is to generalize the *shape* and *contracts* between stages, not to throw away the working logic):

```
Institution/Program/RequirementSchema (§4)          CourseCatalog (per institution+program+year)
        │                                                       │
        └───────────────────────┬───────────────────────────────┘
                                 ▼
                  Data Ingestion Adapter   ← institution-specific import/parse, produces
                                 │            the generic requirement model + catalog below
                                 ▼
                  Normalization Layer      ← maps institution-specific fields onto the
                                 │            generic requirement model + trust tiers (§6)
                                 ▼
                  StudentState (status, board, prefs)
                                 ▼
              ┌─────────────────────────┐
              │  Data-Quality Gate       │  ← strips/flags non-renderable, unknown-trust courses
              └─────────────┬────────────┘
                             ▼
              ┌─────────────────────────┐
              │  Candidate Pool Builder  │  ← legal, named, trust-tiered candidates only
              │                          │     (this is what reaches the AI, if any)
              └─────────────┬────────────┘
                             ▼
        ┌───────────────────────────────────┐
        │  AI Proposal (optional)           │  ← may suggest placement, explain intent;
        │  — advisory only                  │     never trusted for legality
        └────────────────────┬──────────────┘
                             ▼
              ┌─────────────────────────┐
              │  Planner Core             │  ← search/fill/repair/balance logic, working
              │  (search + repair)        │     only against the generic requirement model
              └─────────────┬────────────┘
                             ▼
              ┌─────────────────────────┐
              │  Validation Engine        │  ← the ONLY source of truth for legality:
              │  (always runs,            │     prereqs, terms, multi-term bundles, credit
              │  AI or no AI)             │     caps, hard-avoid, mandatory mobility, load
              └─────────────┬────────────┘
                             ▼
              ┌─────────────────────────┐
              │  Result Classifier        │  ← see §8
              └─────────────┬────────────┘
                             ▼
              ┌─────────────────────────┐
              │  Explanation Layer        │  ← built ONLY from the final validated result
              └─────────────┬────────────┘
                             ▼
              ┌─────────────────────────┐
              │  UI State Layer           │  ← renders draft + message + apply affordance
              └─────────────────────────┘     per the result type's UI contract (§8)
```

Key architectural rule: the **Validation Engine** stage is mandatory and identical whether or not an AI was involved. An AI-free "rebuild" and an AI-assisted "rebuild" must terminate at the same validation engine with the same invariants enforced. The **Planner Core** must depend only on the generic requirement model produced by the Normalization Layer — never directly on an institution-specific data shape.

## 8. Planner Result Types

Every planner run terminates in exactly one of these four, and the UI/message layer must be able to render each one unambiguously. "Partial blocked" (C) and "invalid rejected" (D) are deliberately distinct: C is a legal draft that simply doesn't reach the target after exhausting real options; D is a draft that would violate a hard rule and must not be shown as appliable at all.

| # | Result | Condition | UI contract |
|---|---|---|---|
| **A** | **Complete valid plan** | Reaches the program's credit/hour target, all hard requirements (mandatory courses, requirement groups, prerequisites, term legality) satisfied, no unexplained constraint violation | Normal "plan ready" framing, normal apply allowed, no confirmation step |
| **B** | **Complete with warnings / approval needed** | Reaches the target, no hard-rule violations, but contains an uncertain assumption or data gap (e.g. a tentative-offering course, an unknown-assessment course used only because no verified alternative existed, a structurally irreducible load overage) | Normal "plan ready" framing PLUS every warning visible in the persistent message; apply allowed only with an explicit warning/confirmation step |
| **C** | **Partial blocked plan** | Below the target, and no legal, reliable path to close the gap exists under the current constraints, after exhausting real candidates (not after giving up early) | Leads with the shortfall and amount, explicit "partial" label, candidate-exhaustion reasons (§12), apply allowed only as an explicitly-labeled partial draft |
| **D** | **Invalid rejected plan** | Violates a hard constraint that cannot be legally resolved (e.g. an unresolvable hard-avoid conflict, a broken multi-term bundle, an illegal placement the validator cannot repair) | Apply is blocked entirely; the draft must never be presented as if it were appliable; explanation names the specific violated rule |

A result must never be silently re-labeled between these four by a different message-construction path than the one that classified it. Every message-construction path in the codebase must route through one shared classifier, not re-derive its own notion of "is this plan okay."

## 9. Course Data Quality Requirements

- A course is **user-visible/schedulable** only if it has a real, non-placeholder title in at least one display language the institution/program is configured for.
- Credit/hour value, prerequisites, and term-offering are each independently trust-tiered (§6); a course can have a verified title and an unknown credit value, and must be handled per-field, not as one binary "good/bad" flag.
- A program/catalog load must produce a **data-quality report** (count and identity of non-renderable courses, unknown-assessment courses, unknown-offering courses) that is available to operators/maintainers, separate from anything shown to the end user during planning.
- A course's data-quality status must be computed once per catalog load and reused — not re-derived inconsistently by different pipeline stages (this is the exact class of bug already found and fixed once in the TAU fixture; the generic engine must make this structurally impossible by having one canonical gate function that every stage calls).

## 10. Mandatory Course Mobility Model

Every mandatory course must be classified, from data, as exactly one of:

1. **Fixed** — must stay in one specific term. Never moved, regardless of load.
2. **Movable** — required, but the data declares 2+ legal terms it can occupy. May be relocated by the planner to relieve load or unblock completion, always within its declared legal set, always explained by name.
3. **Annual/multi-term bundle** — required across a fixed set of terms simultaneously (not "choose one"). Counted once toward total credit/hours; loaded into every span term; never split, never moved as a partial unit.
4. **Already satisfied** — completed or in-progress per the student's status; not re-scheduled.

If the catalog data does not explicitly support classifying a course into (2), it defaults to (1) and the missing-mobility-data gap is reported separately — the engine never guesses a course is movable. This default is conservative by design: an incorrectly-fixed course produces an honest "I couldn't move this" explanation; an incorrectly-movable course could produce an illegal plan.

## 11. AI Assistant Behavior Rules

- The AI may: propose a candidate plan, explain intent/tradeoffs in natural language, answer "why" questions about a plan, draft free-text-to-structured-preference parsing.
- The AI may never: be the final authority on legality, see or propose a non-renderable/unknown-trust-tier-without-disclosure course as a clean candidate, have its raw output shown to the user without passing through the Validation Engine first.
- Every AI-sourced course suggestion is re-validated by the same deterministic gate as every other candidate before it can appear in a draft.
- If the AI's proposal is rejected or modified by validation, the user-facing message reflects the **final validated state**, and may explain what changed and why, but never describes the AI's original (pre-validation) proposal as if it were the outcome.
- AI unavailability (no API key, rate limit, network failure) must degrade to the deterministic-only pipeline producing the same result-type contract (§8) — AI is an enhancement layer, not a dependency for correctness.

## 12. UI/UX Quality Bar

Future UI work on this product should be evaluated directly against `/design-motion-principles` and `/impeccable` at implementation time (neither was available as an installed skill in this session, so this section encodes their substance from first principles rather than citing their exact text — re-validate against the actual skills when they're available).

**Motion**
- Motion exists only for orientation, feedback, or continuity (e.g. a card moving to show where it landed, a state transition showing what changed) — never as decoration with no informational purpose.
- Transitions are fast, calm, and reversible: a state change should feel undoable, not committing, until the user takes an explicit apply/confirm action.
- Drag-and-drop interactions give immediate, continuous feedback (valid/invalid drop target, current load impact) — never a delayed or ambiguous result.

**State clarity**
- The five planner-relevant UI states — draft, partial, warning/approval-needed, blocked, complete (mapping to §8's four result types plus the editable-draft state) — are each visually distinct at a glance, not distinguishable only by reading text.
- Hierarchy and visual rhythm: the most consequential information (target reached/not reached, blockers, warnings) is the most visually prominent element on screen, not competing with decorative elements.
- Empty states and error states are designed, not default-rendered — an empty board or a failed plan request explains what happened and what to do next.

**Reliability perception**
- The UI must never *look* more confident than the underlying result actually is — a partial or warning-bearing plan must not visually resemble a complete one at a glance (color, iconography, and apply-button styling all participate in this signal, not just label text).
- Critical warnings (hard-avoid conflicts, data-quality issues, blocked results) must be impossible to miss — never reliant on scrolling, never only in a transient toast, never only in console/debug output.
- No visual polish is applied if it would reduce clarity — e.g. no animation, color, or layout choice that makes a warning harder to notice or a state harder to distinguish.

**Accessibility and baseline quality**
- Light and dark themes both meet a minimum contrast bar for all card types, badges, and message blocks; a theme switch must visibly and immediately reflect token changes (no stale-render states).
- Keyboard navigation and visible focus states are supported for all interactive board/chat elements, not just mouse/touch.
- Hebrew RTL layout (the TAU fixture's language) is correct today, and the layout system must not assume RTL-only or LTR-only — text direction is a locale property of the institution/program (§4), not an engine assumption.
- All user-facing strings are sourced from a per-institution/per-locale string table, not hard-coded literals inside engine logic — the current Hebrew UI is this fixture's locale choice, not an engine assumption.

## 13. Reliability Test Matrix

A program-agnostic test suite must cover, against at least two structurally different synthetic programs (different term counts, different requirement-group structures, different credit/hour targets) in addition to the current TAU fixture:

- Data quality: nameless/unknown-trust courses excluded from every pipeline stage listed in §5.1; correctly flagged when already on a board.
- Hard-avoid: never newly placed; existing-on-board case warns or explains per §5.2; never reported as newly scheduled.
- Completion: reaches target when legal candidates exist; never stops short while legal candidates remain; partial (result C) only when genuinely exhausted, with a real blocker breakdown.
- Mandatory mobility: fixed never moves; movable moves only within its legal set and only when it helps; multi-term bundle never splits.
- Load: never exceeds an explicit user max without an explanation citing the structural cause; never trims a plan below its own target as a side effect of post-target cleanup.
- Result classification: each of the four result types (§8) is reachable and distinguishable by an automated check on the rendered message + apply affordance, not just on internal state.
- Cross-program: every invariant in §5 holds when run against a second, structurally different synthetic program — this is the regression gate that proves the engine, not just the TAU fixture, is correct.

## 14. Roadmap

This is a sequencing sketch, not a committed schedule. Regression-corpus framing: the current TAU catalog is the **first regression corpus**; each future real program catalog added is an **additional regression corpus**, not a replacement.

1. **Extract the requirements/catalog model.** Define the generic schema (§4, §10) and migrate the TAU fixture's existing data into it without changing planner behavior — a refactor, not a rewrite, verified by the existing test suite staying green throughout.
2. **Generalize the data-quality gate** into the single canonical function described in §9, replacing the current per-call-site checks.
3. **Generalize mandatory-mobility classification** per §10, replacing fixture-specific assumptions with the data-driven model (the underlying move logic already works — this is about making its inputs generic).
4. **Formalize the four result types** (§8) as an explicit, tested classifier shared by every message-construction path, replacing the current per-path logic.
5. **Build the second synthetic test program** and run the full reliability matrix (§13) against it — **proof of generic architecture** — before adding a second real program.
6. **Add a second real program catalog** (a different TAU degree, or a different catalog year) as the first genuine multi-program proof, and as the second regression corpus.
7. **Externalize UI strings and locale/direction handling** per §12, as a prerequisite for any non-Hebrew, non-TAU institution.
8. Only after 1–7: onboard a second institution, as **proof that the data-ingestion-adapter boundary (§7) is real**, not just a diagram.

## 15. Definition of Done

Two distinct definitions, deliberately kept separate:

### 15a. This document is done (a contract is approved)

- Every section above has been explicitly approved or edited by the product owner.
- It is checked into the repo (`docs/product-goal.md`) as the reference contract for future planner work.
- Every future planner change can be evaluated against §5 (invariants) and §8 (result types) as acceptance criteria, independent of which institution/program is being tested.

This document does **not** authorize any code change. Implementation against the roadmap (§14) begins only after explicit approval of this contract.

### 15b. The planner works (a runtime/product property — evaluated continuously, not just once)

The planner is considered working only when **all** of the following hold:

- Every planner run terminates in exactly one of the four result types in §8 — never an ambiguous or unclassified outcome.
- The Validation Engine (§7) is the final source of truth for every run, with or without AI involvement.
- All non-negotiable invariants (§5) hold across every planner code path, not just the primary one.
- No nameless/placeholder course can appear anywhere in user-facing planning (§5.1, §9).
- Unknown-trust data (§6) is never treated as verified, anywhere in the pipeline.
- Every summary/explanation matches the final validated draft, never a pre-validation or stale state (§5.5).
- Hard constraints (max load, hard-avoid, prerequisites, term legality) are never silently violated — every violation is either prevented or explicitly explained (§5.2, §5.4).
- Every partial (result C) plan includes concrete candidate-exhaustion reasons, not a generic "couldn't complete" message (§8, §13).
- At least two structurally different real program catalogs can be planned correctly without modifying the planner core — only their data differs.
- The full reliability test matrix (§13) passes, including the cross-program regression gate.
- Manual browser QA of the primary user journey (§2) passes on the current production build.
- A production deploy is never performed without a preceding preview deployment that has been manually verified and without all automated gates (the reliability matrix, plus any project-level lint/type/build checks) passing.
