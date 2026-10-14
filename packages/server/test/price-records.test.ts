import { describe, expect, test } from 'bun:test';
import { priceFixtures, type PriceFixture } from '@stockup/domain/fixtures';
import { jsonRequest, signUpHousehold, useTestApp, type SignedInMember } from './support/harness';

const ctx = useTestApp();

interface Unit {
  dimension: string;
  name: string;
}

interface PriceRecord {
  id: string;
  productId: string;
  date: string;
  channel: { id: string; name: string; archived: boolean };
  purchased: boolean;
  promotion: { id: string; name: string } | null;
  listPrice: number;
  discounts: { amount: number; name?: string }[];
  quantity: number;
  size: { amount: number; unit: Unit };
  enteredSize: { amount: number; unit: Unit };
  note: string;
  recordedBy: { id: string; name: string } | null;
  source: string;
  netPrice: number;
  unitPrice: number;
  evidence: unknown[];
}

function unique(label: string) {
  return `${label} ${crypto.randomUUID().slice(0, 8)}`;
}

async function created<T>(res: Response): Promise<T> {
  expect(res.status).toBe(201);
  return (await res.json()) as T;
}

async function createProduct(m: SignedInMember, pricingUnit: Unit = { dimension: 'count', name: '抽' }, baseSize = 90) {
  const group = await created<{ id: string }>(
    await m.request('/api/category-groups', jsonRequest('POST', { name: unique('生活用品') })),
  );
  const category = await created<{ id: string }>(
    await m.request('/api/categories', jsonRequest('POST', { name: unique('抽纸'), categoryGroupId: group.id })),
  );
  return created<{ id: string }>(
    await m.request(
      '/api/products',
      jsonRequest('POST', { categoryId: category.id, name: unique('得宝抽纸'), pricingUnit, baseSize }),
    ),
  );
}

async function createChannel(m: SignedInMember, name = unique('京东')) {
  return created<{ id: string; name: string }>(await m.request('/api/channels', jsonRequest('POST', { name })));
}

// A household with one tissue product priced per 90 sheets and one channel.
async function seed(m: SignedInMember) {
  return { product: await createProduct(m), channel: await createChannel(m) };
}

function recordBody(productId: string, channelId: string, overrides: Record<string, unknown> = {}) {
  return {
    productId,
    channelId,
    date: '2026-06-18',
    purchased: true,
    listPrice: 9900,
    discounts: [],
    quantity: 18,
    size: { amount: 130, unit: { dimension: 'count', name: '抽' } },
    note: '',
    ...overrides,
  };
}

function createRecord(m: SignedInMember, body: object) {
  return m.request('/api/price-records', jsonRequest('POST', body));
}

function replaceRecord(m: SignedInMember, id: string, body: object) {
  return m.request(`/api/price-records/${id}`, jsonRequest('PUT', body));
}

async function recordsOf(m: SignedInMember, productId: string, filter: Record<string, string> = {}) {
  const res = await m.request(`/api/price-records?${new URLSearchParams({ productId, ...filter })}`);
  expect(res.status).toBe(200);
  return (await res.json()) as PriceRecord[];
}

