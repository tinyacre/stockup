import { describe, expect, test } from 'bun:test';
import { judgmentFixtures } from '@stockup/domain/fixtures';
import { jsonRequest, signUpHousehold, useTestApp, type SignedInMember } from './support/harness';

const ctx = useTestApp();

interface Product {
  id: string;
  stockLine: number | null;
  lowestUnitPrice?: number | null;
}

interface Judgment {
  netPrice: number;
  unitPrice: number;
  stockLine: number | null;
  lowestUnitPrice: number | null;
  lastYearPromotionLowest: number | null;
  verdict: string | null;
  stockLineGap: number | null;
  lowestGap: number | null;
  lastYearPromotionGap: number | null;
}

function unique(label: string) {
  return `${label} ${crypto.randomUUID().slice(0, 8)}`;
}

async function created<T>(res: Response): Promise<T> {
  expect(res.status).toBe(201);
  return (await res.json()) as T;
}

const sheet = { dimension: 'count', name: '抽' };

// With a Base Size of one sheet, a record of one one-sheet piece has a Unit Price equal to its Net Price.
async function seed(m: SignedInMember, baseSize = 1) {
  const group = await created<{ id: string }>(
    await m.request('/api/category-groups', jsonRequest('POST', { name: unique('生活用品') })),
  );
  const category = await created<{ id: string }>(
    await m.request('/api/categories', jsonRequest('POST', { name: unique('抽纸'), categoryGroupId: group.id })),
  );
  const product = await created<Product>(
    await m.request(
      '/api/products',
      jsonRequest('POST', { categoryId: category.id, name: unique('得宝抽纸'), pricingUnit: sheet, baseSize }),
    ),
  );
  const channel = await created<{ id: string }>(
    await m.request('/api/channels', jsonRequest('POST', { name: unique('京东') })),
  );
  return { product, channel };
}

function record(
  m: SignedInMember,
  productId: string,
  channelId: string,
  listPrice: number,
  purchased = true,
  date = '2026-06-18',
) {
  return m
    .request(
      '/api/price-records',
      jsonRequest('POST', {
        productId,
        channelId,
        date,
        purchased,
        listPrice,
        discounts: [],
        quantity: 1,
        size: { amount: 1, unit: sheet },
      }),
    )
    .then(created);
}

function setStockLine(m: SignedInMember, productId: string, stockLine: number | null) {
  return m.request(`/api/products/${productId}`, jsonRequest('PATCH', { stockLine }));
}

function judge(m: SignedInMember, body: object) {
  return m.request('/api/judgments', jsonRequest('POST', body));
}

function judgmentBody(productId: string, overrides: Record<string, unknown> = {}) {
  return { productId, listPrice: 300, discounts: [], quantity: 1, size: { amount: 1, unit: sheet }, ...overrides };
}

