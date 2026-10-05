// Offer economics and approval route (plan §8).

import { MIN_OFFER_HOLDOUT_PCT } from './holdout';

export const OFFER_MECHANICS = {
  activation_bonus: 'Activation bonus — bonus grams on first order after eKYC',
  spread_window: 'Spread or fee window',
  recurring_bonus: 'Recurring plan bonus — grams after N uninterrupted months',
  referral: 'Referral reward — grams to both sides after first funded order',
  threshold_bonus: 'Threshold bonus — grams when cumulative purchases cross a level',
  storage_delivery_waiver: 'Storage or delivery waiver',
  loyalty_tier: 'Loyalty tier benefits',
  partner_bundle: 'Partner bundle (Thndr, MoneyFellows, …)',
} as const;
export type OfferMechanic = keyof typeof OFFER_MECHANICS;

export interface OfferEconomicsInput {
  costPerRedemption: number;
  expectedRedemption: number; // 0..1
  eligibleCount: number;
  holdoutPct: number;
}

export function offerEconomics(o: OfferEconomicsInput) {
  const treated = Math.round(o.eligibleCount * (1 - o.holdoutPct / 100));
  const worstCaseCost = o.costPerRedemption * treated;
  const expectedCost = worstCaseCost * o.expectedRedemption;
  return { treated, worstCaseCost, expectedCost };
}

export interface ApprovalRoute {
  tier: 'under_100k' | '100k_500k' | 'above_500k' | 'pricing';
  requiredRoles: string[];
  complianceLevel: 'wording' | 'full' | 'full_legal' | 'full_treasury';
  leadTimeWorkingDays: number;
}

/** Plan §8.3 approval route. */
export function approvalRoute(worstCaseCost: number, isNewMechanic: boolean, touchesPricing: boolean): ApprovalRoute {
  if (touchesPricing) {
    return { tier: 'pricing', requiredRoles: ['ceo', 'cfo', 'compliance', 'treasury'], complianceLevel: 'full_treasury', leadTimeWorkingDays: 10 };
  }
  if (worstCaseCost > 500_000 || isNewMechanic) {
    return { tier: 'above_500k', requiredRoles: ['ceo', 'compliance', 'legal'], complianceLevel: 'full_legal', leadTimeWorkingDays: 10 };
  }
  if (worstCaseCost >= 100_000) {
    return { tier: '100k_500k', requiredRoles: ['head_of_marketing', 'cfo', 'compliance'], complianceLevel: 'full', leadTimeWorkingDays: 5 };
  }
  return { tier: 'under_100k', requiredRoles: ['head_of_marketing', 'compliance'], complianceLevel: 'wording', leadTimeWorkingDays: 3 };
}

export interface OfferReadinessInput {
  holdoutPct: number;
  eligibility?: string | null;
  endDate?: Date | null;
  startDate?: Date | null;
  termsUrlEn?: string | null;
  termsUrlAr?: string | null;
  helpCentreUrl?: string | null;
  hypothesis?: string | null;
  metalDenominated: boolean;
  hedgeReference?: string | null;
  approvedRoles: string[];
  requiredRoles: string[];
}

/** Plan §8.2 — every rule an offer must satisfy before a single message references it. */
export function offerReadiness(o: OfferReadinessInput): string[] {
  const problems: string[] = [];
  if (!o.hypothesis) problems.push('Written hypothesis is required (segment, behaviour, expected change)');
  if (o.holdoutPct < MIN_OFFER_HOLDOUT_PCT) problems.push(`Holdout must be at least ${MIN_OFFER_HOLDOUT_PCT}%`);
  if (!o.eligibility) problems.push('Eligibility rule is required');
  if (!o.startDate || !o.endDate) problems.push('Start and expiry dates are required');
  if (o.startDate && o.endDate && o.endDate <= o.startDate) problems.push('Expiry must be after start');
  if (!o.termsUrlEn || !o.termsUrlAr) problems.push('Published terms in Arabic and English are required');
  if (!o.helpCentreUrl) problems.push('Help-centre entry is required before the first message');
  if (o.metalDenominated && !o.hedgeReference) problems.push('Metal-denominated incentives must be hedged (hedge reference) at go-live');
  const missing = o.requiredRoles.filter((r) => !o.approvedRoles.includes(r));
  if (missing.length) problems.push(`Missing approvals: ${missing.join(', ')}`);
  return problems;
}
