import { describe, expect, test } from 'bun:test';
import type { RecognitionResult } from '../src/recognizer';
import { fakeRecognizer, fixedRecognition } from './support/fake-recognizer';
import { joinHousehold, jsonRequest, signUpHousehold, useTestApp, type SignedInMember } from './support/harness';

interface Unit {
  dimension: string;
  name: string;
}

interface Draft {
  id: string;
  name: string;
  sizeText: string | null;
  size: { amount: number; unit: Unit } | null;
  quantity: number | null;
  listPrice: number | null;
  discounts: { amount: number; name?: string }[];
  orderDiscount: number | null;
  suggestedProduct: { id: string; name: string; pricingUnit: Unit; baseSize: number } | null;
}

interface Recognition {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  error: string | null;
  requestedBy: { id: string; name: string } | null;
  screenshot: { contentType: string; size: number };
  date: string | null;
  channel: string | null;
  orderDiscounts: { amount: number; name?: string }[];
  drafts: Draft[];
  createdAt: string;
  finishedAt: string | null;
  confirmedAt: string | null;
}

interface PriceRecord {
  id: string;
  productId: string;
  date: string;
  channel: { id: string };
  purchased: boolean;
  promotion: { id: string; name: string } | null;
  listPrice: number;
  discounts: { amount: number; name?: string }[];
  quantity: number;
  enteredSize: { amount: number; unit: Unit };
  source: string;
  netPrice: number;
  recordedBy: { id: string } | null;
  evidence: { id: string; contentType: string; size: number; createdAt: string }[];
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const tissue = { dimension: 'count', name: '抽' };
const grams = { dimension: 'weight', name: 'g' };

function screenshot(...rest: number[]) {
  return new Uint8Array([...pngSignature, ...rest]);
}

function unique(label: string) {
  return `${label} ${crypto.randomUUID().slice(0, 8)}`;
}

async function created<T>(res: Response): Promise<T> {
  expect(res.status).toBe(201);
  return (await res.json()) as T;
}

async function createCategory(m: SignedInMember) {
  const group = await created<{ id: string }>(
    await m.request('/api/category-groups', jsonRequest('POST', { name: unique('生活用品') })),
  );
  return created<{ id: string }>(
    await m.request('/api/categories', jsonRequest('POST', { name: unique('抽纸'), categoryGroupId: group.id })),
  );
}

async function createProduct(m: SignedInMember, categoryId: string, name: string, pricingUnit: Unit, baseSize: number) {
  return created<{ id: string; name: string }>(
    await m.request('/api/products', jsonRequest('POST', { categoryId, name, pricingUnit, baseSize })),
  );
}

function upload(m: SignedInMember, bytes: Uint8Array, name = 'order.png', type = 'image/png') {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  return m.request('/api/recognitions', { method: 'POST', body: form });
}

async function read(m: SignedInMember, id: string) {
  const res = await m.request(`/api/recognitions/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Recognition;
}

// Polls the way the web app does until the recognition has finished.
async function finished(m: SignedInMember, id: string) {
  for (let i = 0; i < 200; i++) {
    const recognition = await read(m, id);
    if (recognition.status !== 'pending') return recognition;
    await Bun.sleep(10);
  }
  throw new Error(`recognition ${id} is still pending`);
}

async function screenshotOf(m: SignedInMember, id: string) {
  const res = await m.request(`/api/recognitions/${id}/screenshot`);
  expect(res.status).toBe(200);
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  return { contentType: res.headers.get('content-type'), bytes: new Uint8Array(await res.arrayBuffer()) };
}

describe('recognitions', () => {
  const recognizer = fakeRecognizer();
  const ctx = useTestApp({ recognizer });

  test('a screenshot is recognized into drafts with parsed sizes and suggested products', async () => {
    recognizer.respond = async () => fixedRecognition;
    const m = await signUpHousehold(ctx);
    const category = await createCategory(m);
    const tissues = await createProduct(m, category.id, '得宝抽纸 M 码', tissue, 90);
    await createProduct(m, category.id, '维达抽纸', tissue, 100);
    const catFood = await createProduct(m, category.id, '皇家猫粮', grams, 1000);
    const bytes = screenshot(1, 2, 3);

    const started = await created<Recognition>(await upload(m, bytes));
    expect(started).toMatchObject({
      status: 'pending',
      error: null,
      requestedBy: { id: m.userId },
      screenshot: { contentType: 'image/png', size: bytes.length },
      drafts: [],
      finishedAt: null,
    });

    const done = await finished(m, started.id);
    expect(done).toMatchObject({
      id: started.id,
      status: 'succeeded',
      error: null,
      date: '2026-06-18',
      channel: '京东',
      orderDiscounts: [{ amount: 2000, name: '满 199 减 20' }],
      finishedAt: expect.any(String),
    });
    expect(done.drafts).toEqual([
      {
        id: expect.any(String),
        name: '得宝抽纸 M码',
        sizeText: '100抽',
        size: { amount: 100, unit: tissue },
        quantity: 18,
        listPrice: 9900,
        discounts: [{ amount: 1000, name: 'plus 券' }],
        orderDiscount: 553,
        suggestedProduct: { id: tissues.id, name: '得宝抽纸 M 码', pricingUnit: tissue, baseSize: 90 },
      },
      {
        id: expect.any(String),
        name: '皇家猫粮',
        sizeText: '2kg',
        size: { amount: 2, unit: { dimension: 'weight', name: 'kg' } },
        quantity: 1,
        listPrice: 25900,
        discounts: [],
        orderDiscount: 1447,
        suggestedProduct: { id: catFood.id, name: '皇家猫粮', pricingUnit: grams, baseSize: 1000 },
      },
    ]);

    expect(recognizer.screenshots.at(-1)).toEqual({ bytes, contentType: 'image/png' });
    expect(await screenshotOf(m, started.id)).toEqual({ contentType: 'image/png', bytes });
  });

  test('stays pending while the recognizer is still reading', async () => {
    let answer!: () => void;
    recognizer.respond = () => new Promise((resolve) => (answer = () => resolve(fixedRecognition)));
    const m = await signUpHousehold(ctx);

    const started = await created<Recognition>(await upload(m, screenshot(1)));
    await Bun.sleep(20);
    expect((await read(m, started.id)).status).toBe('pending');

    answer();
    expect((await finished(m, started.id)).status).toBe('succeeded');
  });

  test('a draft keeps what could not be read or matched', async () => {
    const m = await signUpHousehold(ctx);
    const category = await createCategory(m);
    const archived = await createProduct(m, category.id, '清风抽纸', tissue, 100);
    await m.request(`/api/products/${archived.id}`, jsonRequest('PATCH', { archived: true }));
    recognizer.respond = async () => ({
      items: [
        { name: '清风抽纸', sizeText: '100抽×18包', quantity: null, listPrice: null, discounts: [] },
        { name: '无名商品', sizeText: null, quantity: 2, listPrice: 500, discounts: [] },
      ],
      orderDiscounts: [],
      date: null,
      channel: null,
    });

    const started = await created<Recognition>(await upload(m, screenshot(2)));
    const done = await finished(m, started.id);
    expect(done).toMatchObject({ status: 'succeeded', date: null, channel: null, orderDiscounts: [] });
    expect(done.drafts).toEqual([
      {
        id: expect.any(String),
        name: '清风抽纸',
        sizeText: '100抽×18包',
        size: null,
        quantity: null,
        listPrice: null,
        discounts: [],
        orderDiscount: 0,
        suggestedProduct: null,
      },
      {
        id: expect.any(String),
        name: '无名商品',
        sizeText: null,
        size: null,
        quantity: 2,
        listPrice: 500,
        discounts: [],
        orderDiscount: 0,
        suggestedProduct: null,
      },
    ]);
  });

  test('a failed recognition keeps the screenshot for manual entry', async () => {
    recognizer.respond = async () => {
      throw new Error('model unavailable');
    };
    const m = await signUpHousehold(ctx);
    const bytes = screenshot(3);

    const started = await created<Recognition>(await upload(m, bytes));
    const done = await finished(m, started.id);
    expect(done).toMatchObject({
      status: 'failed',
      error: 'recognition_failed',
      drafts: [],
      finishedAt: expect.any(String),
    });
    expect((await screenshotOf(m, started.id)).bytes).toEqual(bytes);
  });

  test('suggestions follow a merged product and clear when the product is deleted', async () => {
    recognizer.respond = async () => fixedRecognition;
    const m = await signUpHousehold(ctx);
    const category = await createCategory(m);
    const duplicate = await createProduct(m, category.id, '得宝抽纸 M 码', tissue, 90);
    const kept = await createProduct(m, category.id, '得宝 Mini', tissue, 90);
    const catFood = await createProduct(m, category.id, '皇家猫粮', grams, 1000);

    const started = await created<Recognition>(await upload(m, screenshot(4)));
    const suggested = (await finished(m, started.id)).drafts.map((d) => d.suggestedProduct?.id);
    expect(suggested).toEqual([duplicate.id, catFood.id]);

    const merged = await m.request(`/api/products/${kept.id}/merge`, jsonRequest('POST', { productId: duplicate.id }));
    expect(merged.status).toBe(200);
    expect((await m.request(`/api/products/${catFood.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await read(m, started.id)).drafts.map((d) => d.suggestedProduct?.id ?? null)).toEqual([kept.id, null]);
  });

  test('files that are not PNG, JPEG, WebP or GIF images are rejected', async () => {
    const m = await signUpHousehold(ctx);
    const res = await upload(m, new TextEncoder().encode('<svg/>'), 'evil.svg', 'image/svg+xml');
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'unsupported_evidence_type' });
  });

  test('files over 10 MB are rejected', async () => {
    const m = await signUpHousehold(ctx);
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(pngSignature);
    const res = await upload(m, big);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'evidence_too_large' });
  });

  test('an upload without a file is rejected', async () => {
    const m = await signUpHousehold(ctx);
    expect((await m.request('/api/recognitions', { method: 'POST', body: new FormData() })).status).toBe(400);
  });

  test('the household sees a recognition as its requester started it', async () => {
    recognizer.respond = async () => fixedRecognition;
    const requester = await signUpHousehold(ctx);
    const housemate = await joinHousehold(ctx, requester);
    const started = await created<Recognition>(await upload(requester, screenshot(5)));

    const seen = await finished(housemate, started.id);
    expect(seen.requestedBy).toEqual({ id: requester.userId, name: expect.any(String) });
    expect(seen.drafts).toHaveLength(2);
    expect((await screenshotOf(housemate, started.id)).bytes).toEqual(screenshot(5));
  });

  test("another household's members cannot see a recognition or its screenshot", async () => {
    recognizer.respond = async () => fixedRecognition;
    const owner = await signUpHousehold(ctx);
    const other = await signUpHousehold(ctx);
    const started = await created<Recognition>(await upload(owner, screenshot(6)));
    await finished(owner, started.id);

    expect((await other.request(`/api/recognitions/${started.id}`)).status).toBe(404);
    expect((await other.request(`/api/recognitions/${started.id}/screenshot`)).status).toBe(404);
  });

  test('recognitions require a signed-in member', async () => {
    const owner = await signUpHousehold(ctx);
    const started = await created<Recognition>(await upload(owner, screenshot(7)));
    await finished(owner, started.id);

    expect((await ctx.app.request(`/api/recognitions/${started.id}`)).status).toBe(401);
    expect((await ctx.app.request(`/api/recognitions/${started.id}/screenshot`)).status).toBe(401);
    const form = new FormData();
    form.append('file', new File([screenshot()], 'a.png', { type: 'image/png' }));
    expect((await ctx.app.request('/api/recognitions', { method: 'POST', body: form })).status).toBe(401);
  });
});

