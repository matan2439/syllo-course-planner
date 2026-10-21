import { LEGAL_VERSIONS, IMMEDIATE_SERVICE_CONSENT_VERSION } from '../../shared/billing/legal_versions';
import { LEGAL_POLICY } from './refund_policy';

/** Production checkout needs both an operator switch and reviewed legal artifacts. */
export function legalReadyForLiveSales(
  policy: { status: string; version: string } = LEGAL_POLICY,
  versions: Record<string, string> = LEGAL_VERSIONS,
  consentVersion: string | null = IMMEDIATE_SERVICE_CONSENT_VERSION,
): boolean {
  const reviewed = (version: string) => version.trim().length > 0 && !/draft/i.test(version);
  return policy.status === 'approved'
    && reviewed(policy.version)
    && policy.version !== 'legal-none'
    && Object.values(versions).length === 4
    && Object.values(versions).every(reviewed)
    && (consentVersion === null || reviewed(consentVersion));
}
