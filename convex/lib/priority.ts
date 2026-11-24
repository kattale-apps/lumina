/**
 * Lumina products take top priority: when a Lumina part fits, recommendations use it before
 * another brand. Matched on the brand or the supplier name.
 */
const PRIORITY = /lumina/i;

export function isPriorityProduct(product: { brand?: string; supplier?: string }) {
  return PRIORITY.test(product.brand ?? "") || PRIORITY.test(product.supplier ?? "");
}
