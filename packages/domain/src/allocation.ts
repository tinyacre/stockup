import { assertCents } from './price';

// Splits an order-level Discount across items in proportion to their List Prices, all in cents.
// The shares always add up to the total. The rounding remainder goes to the item with the largest List Price,
// spilling over to the next largest once a share would leave its item free, since a Net Price stays positive.
export function allocateDiscount(total: number, listPrices: readonly number[]): number[] {
  assertCents(total, 'Discount');
  for (const listPrice of listPrices) {
    assertCents(listPrice, 'List Price');
    if (listPrice === 0) throw new RangeError('List Price must be positive');
  }
  const orderTotal = listPrices.reduce((sum, p) => sum + p, 0);
  if (total > orderTotal - listPrices.length) {
    throw new RangeError(`Discount ${total} leaves an item of the ${orderTotal} order free`);
  }
  if (total === 0) return listPrices.map(() => 0);

  const shares = listPrices.map((p) => Math.floor((total * p) / orderTotal));
  let remainder = total - shares.reduce((sum, s) => sum + s, 0);
  const byListPrice = listPrices.map((_, i) => i).sort((a, b) => listPrices[b]! - listPrices[a]!);
  for (const i of byListPrice) {
    const extra = Math.min(remainder, listPrices[i]! - 1 - shares[i]!);
    shares[i]! += extra;
    remainder -= extra;
  }
  return shares;
}
