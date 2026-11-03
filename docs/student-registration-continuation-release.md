# Registration tools continuation — 2026-10-30

The user authorized continued roadmap implementation and automatic deployment once functional and visual checks pass. This release preserves the numbered plan switcher and current design tokens.

## Delivered

- Saved course searches: query/filters in the owner/program document, save/load/rename/delete inside filters; no snapshot of private favorite IDs. Account/program switch resets the repository scope.
- Bidding round snapshots, manual correction from an independent copy, and next-round preparation. Old entries remain immutable; rejected/pending choices start at zero, accepted/other-group/canceled choices stay in prior results; a new personal budget and rule confirmation are required. No official registration is submitted.
- Timetable options: personal busy intervals scoped per semester; fixed selected meetings remain visible with a conflict warning; new selections and best-group search respect unavailability. Entered exam dates have same-day/short-gap notices.
- Calendar ICS export from actual selected groups in an explicit teaching range, plus entered exams even after that range. UTC occurrences preserve Jerusalem wall time through DST; invalid dates, missing times and nonexistent local clock times fail clearly. Text escaping, deterministic IDs and UTF-8 line folding follow RFC 5545. Holidays are explicitly not excluded automatically; this is a file export, not a subscription.
- Optional JSON fields retain old-document compatibility. Bidding archives, availability and exams follow each saved alternative; searches belong to the program. Existing CAS and server restore validation remain authoritative. No database migration, provider change or Paddle change is needed.

## Verification

Focused results before publication: 21 workspace API tests; 46 workspace/owner integration tests; 42 search/filter tests and 32 bidding tests reported by implementing agents; final combined 7 web suites / 47 tests and 3 API suites / 16 tests all passed. The two schedule-option UI tests passed again after a browser-discovered date-input fix. Root and web typechecks passed. Production build/deployment result is recorded below when complete.

Browser: local addition of an unavailable interval and exact exam date persisted through refresh; saved search appeared in the selector; next-round history appeared. Downloaded ICS contained 121 events, including the manually entered February exam outside the teaching period, and no physical content line exceeded 75 UTF-8 octets. Mobile 390px check found no horizontal page overflow; viewport override was reset.

Standard checked: https://www.rfc-editor.org/rfc/rfc5545 . Deployment inputs exclude temporary files and secrets. New production checks will use a separate guest browser state where possible and never alter university registration.

## Production result

Production Next.js build and root/web typechecks passed. Deployment `dpl_DozEt8mto4CMJZQfsG3PCbHGYtdH` (`syllo-course-planner-1w8bkwowq-matanyaron-1633s-projects.vercel.app`) reached READY and was promoted on 2026-10-30. Alias lookup confirmed syllo.cc serves that deployment.

A fresh isolated guest API smoke wrote and re-read saved searches, a round archive, busy times, a manual exam and the explicit calendar range successfully. Live browser opened the new timetable options and recorded zero error logs. Screenshot evidence: `.tmp/registration-tools-live.jpg`. No university registration or external calendar account was changed. No Git commit/push was performed; the deployment used the local authorized workspace source.
