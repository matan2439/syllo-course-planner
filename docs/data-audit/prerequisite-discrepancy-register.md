# Prerequisite discrepancy register

Catalog year 2026; official sources probed 2026-11-18. Source: `data/prerequisites/discrepancy_register.json` (curated) + computed checks. **Nothing here is applied**; entries with *approval required* wait for the project owner.

| # | Courses | Issue | Status | Approval | Safe to enforce |
|---|---|---|---|---|---|
| D1 | 0542-3804, 0509-1820, 0542-1821 | ME mandatory Numerical Analysis requires an Electrical-Engineering Python course the official ME plan never schedules | official-conflict (unresolved) | **yes** | no |
| D2 | 0542-4010, 0542-4020, 0542-4092 | Spec places Y4 mandatory courses in 'either' semester while official notes/timetable fix semester 7 or 8 | official (program note + timetable agree) | **yes** | yes |
| D3 | 0542-2500, 0542-2600, 0542-3620… | Fluid Mechanics (1) window 'semester 4 or 5' vs verified prerequisite Thermodynamics (1) fixed at Y2/B | official (windows) + verified prerequisites; the resulting feasible set is derived by SYLLO | **yes** | yes |
| D4 | 0542-1830, 0581-1111, 0542-2400… | Retired prerequisite 0542-1830 (Intro to Materials Science) — inferred equivalence to 0581-1111 | inferred | **yes** | no |
| D5 | 0509-1510, 0542-1510 | Equivalence 0509-1510 = 0542-1510 is recorded as INFERRED although the official program page states the courses are identical | official (program page) — pending owner decision | **yes** | yes |
| D6 | 0555-2250, 0555-3240 | Physiological Systems (2) is required by 0555-3240 but not in any probed catalog | unresolved | no | no |
| D7 | 0512-4262, 0512-4263 | Image Processing (0512-4262) is the only prerequisite of Video Processing (0512-4263) but is not offered in 2026/27 | unresolved | no | no |
| D8 | 0509-1846, 0512-2507, 0512-2509… | Retired ids that appear only inside OR groups | verified (derived from the official expression structure) | no | yes |

## D1 — ME mandatory Numerical Analysis requires an Electrical-Engineering Python course the official ME plan never schedules

- **Courses:** 0542-3804, 0509-1820, 0542-1821
- **Official evidence:**
  - registrar_prerequisites_page · https://ims.tau.ac.il/tal/kr/Drishot_L.aspx?kurs=05423804&kv=01&sem=20262: 0542-1821 וגם 0509-1645 וגם 0509-1820 (all three joined by 'וגם' = AND)
  - program_page_spec · data/degrees/tau/mechanical_engineering/2027/spec.json: 0542-3804 is mandatory at Y2/B; 0509-1820 (תכנות - פייתון) is not part of the Mechanical Engineering official plan
- **Conflict / interpretation:** Verified AND-requirement vs the official default ME plan: a student who follows the official plan cannot satisfy 0509-1820. Parsing is correct (the registrar page literally lists AND), so this is an official-source inconsistency, not a parser error. Likely registrar data lag (0542-1821 is the ME programming course) but that is an interpretation.
- **Proposed resolution:** Keep as ADVISORY (do not block). Ask the Mechanical Engineering department / registrar whether 0509-1820 is still required or replaced by 0542-1821. Do not create an equivalence without a source.
- **Confidence:** official-conflict (unresolved)
- **Planning impact:** High: a mandatory Y2/B course; strict enforcement would invalidate every official ME plan.
- **Human approval required:** yes · **Safe for blocking enforcement:** no

## D2 — Spec places Y4 mandatory courses in 'either' semester while official notes/timetable fix semester 7 or 8

- **Courses:** 0542-4010, 0542-4020, 0542-4092
- **Official evidence:**
  - program_page_note · tau:8715:2026:rama:13:kurs:0542-4010:hearakurs:800dc8086d55: 0542-4010 taught in semester 7 only (Y4/A); timetable agrees
  - program_page_note · tau:8715:2026:rama:13:kurs:0542-4020:hearakurs:ed357c516aed: 0542-4020 taught in semester 8 only (Y4/B); timetable agrees
  - registrar_prerequisites_page: 0542-4020 requires 0542-4010 (verified in data/prerequisites/tau.json)
