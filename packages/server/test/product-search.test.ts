import { describe, expect, test } from 'bun:test';
import { jsonRequest, signUpHousehold, useTestApp, type SignedInMember } from './support/harness';

const ctx = useTestApp();

interface Product {
  id: string;
  name: string;
  archived: boolean;
}

async function created<T>(res: Response): Promise<T> {
  expect(res.status).toBe(201);
  return (await res.json()) as T;
}

// Creates the named products in one category of a fresh category group.
async function seedProducts(m: SignedInMember, names: string[]) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const group = await created<{ id: string }>(
    await m.request('/api/category-groups', jsonRequest('POST', { name: `生活用品 ${suffix}` })),
  );
  const category = await created<{ id: string }>(
    await m.request('/api/categories', jsonRequest('POST', { categoryGroupId: group.id, name: `纸品 ${suffix}` })),
  );
  const products: Product[] = [];
  for (const name of names) {
    products.push(
      await created<Product>(
        await m.request(
          '/api/products',
          jsonRequest('POST', {
            categoryId: category.id,
            name,
            pricingUnit: { dimension: 'count', name: '抽' },
            baseSize: 90,
          }),
        ),
      ),
    );
  }
  return products;
}

async function search(m: SignedInMember, q: string, extra = '') {
  const res = await m.request(`/api/products/search?q=${encodeURIComponent(q)}${extra}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as Product[]).map((p) => p.name);
}

const tissues = ['得宝抽纸 M 码', '清风抽纸', '维达卷纸', '豆腐猫砂'];

describe('product search', () => {
  test('matches Chinese text, best match first', async () => {
    const m = await signUpHousehold(ctx);
    await seedProducts(m, tissues);
    expect(await search(m, '抽纸')).toEqual(['清风抽纸', '得宝抽纸 M 码']);
  });

  test('matches pinyin initials and full pinyin', async () => {
    const m = await signUpHousehold(ctx);
    await seedProducts(m, tissues);
    expect(await search(m, 'dbcz')).toEqual(['得宝抽纸 M 码']);
    expect(await search(m, 'maosha')).toEqual(['豆腐猫砂']);
  });

  test('matches a typo or part of a name', async () => {
    const m = await signUpHousehold(ctx);
    await seedProducts(m, tissues);
    expect(await search(m, '德宝抽纸')).toEqual(['得宝抽纸 M 码']);
    expect(await search(m, '得宝油纸')).toEqual(['得宝抽纸 M 码']);
    expect(await search(m, '得宝 m 码')).toEqual(['得宝抽纸 M 码']);
    expect(await search(m, '卷')).toEqual(['维达卷纸']);
  });

  test('returns the products themselves', async () => {
    const m = await signUpHousehold(ctx);
    const [product] = await seedProducts(m, ['得宝抽纸 M 码']);
    const res = await m.request('/api/products/search?q=dbcz');
    expect(await res.json()).toEqual([product]);
  });

  test('leaves archived products out unless asked to include them', async () => {
    const m = await signUpHousehold(ctx);
    const [old] = await seedProducts(m, ['得宝抽纸 旧款包装', '得宝抽纸 M 码']);
    const archived = await m.request(`/api/products/${old!.id}`, jsonRequest('PATCH', { archived: true }));
    expect(archived.status).toBe(200);
    expect(((await archived.json()) as Product).archived).toBe(true);

    expect(await search(m, '得宝')).toEqual(['得宝抽纸 M 码']);
    expect(await search(m, '得宝', '&includeArchived=true')).toEqual(['得宝抽纸 M 码', '得宝抽纸 旧款包装']);

    await m.request(`/api/products/${old!.id}`, jsonRequest('PATCH', { archived: false }));
    expect(await search(m, '得宝')).toEqual(['得宝抽纸 M 码', '得宝抽纸 旧款包装']);
  });

  test("only finds the member's own household's products", async () => {
    const m = await signUpHousehold(ctx);
    const other = await signUpHousehold(ctx);
    await seedProducts(other, ['得宝抽纸 M 码']);
    await seedProducts(m, ['清风抽纸']);
    expect(await search(m, '抽纸')).toEqual(['清风抽纸']);
    expect(await search(m, 'dbcz', '&includeArchived=true')).toEqual([]);
  });

  test('a blank query is rejected', async () => {
    const m = await signUpHousehold(ctx);
    expect((await m.request('/api/products/search?q=%20%20')).status).toBe(400);
    expect((await m.request('/api/products/search')).status).toBe(400);
  });

  test('requires signing in', async () => {
    expect((await ctx.app.request('/api/products/search?q=dbcz')).status).toBe(401);
  });
});
