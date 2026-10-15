import {
  findLastYearPromotionLowest,
  judge,
  matchPromotion,
  promotionYear,
  type PromotionLowest,
  type Size,
} from '@stockup/domain';
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
type Promotions = Awaited<ReturnType<typeof listPromotions>>;

export interface PriceReferences {
  productId: string;
  lowestUnitPrice: number;
  promotionLowests: PromotionLowest[];
  recentSizes: Size[];
}

const recentSizeCount = 5;

// Takes records newest first. A record counts towards the promotion it is tagged with, in the year of
// that promotion's occurrence, so one tagged by hand outside the range still compares.
function referencesOf(productId: string, records: Records, promotions: Promotions): PriceReferences {
  const promotionLowests = new Map<string, PromotionLowest>();
  const sizes = new Map<string, Size>();
  for (const r of records) {
    const promotion = r.promotion && promotions.find((p) => p.id === r.promotion!.id);
    if (promotion) {
      const year = promotionYear(r.date, promotion);
      const key = `${promotion.id}:${year}`;
      const lowest = promotionLowests.get(key);
      if (!lowest || r.unitPrice < lowest.lowestUnitPrice) {
        promotionLowests.set(key, { promotionId: promotion.id, year, lowestUnitPrice: r.unitPrice });
      }
    }
    const size = `${r.enteredSize.amount} ${r.enteredSize.unit.name}`;
    if (sizes.size < recentSizeCount && !sizes.has(size)) sizes.set(size, r.enteredSize);
  }
  return {
    productId,
    lowestUnitPrice: Math.min(...records.map((r) => r.unitPrice)),
    promotionLowests: [...promotionLowests.values()],
    recentSizes: [...sizes.values()],
  };
}

export async function listPriceReferences(db: Database, scope: CurrentMember) {
  const [records, promotions] = await Promise.all([listPriceRecords(db, scope), listPromotions(db, scope)]);
  const byProduct = new Map<string, Records>();
  for (const r of records) {
    const own = byProduct.get(r.productId);
    if (own) own.push(r);
    else byProduct.set(r.productId, [r]);
  }
  return [...byProduct].map(([productId, own]) => referencesOf(productId, own, promotions));
}

// Returns the product's records newest first, with the lowest unit prices a quote for it is judged against.
export async function describePriceHistory(db: Database, scope: CurrentMember, productId: string) {
  const [records, promotions] = await Promise.all([
    listPriceRecords(db, scope, { productIds: [productId] }),
    listPromotions(db, scope),
  ]);
  if (records.length === 0) return { records, lowestUnitPrice: null, promotionLowests: [] };
  const references = referencesOf(productId, records, promotions);
  return {
    records,
    lowestUnitPrice: references.lowestUnitPrice,
    promotionLowests: references.promotionLowests.map(({ promotionId, ...lowest }) => {
      const { id, name } = promotions.find((p) => p.id === promotionId)!;
      return { promotion: { id, name }, ...lowest };
    }),
  };
}

export async function judgePrice(db: Database, scope: CurrentMember, input: JudgmentInput) {
  const date = input.date ?? today();
  const [pricing, records, promotions] = await Promise.all([
    pricingOf(db, scope, input.productId),
    listPriceRecords(db, scope, { productIds: [input.productId] }),
    listPromotions(db, scope),
  ]);
  if (!pricing) throw new ProductNotFoundError();
  const { netPrice, unitPrice } = priceFor(pricing, input);

  const references = records.length ? referencesOf(input.productId, records, promotions) : null;
  const promotion = matchPromotion(date, promotions);
  const lastYearPromotionLowest =
    promotion && references ? findLastYearPromotionLowest(date, promotion, references.promotionLowests) : null;
  const lowest = references?.lowestUnitPrice ?? null;

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
