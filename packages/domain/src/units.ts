export type Dimension = 'weight' | 'volume' | 'count';

export type WeightUnitName = 'g' | 'kg' | '斤' | '磅';
export type VolumeUnitName = 'ml' | 'L';

// A count unit's name is chosen per product ("抽", "片", "颗"), and only identical names are interchangeable.
export type Unit =
  | { dimension: 'weight'; name: WeightUnitName }
  | { dimension: 'volume'; name: VolumeUnitName }
  | { dimension: 'count'; name: string };

const gramsPer: Record<WeightUnitName, number> = { g: 1, kg: 1000, 斤: 500, 磅: 453.59237 };
const millilitresPer: Record<VolumeUnitName, number> = { ml: 1, L: 1000 };

export const weightUnits = Object.keys(gramsPer) as WeightUnitName[];
export const volumeUnits = Object.keys(millilitresPer) as VolumeUnitName[];

export class IncompatibleUnitsError extends Error {
  override name = 'IncompatibleUnitsError';

  constructor(
    readonly from: Unit,
    readonly to: Unit,
  ) {
    super(`Cannot convert ${from.name} (${from.dimension}) to ${to.name} (${to.dimension})`);
  }
}

export function isConvertible(from: Unit, to: Unit): boolean {
  if (from.dimension !== to.dimension) return false;
  return from.dimension !== 'count' || from.name === to.name;
}

export function convert(amount: number, from: Unit, to: Unit): number {
  if (!isConvertible(from, to)) throw new IncompatibleUnitsError(from, to);
  return (amount * baseFactor(from)) / baseFactor(to);
}

// Units often arrive as untyped data from storage or requests, so their names are checked here.
function baseFactor(unit: Unit): number {
  if (unit.dimension === 'count') return 1;
  const table: Record<string, number> =
    unit.dimension === 'weight' ? gramsPer : unit.dimension === 'volume' ? millilitresPer : {};
  const factor = Object.hasOwn(table, unit.name) ? table[unit.name] : undefined;
  if (factor === undefined) throw new RangeError(`Unknown unit ${unit.name} (${unit.dimension})`);
  return factor;
}

const reservedNames = new Set([...weightUnits, ...volumeUnits].map((name) => name.toLowerCase()));

// A count unit cannot borrow a weight or volume name in any letter case, so "kg" always means the same quantity.
export function isUnit(unit: { dimension: string; name: string }): unit is Unit {
  switch (unit.dimension) {
    case 'weight':
      return Object.hasOwn(gramsPer, unit.name);
    case 'volume':
      return Object.hasOwn(millilitresPer, unit.name);
    case 'count':
      return (
        unit.name.length > 0 &&
        unit.name.trim() === unit.name &&
        !reservedNames.has(unit.name.toLowerCase())
      );
    default:
      return false;
  }
}
