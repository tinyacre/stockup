import type { Unit } from '@stockup/domain';

// Converted sizes such as 11.9 磅 in kg carry long fractions that are noise on screen.
export function formatSize(amount: number, unit: Unit) {
  return `${Number(amount.toFixed(3))} ${unit.name}`;
}

export function formatYuan(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

// A Stock Line Gap is a percentage of the Stock Line, positive when the price is above it.
export function formatStockLineGap(gap: number) {
  if (gap === 0) return '与入手价持平';
  const percent = Number(Math.abs(gap).toFixed(1));
  return `比入手价${gap < 0 ? '便宜' : '贵'}${percent === 0 ? '不到 0.1' : ` ${percent}`}%`;
}
