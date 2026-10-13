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

// Takes a calendar date "YYYY-MM-DD" and returns the matching Promotion with the shortest range, or null.
export function matchPromotion<T extends PromotionRange>(date: string, promotions: readonly T[]): T | null {
  const match = /^(\d{4})-(\d{2}-\d{2})$/.exec(date);
  if (!match || !isCalendarDate(Number(match[1]), match[2]!)) throw new RangeError(`Invalid date ${date}`);
  const day = ordinal(match[2]!);

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

function ordinal(monthDay: string): number {
  if (!/^\d{2}-\d{2}$/.test(monthDay) || !isCalendarDate(REFERENCE_YEAR, monthDay)) {
    throw new RangeError(`Invalid month-day ${monthDay}`);
  }
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
