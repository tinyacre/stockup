import { describe, expect, test } from 'bun:test';
import { jsonRequest, signUpHousehold, useTestApp, type SignedInMember } from './support/harness';

const ctx = useTestApp();

interface Unit {
  dimension: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  categoryId: string;
  pricingUnit: Unit;
  baseSize: number;
  stockLine: number | null;
  note: string;
  archived: boolean;
}

interface PriceRecord {
  id: string;
  productId: string;
  size: { amount: number; unit: Unit };
  enteredSize: { amount: number; unit: Unit };
  netPrice: number;
  unitPrice: number;
}

const tissue = { dimension: 'count', name: '抽' };
const grams = { dimension: 'weight', name: 'g' };
const kilograms = { dimension: 'weight', name: 'kg' };
const pounds = { dimension: 'weight', name: '磅' };
const litres = { dimension: 'volume', name: 'L' };

function unique(label: string) {
  return `${label} ${crypto.randomUUID().slice(0, 8)}`;
}

async function created<T>(res: Response): Promise<T> {
  expect(res.status).toBe(201);
  return (await res.json()) as T;
}

async function ok<T>(res: Response): Promise<T> {
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

async function createCategory(m: SignedInMember) {
  const group = await created<{ id: string }>(
    await m.request('/api/category-groups', jsonRequest('POST', { name: unique('宠物') })),
  );
  return created<{ id: string }>(
    await m.request('/api/categories', jsonRequest('POST', { name: unique('猫粮'), categoryGroupId: group.id })),
  );
}

async function createProduct(m: SignedInMember, categoryId: string, pricingUnit: Unit, baseSize: number) {
  return created<Product>(
    await m.request(
      '/api/products',
      jsonRequest('POST', { categoryId, name: unique('渴望猫粮'), pricingUnit, baseSize }),
    ),
  );
}

async function createChannel(m: SignedInMember) {
  return created<{ id: string }>(await m.request('/api/channels', jsonRequest('POST', { name: unique('京东') })));
}

function recordPrice(m: SignedInMember, productId: string, channelId: string, size: { amount: number; unit: Unit }) {
  return m.request(
    '/api/price-records',
    jsonRequest('POST', {
      productId,
      channelId,
      date: '2026-06-18',
      purchased: true,
      listPrice: 59900,
      discounts: [{ amount: 10000 }],
      quantity: 2,
      size,
      note: '',
    }),
  );
}

function updateProduct(m: SignedInMember, id: string, changes: object) {
  return m.request(`/api/products/${id}`, jsonRequest('PATCH', changes));
}

function mergeInto(m: SignedInMember, keptId: string, mergedId: string) {
  return m.request(`/api/products/${keptId}/merge`, jsonRequest('POST', { productId: mergedId }));
}

async function recordsOf(m: SignedInMember, productId: string) {
  return ok<PriceRecord[]>(await m.request(`/api/price-records?productId=${productId}`));
}

async function productNames(m: SignedInMember, query = '') {
  const products = await ok<Product[]>(await m.request(`/api/products${query}`));
  return products.map((p) => p.name);
}

// A household with a cat food priced per 500 g that has two price records, one entered in pounds.
async function seed(m: SignedInMember) {
  const category = await createCategory(m);
  const channel = await createChannel(m);
  const product = await createProduct(m, category.id, grams, 500);
  await created(await recordPrice(m, product.id, channel.id, { amount: 2000, unit: grams }));
  await created(await recordPrice(m, product.id, channel.id, { amount: 11.9, unit: pounds }));
  return { category, channel, product, records: await recordsOf(m, product.id) };
}

describe('changing the base size', () => {
  test('re-expresses every unit price and keeps the records as they are', async () => {
    const m = await signUpHousehold(ctx);
    const { product, records } = await seed(m);

    const updated = await ok<Product>(await updateProduct(m, product.id, { baseSize: 1000 }));
    expect(updated.baseSize).toBe(1000);

    const after = await recordsOf(m, product.id);
    expect(after.map((r) => r.unitPrice)).toEqual(records.map((r) => r.unitPrice * 2));
    expect(after.map(({ unitPrice, ...rest }) => rest)).toEqual(records.map(({ unitPrice, ...rest }) => rest));

    const detail = await ok<{ lowestUnitPrice: number }>(await m.request(`/api/products/${product.id}`));
    expect(detail.lowestUnitPrice).toBe(Math.min(...after.map((r) => r.unitPrice)));
  });

  test('keeps the stock line at the same price per pricing unit', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    await ok(await updateProduct(m, product.id, { stockLine: 1500 }));

    const updated = await ok<Product>(await updateProduct(m, product.id, { baseSize: 1000 }));
    expect(updated.stockLine).toBe(3000);
  });

  test('takes a stock line given alongside it as it is', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    await ok(await updateProduct(m, product.id, { stockLine: 1500 }));

    const updated = await ok<Product>(await updateProduct(m, product.id, { baseSize: 1000, stockLine: 2800 }));
    expect(updated).toMatchObject({ baseSize: 1000, stockLine: 2800 });
  });

  test('must be positive', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    for (const baseSize of [0, -1]) expect((await updateProduct(m, product.id, { baseSize })).status).toBe(400);
  });
});

