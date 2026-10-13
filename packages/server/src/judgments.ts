import { judge } from '@stockup/domain';
import type { Database } from './db';
import type { CurrentMember } from './members';
import { lowestUnitPrice, priceFor, pricingOf, ProductNotFoundError, type PricedInput } from './price-records';

export async function judgePrice(db: Database, scope: CurrentMember, input: PricedInput & { productId: string }) {
  const [pricing, lowest] = await Promise.all([
    pricingOf(db, scope, input.productId),
    lowestUnitPrice(db, scope, input.productId),
  ]);
  if (!pricing) throw new ProductNotFoundError();
  const { netPrice, unitPrice } = priceFor(pricing, input);
  // Filled in once Price Records carry their Promotion.
  const lastYearPromotionLowest = null;
  return {
    netPrice,
    unitPrice,
    stockLine: pricing.stockLine,
    lowestUnitPrice: lowest,
    lastYearPromotionLowest,
    ...judge({ unitPrice, stockLine: pricing.stockLine, lowestUnitPrice: lowest, lastYearPromotionLowest }),
  };
}