- **Conflict / interpretation:** spec.mandatory_courses uses semester 'either' for both. With 'either' the evaluator can place 0542-4020 in the same semester as 0542-4010 (blocked) or before it.
- **Proposed resolution:** Record the official semester windows (4010/4092 → A, 4020 → B; 0542-4092's note is cited in spec.source_conflicts) in course_rules as official constraints; already listed in spec.source_conflicts as 'Not applied'. Needs approval because it edits an official requirement record.
- **Confidence:** official (program note + timetable agree)
- **Planning impact:** Medium: removes the only intra-Y4 sequencing false positive on the default ME path.
- **Human approval required:** yes · **Safe for blocking enforcement:** yes

## D3 — Fluid Mechanics (1) window 'semester 4 or 5' vs verified prerequisite Thermodynamics (1) fixed at Y2/B

- **Courses:** 0542-2500, 0542-2600, 0542-3620, 0542-3792
- **Official evidence:**
  - program_page_note · tau:8715:2026:rama:10:kurs:0542-2500:hearakurs:ada3ac27701b: 0542-2500 listed under Y2/B and Y3/A: 'יש לקחת את הקורס בסמסטר 4 או 5'
  - program_page_note · tau:8715:2026:rama:9:kurs:0542-2600:hearakurs:27f39efc4dbf: 0542-2600 listed under Y2/A and Y2/B: 'יש לקחת את הקורס בסמסטר 3 או 4'
  - registrar_prerequisites_page: 0542-2500 requires 0542-2600 (AND); 0542-3620 and 0542-3792 require 0542-2500 (verified)
- **Conflict / interpretation:** The spec fixes 0542-2600 at Y2/B (semester 4) and 0542-2500 at Y3/A (semester 5). Official windows allow 2600 in semester 3, making 2500 in semester 4 feasible. With the spec's fixed placement, 2500 can only be semester 5 and its dependants 0542-3620/3792 cannot be Y3/A even though the spec lists them 'either' (Y3).
- **Proposed resolution:** Represent the official windows (2600: sem 3|4; 2500: sem 4|5) as window rules and let the planner choose the semester subject to the verified prerequisites; early_year_courses.json (2500 at Y2/B) and mandatory_2027.json (Y3/A) are each valid only under one choice of 2600. Needs approval.
- **Confidence:** official (windows) + verified prerequisites; the resulting feasible set is derived by SYLLO
- **Planning impact:** Medium: with fixed placements the default path is valid only if 3620/3792 sit in Y3/B; today they may be proposed in Y3/A and are flagged.
- **Human approval required:** yes · **Safe for blocking enforcement:** yes

## D4 — Retired prerequisite 0542-1830 (Intro to Materials Science) — inferred equivalence to 0581-1111

- **Courses:** 0542-1830, 0581-1111, 0542-2400, 0542-3780, 0542-4091
- **Official evidence:**
  - registrar_catalog_listing · https://ims.tau.ac.il/tal/kr/search_l.aspx?course_num=05421830&year=2026: No catalog record for 0542-1830 in 2021, 2022, 2023, 2025 or 2026 (probed)
  - registrar_catalog_listing · https://ims.tau.ac.il/tal/kr/search_l.aspx?course_num=05811111&year=2026: 0581-1111 מבוא למדע והנדסה של חומרים exists, semester B, in 2024, 2025 and 2026
  - registrar_prerequisites_page: 0542-2400, 0542-3780, 0542-4091 require 0542-1830 as an AND member; no registrar page lists 0581-1111 as an alternative
- **Conflict / interpretation:** The registrar still names a number it no longer lists. The mapping to 0581-1111 is SYLLO/owner inference (approved 2026-11-14), not a university statement.
- **Proposed resolution:** Leave status 'inferred', Mechanical-Engineering scope only. Ask the department to confirm; upgrade only on a source. Any use stays labelled inferred and is advisory-only.
- **Confidence:** inferred
- **Planning impact:** High: gates three mandatory/core ME courses; an unmapped retired id would block all of them.
- **Human approval required:** yes · **Safe for blocking enforcement:** no

## D5 — Equivalence 0509-1510 = 0542-1510 is recorded as INFERRED although the official program page states the courses are identical

- **Courses:** 0509-1510, 0542-1510
- **Official evidence:**
  - program_page_rule_text · https://tochniot.tau.ac.il/graphql: קורס זהה לקורס מספר 0509.1510 (record updated 08/06/2026)
  - registrar_catalog_listing: 0509-1510 listed through 2025/26, absent in 2026/27; 0542-1510 listed 2026/27 only (probed 2026-11-18)
- **Conflict / interpretation:** data/prerequisites/equivalences.json says 'The university does not state the equivalence' while spec course_rules equiv-0542-1510-0509-1510 quotes an official statement. Our two records contradict each other.
- **Proposed resolution:** Add a distinct status 'program_page_stated' (official, scoped to the program page that states it) and migrate this entry to it. NOT applied automatically: the owner decides whether the program-page statement suffices.
- **Confidence:** official (program page) — pending owner decision
- **Planning impact:** Medium: removes an 'inferred' label from 3 courses' prerequisite chains.
- **Human approval required:** yes · **Safe for blocking enforcement:** yes

## D6 — Physiological Systems (2) is required by 0555-3240 but not in any probed catalog

- **Courses:** 0555-2250, 0555-3240
- **Official evidence:**
  - registrar_catalog_listing · https://ims.tau.ac.il/tal/kr/search_l.aspx?course_num=05552250&year=2026: No record in 2021, 2022, 2023, 2025, 2026 (probed)
  - registrar_prerequisites_page: 0555-3240 requires 0555-4530 AND 0555-2250
- **Conflict / interpretation:** No successor can be identified from an official source. 0555-2106 has a similar name but no official link.
- **Proposed resolution:** Remain unresolved (satisfies nothing, blocks nothing); keep advisory and show the student the unresolved requirement. Candidate lead for the department: 0555-2106.
- **Confidence:** unresolved
- **Planning impact:** Low: a single elective outside the main ME/EE paths.
- **Human approval required:** no · **Safe for blocking enforcement:** no

## D7 — Image Processing (0512-4262) is the only prerequisite of Video Processing (0512-4263) but is not offered in 2026/27

- **Courses:** 0512-4262, 0512-4263
- **Official evidence:**
  - registrar_catalog_listing · https://ims.tau.ac.il/tal/kr/search_l.aspx?course_num=05124262&year=2025: Listed 2025/26 (semester A); not in 2026/27
- **Conflict / interpretation:** The requirement names a course that may be rotating rather than retired; no replacement identified.
- **Proposed resolution:** Remain unresolved/advisory; availability of 0512-4262 in future years should be checked each catalog refresh.
- **Confidence:** unresolved
- **Planning impact:** Low: one EE elective.
- **Human approval required:** no · **Safe for blocking enforcement:** no

## D8 — Retired ids that appear only inside OR groups

- **Courses:** 0509-1846, 0512-2507, 0512-2509, 0512-2526, 0512-2531
- **Official evidence:**
  - registrar_prerequisites_page: Each id is listed as one alternative ('או') beside a current course; see computed section for the sibling alternatives.
- **Conflict / interpretation:** None blocking: an unmatched alternative cannot invalidate an OR whose sibling is satisfiable. They appear in the 'not in catalog' counts but need no mapping.
- **Proposed resolution:** No equivalence needed. Exclude from 'blocking unresolved' metrics; keep recorded.
- **Confidence:** verified (derived from the official expression structure)
- **Planning impact:** None, provided the sibling alternative is plannable.
- **Human approval required:** no · **Safe for blocking enforcement:** yes

## Computed: which retired prerequisite ids actually block a course

A retired id *blocks* a course when the course's expression cannot hold without it (it is in an AND with no alternative). It is *harmless* when an OR sibling keeps the requirement satisfiable.

| Retired / missing id | Blocks (only-way requirement) | Harmless (OR sibling exists) | Approved equivalence |
|---|---|---|---|
| 0509-1510 | 0542-2400, 0542-3780, 0542-4425 | — | yes |
| 0509-1824 | 0509-2805, 0542-4422 | 0509-1645, 0509-1647, 0509-1745, 0509-1747, 0509-2844, 0512-3561 | yes |
| 0509-1843 | 0509-2805 | 0509-2801, 0509-2843, 0509-2844 | yes |
| 0509-1845 | 0512-1205 | 0509-2843, 0509-2846, 0512-2832, 0542-2200, 0542-2500 | yes |
| 0509-1846 | — | 0509-1645, 0509-1647, 0509-1745, 0509-1747 | no |
| 0512-2507 | — | 0512-4702 | no |
| 0512-2509 | — | 0512-3513 | no |
| 0512-2526 | — | 0512-4660, 0512-4800 | no |
| 0512-2531 | — | 0512-3513, 0512-3543 | no |
| 0512-3632 | 0510-6101, 0512-4602 | 0510-6202, 0512-4100, 0512-4161, 0512-4261 | yes |
| 0512-4262 | 0512-4263 | — | no |
| 0542-1830 | 0542-2400, 0542-3780, 0542-4091 | — | yes |
| 0555-2250 | 0555-3240 | — | no |
| 0671-1035 | — | 0671-1238 | no |

Blocking ids with no approved equivalence: 0512-4262, 0555-2250.
