# Legacy `tests/ui` audit (pre-deletion)

Scope: the 78 files in `tests/ui/`. 65 load `app/web/semester_board_viewer.html` and
exercise its client-side "shadow planner"; 13 do not. Deleting the HTML deletes the
65, so each needs a verdict: **covered** (server/web test already asserts the rule),
**UI-only** (DOM of the retired page, no rule to keep) or **GAP** (rule lives only in
the HTML and has no server equivalent).

Confidence: verdicts marked *probed* were checked against server source and
`tests/api` by keyword (see "Evidence"). The rest are classified by topic from file
names and titles and still need a per-file read before deletion.

## Keep (13, no HTML dependency) - move to `web/`
`board_adapter`, `chip_status_adapter`, `course_details_adapter`,
`repository_adapter`, `requirements_adapter`, `programs_adapter` (drop its HTML
drift guard), `shader_background_gating`, `shader_background_viewport_safety`,
`web_next_wiring` (rewrite: assert Next is root, no legacy route).

## GAP - rule exists only in the HTML (port to the server planner or drop deliberately)
| Legacy test | Rule | Server evidence (probed) |
|---|---|---|
| `plan_grade_safety_gate` | courses with grade-risk >= 0.9 are never used as plain hours filler | DECIDED: ported as a SOFT penalty, not a hard gate (23 of 42 graded courses are >= 0.9, a hard gate would leave plans short of 185 h). `planner_goals.ts` `comfortCost`/`gradeRisk` feed the difficulty_comfort tiebreak; test in `planner_goals.test.ts` |
| `plan_overshoot_minimization` | soft-match courses must not all be added past the hours gap | COVERED: `pickBestCandidateForGap`; regression test `tests/api/gap_fill_overshoot.test.ts` |
| ~~`plan_nameless_course_data_quality`~~ | RETRACTED - covered: `course_profile.ts` `toProfile` excludes any course without an authoritative name (`hasAuthoritativeName`), tested in `course_profile.test.ts`/`planner_actions.test.ts` | keyword probe missed it |
| `plan_no_exam_unknown_data_label` | DECIDED: deliberately dropped (unreachable in native UI). Original rule: under "prefer no final exam", unknown-exam courses are labelled "missing data", never a clean match | server has a `finalExam` feature (`course_features.ts`) but no preference; the native UI has no way to set it (0 matches in `web/`) |
| `plan_completed_source_workload_thermal` (F5, F9, F8) | high-risk course loses to easier equal-relevance one; missing-field audit surfaced in summary | `thermal` exists server-side; grade-risk tie-break absent |

## Covered by server/web suites (topic match, confirm on read)
| Legacy tests | Server/web owner |
|---|---|
| `plan_offering_*`, `plan_partial_*`, dual-semester rules | `generate_plan_offering_legality`, `generate_plan_dual_semester_*`, `offering_provenance_*` |
| `plan_annual_course_bundle` | `generate_plan_annual_course_placement`, `planner_actions_annual_course` |
| `plan_degree_progress_truth`, `plan_degree_completion_solver_goal`, `plan_draft_status_and_185`, `plan_full185_*`, `auto_fill_degree_hours` | `academic_progress`, `completion_analysis`, `generate_plan_degree_hours_shortfall_gate`, `generate_plan_structural_degree_gap_warning` |
| `plan_course_identity_prereq`, `plan_fem_discoverability_prereq`, `plan_stale_disallowed_block_resolution` | `generate_plan_prerequisite_timing_gate`, `generate_plan_currently_taking_prereq`, `generate_plan_disallowed_placed_gate` |
| `planner_hard_exclusions`, `plan_panel_hard_avoid_wiring`, `plan_existing_hard_avoid_warning`, `plan_explicit_avoid_picker_gap`, `plan_avoid_picker_generic`, `plan_eligibility_exclusion` | `hard_constraints`, `generate_plan_hard_constraints`, `grounded_preference_eligibility` (probed: 19 server tests) |
| `plan_repair_workload_balance`, `plan_load_balance_consistency`, `plan_preview_overload`, `plan_overload_block_chat`, `plan_movable_mandatory_and_overload` | `planner_load_distribution_policy`, `generate_plan_load_distribution_policy`, `generate_plan_max_weekly_hours_warning` |
| `plan_ai_schedule_gate`, `catalog_reliability_audit`, `plan_legality_and_data_audit`, `course_data_overrides_and_legality`, `final_plan_validator`, `plan_reliability_matrix`, `plan_quality_student_logic` | `plan_validation`, `generate_plan_catalog_integrity`, `catalog_integrity_fields`, `generate_plan_real_student_scenario_matrix` |
| `plan_interest_evaluation_ui`, `plan_user_intent_profile`, `planner_user_intent_focus`, `plan_conversational_fallback`, `plan_chat_*`, `plan_command_execution` | `generate_plan_interest_evaluation`, `planning_intent`, `conversational_agent`, `conversation_endpoint` |
| `plan_agent_decision_ui`, `plan_agent_clarification_form`, `plan_blocked_clarification` | `academic_clarification*`, web `AcademicAgentConversation` tests |
| `plan_mass_removal_repro`, `plan_seven_issues`, `planner_e2e_recovers_from_bad_ai_proposal`, `plan_e2e_message_path` | `authoritative_candidate_validation`, `apply_plan_endpoint`, `server_apply_authority` |

## UI-only (retired DOM, nothing to port)
`plan_visible_draft`, `plan_draft_actions`, `plan_draft_summary_consistency`,
`plan_concise_summary`, `plan_summary_warnings_propagation`,
`plan_conflict_message_visible`, `plan_sidebar_blocked_compact`,
`plan_trace_debug_panel`, `plan_debugger_explain_mode`, `planner_shell_actions`,
`planner_legacy_embed`, `semester_board_ai_chat`, `semester_board_mycourses`,
`course_details_panel`, `plan_context_baseline_and_card`,
`plan_progress_sync_grade_risk`, `plan_panel_prefs_grade_assessment`,
`plan_structural_gap_decision_text`, `plan_chat_correction_draftpatch`.
Web component tests already cover the native equivalents
(`CompletedCoursesPanel`, `CourseAiChat`, `NativePlannerDraft`, `AgentOutcomeDetails`).

## Evidence (keyword probe, src = api+shared, tests = tests/api)
nameless keyword 0/0 (but handled as name-missing exclusion in `toProfile`); grade-risk 0/0; prefer_no_exam 0/0; workload trim 0/0;
hard-avoid/exclusion 11/19; filler 5/13; thermal 3/3; overshoot 1/2.

## Data check (2027 mechanical board)
23 of the 42 courses with a known TAU grade have grade-risk >= 0.9 (avg <= 63). A hard filler gate would remove over half the graded electives from hours filling.
