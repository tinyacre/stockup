import { judge, matchPromotion, promotionYear } from '@stockup/domain';
import type { Database } from './db';
import type { CurrentMember } from './members';
import { listPriceRecords, priceFor, pricingOf, ProductNotFoundError, type PricedInput } from './price-records';
import { listPromotions } from './promotions';

export interface JudgmentInput extends PricedInput {
  productId: string;
  date?: string;
}

function today() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

type Records = Awaited<ReturnType<typeof listPriceRecords>>;

function lowestOf(records: Records) {
  return records.length ? Math.min(...records.map((r) => r.unitPrice)) : null;
}

export async function judgePrice(db: Database, scope: CurrentMember, input: JudgmentInput) {
  const date = input.date ?? today();
  const [pricing, records, promotions] = await Promise.all([
    pricingOf(db, scope, input.productId),
    listPriceRecords(db, scope, { productId: input.productId }),
    listPromotions(db, scope),
  ]);
  if (!pricing) throw new ProductNotFoundError();
  const { netPrice, unitPrice } = priceFor(pricing, input);

  const promotion = matchPromotion(date, promotions);
  // A record counts by the tag it carries, so one tagged by hand outside the range still compares.
  const lastYear = promotion && promotionYear(date, promotion) - 1;
  const lastYearPromotionLowest = promotion
    ? lowestOf(records.filter((r) => r.promotion?.id === promotion.id && promotionYear(r.date, promotion) === lastYear))
    : null;
  const lowest = lowestOf(records);

  return {
    netPrice,
    unitPrice,
    stockLine: pricing.stockLine,
    lowestUnitPrice: lowest,
    promotion: promotion && { id: promotion.id, name: promotion.name },
    lastYearPromotionLowest,
    ...judge({ unitPrice, stockLine: pricing.stockLine, lowestUnitPrice: lowest, lastYearPromotionLowest }),
  };
}
