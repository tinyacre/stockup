export type Verdict = 'recordLow' | 'stockUp' | 'skip' | 'noReference';

// All prices are Unit Prices in cents per Base Size, and always positive because a Net Price is.
export interface JudgmentInput {
  unitPrice: number;
  stockLine?: number | null;
  lowestUnitPrice?: number | null;
  lastYearPromotionLowest?: number | null;
}

export interface Judgment {
  // Null when there is no Stock Line and the Unit Price is not a record low: only the gap to the lowest applies.
  verdict: Verdict | null;
  // Percentage above (positive) or below (negative) the Stock Line.
  stockLineGap: number | null;
  // Cents above (positive) or below (negative) the reference Unit Price.
  lowestGap: number | null;
  lastYearPromotionGap: number | null;
}

export function judge({ unitPrice, stockLine, lowestUnitPrice, lastYearPromotionLowest }: JudgmentInput): Judgment {
  assertUnitPrice(unitPrice, 'Unit Price');
  if (stockLine != null) assertUnitPrice(stockLine, 'Stock Line');
  if (lowestUnitPrice != null) assertUnitPrice(lowestUnitPrice, 'Lowest Unit Price');
  if (lastYearPromotionLowest != null) assertUnitPrice(lastYearPromotionLowest, 'last-year Promotion lowest');

  return {
    verdict: verdictOf(unitPrice, stockLine ?? null, lowestUnitPrice ?? null),
    stockLineGap: stockLine == null ? null : ((unitPrice - stockLine) / stockLine) * 100,
    lowestGap: lowestUnitPrice == null ? null : unitPrice - lowestUnitPrice,
    lastYearPromotionGap: lastYearPromotionLowest == null ? null : unitPrice - lastYearPromotionLowest,
  };
}

function verdictOf(unitPrice: number, stockLine: number | null, lowestUnitPrice: number | null): Verdict | null {
  if (stockLine === null && lowestUnitPrice === null) return 'noReference';
  if (lowestUnitPrice !== null && unitPrice < lowestUnitPrice) return 'recordLow';
  if (stockLine === null) return null;
  return unitPrice <= stockLine ? 'stockUp' : 'skip';
}

function assertUnitPrice(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be a positive number, got ${value}`);
}
