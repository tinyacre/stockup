import { describe, expect, test } from 'bun:test';
import { jsonRequest, signUpHousehold, useTestApp, type SignedInMember } from './support/harness';

const ctx = useTestApp();

interface CategoryGroup {
  id: string;
  name: string;
  categories: { id: string; name: string; productCount: number }[];
}

interface Product {
  id: string;
  name: string;
  categoryId: string;
  pricingUnit: { dimension: string; name: string };
  baseSize: number;
  stockLine: number | null;
  note: string;
  archived: boolean;
}

function unique(label: string) {
  return `${label} ${crypto.randomUUID().slice(0, 8)}`;
}

async function created<T>(res: Response): Promise<T> {
  expect(res.status).toBe(201);
  return (await res.json()) as T;
}

function createGroup(m: SignedInMember, name = unique('宠物')) {
  return m.request('/api/category-groups', jsonRequest('POST', { name }));
}

function createCategory(m: SignedInMember, categoryGroupId: string, name = unique('猫砂')) {
  return m.request('/api/categories', jsonRequest('POST', { categoryGroupId, name }));
}

function createProduct(m: SignedInMember, categoryId: string, overrides: Record<string, unknown> = {}) {
  return m.request(
    '/api/products',
    jsonRequest('POST', {
      categoryId,
      name: unique('得宝抽纸 M 码'),
      pricingUnit: { dimension: 'count', name: '抽' },
      baseSize: 90,
      ...overrides,
    }),
  );
}

async function catalogOf(m: SignedInMember) {
  const res = await m.request('/api/category-groups');
  expect(res.status).toBe(200);
  return (await res.json()) as CategoryGroup[];
}

// A household with one category group, one category in it and one product in that.
async function seed(m: SignedInMember) {
  const group = await created<{ id: string; name: string }>(await createGroup(m));
  const category = await created<{ id: string; name: string; categoryGroupId: string }>(
    await createCategory(m, group.id),
  );
  const product = await created<Product>(await createProduct(m, category.id));
  return { group, category, product };
}

