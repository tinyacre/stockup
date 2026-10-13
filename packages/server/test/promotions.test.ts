import { describe, expect, test } from 'bun:test';
import { jsonRequest, signUpHousehold, useTestApp, type SignedInMember } from './support/harness';

const ctx = useTestApp();

interface Promotion {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
}

interface PriceRecord {
  id: string;
  date: string;
  promotion: { id: string; name: string } | null;
  unitPrice: number;
}

interface Judgment {
  unitPrice: number;
  promotion: { id: string; name: string } | null;
  lastYearPromotionLowest: number | null;
  lastYearPromotionGap: number | null;
}

function unique(label: string) {
  return `${label} ${crypto.randomUUID().slice(0, 8)}`;
}

async function created<T>(res: Response): Promise<T> {
  expect(res.status).toBe(201);
  return (await res.json()) as T;
}

function createPromotion(m: SignedInMember, body: object) {
  return m.request('/api/promotions', jsonRequest('POST', body));
}

function updatePromotion(m: SignedInMember, id: string, body: object) {
  return m.request(`/api/promotions/${id}`, jsonRequest('PATCH', body));
}

async function promotionsOf(m: SignedInMember) {
  const res = await m.request('/api/promotions');
  expect(res.status).toBe(200);
  return (await res.json()) as Promotion[];
}

async function promotionNamed(m: SignedInMember, name: string) {
  return (await promotionsOf(m)).find((p) => p.name === name)!;
}

const sheet = { dimension: 'count', name: '抽' };

// With a Base Size of one sheet, a record of one one-sheet piece has a Unit Price equal to its Net Price.
async function seed(m: SignedInMember) {
  const group = await created<{ id: string }>(
    await m.request('/api/category-groups', jsonRequest('POST', { name: unique('生活用品') })),
  );
  const category = await created<{ id: string }>(
    await m.request('/api/categories', jsonRequest('POST', { name: unique('抽纸'), categoryGroupId: group.id })),
  );
  const product = await created<{ id: string }>(
    await m.request(
      '/api/products',
      jsonRequest('POST', { categoryId: category.id, name: unique('得宝抽纸'), pricingUnit: sheet, baseSize: 1 }),
    ),
  );
  const channel = await created<{ id: string }>(
    await m.request('/api/channels', jsonRequest('POST', { name: unique('京东') })),
  );
  return { product, channel };
}

function recordBody(seeded: Awaited<ReturnType<typeof seed>>, date: string, extra: Record<string, unknown> = {}) {
  return {
    productId: seeded.product.id,
    channelId: seeded.channel.id,
    date,
    purchased: true,
    listPrice: 300,
    discounts: [],
    quantity: 1,
    size: { amount: 1, unit: sheet },
    ...extra,
  };
}

function createRecord(m: SignedInMember, body: object) {
  return m.request('/api/price-records', jsonRequest('POST', body));
}

