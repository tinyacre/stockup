import {
  calculatePrice,
  IncompatibleUnitsError,
  localDate,
  matchPromotion,
  parseQuantity,
  promotionYear,
  volumeUnits,
  weightUnits,
  type Price,
  type Unit,
  type Verdict,
} from '@stockup/domain';
import type { PriceRecord, PriceRecordInput, Product, Promotion } from '@/lib/api';
import { formatSize, formatYuan } from '@/lib/format';

export function formatUnitPrice(unitPrice: number, product: Product) {
  return `${formatYuan(unitPrice)} / ${formatSize(product.baseSize, product.pricingUnit)}`;
}

export function parseYuan(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

export function today() {
  return localDate(new Date());
}

export function unitsLike(unit: Unit): Unit[] {
  if (unit.dimension === 'weight') return weightUnits.map((name) => ({ dimension: 'weight', name }));
  if (unit.dimension === 'volume') return volumeUnits.map((name) => ({ dimension: 'volume', name }));
  return [unit];
}

export const verdictLabels: Record<Verdict, string> = {
  recordLow: '史低',
  stockUp: '囤',
  skip: '不囤',
  noReference: '暂无参考',
};

export function lowestOf(records: PriceRecord[]) {
  return records.length ? Math.min(...records.map((r) => r.unitPrice)) : null;
}

// Mirrors the server's judgment: records count by their tag, in the occurrence a year before the date's.
export function lastYearPromotionLowest(date: string, promotion: Promotion, records: PriceRecord[]) {
  const lastYear = promotionYear(date, promotion) - 1;
  return lowestOf(
    records.filter((r) => r.promotion?.id === promotion.id && promotionYear(r.date, promotion) === lastYear),
  );
}

export function matchDate(date: string, promotions: Promotion[]) {
  try {
    return matchPromotion(date, promotions);
  } catch (error) {
    // A date input mid-edit holds no valid date yet.
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export const recordErrors = {
  channel_not_found: '渠道已不存在',
  promotion_not_found: '大促已不存在',
  incompatible_unit: '规格单位与计价单位量纲不同',
  invalid_price: '优惠合计需小于原价',
};

export interface DiscountDraft {
  key: number;
  amount: string;
  name: string;
}

let nextDiscountKey = 0;

export function discountDraft(amount = '', name = ''): DiscountDraft {
  return { key: nextDiscountKey++, amount, name };
}

export interface PriceDraft {
  listPrice: string;
  discounts: DiscountDraft[];
  quantity: string;
  sizeAmount: string;
  sizeUnitName: string;
}

export type PricedInput = Pick<PriceRecordInput, 'listPrice' | 'discounts' | 'quantity' | 'size'>;

// Reads the drafts into an input, or explains the first field that does not parse.
export function readPriceDraft(product: Product, draft: PriceDraft): { input: PricedInput } | { error: string } {
  const listPrice = parseYuan(draft.listPrice);
  if (listPrice === null || listPrice === 0) return { error: '原价需大于 0，最多两位小数' };
  const discounts = [];
  for (const d of draft.discounts) {
    if (!d.amount.trim() && !d.name.trim()) continue;
    const amount = parseYuan(d.amount);
    if (amount === null || amount === 0) return { error: '优惠金额需大于 0，最多两位小数' };
    discounts.push(d.name.trim() ? { amount, name: d.name.trim() } : { amount });
  }
  const quantity = parseQuantity(draft.quantity);
  if (quantity === null) return { error: '件数需为正整数' };
  const sizeAmount = Number(draft.sizeAmount);
  if (!draft.sizeAmount.trim() || !(sizeAmount > 0)) return { error: '规格需大于 0' };
  const unit = unitsLike(product.pricingUnit).find((u) => u.name === draft.sizeUnitName) ?? product.pricingUnit;
  return { input: { listPrice, discounts, quantity, size: { amount: sizeAmount, unit } } };
}

// Returns a message when the input parses but cannot be priced.
export function preview(product: Product, input: PricedInput): Price | string {
  try {
    return calculatePrice({ ...input, pricingUnit: product.pricingUnit, baseSize: product.baseSize });
  } catch (error) {
    if (error instanceof IncompatibleUnitsError) return recordErrors.incompatible_unit;
    return recordErrors.invalid_price;
  }
}

// A product of a quantity like "3 × 6" is worth echoing back; a plain "18" is not.
export function multipliedQuantity(text: string) {
  const quantity = parseQuantity(text);
  return quantity !== null && /[×✕xX*＊]/.test(text) ? quantity : null;
}