describe('category groups', () => {
  test('are created, renamed and listed', async () => {
    const m = await signUpHousehold(ctx);
    const group = await created<{ id: string; name: string }>(await createGroup(m, '宠物'));
    expect(group.name).toBe('宠物');

    const renamed = await m.request(`/api/category-groups/${group.id}`, jsonRequest('PATCH', { name: '宠物用品' }));
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual({ id: group.id, name: '宠物用品' });

    expect(await catalogOf(m)).toEqual([{ id: group.id, name: '宠物用品', categories: [] }]);
  });

  test('names are trimmed and must be unique within the household', async () => {
    const m = await signUpHousehold(ctx);
    const group = await created<{ name: string }>(await createGroup(m, '  生活用品 '));
    expect(group.name).toBe('生活用品');

    const duplicate = await createGroup(m, '生活用品');
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: 'name_taken' });

    const other = await signUpHousehold(ctx);
    expect((await createGroup(other, '生活用品')).status).toBe(201);
  });

  test('a blank name is rejected', async () => {
    const m = await signUpHousehold(ctx);
    expect((await createGroup(m, '   ')).status).toBe(400);
  });

  test('an empty group is deleted', async () => {
    const m = await signUpHousehold(ctx);
    const group = await created<{ id: string }>(await createGroup(m));
    expect((await m.request(`/api/category-groups/${group.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await catalogOf(m)).toEqual([]);
  });

  test('a group that still has categories is kept', async () => {
    const m = await signUpHousehold(ctx);
    const { group } = await seed(m);
    const res = await m.request(`/api/category-groups/${group.id}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_empty' });
    expect((await catalogOf(m)).map((g) => g.id)).toEqual([group.id]);
  });
});

describe('categories', () => {
  test('are created under a group and listed with their product counts', async () => {
    const m = await signUpHousehold(ctx);
    const { group, category } = await seed(m);
    const empty = await created<{ id: string; name: string; categoryGroupId: string }>(
      await createCategory(m, group.id, '猫粮'),
    );
    expect(empty).toEqual({ id: empty.id, name: '猫粮', categoryGroupId: group.id });

    const [listed] = await catalogOf(m);
    expect(listed!.categories).toEqual(
      expect.arrayContaining([
        { id: category.id, name: category.name, productCount: 1 },
        { id: empty.id, name: '猫粮', productCount: 0 },
      ]),
    );
  });

  test('are renamed and moved to another group', async () => {
    const m = await signUpHousehold(ctx);
    const { category } = await seed(m);
    const target = await created<{ id: string }>(await createGroup(m));

    const res = await m.request(
      `/api/categories/${category.id}`,
      jsonRequest('PATCH', { name: '豆腐猫砂', categoryGroupId: target.id }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: category.id, name: '豆腐猫砂', categoryGroupId: target.id });

    const moved = (await catalogOf(m)).find((g) => g.id === target.id);
    expect(moved!.categories.map((c) => c.name)).toEqual(['豆腐猫砂']);
  });

  test('names must be unique within the household', async () => {
    const m = await signUpHousehold(ctx);
    const { category } = await seed(m);
    const otherGroup = await created<{ id: string }>(await createGroup(m));
    const res = await createCategory(m, otherGroup.id, category.name);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'name_taken' });
  });

  test('need an existing group', async () => {
    const m = await signUpHousehold(ctx);
    const res = await createCategory(m, crypto.randomUUID());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'category_group_not_found' });
  });

  test('an empty category is deleted', async () => {
    const m = await signUpHousehold(ctx);
    const group = await created<{ id: string }>(await createGroup(m));
    const category = await created<{ id: string }>(await createCategory(m, group.id));
    expect((await m.request(`/api/categories/${category.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await catalogOf(m))[0]!.categories).toEqual([]);
  });

  test('a category that still has products is kept', async () => {
    const m = await signUpHousehold(ctx);
    const { category } = await seed(m);
    const res = await m.request(`/api/categories/${category.id}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_empty' });
  });
});

describe('products', () => {
  test('are created with a pricing unit, base size and note', async () => {
    const m = await signUpHousehold(ctx);
    const { category } = await seed(m);
    const product = await created<Product>(
      await createProduct(m, category.id, {
        name: '渴望猫粮',
        pricingUnit: { dimension: 'weight', name: '磅' },
        baseSize: 25,
        note: '六种鱼和原味都算',
      }),
    );
    expect(product).toEqual({
      id: product.id,
      name: '渴望猫粮',
      categoryId: category.id,
      pricingUnit: { dimension: 'weight', name: '磅' },
      baseSize: 25,
      stockLine: null,
      note: '六种鱼和原味都算',
      archived: false,
    });

    const res = await m.request(`/api/products/${product.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...product, lowestUnitPrice: null });
  });

  test('default to an empty note', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    expect(product.note).toBe('');
  });

  test('accept every weight and volume unit and any named count unit', async () => {
    const m = await signUpHousehold(ctx);
    const { category } = await seed(m);
    const units = [
      ...['g', 'kg', '斤', '磅'].map((name) => ({ dimension: 'weight', name })),
      ...['ml', 'L'].map((name) => ({ dimension: 'volume', name })),
      ...['片', '卷', '颗', '袋'].map((name) => ({ dimension: 'count', name })),
    ];
    for (const pricingUnit of units) {
      const product = await created<Product>(await createProduct(m, category.id, { pricingUnit }));
      expect(product.pricingUnit).toEqual(pricingUnit);
    }
  });

  test('reject an invalid pricing unit', async () => {
    const m = await signUpHousehold(ctx);
    const { category } = await seed(m);
    for (const pricingUnit of [
      { dimension: 'weight', name: 'ml' },
      { dimension: 'volume', name: '斤' },
      { dimension: 'count', name: '' },
      { dimension: 'count', name: 'kg' },
      { dimension: 'count', name: 'KG' },
      { dimension: 'count', name: '抽'.repeat(11) },
      { dimension: 'length', name: 'm' },
    ]) {
      expect((await createProduct(m, category.id, { pricingUnit })).status).toBe(400);
    }
  });

  test('reject a base size that is not positive', async () => {
    const m = await signUpHousehold(ctx);
    const { category } = await seed(m);
    for (const baseSize of [0, -1]) {
      expect((await createProduct(m, category.id, { baseSize })).status).toBe(400);
    }
  });

  test('need an existing category', async () => {
    const m = await signUpHousehold(ctx);
    const res = await createProduct(m, crypto.randomUUID());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'category_not_found' });
  });

  test('are listed by category', async () => {
    const m = await signUpHousehold(ctx);
    const { group, category, product } = await seed(m);
    const other = await created<{ id: string }>(await createCategory(m, group.id));
    await created<Product>(await createProduct(m, other.id));

    const res = await m.request(`/api/products?categoryId=${category.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ ...product, lowestUnitPrice: null, latestPrice: null }]);
  });

  test('are listed with their stock line, lowest and latest unit prices', async () => {
    const m = await signUpHousehold(ctx);
    const { category, product } = await seed(m);
    const plain = await created<Product>(await createProduct(m, category.id, { name: '维达抽纸' }));
    const channel = await created<{ id: string }>(
      await m.request('/api/channels', jsonRequest('POST', { name: unique('京东') })),
    );
    await m.request(`/api/products/${product.id}`, jsonRequest('PATCH', { stockLine: 5000 }));
    // One piece of the 90-sheet base size, so the unit price equals the list price.
    for (const [date, listPrice, purchased] of [
      ['2026-06-18', 9000, true],
      ['2026-01-01', 4500, true],
      ['2026-10-01', 6000, false],
    ] as const) {
      const res = await m.request(
        '/api/price-records',
        jsonRequest('POST', {
          productId: product.id,
          channelId: channel.id,
          date,
          purchased,
          listPrice,
          discounts: [],
          quantity: 1,
          size: { amount: 90, unit: { dimension: 'count', name: '抽' } },
        }),
      );
      expect(res.status).toBe(201);
    }

    const res = await m.request(`/api/products?categoryId=${category.id}`);
    expect(await res.json()).toEqual([
      { ...product, stockLine: 5000, lowestUnitPrice: 4500, latestPrice: { date: '2026-10-01', unitPrice: 6000, verdict: 'skip' } },
      { ...plain, lowestUnitPrice: null, latestPrice: null },
    ]);
  });

  test("judge their latest price against the stock line and the product's other records", async () => {
    const m = await signUpHousehold(ctx);
    const { category } = await seed(m);
    const channel = await created<{ id: string }>(
      await m.request('/api/channels', jsonRequest('POST', { name: unique('京东') })),
    );
    async function latestVerdict(stockLine: number | null, listPrices: [string, number][]) {
      const product = await created<Product>(await createProduct(m, category.id, { name: unique('抽纸') }));
      if (stockLine !== null) await m.request(`/api/products/${product.id}`, jsonRequest('PATCH', { stockLine }));
      for (const [date, listPrice] of listPrices) {
        const res = await m.request(
          '/api/price-records',
          jsonRequest('POST', {
            productId: product.id,
            channelId: channel.id,
            date,
            purchased: true,
            listPrice,
            discounts: [],
            quantity: 1,
            size: { amount: 90, unit: { dimension: 'count', name: '抽' } },
          }),
        );
        expect(res.status).toBe(201);
      }
      const listed = (await (await m.request(`/api/products?categoryId=${category.id}`)).json()) as {
        id: string;
        latestPrice: { verdict: string | null } | null;
      }[];
      return listed.find((p) => p.id === product.id)!.latestPrice!.verdict;
    }

    expect(await latestVerdict(5000, [['2026-01-01', 4500], ['2026-10-01', 4000]])).toBe('recordLow');
    expect(await latestVerdict(5000, [['2026-01-01', 4500], ['2026-10-01', 4500]])).toBe('stockUp');
    expect(await latestVerdict(null, [['2026-10-01', 4500]])).toBe('noReference');
    expect(await latestVerdict(null, [['2026-01-01', 4500], ['2026-10-01', 4800]])).toBeNull();
    expect(await latestVerdict(3500, [['2026-10-01', 4000], ['2026-01-01', 3000]])).toBe('skip');
  });

  test('are renamed, moved to another category and given a note', async () => {
    const m = await signUpHousehold(ctx);
    const { group, product } = await seed(m);
    const target = await created<{ id: string }>(await createCategory(m, group.id));

    const res = await m.request(
      `/api/products/${product.id}`,
      jsonRequest('PATCH', { name: '维达抽纸', categoryId: target.id, note: '超韧和棉韧都算' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...product, name: '维达抽纸', categoryId: target.id, note: '超韧和棉韧都算' });
  });

  test('cannot be moved to a missing category', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    const res = await m.request(`/api/products/${product.id}`, jsonRequest('PATCH', { categoryId: crypto.randomUUID() }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'category_not_found' });
  });

  test('are deleted', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    expect((await m.request(`/api/products/${product.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await m.request(`/api/products/${product.id}`)).status).toBe(404);
  });
});

describe('household isolation', () => {
  test("another household's catalog is invisible", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const { category, product } = await seed(bob);

    expect(await catalogOf(alice)).toEqual([]);
    expect((await alice.request(`/api/products/${product.id}`)).status).toBe(404);
    const listed = await alice.request(`/api/products?categoryId=${category.id}`);
    expect(await listed.json()).toEqual([]);
  });

  test("another household's catalog cannot be changed", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const { group, category, product } = await seed(bob);
    const emptyGroup = await created<{ id: string }>(await createGroup(bob));

    const attempts = [
      alice.request(`/api/category-groups/${group.id}`, jsonRequest('PATCH', { name: 'hijacked' })),
      alice.request(`/api/category-groups/${emptyGroup.id}`, { method: 'DELETE' }),
      alice.request(`/api/categories/${category.id}`, jsonRequest('PATCH', { name: 'hijacked' })),
      alice.request(`/api/products/${product.id}`, jsonRequest('PATCH', { name: 'hijacked' })),
      alice.request(`/api/products/${product.id}`, jsonRequest('PATCH', { stockLine: 1 })),
      alice.request(`/api/products/${product.id}`, { method: 'DELETE' }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);

    const bobsCatalog = await catalogOf(bob);
    expect(bobsCatalog.find((g) => g.id === group.id)!.name).toBe(group.name);
    expect(bobsCatalog.some((g) => g.id === emptyGroup.id)).toBe(true);
    expect(await (await bob.request(`/api/products/${product.id}`)).json()).toEqual({ ...product, lowestUnitPrice: null });
  });

  test("another household's groups and categories cannot be built on", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const { group, category } = await seed(bob);
    const mine = await seed(alice);

    expect((await createCategory(alice, group.id)).status).toBe(422);
    expect((await createProduct(alice, category.id)).status).toBe(422);
    const move = await alice.request(
      `/api/categories/${mine.category.id}`,
      jsonRequest('PATCH', { categoryGroupId: group.id }),
    );
    expect(move.status).toBe(422);
    const moveProduct = await alice.request(
      `/api/products/${mine.product.id}`,
      jsonRequest('PATCH', { categoryId: category.id }),
    );
    expect(moveProduct.status).toBe(422);
  });

  test('the catalog requires a signed-in member', async () => {
    expect((await ctx.app.request('/api/category-groups')).status).toBe(401);
    expect((await ctx.app.request('/api/products', jsonRequest('POST', {}))).status).toBe(401);
  });
});