async function recordById(m: SignedInMember, id: string) {
  const res = await m.request(`/api/price-records/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as PriceRecord;
}

function record(m: SignedInMember, seeded: Awaited<ReturnType<typeof seed>>, date: string, extra = {}) {
  return createRecord(m, recordBody(seeded, date, extra)).then((res) => created<PriceRecord>(res));
}

async function judge(m: SignedInMember, productId: string, listPrice: number, date?: string) {
  const res = await m.request(
    '/api/judgments',
    jsonRequest('POST', { productId, listPrice, discounts: [], quantity: 1, size: { amount: 1, unit: sheet }, date }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Judgment;
}

describe('promotions', () => {
  test('presets are listed by start date with their default ranges', async () => {
    const m = await signUpHousehold(ctx);
    expect((await promotionsOf(m)).map(({ name, startsOn, endsOn }) => ({ name, startsOn, endsOn }))).toEqual([
      { name: '年货节', startsOn: '01-05', endsOn: '01-25' },
      { name: '38 节', startsOn: '03-01', endsOn: '03-08' },
      { name: '618', startsOn: '05-31', endsOn: '06-20' },
      { name: '双 11', startsOn: '10-20', endsOn: '11-11' },
      { name: '双 12', startsOn: '12-01', endsOn: '12-12' },
    ]);
  });

  test('custom promotions are created, including ranges across the new year', async () => {
    const m = await signUpHousehold(ctx);
    const promotion = await created<Promotion>(
      await createPromotion(m, { name: ' 跨年囤货 ', startsOn: '12-20', endsOn: '01-10' }),
    );
    expect(promotion).toEqual({ id: promotion.id, name: '跨年囤货', startsOn: '12-20', endsOn: '01-10' });
    expect(await promotionsOf(m)).toContainEqual(promotion);
  });

  test('ranges and names are changed', async () => {
    const m = await signUpHousehold(ctx);
    const promotion = await promotionNamed(m, '618');

    const res = await updatePromotion(m, promotion.id, { startsOn: '05-20', endsOn: '06-18' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...promotion, startsOn: '05-20', endsOn: '06-18' });

    const renamed = await updatePromotion(m, promotion.id, { name: '京东 618' });
    expect(await renamed.json()).toEqual({ ...promotion, name: '京东 618', startsOn: '05-20', endsOn: '06-18' });
  });

  test('names are unique within the household', async () => {
    const m = await signUpHousehold(ctx);
    const duplicate = await createPromotion(m, { name: '618', startsOn: '06-01', endsOn: '06-18' });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: 'name_taken' });

    const double12 = await promotionNamed(m, '双 12');
    expect((await updatePromotion(m, double12.id, { name: '双 11' })).status).toBe(409);
  });

  test('bounds must be month-days of a calendar, and a change must change something', async () => {
    const m = await signUpHousehold(ctx);
    for (const bounds of [
      { startsOn: '02-30', endsOn: '03-05' },
      { startsOn: '6-1', endsOn: '06-18' },
      { startsOn: '06-01', endsOn: '2026-06-18' },
      { startsOn: '13-01', endsOn: '01-05' },
    ]) {
      expect((await createPromotion(m, { name: unique('大促'), ...bounds })).status).toBe(400);
    }
    expect((await createPromotion(m, { name: '开春', startsOn: '02-29', endsOn: '03-05' })).status).toBe(201);

    const promotion = await promotionNamed(m, '618');
    expect((await updatePromotion(m, promotion.id, { endsOn: '04-31' })).status).toBe(400);
    expect((await updatePromotion(m, promotion.id, {})).status).toBe(400);
  });

  test("another household's promotions cannot be changed or tagged", async () => {
    const alice = await signUpHousehold(ctx);
    const bob = await signUpHousehold(ctx);
    const bobs618 = await promotionNamed(bob, '618');

    const res = await updatePromotion(alice, bobs618.id, { name: 'hijacked' });
    expect(res.status).toBe(404);
    expect(await promotionNamed(bob, '618')).toEqual(bobs618);

    const seeded = await seed(alice);
    const tagged = await createRecord(alice, recordBody(seeded, '2026-06-18', { promotionId: bobs618.id }));
    expect(tagged.status).toBe(422);
    expect(await tagged.json()).toEqual({ error: 'promotion_not_found' });
  });

  test('require a signed-in member', async () => {
    expect((await ctx.app.request('/api/promotions', jsonRequest('POST', { name: 'x' }))).status).toBe(401);
  });
});

describe('price record promotion tags', () => {
  test('are set from the date when a record is created', async () => {
    const m = await signUpHousehold(ctx);
    const seeded = await seed(m);
    const promotion = await promotionNamed(m, '618');

    const tagged = await record(m, seeded, '2026-06-18');
    expect(tagged.promotion).toEqual({ id: promotion.id, name: '618' });
    expect((await recordById(m, tagged.id)).promotion).toEqual(tagged.promotion);

    expect((await record(m, seeded, '2026-07-01')).promotion).toBeNull();
  });

  test('pick the shortest of overlapping promotions', async () => {
    const m = await signUpHousehold(ctx);
    const seeded = await seed(m);
    const anniversary = await created<Promotion>(
      await createPromotion(m, { name: '超市周年庆', startsOn: '11-01', endsOn: '11-05' }),
    );

    expect((await record(m, seeded, '2026-11-03')).promotion).toEqual({ id: anniversary.id, name: '超市周年庆' });
    expect((await record(m, seeded, '2026-11-06')).promotion?.name).toBe('双 11');
  });

  test('follow ranges across the new year', async () => {
    const m = await signUpHousehold(ctx);
    const seeded = await seed(m);
    await created(await createPromotion(m, { name: '跨年囤货', startsOn: '12-20', endsOn: '01-03' }));

    expect((await record(m, seeded, '2026-12-31')).promotion?.name).toBe('跨年囤货');
    expect((await record(m, seeded, '2027-01-03')).promotion?.name).toBe('跨年囤货');
    expect((await record(m, seeded, '2027-01-04')).promotion).toBeNull();
  });

  test('use the ranges at the time of writing', async () => {
    const m = await signUpHousehold(ctx);
    const seeded = await seed(m);
    const promotion = await promotionNamed(m, '618');
    const before = await record(m, seeded, '2026-05-25');
    await updatePromotion(m, promotion.id, { startsOn: '05-20' });

    expect((await record(m, seeded, '2026-05-25')).promotion?.name).toBe('618');
    expect((await recordById(m, before.id)).promotion).toBeNull();
  });

  test('are chosen or cleared by hand', async () => {
    const m = await signUpHousehold(ctx);
    const seeded = await seed(m);
    const double11 = await promotionNamed(m, '双 11');

    const chosen = await record(m, seeded, '2026-06-18', { promotionId: double11.id });
    expect(chosen.promotion).toEqual({ id: double11.id, name: '双 11' });
    expect((await record(m, seeded, '2026-06-18', { promotionId: null })).promotion).toBeNull();
  });

  test('are kept, replaced or cleared when a record is replaced', async () => {
    const m = await signUpHousehold(ctx);
    const seeded = await seed(m);
    const double11 = await promotionNamed(m, '双 11');
    const tagged = await record(m, seeded, '2026-06-18', { promotionId: double11.id });
    const replace = (body: object) =>
      m.request(`/api/price-records/${tagged.id}`, jsonRequest('PUT', body)).then(async (res) => {
        expect(res.status).toBe(200);
        return (await res.json()) as PriceRecord;
      });
    const { productId: _, ...body } = recordBody(seeded, '2026-06-19');

    expect((await replace(body)).promotion).toEqual({ id: double11.id, name: '双 11' });
    expect((await replace({ ...body, promotionId: null })).promotion).toBeNull();
    const promo618 = await promotionNamed(m, '618');
    expect((await replace({ ...body, promotionId: promo618.id })).promotion).toEqual({ id: promo618.id, name: '618' });
  });
});

describe("last year's lowest in the same promotion", () => {
  test("is the lowest unit price among last year's records tagged with the promotion the date falls in", async () => {
    const m = await signUpHousehold(ctx);
    const seeded = await seed(m);
    const promotion = await promotionNamed(m, '618');
    await record(m, seeded, '2025-06-01', { listPrice: 320 });
    await record(m, seeded, '2025-06-18', { listPrice: 280, purchased: false });
    // Outside the range but tagged by hand, so it counts.
    await record(m, seeded, '2025-07-02', { listPrice: 290, promotionId: promotion.id });
    // Inside last year's range but untagged, tagged otherwise, from another year, or this year's.
    await record(m, seeded, '2025-06-10', { listPrice: 100, promotionId: null });
    await record(m, seeded, '2025-06-11', { listPrice: 110, promotionId: (await promotionNamed(m, '双 11')).id });
    await record(m, seeded, '2024-06-18', { listPrice: 120 });
    await record(m, seeded, '2026-06-01', { listPrice: 130 });

    const judgment = await judge(m, seeded.product.id, 300, '2026-06-15');
    expect(judgment.promotion).toEqual({ id: promotion.id, name: '618' });
    expect(judgment.lastYearPromotionLowest).toBe(280);
    expect(judgment.lastYearPromotionGap).toBe(20);
  });

  test('is null when the date falls in no promotion or last year has no records', async () => {
    const m = await signUpHousehold(ctx);
    const seeded = await seed(m);
    await record(m, seeded, '2025-06-18', { listPrice: 280 });

    const outside = await judge(m, seeded.product.id, 300, '2026-07-01');
    expect(outside).toMatchObject({ promotion: null, lastYearPromotionLowest: null, lastYearPromotionGap: null });

    const noRecords = await judge(m, seeded.product.id, 300, '2026-11-11');
    expect(noRecords.promotion?.name).toBe('双 11');
    expect(noRecords.lastYearPromotionLowest).toBeNull();
  });

  test('counts a range across the new year from the year it started', async () => {
    const m = await signUpHousehold(ctx);
    const seeded = await seed(m);
    await created(await createPromotion(m, { name: '跨年囤货', startsOn: '12-20', endsOn: '01-10' }));
    await record(m, seeded, '2025-12-25', { listPrice: 260 });
    await record(m, seeded, '2026-01-03', { listPrice: 250 });
    // The occurrence that started in 2024.
    await record(m, seeded, '2025-01-03', { listPrice: 200 });

    expect((await judge(m, seeded.product.id, 300, '2027-01-03')).lastYearPromotionLowest).toBe(250);
    expect((await judge(m, seeded.product.id, 300, '2026-12-21')).lastYearPromotionLowest).toBe(250);
    expect((await judge(m, seeded.product.id, 300, '2026-01-03')).lastYearPromotionLowest).toBe(200);
  });

  test('defaults the date to today', async () => {
    const m = await signUpHousehold(ctx);
    const seeded = await seed(m);
    const now = new Date();
    const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // A single day is shorter than any preset that might contain today.
    const today = await created<Promotion>(
      await createPromotion(m, { name: '今天', startsOn: monthDay, endsOn: monthDay }),
    );
    await record(m, seeded, `${now.getFullYear() - 1}-06-15`, { listPrice: 270, promotionId: today.id });

    const judgment = await judge(m, seeded.product.id, 300);
    expect(judgment.promotion).toEqual({ id: today.id, name: '今天' });
    expect(judgment.lastYearPromotionLowest).toBe(270);
  });
});
