import type { CategoryGroup, Placement } from './api';

// Names the products a group holds outside its categories, wherever they are listed.
export const outsideCategories = '未分品类';

type Placed = { categoryGroupId: string; categoryId: string | null };

export function placementOf(product: Placed): Placement {
  return product.categoryId === null ? { categoryGroupId: product.categoryGroupId } : { categoryId: product.categoryId };
}

// One string per placement, for a <select> value or a history entry.
export function placementKey(placement: Placement) {
  return placement.categoryId === undefined ? `group:${placement.categoryGroupId}` : `category:${placement.categoryId}`;
}

export function parsePlacementKey(key: string): Placement | undefined {
  const separator = key.indexOf(':');
  const id = key.slice(separator + 1);
  if (key.startsWith('group:')) return { categoryGroupId: id };
  if (key.startsWith('category:')) return { categoryId: id };
  return undefined;
}

export function placementLabel(groups: CategoryGroup[], product: Placed) {
  const group = groups.find((g) => g.id === product.categoryGroupId);
  if (!group) return '';
  const category = group.categories.find((c) => c.id === product.categoryId);
  return category ? `${group.name} / ${category.name}` : group.name;
}