describe('reviewing and confirming drafts', () => {
  const recognizer = fakeRecognizer();
  const ctx = useTestApp({ recognizer });

  async function setUp(m: SignedInMember, result: RecognitionResult = fixedRecognition) {
    recognizer.respond = async () => result;
    const category = await createCategory(m);
    const tissues = await createProduct(m, category.id, '得宝抽纸 M 码', tissue, 90);
    const catFood = await createProduct(m, category.id, '皇家猫粮', grams, 1000);
    const channel = await created<{ id: string }>(
      await m.request('/api/channels', jsonRequest('POST', { name: unique('京东') })),
    );
    const started = await created<Recognition>(await upload(m, screenshot(9, 9)));
    const recognition = await finished(m, started.id);
    return { category, tissues, catFood, channel, recognition };
  }

  function editDraft(m: SignedInMember, recognition: Recognition, draftId: string, changes: object) {
    return m.request(`/api/recognitions/${recognition.id}/drafts/${draftId}`, jsonRequest('PATCH', changes));
  }

  async function edited(m: SignedInMember, recognition: Recognition, draftId: string, changes: object) {
    const res = await editDraft(m, recognition, draftId, changes);
    expect(res.status).toBe(200);
    return (await res.json()) as Recognition;
  }

  function deleteDraft(m: SignedInMember, recognition: Recognition, draftId: string) {
    return m.request(`/api/recognitions/${recognition.id}/drafts/${draftId}`, { method: 'DELETE' });
  }

  function confirm(m: SignedInMember, recognition: Recognition, body: object) {
    return m.request(`/api/recognitions/${recognition.id}/confirm`, jsonRequest('POST', body));
  }

  async function recordsOf(m: SignedInMember, productId: string) {
    const res = await m.request(`/api/price-records?productId=${productId}`);
    expect(res.status).toBe(200);
    return (await res.json()) as PriceRecord[];
  }

  async function lowestOf(m: SignedInMember, productId: string) {
    const res = await m.request(`/api/products/${productId}`);
    return ((await res.json()) as { lowestUnitPrice: number | null }).lowestUnitPrice;
  }

  test('a member edits each draft and picks or clears its product', async () => {
    const m = await signUpHousehold(ctx);
    const { category, recognition } = await setUp(m);
    const [first, second] = recognition.drafts;
    const other = await createProduct(m, category.id, unique('得宝抽纸 Mini'), tissue, 80);

    const after = await edited(m, recognition, first!.id, {
      name: '得宝抽纸 M 码 4 层',
      size: { amount: 90, unit: tissue },
      quantity: 24,
      discounts: [{ amount: 500, name: '店铺券' }],
      productId: other.id,
    });
    expect(after.drafts[0]).toEqual({
      ...first!,
      name: '得宝抽纸 M 码 4 层',
      size: { amount: 90, unit: tissue },
      quantity: 24,
      discounts: [{ amount: 500, name: '店铺券' }],
      suggestedProduct: { id: other.id, name: other.name, pricingUnit: tissue, baseSize: 80 },
    });
    expect(after.drafts[1]).toEqual(second!);

    const cleared = await edited(m, recognition, second!.id, { productId: null, size: null, quantity: null });
    expect(cleared.drafts[1]).toMatchObject({ suggestedProduct: null, size: null, quantity: null });
    expect((await read(m, recognition.id)).drafts.map((d) => d.suggestedProduct?.id ?? null)).toEqual([
      other.id,
      null,
    ]);
  });

  test('a draft with no match gets a newly created product', async () => {
    const m = await signUpHousehold(ctx);
    const { category, channel, recognition } = await setUp(m, {
      ...fixedRecognition,
      items: [{ name: '新品牌洗衣液', sizeText: '3kg', quantity: 2, listPrice: 5980, discounts: [] }],
      orderDiscounts: [],
    });
    expect(recognition.drafts[0]!.suggestedProduct).toBeNull();

    const product = await createProduct(m, category.id, '新品牌洗衣液', grams, 1000);
    await edited(m, recognition, recognition.drafts[0]!.id, { productId: product.id });
    expect((await confirm(m, recognition, { date: '2026-06-18', channelId: channel.id, purchased: true })).status).toBe(
      201,
    );
    expect(await recordsOf(m, product.id)).toMatchObject([{ listPrice: 5980, quantity: 2, netPrice: 5980 }]);
  });

  test('order discounts are shared again when a list price changes or a draft goes, and can be adjusted', async () => {
    const m = await signUpHousehold(ctx);
    const { recognition } = await setUp(m, {
      ...fixedRecognition,
      items: [
        { name: '得宝抽纸 M码', sizeText: '100抽', quantity: 18, listPrice: null, discounts: [] },
        { name: '皇家猫粮', sizeText: '2kg', quantity: 1, listPrice: 25900, discounts: [] },
        { name: '赠品', sizeText: null, quantity: 1, listPrice: 100, discounts: [] },
      ],
      orderDiscounts: [{ amount: 1500, name: '满 199 减 10' }, { amount: 500 }],
    });
    const [tissues, catFood, gift] = recognition.drafts;
    expect(recognition.drafts.map((d) => d.orderDiscount)).toEqual([null, null, null]);

    const priced = await edited(m, recognition, tissues!.id, { listPrice: 9900 });
    expect(priced.drafts.map((d) => d.orderDiscount)).toEqual([551, 1444, 5]);

    const adjusted = await edited(m, recognition, catFood!.id, { orderDiscount: 1450 });
    expect(adjusted.drafts.map((d) => d.orderDiscount)).toEqual([551, 1450, 5]);
    const renamed = await edited(m, recognition, tissues!.id, { name: '得宝抽纸 M 码' });
    expect(renamed.drafts.map((d) => d.orderDiscount)).toEqual([551, 1450, 5]);

    const res = await deleteDraft(m, recognition, gift!.id);
    expect(res.status).toBe(200);
    const remaining = (await res.json()) as Recognition;
    expect(remaining.drafts.map((d) => d.name)).toEqual(['得宝抽纸 M 码', '皇家猫粮']);
    expect(remaining.drafts.map((d) => d.orderDiscount)).toEqual([553, 1447]);
    expect(await read(m, recognition.id)).toEqual(remaining);
  });

  test('confirming writes every draft as a recognized price record with the screenshot as evidence', async () => {
    const m = await signUpHousehold(ctx);
    const { tissues, catFood, channel, recognition } = await setUp(m);
    expect(await lowestOf(m, tissues.id)).toBeNull();
    expect(await lowestOf(m, catFood.id)).toBeNull();

    const res = await confirm(m, recognition, { date: '2026-06-18', channelId: channel.id, purchased: true });
    expect(res.status).toBe(201);
    const { priceRecords } = (await res.json()) as { priceRecords: PriceRecord[] };
    expect(priceRecords.map((r) => r.productId)).toEqual([tissues.id, catFood.id]);

    const [tissueRecord] = await recordsOf(m, tissues.id);
    expect(tissueRecord).toMatchObject({
      date: '2026-06-18',
      channel: { id: channel.id },
      purchased: true,
      promotion: { name: '618' },
      listPrice: 9900,
      discounts: [{ amount: 1000, name: 'plus 券' }, { amount: 553, name: '满 199 减 20' }],
      quantity: 18,
      enteredSize: { amount: 100, unit: tissue },
      source: 'recognition',
      netPrice: 8347,
      recordedBy: { id: m.userId },
    });
    const [catFoodRecord] = await recordsOf(m, catFood.id);
    expect(catFoodRecord).toMatchObject({
      discounts: [{ amount: 1447, name: '满 199 减 20' }],
      enteredSize: { amount: 2, unit: { dimension: 'weight', name: 'kg' } },
      source: 'recognition',
      netPrice: 24453,
    });
    expect(priceRecords).toEqual([tissueRecord!, catFoodRecord!]);

    for (const record of [tissueRecord!, catFoodRecord!]) {
      expect(record.evidence).toEqual([
        { id: expect.any(String), contentType: 'image/png', size: screenshot(9, 9).length, createdAt: expect.any(String) },
      ]);
      const file = await m.request(`/api/evidence/${record.evidence[0]!.id}`);
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(screenshot(9, 9));
    }
    expect(await lowestOf(m, tissues.id)).toBeNumber();

    const done = await read(m, recognition.id);
    expect(done).toMatchObject({ status: 'succeeded', drafts: [], confirmedAt: expect.any(String) });
    expect((await screenshotOf(m, recognition.id)).bytes).toEqual(screenshot(9, 9));
  });

  test('a single draft that cannot be confirmed leaves no record behind', async () => {
    const m = await signUpHousehold(ctx);
    const { tissues, catFood, channel, recognition } = await setUp(m);
    const [first, second] = recognition.drafts;
    const body = { date: '2026-06-18', channelId: channel.id, purchased: false };

    await edited(m, recognition, second!.id, { size: { amount: 2, unit: tissue } });
    let res = await confirm(m, recognition, body);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'incompatible_unit', draftId: second!.id });

    await edited(m, recognition, second!.id, { size: { amount: 2, unit: { dimension: 'weight', name: 'kg' } } });
    await edited(m, recognition, second!.id, { quantity: null });
    res = await confirm(m, recognition, body);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'draft_incomplete', draftId: second!.id });

    await edited(m, recognition, second!.id, { quantity: 1, orderDiscount: 25900 });
    res = await confirm(m, recognition, body);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_price', draftId: second!.id });

    await edited(m, recognition, second!.id, { orderDiscount: 1447 });
    await edited(m, recognition, first!.id, { productId: null });
    res = await confirm(m, recognition, body);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'draft_incomplete', draftId: first!.id });

    expect(await recordsOf(m, tissues.id)).toEqual([]);
    expect(await recordsOf(m, catFood.id)).toEqual([]);
    expect((await read(m, recognition.id)).drafts).toHaveLength(2);
  });

  test('confirming checks the channel and promotion and needs at least one draft', async () => {
    const m = await signUpHousehold(ctx);
    const other = await signUpHousehold(ctx);
    const otherChannel = await created<{ id: string }>(
      await other.request('/api/channels', jsonRequest('POST', { name: unique('山姆') })),
    );
    const { channel, recognition } = await setUp(m);

    let res = await confirm(m, recognition, { date: '2026-06-18', channelId: otherChannel.id, purchased: true });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'channel_not_found' });

    res = await confirm(m, recognition, { date: '2026-06-18', channelId: channel.id, purchased: true, promotionId: 'x' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'promotion_not_found' });

    for (const draft of recognition.drafts) expect((await deleteDraft(m, recognition, draft.id)).status).toBe(200);
    res = await confirm(m, recognition, { date: '2026-06-18', channelId: channel.id, purchased: true });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'no_drafts' });
  });

  test('a recognition still being read cannot be confirmed', async () => {
    const m = await signUpHousehold(ctx);
    const channel = await created<{ id: string }>(
      await m.request('/api/channels', jsonRequest('POST', { name: unique('京东') })),
    );
    let answer!: () => void;
    recognizer.respond = () => new Promise((resolve) => (answer = () => resolve(fixedRecognition)));
    const started = await created<Recognition>(await upload(m, screenshot(10)));

    const res = await confirm(m, started, { date: '2026-06-18', channelId: channel.id, purchased: true });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'no_drafts' });
    answer();
    expect((await finished(m, started.id)).drafts).toHaveLength(2);
  });

  test('a confirmed recognition takes no more edits or confirmations', async () => {
    const m = await signUpHousehold(ctx);
    const { tissues, channel, recognition } = await setUp(m);
    const body = { date: '2026-06-18', channelId: channel.id, purchased: true, promotionId: null };
    expect((await confirm(m, recognition, body)).status).toBe(201);

    for (const res of [
      await confirm(m, recognition, body),
      await editDraft(m, recognition, recognition.drafts[0]!.id, { quantity: 1 }),
      await deleteDraft(m, recognition, recognition.drafts[0]!.id),
    ]) {
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'already_confirmed' });
    }
    expect(await recordsOf(m, tissues.id)).toMatchObject([{ promotion: null }]);
  });

  test('a draft cannot be given a product from another household', async () => {
    const m = await signUpHousehold(ctx);
    const other = await signUpHousehold(ctx);
    const { recognition } = await setUp(m);
    const foreign = await createProduct(other, (await createCategory(other)).id, '得宝抽纸', tissue, 90);

    const res = await editDraft(m, recognition, recognition.drafts[0]!.id, { productId: foreign.id });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'product_not_found' });
  });

  test("another household's members cannot edit, delete or confirm drafts", async () => {
    const m = await signUpHousehold(ctx);
    const other = await signUpHousehold(ctx);
    const { channel, recognition } = await setUp(m);
    const draftId = recognition.drafts[0]!.id;

    expect((await editDraft(other, recognition, draftId, { quantity: 1 })).status).toBe(404);
    expect((await deleteDraft(other, recognition, draftId)).status).toBe(404);
    expect((await confirm(other, recognition, { date: '2026-06-18', channelId: channel.id, purchased: true })).status).toBe(
      404,
    );
    expect(await read(m, recognition.id)).toEqual(recognition);
  });

  test('a draft of another recognition is not found', async () => {
    const m = await signUpHousehold(ctx);
    const first = (await setUp(m)).recognition;
    const second = (await setUp(m)).recognition;

    expect((await editDraft(m, first, second.drafts[0]!.id, { quantity: 1 })).status).toBe(404);
    expect((await deleteDraft(m, first, second.drafts[0]!.id)).status).toBe(404);
  });

  test('drafts follow a merge and are confirmed under the kept product', async () => {
    const m = await signUpHousehold(ctx);
    const { category, tissues, channel, recognition } = await setUp(m);
    const kept = await createProduct(m, category.id, unique('得宝'), tissue, 90);
    const merge = await m.request(`/api/products/${kept.id}/merge`, jsonRequest('POST', { productId: tissues.id }));
    expect(merge.status).toBe(200);

    expect((await confirm(m, recognition, { date: '2026-06-18', channelId: channel.id, purchased: true })).status).toBe(
      201,
    );
    expect(await recordsOf(m, kept.id)).toMatchObject([{ listPrice: 9900, enteredSize: { amount: 100, unit: tissue } }]);
  });
});

describe('recognitions without a recognizer', () => {
  const ctx = useTestApp();

  test('fail straight away and keep the screenshot for manual entry', async () => {
    const m = await signUpHousehold(ctx);
    const bytes = screenshot(8);

    const started = await created<Recognition>(await upload(m, bytes));
    expect(started).toMatchObject({ status: 'failed', error: 'recognition_unavailable', drafts: [] });
    expect(await read(m, started.id)).toEqual(started);
    expect((await screenshotOf(m, started.id)).bytes).toEqual(bytes);
  });
});
