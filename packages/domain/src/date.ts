// The calendar day the date falls on in the local time zone, as YYYY-MM-DD; toISOString would give the UTC day.
export function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