async function productOf(m: SignedInMember, id: string) {
  const res = await m.request(`/api/products/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Product;
}

describe('stock line', () => {
  test('is set, changed and cleared on the product', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m, 90);
    expect(product.stockLine).toBeNull();

    const set = await setStockLine(m, product.id, 207);
    expect(set.status).toBe(200);
    expect(((await set.json()) as Product).stockLine).toBe(207);
    expect((await productOf(m, product.id)).stockLine).toBe(207);

    expect(((await (await setStockLine(m, product.id, 199)).json()) as Product).stockLine).toBe(199);

    const cleared = await setStockLine(m, product.id, null);
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as Product).stockLine).toBeNull();
    expect((await productOf(m, product.id)).stockLine).toBeNull();
  });

  test('must be a positive whole number of cents', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    for (const stockLine of [0, -1, 2.5, '207']) {
      expect((await setStockLine(m, product.id, stockLine as number)).status).toBe(400);
    }
  });

  test('is listed with the products', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    await setStockLine(m, product.id, 250);
    const detail = await productOf(m, product.id);
    const res = await m.request(`/api/products`);
    const listed = ((await res.json()) as Product[]).find((p) => p.id === product.id);
    expect(listed?.stockLine).toBe(250);
    expect(detail.stockLine).toBe(250);
  });
});

describe('lowest unit price', () => {
  test('is the lowest across bought and only-seen records, shown on the product detail', async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);
    expect((await productOf(m, product.id)).lowestUnitPrice).toBeNull();

    await record(m, product.id, channel.id, 320, true);
    await record(m, product.id, channel.id, 280, false);
    await record(m, product.id, channel.id, 300, true);
    expect((await productOf(m, product.id)).lowestUnitPrice).toBe(280);
  });
});

interface References {
  productId: string;
  lowestUnitPrice: number;
  promotionLowests: { promotionId: string; year: number; lowestUnitPrice: number }[];
  recentSizes: { amount: number; unit: { dimension: string; name: string } }[];
}

async function referencesOf(m: SignedInMember) {
  const res = await m.request('/api/price-references');
  expect(res.status).toBe(200);
  return (await res.json()) as References[];
}

describe('price references', () => {
  test("list each product's lowest, its lowest per promotion and year, and its sizes newest first", async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);
    const { product: unrecorded } = await seed(m);
    const promotions = (await (await m.request('/api/promotions')).json()) as { id: string; name: string }[];
    const promotion618 = promotions.find((p) => p.name === '618')!;

    await record(m, product.id, channel.id, 320, true, '2025-06-01');
    await record(m, product.id, channel.id, 280, true, '2025-06-18');
    await record(m, product.id, channel.id, 260, false, '2026-04-01');
    await created(
      await m.request(
        '/api/price-records',
        jsonRequest('POST', {
          productId: product.id,
          channelId: channel.id,
          date: '2026-06-18',
          purchased: true,
          listPrice: 1100,
          discounts: [{ amount: 100 }],
          quantity: 2,
          size: { amount: 2, unit: sheet },
        }),
      ),
    );

    const references = await referencesOf(m);
    expect(references.find((r) => r.productId === unrecorded.id)).toBeUndefined();
    const found = references.find((r) => r.productId === product.id)!;
    expect(found.lowestUnitPrice).toBe(250);
    expect(found.promotionLowests).toEqual(
      expect.arrayContaining([
        { promotionId: promotion618.id, year: 2025, lowestUnitPrice: 280 },
        { promotionId: promotion618.id, year: 2026, lowestUnitPrice: 250 },
      ]),
    );
    expect(found.promotionLowests).toHaveLength(2);
    expect(found.recentSizes).toEqual([
      { amount: 2, unit: sheet },
      { amount: 1, unit: sheet },
    ]);
  });

  test("leave out another household's products", async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);
    await record(m, product.id, channel.id, 300);
    const other = await signUpHousehold(ctx);
    expect(await referencesOf(other)).toEqual([]);
  });

  test('require a signed-in member', async () => {
    expect((await ctx.app.request('/api/price-references')).status).toBe(401);
  });
});

describe('judgments', () => {
  for (const f of judgmentFixtures) {
    if (!('expected' in f)) continue;
    test(f.name, async () => {
      const m = await signUpHousehold(ctx);
      const { product, channel } = await seed(m);
      const { unitPrice, stockLine, lowestUnitPrice, lastYearPromotionLowest } = f.input;
      if (stockLine != null) expect((await setStockLine(m, product.id, stockLine)).status).toBe(200);
      if (lowestUnitPrice != null) {
        await record(m, product.id, channel.id, lowestUnitPrice + 50);
        await record(m, product.id, channel.id, lowestUnitPrice, false);
      }
      // Tagged 618 a year before the judged date, which falls in 618 too.
      if (lastYearPromotionLowest != null) {
        await record(m, product.id, channel.id, lastYearPromotionLowest, true, '2025-06-18');
      }

      const res = await judge(m, judgmentBody(product.id, { listPrice: unitPrice, date: '2026-06-18' }));
      expect(res.status).toBe(200);
      const judgment = (await res.json()) as Judgment;
      expect(judgment).toMatchObject({
        netPrice: unitPrice,
        unitPrice,
        stockLine: stockLine ?? null,
        lowestUnitPrice: lowestUnitPrice ?? null,
        lastYearPromotionLowest: lastYearPromotionLowest ?? null,
        verdict: f.expected.verdict,
        lowestGap: f.expected.lowestGap,
        lastYearPromotionGap: f.expected.lastYearPromotionGap,
      });
      if (f.expected.stockLineGap === null) expect(judgment.stockLineGap).toBeNull();
      else expect(judgment.stockLineGap).toBeCloseTo(f.expected.stockLineGap, 9);
    });
  }

  test('prices the input like a price record, with discounts, quantity and size conversion', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m, 90);
    await setStockLine(m, product.id, 330);

    const res = await judge(
      m,
      judgmentBody(product.id, {
        listPrice: 9900,
        discounts: [{ amount: 1500, name: '券' }],
        quantity: 18,
        size: { amount: 130, unit: sheet },
      }),
    );
    expect(res.status).toBe(200);
    const judgment = (await res.json()) as Judgment;
    expect(judgment.netPrice).toBe(8400);
    expect(judgment.unitPrice).toBeCloseTo((8400 * 90) / (18 * 130), 9);
    expect(judgment.verdict).toBe('stockUp');
  });

  test('stores nothing', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    await judge(m, judgmentBody(product.id));
    const res = await m.request(`/api/price-records?productId=${product.id}`);
    expect(await res.json()).toEqual([]);
  });

  test('rejects prices the domain rejects', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    const other = await signUpHousehold(ctx);

    const free = await judge(m, judgmentBody(product.id, { listPrice: 100, discounts: [{ amount: 100 }] }));
    expect(free.status).toBe(422);
    expect(await free.json()).toEqual({ error: 'invalid_price' });

    const wrongUnit = await judge(m, judgmentBody(product.id, { size: { amount: 1, unit: { dimension: 'weight', name: 'kg' } } }));
    expect(wrongUnit.status).toBe(422);
    expect(await wrongUnit.json()).toEqual({ error: 'incompatible_unit' });

    const foreign = await judge(other, judgmentBody(product.id));
    expect(foreign.status).toBe(422);
    expect(await foreign.json()).toEqual({ error: 'product_not_found' });

    expect((await judge(m, judgmentBody(product.id, { quantity: 0 }))).status).toBe(400);
  });

  test('requires a signed-in member', async () => {
    const res = await ctx.app.request('/api/judgments', jsonRequest('POST', judgmentBody('any')));
    expect(res.status).toBe(401);
  });
});
