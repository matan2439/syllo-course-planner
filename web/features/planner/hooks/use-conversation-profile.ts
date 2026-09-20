import { useRef, useState } from 'react'
import { emptyProfile, type PreferenceProfile } from '../../../../api/ai/preference_model'

/**
 * The mounted preference conversation (flagged path only).
 *
 * The PreferenceConversation component owns the single authoritative typed
 * ConversationState; here we mirror only the current profile VERSION (a scalar,
 * not a second profile representation) for staleness comparison, and hold the
 * latest profile in a ref so an explicit Build sends the exact typed profile.
 */
export function useConversationProfile() {
  const [convProfileVersion, setConvProfileVersion] = useState<number | undefined>(undefined)
  const convProfileRef = useRef<PreferenceProfile>(emptyProfile())
  // Deliberately a fresh function each render (as it was inline), not memoised.
  const onProfileChange = (profile: PreferenceProfile) => {
    convProfileRef.current = profile
    setConvProfileVersion(profile.version)
  }
  return { convProfileVersion, convProfileRef, onProfileChange }
}
