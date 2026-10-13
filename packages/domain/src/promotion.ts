// A Promotion recurs every year over month-day bounds ("MM-DD"); an end before the start wraps across the new year.
export interface PromotionRange {
  name: string;
  startsOn: string;
  endsOn: string;
}

const DAY = 86_400_000;
// Ordinals are counted in a leap year so that "02-29" is a valid bound.
const REFERENCE_YEAR = 2000;
const DAYS_IN_REFERENCE_YEAR = 366;

export function isMonthDay(text: string): boolean {
  return /^\d{2}-\d{2}$/.test(text) && isCalendarDate(REFERENCE_YEAR, text);
}

// Takes a calendar date "YYYY-MM-DD" and returns the matching Promotion with the shortest range, or null.
export function matchPromotion<T extends PromotionRange>(date: string, promotions: readonly T[]): T | null {
  const day = ordinal(parseDate(date).monthDay);

  let best: { promotion: T; length: number } | null = null;
  for (const promotion of promotions) {
    const start = ordinal(promotion.startsOn);
    const end = ordinal(promotion.endsOn);
    const wraps = end < start;
    const contains = wraps ? day >= start || day <= end : day >= start && day <= end;
    if (!contains) continue;
    const length = (wraps ? end + DAYS_IN_REFERENCE_YEAR : end) - start + 1;
    if (!best || length < best.length) best = { promotion, length };
  }
  return best?.promotion ?? null;
}

// Returns the year in which the occurrence of the Promotion that the date belongs to started, so the
// January days of a range across the new year count towards the previous year. A date outside the range,
// as on a record tagged by hand, counts towards its own year unless it falls before the end of a wrapping range.
export function promotionYear(date: string, promotion: PromotionRange): number {
  const { year, monthDay } = parseDate(date);
  const end = ordinal(promotion.endsOn);
  const wraps = end < ordinal(promotion.startsOn);
  return wraps && ordinal(monthDay) <= end ? year - 1 : year;
}

// The lowest Unit Price among the records tagged with a Promotion in one of its occurrences.
export interface PromotionLowest {
  promotionId: string;
  // The year that occurrence started, as promotionYear gives it.
  year: number;
  lowestUnitPrice: number;
}

// Takes the Promotion the date falls in and returns the lowest of its occurrence a year before, or null.
export function findLastYearPromotionLowest(
  date: string,
  promotion: PromotionRange & { id: string },
  lowests: readonly PromotionLowest[],
): number | null {
  const lastYear = promotionYear(date, promotion) - 1;
  return lowests.find((l) => l.promotionId === promotion.id && l.year === lastYear)?.lowestUnitPrice ?? null;
}

function parseDate(date: string) {
  const match = /^(\d{4})-(\d{2}-\d{2})$/.exec(date);
  if (!match || !isCalendarDate(Number(match[1]), match[2]!)) throw new RangeError(`Invalid date ${date}`);
  return { year: Number(match[1]), monthDay: match[2]! };
}

function ordinal(monthDay: string): number {
  if (!isMonthDay(monthDay)) throw new RangeError(`Invalid month-day ${monthDay}`);
  const [month, day] = monthDay.split('-').map(Number) as [number, number];
  return (Date.UTC(REFERENCE_YEAR, month - 1, day) - Date.UTC(REFERENCE_YEAR, 0, 1)) / DAY;
}

function isCalendarDate(year: number, monthDay: string): boolean {
  const [month, day] = monthDay.split('-').map(Number) as [number, number];
  const date = new Date(0);
  // setUTCFullYear keeps years below 100 as written, where Date.UTC would map them to 19xx.
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
