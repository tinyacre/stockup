import { convert, type Unit } from './units';

// Money is always an integer number of cents (分). A Unit Price stays fractional until it is displayed.

export interface Discount {
  amount: number;
  name?: string;
}

export interface Size {
  amount: number;
  unit: Unit;
}

export interface PriceInput {
  listPrice: number;
  discounts: Discount[];
  quantity: number;
  size: Size;
  pricingUnit: Unit;
  // Expressed in the Pricing Unit.
  baseSize: number;
}

export interface Price {
  netPrice: number;
  unitPrice: number;
}

export function calculatePrice(input: PriceInput): Price {
  assertCents(input.listPrice, 'List Price');
  for (const discount of input.discounts) assertCents(discount.amount, 'Discount');
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new RangeError(`Quantity must be a positive integer, got ${input.quantity}`);
  }
  assertPositive(input.size.amount, 'Size');
  assertPositive(input.baseSize, 'Base Size');

  const netPrice = input.listPrice - input.discounts.reduce((sum, d) => sum + d.amount, 0);
  // A free item is not a price observation, and a zero Unit Price would pin the Lowest Unit Price for good.
  if (netPrice <= 0) throw new RangeError(`Discounts must leave a positive Net Price, got ${netPrice}`);

  const size = convert(input.size.amount, input.size.unit, input.pricingUnit);
  return { netPrice, unitPrice: (netPrice * input.baseSize) / (input.quantity * size) };
}

export function assertCents(amount: number, label: string) {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`${label} must be a non-negative whole number of cents, got ${amount}`);
  }
}

function assertPositive(amount: number, label: string) {
  if (!Number.isFinite(amount) || amount <= 0) throw new RangeError(`${label} must be positive, got ${amount}`);
}
