import { describe, expect, test } from 'bun:test';
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
