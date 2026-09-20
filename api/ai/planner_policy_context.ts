import type { DistributionPolicy } from './planner_types';

const INTERNAL_DISTRIBUTION_POLICY = '__planner_distribution_policy';

export function preferencesWithPlannerPolicy(
  preferences: unknown,
  distributionPolicy: DistributionPolicy | undefined,
): unknown {
  const source = preferences && typeof preferences === 'object'
    ? preferences as Record<string, unknown>
    : {};
  return {
    ...source,
    ...(distributionPolicy ? { [INTERNAL_DISTRIBUTION_POLICY]: distributionPolicy } : {}),
  };
}

export function storedDistributionPolicy(preferences: unknown): DistributionPolicy | undefined {
  const value = preferences && typeof preferences === 'object'
    ? (preferences as Record<string, unknown>)[INTERNAL_DISTRIBUTION_POLICY]
    : undefined;
  return value === 'balanced' || value === 'compact' ? value : undefined;
}
