import { isCatalogStale, type ProposalBaseRevision } from '../../../../shared/planner/model'
import type { BoardModel, GeneratedPlanModel } from '../../../../shared/planner/model'
import type { GenPhase, StaleReason } from '../types'

export interface StaleInputs {
  genPhase: GenPhase
  capturedRev: ProposalBaseRevision | null
  current: BoardModel | null
  capturedStatusVersion: number | null
  statusVersion: number
  capturedPreferenceVersion: number | null
  preferenceVersion: number
  proposal: GeneratedPlanModel | null
  convProfileVersion: number | undefined
  capturedManualRevision: number | null
  manualRevision: number
}

// WHY the proposal is stale, not merely THAT it is — the note must name the
// real cause. Browser acceptance (check 4B) found the profile-version case
// silently disabling Apply, and then found a single shared message wrongly
// blaming the catalog for a preference edit.
export function computeStaleReason({
  genPhase, capturedRev, current, capturedStatusVersion, statusVersion, capturedPreferenceVersion,
  preferenceVersion, proposal, convProfileVersion, capturedManualRevision, manualRevision,
}: StaleInputs): StaleReason | null {
  return (
    genPhase !== 'done'
      ? null
      : capturedRev != null && current != null && isCatalogStale(capturedRev, current.catalogRevision)
        ? 'catalog'
        // The academic status (completed courses / electives) changed since this
        // proposal was generated — it was planned from facts that no longer hold.
        : capturedStatusVersion != null && capturedStatusVersion !== statusVersion
          ? 'status'
          : capturedPreferenceVersion != null && capturedPreferenceVersion !== preferenceVersion
            ? 'preferences'
          // The typed preference profile advanced. `isProposalApplyable` already
          // REFUSED to apply in this case, but that guard is silent — it only
          // greys the button out. Surfacing it here can only make MORE proposals
          // stale, never fewer, so no guard is loosened.
          : proposal?.profileVersion != null && convProfileVersion != null &&
            proposal.profileVersion !== convProfileVersion
            ? 'preferences'
            : capturedManualRevision != null && capturedManualRevision !== manualRevision
              ? 'manual'
            : null
  )
}