describe('price records', () => {
  test('are created with every field and read back', async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);

    const record = await created<PriceRecord>(
      await createRecord(
        m,
        recordBody(product.id, channel.id, {
          date: '2026-11-11',
          purchased: false,
          listPrice: 19900,
          discounts: [{ amount: 10000, name: '满 199 减 100' }, { amount: 500, name: ' plus 券 ' }],
          quantity: 3,
          size: { amount: 100, unit: { dimension: 'count', name: '抽' } },
          note: '凑单买的',
        }),
      ),
    );

    expect(record).toEqual({
      id: record.id,
      productId: product.id,
      date: '2026-11-11',
      channel: { id: channel.id, name: channel.name, archived: false },
      purchased: false,
      promotion: { id: expect.any(String), name: '双 11' },
      listPrice: 19900,
      discounts: [{ amount: 10000, name: '满 199 减 100' }, { amount: 500, name: 'plus 券' }],
      quantity: 3,
      size: { amount: 100, unit: { dimension: 'count', name: '抽' } },
      enteredSize: { amount: 100, unit: { dimension: 'count', name: '抽' } },
      note: '凑单买的',
      recordedBy: { id: m.userId, name: expect.stringMatching(/^Member /) },
      source: 'manual',
      netPrice: 9400,
      unitPrice: 2820,
      evidence: [],
    });

    const detail = await m.request(`/api/price-records/${record.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual(record);
    expect(await recordsOf(m, product.id)).toEqual([record]);
  });

  test('a single unnamed discount works as the total discount', async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);

    const record = await created<PriceRecord>(
      await createRecord(m, recordBody(product.id, channel.id, { listPrice: 9900, discounts: [{ amount: 1900 }] })),
    );
    expect(record.discounts).toEqual([{ amount: 1900 }]);
    expect(record.netPrice).toBe(8000);
  });

  test('a size in another unit of the same dimension is stored converted, keeping the entry', async () => {
    const m = await signUpHousehold(ctx);
    const product = await createProduct(m, { dimension: 'weight', name: 'kg' }, 1);
    const channel = await createChannel(m);

    const record = await created<PriceRecord>(
      await createRecord(
        m,
        recordBody(product.id, channel.id, {
          listPrice: 45900,
          quantity: 1,
          size: { amount: 11.9, unit: { dimension: 'weight', name: '磅' } },
        }),
      ),
    );
    expect(record.size.unit).toEqual({ dimension: 'weight', name: 'kg' });
    expect(record.size.amount).toBeCloseTo(5.3977492, 6);
    expect(record.enteredSize).toEqual({ amount: 11.9, unit: { dimension: 'weight', name: '磅' } });
  });

  test('a size in another dimension or count unit is rejected', async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);

    for (const unit of [
      { dimension: 'weight', name: 'kg' },
      { dimension: 'count', name: '片' },
    ]) {
      const res = await createRecord(m, recordBody(product.id, channel.id, { size: { amount: 100, unit } }));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: 'incompatible_unit' });
    }
  });

  test('discounts must leave a positive net price', async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);

    const res = await createRecord(m, recordBody(product.id, channel.id, { listPrice: 1000, discounts: [{ amount: 1000 }] }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_price' });
  });

  test('malformed amounts are rejected', async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);

    for (const overrides of [
      { listPrice: 99.5 },
      { listPrice: 0 },
      { quantity: 0 },
      { quantity: 1.5 },
      { discounts: [{ amount: 0 }] },
      { size: { amount: 0, unit: { dimension: 'count', name: '抽' } } },
      { date: '2026-02-30' },
    ]) {
      expect((await createRecord(m, recordBody(product.id, channel.id, overrides))).status).toBe(400);
    }
  });

  test('the product and channel must belong to the household', async () => {
    const m = await signUpHousehold(ctx);
    const other = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);
    const foreign = await seed(other);

    const wrongProduct = await createRecord(m, recordBody(foreign.product.id, channel.id));
    expect(wrongProduct.status).toBe(422);
    expect(await wrongProduct.json()).toEqual({ error: 'product_not_found' });

    const wrongChannel = await createRecord(m, recordBody(product.id, foreign.channel.id));
    expect(wrongChannel.status).toBe(422);
    expect(await wrongChannel.json()).toEqual({ error: 'channel_not_found' });
  });

  test('are listed newest first', async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);
    const dates = ['2026-06-18', '2025-11-11', '2026-10-01', '2026-06-18'];
    const ids = [];
    for (const date of dates) {
      ids.push((await created<PriceRecord>(await createRecord(m, recordBody(product.id, channel.id, { date })))).id);
    }

    const listed = await recordsOf(m, product.id);
    expect(listed.map((r) => r.date)).toEqual(['2026-10-01', '2026-06-18', '2026-06-18', '2025-11-11']);
    // Records on the same day are listed in reverse order of entry.
    expect(listed.map((r) => r.id).slice(1, 3)).toEqual([ids[3]!, ids[0]!]);
    expect(await recordsOf(m, (await createProduct(m)).id)).toEqual([]);
  });

  test('are filtered by purchase, channel and promotion', async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);
    const other = await createChannel(m);
    const add = async (overrides: Record<string, unknown>) =>
      (await created<PriceRecord>(await createRecord(m, recordBody(product.id, channel.id, overrides)))).id;
    const bought618 = await add({ date: '2026-06-18', purchased: true });
    const seenElsewhere = await add({ date: '2026-03-03', purchased: false, channelId: other.id, promotionId: null });
    const seen1111 = await add({ date: '2026-11-11', purchased: false });
    const ids = async (filter: Record<string, string>) => (await recordsOf(m, product.id, filter)).map((r) => r.id);
    const [promotion618] = (await recordsOf(m, product.id, { purchased: 'true' })).map((r) => r.promotion!.id);

    expect(await ids({ purchased: 'true' })).toEqual([bought618]);
    expect(await ids({ purchased: 'false' })).toEqual([seen1111, seenElsewhere]);
    expect(await ids({ channelId: channel.id })).toEqual([seen1111, bought618]);
    expect(await ids({ promotionId: promotion618! })).toEqual([bought618]);
    expect(await ids({ promotionId: 'none' })).toEqual([seenElsewhere]);
    expect(await ids({ purchased: 'false', channelId: channel.id })).toEqual([seen1111]);
    expect(await ids({ channelId: crypto.randomUUID() })).toEqual([]);
  });

  test('reject a malformed purchase filter', async () => {
    const m = await signUpHousehold(ctx);
    const { product } = await seed(m);
    const res = await m.request(`/api/price-records?productId=${product.id}&purchased=yes`);
    expect(res.status).toBe(400);
  });

  test('are replaced as a whole', async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);
    const other = await createChannel(m);
    const record = await created<PriceRecord>(
      await createRecord(m, recordBody(product.id, channel.id, { discounts: [{ amount: 100, name: '券' }] })),
    );

    const { productId: _, ...changes } = recordBody(product.id, other.id, {
      date: '2026-06-01',
      purchased: false,
      listPrice: 5000,
      discounts: [{ amount: 1000 }, { amount: 500, name: '红包' }],
      quantity: 2,
      size: { amount: 200, unit: { dimension: 'count', name: '抽' } },
      note: '改过',
    });
    const res = await replaceRecord(m, record.id, changes);
    expect(res.status).toBe(200);
    const replaced = (await res.json()) as PriceRecord;
    expect(replaced).toMatchObject({
      id: record.id,
      productId: product.id,
      date: '2026-06-01',
      channel: { id: other.id },
      purchased: false,
      listPrice: 5000,
      discounts: [{ amount: 1000 }, { amount: 500, name: '红包' }],
      quantity: 2,
      note: '改过',
      netPrice: 3500,
    });
    expect(replaced.unitPrice).toBeCloseTo(787.5, 6);
    expect(await recordsOf(m, product.id)).toEqual([replaced]);

    const free = await replaceRecord(m, record.id, { ...changes, discounts: [{ amount: 5000 }] });
    expect(free.status).toBe(422);
  });

  test('are deleted', async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);
    const record = await created<PriceRecord>(await createRecord(m, recordBody(product.id, channel.id)));

    expect((await m.request(`/api/price-records/${record.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await m.request(`/api/price-records/${record.id}`)).status).toBe(404);
    expect(await recordsOf(m, product.id)).toEqual([]);
  });

  test('keep the products and channels they refer to', async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);
    await created<PriceRecord>(await createRecord(m, recordBody(product.id, channel.id)));

    const productDeleted = await m.request(`/api/products/${product.id}`, { method: 'DELETE' });
    expect(productDeleted.status).toBe(409);
    expect(await productDeleted.json()).toEqual({ error: 'not_empty' });

    const channelDeleted = await m.request(`/api/channels/${channel.id}`, { method: 'DELETE' });
    expect(channelDeleted.status).toBe(409);
    expect(await channelDeleted.json()).toEqual({ error: 'in_use' });
  });

  test('show an archived channel by name', async () => {
    const m = await signUpHousehold(ctx);
    const { product, channel } = await seed(m);
    await m.request(`/api/channels/${channel.id}`, jsonRequest('PATCH', { archived: true }));

    const record = await created<PriceRecord>(await createRecord(m, recordBody(product.id, channel.id)));
    expect(record.channel).toEqual({ id: channel.id, name: channel.name, archived: true });
  });
});