describe('changing the pricing unit', () => {
  test('converts every size within the dimension and keeps the unit prices', async () => {
    const m = await signUpHousehold(ctx);
    const { product, records } = await seed(m);

    const updated = await ok<Product>(await updateProduct(m, product.id, { pricingUnit: kilograms }));
    expect(updated).toMatchObject({ pricingUnit: kilograms, baseSize: 0.5 });

    const after = await recordsOf(m, product.id);
    after.forEach((r, i) => {
      expect(r.size.unit).toEqual(kilograms);
      expect(r.size.amount).toBeCloseTo(records[i]!.size.amount / 1000, 9);
    });
    expect(after.map((r) => r.enteredSize)).toEqual(records.map((r) => r.enteredSize));
    after.forEach((r, i) => expect(r.unitPrice).toBeCloseTo(records[i]!.unitPrice, 6));
  });

  test('takes a base size given alongside it in the new unit', async () => {
    const m = await signUpHousehold(ctx);
    const { product, records } = await seed(m);

    const updated = await ok<Product>(await updateProduct(m, product.id, { pricingUnit: kilograms, baseSize: 1 }));
    expect(updated).toMatchObject({ pricingUnit: kilograms, baseSize: 1 });
    const after = await recordsOf(m, product.id);
    after.forEach((r, i) => expect(r.unitPrice).toBeCloseTo(records[i]!.unitPrice * 2, 6));
  });

  test('to another dimension is rejected, leaving the product and its records alone', async () => {
    const m = await signUpHousehold(ctx);
    const { product, records } = await seed(m);

    for (const pricingUnit of [litres, tissue]) {
      const res = await updateProduct(m, product.id, { pricingUnit, name: '改名' });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: 'incompatible_unit' });
    }
    expect(await ok(await m.request(`/api/products/${product.id}`))).toMatchObject({
      name: product.name,
      pricingUnit: grams,
    });
    expect(await recordsOf(m, product.id)).toEqual(records);
  });

  test('to a count unit of another name is rejected', async () => {
    const m = await signUpHousehold(ctx);
    const category = await createCategory(m);
    const product = await createProduct(m, category.id, tissue, 90);
    const res = await updateProduct(m, product.id, { pricingUnit: { dimension: 'count', name: '张' } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'incompatible_unit' });
  });

  test('to an invalid unit is rejected', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    const res = await updateProduct(m, product.id, { pricingUnit: { dimension: 'weight', name: 'ml' } });
    expect(res.status).toBe(400);
  });
});

