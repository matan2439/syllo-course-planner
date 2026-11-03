# Student registration continuation

The user authorized continued development from the existing roadmap and automatic production publication once functional and visual verification pass. Preserve numbered plan slots, direct manual placement, server validation, owner isolation and current design tokens.

## Delivery

1. Timetable options: per-semester busy intervals, manually entered exams, conflict/gap notices and downloadable ICS for actual selected groups. Calendar start/end dates are explicit student inputs; source names remain unchanged. Never invent official term/exam dates. Keep controls in one collapsed options section. Shared schemas and pure export/conflict helpers receive invalid-date, overlap, timezone and escaping tests.
2. Course searches: save query and structured filters in the account's program workspace, with a compact control inside filters. No favorite ID snapshots or local account data. Save/load/rename/delete tests include owner/program transition and invalid filters.
3. Bidding rounds: preserve immutable snapshots of earlier rounds, prepare next round with a zero unconfirmed budget and rejected/pending targets reset for editing. Accepted/other-group outcomes stay in prior-round summary; no official registration is performed. Round limits and independent snapshots tested.
4. Integrate optional additive document fields through existing CAS persistence. Round history follows each numbered plan; saved searches belong to the program. Hydration and restore never overwrite a newer committed board. Test old-document compatibility and server round-trip of all new fields.
5. Run focused tests, root/web typechecks, production build and browser checks at desktop/mobile. Deploy production with domains held, inspect build readiness, promote to syllo.cc, verify API and a fresh isolated browser save/reload. Do not export secrets or change Paddle.

## Review focus

- Optional fields in old documents and distinct account/plan scope.
- Crossing or invalid time/date ranges; exams from inactive semesters.
- ICS injection/line folding, daylight saving, empty/missing meeting data.
- Interrupted plan switching and in-flight workspace saves.
- Earlier round snapshots never silently edited by new allocations.

Use the current TypeScript/React/Postgres stack and existing native session. Domain/UI tasks run independently; root owns shared document schema and integration. No design reapproval is needed because the user explicitly delegated these choices and deployment.