// The API computes prices with the same domain functions as the web client, so it must agree with the shared fixtures.
describe('net and unit prices match the domain fixtures', () => {
  const succeeding = priceFixtures.filter((f): f is Extract<PriceFixture, { expected: unknown }> => 'expected' in f);

  for (const f of succeeding) {
    test(f.name, async () => {
      const m = await signUpHousehold(ctx);
      const product = await createProduct(m, f.input.pricingUnit, f.input.baseSize);
      const channel = await createChannel(m);
      const { listPrice, discounts, quantity, size } = f.input;

      const record = await created<PriceRecord>(
        await createRecord(m, recordBody(product.id, channel.id, { listPrice, discounts, quantity, size })),
      );
      expect(record.netPrice).toBe(f.expected.netPrice);
      expect(record.unitPrice).toBeCloseTo(f.expected.unitPrice, 6);
      expect((await recordsOf(m, product.id))[0]!.unitPrice).toBeCloseTo(f.expected.unitPrice, 6);
    });
  }

  for (const f of priceFixtures.filter((f) => 'error' in f)) {
    test(f.name, async () => {
      const m = await signUpHousehold(ctx);
      const product = await createProduct(m, f.input.pricingUnit, f.input.baseSize);
      const channel = await createChannel(m);
      const { listPrice, discounts, quantity, size } = f.input;

      const res = await createRecord(m, recordBody(product.id, channel.id, { listPrice, discounts, quantity, size }));
      // Malformed amounts fail request validation; the rest fail the domain rules.
      if (f.error === 'IncompatibleUnitsError') expect(await res.json()).toEqual({ error: 'incompatible_unit' });
      else if (res.status === 422) expect(await res.json()).toEqual({ error: 'invalid_price' });
      else expect(res.status).toBe(400);
    });
  }
});

describe('household isolation', () => {
  test("another household's price records cannot be read, replaced or deleted", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const { product, channel } = await seed(bob);
    const record = await created<PriceRecord>(await createRecord(bob, recordBody(product.id, channel.id)));
    const own = await seed(alice);

    expect(await recordsOf(alice, product.id)).toEqual([]);
    const { productId: _, ...body } = recordBody(own.product.id, own.channel.id);
    const attempts = [
      alice.request(`/api/price-records/${record.id}`),
      replaceRecord(alice, record.id, body),
      alice.request(`/api/price-records/${record.id}`, { method: 'DELETE' }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);

    expect(await recordsOf(bob, product.id)).toEqual([record]);
  });

  test('price records require a signed-in member', async () => {
    expect((await ctx.app.request('/api/price-records?productId=x')).status).toBe(401);
    expect((await ctx.app.request('/api/price-records', jsonRequest('POST', {}))).status).toBe(401);
  });
});