describe('merging products', () => {
  test("moves the merged product's records to the kept one and deletes it", async () => {
    const m = await signUpHousehold(ctx);
    const { category, channel, product: kept, records: keptRecords } = await seed(m);
    const merged = await createProduct(m, category.id, grams, 1000);
    const mergedRecord = await created<PriceRecord>(
      await recordPrice(m, merged.id, channel.id, { amount: 5400, unit: grams }),
    );

    const res = await mergeInto(m, kept.id, merged.id);
    expect(await ok(res)).toEqual(kept);

    const after = await recordsOf(m, kept.id);
    expect(after.map((r) => r.id).sort()).toEqual([...keptRecords.map((r) => r.id), mergedRecord.id].sort());
    const moved = after.find((r) => r.id === mergedRecord.id)!;
    expect(moved).toMatchObject({ productId: kept.id, size: mergedRecord.size, netPrice: mergedRecord.netPrice });
    expect(moved.unitPrice).toBeCloseTo(mergedRecord.unitPrice / 2, 6);
    expect((await m.request(`/api/products/${merged.id}`)).status).toBe(404);
  });

  test("converts the merged records' sizes to the kept product's pricing unit", async () => {
    const m = await signUpHousehold(ctx);
    const { category, channel, product: kept } = await seed(m);
    const merged = await createProduct(m, category.id, pounds, 25);
    const mergedRecord = await created<PriceRecord>(
      await recordPrice(m, merged.id, channel.id, { amount: 11.9, unit: pounds }),
    );

    await ok(await mergeInto(m, kept.id, merged.id));
    const moved = (await recordsOf(m, kept.id)).find((r) => r.id === mergedRecord.id)!;
    expect(moved.size.unit).toEqual(grams);
    expect(moved.size.amount).toBeCloseTo(11.9 * 453.59237, 6);
    expect(moved.enteredSize).toEqual({ amount: 11.9, unit: pounds });
    expect(moved.netPrice).toBe(mergedRecord.netPrice);
  });

  test('across dimensions or count units of another name is rejected', async () => {
    const m = await signUpHousehold(ctx);
    const { category, product: kept, records } = await seed(m);
    const sheets = await createProduct(m, category.id, tissue, 90);
    const otherSheets = await createProduct(m, category.id, { dimension: 'count', name: '张' }, 90);
    const bottles = await createProduct(m, category.id, litres, 1);

    for (const [keptId, mergedId] of [
      [kept.id, bottles.id],
      [kept.id, sheets.id],
      [sheets.id, otherSheets.id],
    ] as const) {
      const res = await mergeInto(m, keptId, mergedId);
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: 'incompatible_unit' });
    }
    expect(await recordsOf(m, kept.id)).toEqual(records);
    for (const p of [sheets, otherSheets, bottles]) expect((await m.request(`/api/products/${p.id}`)).status).toBe(200);
  });

  test('into itself is rejected', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    const res = await mergeInto(m, product.id, product.id);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'same_product' });
  });

  test('needs both products', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    const missingKept = await mergeInto(m, crypto.randomUUID(), product.id);
    expect(missingKept.status).toBe(404);
    const missingMerged = await mergeInto(m, product.id, crypto.randomUUID());
    expect(missingMerged.status).toBe(422);
    expect(await missingMerged.json()).toEqual({ error: 'product_not_found' });
  });
});

describe('archiving products', () => {
  test('leaves them out of the default list while keeping their records, until restored', async () => {
    const m = await signUpHousehold(ctx);
    const { category, product, records } = await seed(m);
    const kept = await createProduct(m, category.id, grams, 500);

    const archived = await ok<Product>(await updateProduct(m, product.id, { archived: true }));
    expect(archived.archived).toBe(true);
    expect(await productNames(m)).toEqual([kept.name]);
    expect(await productNames(m, `?categoryId=${category.id}`)).toEqual([kept.name]);
    expect((await productNames(m, '?includeArchived=true')).sort()).toEqual([kept.name, product.name].sort());
    expect(await ok(await m.request(`/api/products/${product.id}`))).toMatchObject({ archived: true });
    const groups = await ok<{ categories: { id: string; productCount: number }[] }[]>(
      await m.request('/api/category-groups'),
    );
    expect(groups.flatMap((g) => g.categories).find((c) => c.id === category.id)!.productCount).toBe(1);
    expect(await recordsOf(m, product.id)).toEqual(records);

    await ok(await updateProduct(m, product.id, { archived: false }));
    expect((await productNames(m)).sort()).toEqual([kept.name, product.name].sort());
  });
});

describe('household isolation', () => {
  test("another household's products cannot be re-based, re-united, merged or archived", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const bobs = await seed(bob);
    const alices = await seed(alice);

    const attempts = [
      updateProduct(alice, bobs.product.id, { baseSize: 1000 }),
      updateProduct(alice, bobs.product.id, { pricingUnit: kilograms }),
      updateProduct(alice, bobs.product.id, { archived: true }),
      mergeInto(alice, bobs.product.id, alices.product.id),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);

    const intoMine = await mergeInto(alice, alices.product.id, bobs.product.id);
    expect(intoMine.status).toBe(422);
    expect(await intoMine.json()).toEqual({ error: 'product_not_found' });

    expect(await ok(await bob.request(`/api/products/${bobs.product.id}`))).toMatchObject({
      pricingUnit: grams,
      baseSize: 500,
      archived: false,
    });
    expect(await recordsOf(bob, bobs.product.id)).toEqual(bobs.records);
    expect(await recordsOf(alice, alices.product.id)).toEqual(alices.records);
    expect(await productNames(alice, '?includeArchived=true')).toEqual([alices.product.name]);
  });
});
