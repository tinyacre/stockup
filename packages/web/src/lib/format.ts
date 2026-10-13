import type { Unit } from '@stockup/domain';

// Converted sizes such as 11.9 磅 in kg carry long fractions that are noise on screen.
export function formatSize(amount: number, unit: Unit) {
  return `${Number(amount.toFixed(3))} ${unit.name}`;
}

export function formatYuan(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}
