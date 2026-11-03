/**
 * ERA / UEDCL average tariffs per kWh in whole UGX, by customer type.
 * Review these when ERA publishes a new tariff schedule.
 */
export const CUSTOMER_CATEGORIES = ["residential", "commercial_small", "commercial_medium", "industrial"] as const;
export type CustomerCategory = (typeof CUSTOMER_CATEGORIES)[number];

export const TARIFF_UGX_PER_KWH: Record<CustomerCategory, number> = {
  residential: 779.4, // domestic standard rate (Tier 1 / above 150 kWh)
  commercial_small: 562.1, // commercial average
  commercial_medium: 423.9, // medium service sector average
  industrial: 363.8 // medium industrial (manufacturing) average
};

/** Category rate in minor units, or null when the company does not bill in UGX. */
export function categoryRateMinor(category: CustomerCategory | undefined, currency: string, exponent: number): number | null {
  if (!category || currency !== "UGX") return null;
  return Math.round(TARIFF_UGX_PER_KWH[category] * 10 ** exponent);
}
