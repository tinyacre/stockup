import { setSystemTime } from 'bun:test';

export const minutes = (n: number) => n * 60_000;

// Stops the clock at the current time, so the waits a test checks come out exact.
// Requires the test file to call setSystemTime() in afterEach, which lets the clock run again.
export function freezeClock() {
  const start = new Date();
  setSystemTime(start);
  return start;
}

export function advance(start: Date, ms: number) {
  setSystemTime(new Date(start.getTime() + ms));
}
