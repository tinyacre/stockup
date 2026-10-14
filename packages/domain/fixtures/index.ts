import type { Judgment, JudgmentInput, Price, PriceInput, PromotionRange, Size, Unit } from '../src';
import allocation from './allocation.json';
import judgment from './judgment.json';
import price from './price.json';
import monthDay from './month-day.json';
import promotion from './promotion.json';
import promotionYear from './promotion-year.json';
import quantity from './quantity.json';
import search from './search.json';
import size from './size.json';
import units from './units.json';

// Each fixture expects either a value or the name of the error class the call throws.
type Outcome<T> = { expected: T } | { error: string };

export type UnitFixture = { name: string; amount: number; from: Unit; to: Unit } & Outcome<number>;
export type PriceFixture = { name: string; input: PriceInput } & Outcome<Price>;
export type JudgmentFixture = { name: string; input: JudgmentInput } & Outcome<Judgment>;
// Expects the name of the matched Promotion.
export type PromotionFixture = { name: string; date: string; promotions: PromotionRange[] } & Outcome<string | null>;
// Expects the year in which the occurrence of the Promotion the date belongs to started.
export type PromotionYearFixture = { name: string; date: string; promotion: PromotionRange } & Outcome<number>;
export type MonthDayFixture = { name: string; text: string; expected: boolean };
export type AllocationFixture = { name: string; total: number; listPrices: number[] } & Outcome<number[]>;
// Expects null for text that is not a valid Quantity.
export type QuantityFixture = { name: string; text: string; expected: number | null };
// Expects null for text that is not a valid Size.
export type SizeFixture = { name: string; text: string; expected: Size | null };
// Expects the matching names, best match first.
export type SearchFixture = { name: string; query: string; names: string[]; expected: string[] };

export const unitFixtures = units as UnitFixture[];
export const priceFixtures = price as PriceFixture[];
export const judgmentFixtures = judgment as JudgmentFixture[];
export const promotionFixtures = promotion as PromotionFixture[];
export const promotionYearFixtures = promotionYear as PromotionYearFixture[];
export const monthDayFixtures = monthDay as MonthDayFixture[];
export const allocationFixtures = allocation as AllocationFixture[];
export const quantityFixtures = quantity as QuantityFixture[];
export const searchFixtures = search as SearchFixture[];
export const sizeFixtures = size as SizeFixture[];
