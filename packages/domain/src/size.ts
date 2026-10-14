import type { Size } from './price';
import { isUnit, type Unit } from './units';

// Spellings seen on Chinese order and product pages, keyed in lower case.
const aliases: Record<string, Unit> = {
  g: { dimension: 'weight', name: 'g' },
  克: { dimension: 'weight', name: 'g' },
  kg: { dimension: 'weight', name: 'kg' },
  千克: { dimension: 'weight', name: 'kg' },
  公斤: { dimension: 'weight', name: 'kg' },
  斤: { dimension: 'weight', name: '斤' },
  磅: { dimension: 'weight', name: '磅' },
  lb: { dimension: 'weight', name: '磅' },
  lbs: { dimension: 'weight', name: '磅' },
  ml: { dimension: 'volume', name: 'ml' },
  毫升: { dimension: 'volume', name: 'ml' },
  l: { dimension: 'volume', name: 'L' },
  升: { dimension: 'volume', name: 'L' },
  公升: { dimension: 'volume', name: 'L' },
};

// Han measures StockUp has no unit for; read as count units they would compare with the wrong dimension.
const unsupportedMeasures = new Set(['毫克', '两', '钱', '盎司', '厘升', '分升', '加仑', '品脱']);

// Reads a Size written as an amount and a unit, such as "100抽" or "5.4 kg"; any other Han word names a count unit,
// while an unknown Latin word is left unread rather than guessed at.
export function parseSize(text: string): Size | null {
  const match = /^(\d+(?:\.\d+)?)\s*(\p{Script=Han}+|[a-z]+)$/iu.exec(text.normalize('NFKC').trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!(amount > 0)) return null;
  const word = match[2]!;
  if (unsupportedMeasures.has(word.toLowerCase())) return null;
  const alias = Object.hasOwn(aliases, word.toLowerCase()) ? aliases[word.toLowerCase()] : undefined;
  const unit = alias ?? (/\p{Script=Han}/u.test(word) ? { dimension: 'count', name: word } : null);
  return unit && isUnit(unit) ? { amount, unit } : null;
}
