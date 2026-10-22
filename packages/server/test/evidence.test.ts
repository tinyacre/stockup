import { describe, expect, test } from 'bun:test';
import { jsonRequest, signUpHousehold, useTestApp, type SignedInMember, type TestContext } from './support/harness';

const ctx = useTestApp();

interface Evidence {
  id: string;
  contentType: string;
  size: number;
  createdAt: string;
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const jpegSignature = [0xff, 0xd8, 0xff, 0xe0];

function image(signature: number[], ...rest: number[]) {
  return new Uint8Array([...signature, ...rest]);
}

async function created<T>(res: Response): Promise<T> {
  expect(res.status).toBe(201);
  return (await res.json()) as T;
}

// A price record for a fresh product and channel in the member's household.
async function createRecord(m: SignedInMember) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const group = await created<{ id: string }>(
    await m.request('/api/category-groups', jsonRequest('POST', { name: `生活用品 ${suffix}` })),
  );
  const category = await created<{ id: string }>(
    await m.request('/api/categories', jsonRequest('POST', { name: `抽纸 ${suffix}`, categoryGroupId: group.id })),
  );
  const product = await created<{ id: string }>(
    await m.request(
      '/api/products',
      jsonRequest('POST', {
        categoryId: category.id,
        name: `得宝抽纸 ${suffix}`,
        pricingUnit: { dimension: 'count', name: '抽' },
        baseSize: 90,
      }),
    ),
  );
  const channel = await created<{ id: string }>(
    await m.request('/api/channels', jsonRequest('POST', { name: `京东 ${suffix}` })),
  );
  return created<{ id: string; evidence: Evidence[] }>(
    await m.request(
      '/api/price-records',
      jsonRequest('POST', {
        productId: product.id,
        channelId: channel.id,
        date: '2026-06-18',
        purchased: true,
        listPrice: 9900,
        discounts: [],
        quantity: 18,
        size: { amount: 130, unit: { dimension: 'count', name: '抽' } },
      }),
    ),
  );
}

function upload(m: SignedInMember, recordId: string, files: { bytes: Uint8Array; name: string; type?: string }[]) {
  const form = new FormData();
  for (const f of files) form.append('files', new File([f.bytes], f.name, { type: f.type ?? 'image/png' }));
  return m.request(`/api/price-records/${recordId}/evidence`, { method: 'POST', body: form });
}

async function evidenceOf(m: SignedInMember, recordId: string) {
  const res = await m.request(`/api/price-records/${recordId}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { evidence: Evidence[] }).evidence;
}

async function stored(ctx: TestContext, id: string) {
  return (await ctx.evidence.get(id)) !== null;
}

describe('evidence', () => {
  test('a new price record has none', async () => {
    const m = await signUpHousehold(ctx);
    const record = await createRecord(m);
    expect(record.evidence).toEqual([]);
  });

  test('the content type comes from the file itself, not the upload', async () => {
    const m = await signUpHousehold(ctx);
    const record = await createRecord(m);
    const [evidence] = await created<Evidence[]>(
      await upload(m, record.id, [{ bytes: image(pngSignature, 1), name: 'shot.jpg', type: 'image/jpeg' }]),
    );
    expect(evidence!.contentType).toBe('image/png');
  });

  test('files that are not PNG, JPEG, WebP or GIF images are rejected', async () => {
    const m = await signUpHousehold(ctx);
    const record = await createRecord(m);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    const res = await upload(m, record.id, [
      { bytes: image(pngSignature, 1), name: 'ok.png' },
      { bytes: svg, name: 'evil.svg', type: 'image/svg+xml' },
    ]);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'unsupported_evidence_type' });
    expect(await evidenceOf(m, record.id)).toEqual([]);
  });

  test('files over 10 MB are rejected', async () => {
    const m = await signUpHousehold(ctx);
    const record = await createRecord(m);
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(pngSignature);

    const res = await upload(m, record.id, [{ bytes: big, name: 'big.png' }]);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'evidence_too_large' });
    expect(await evidenceOf(m, record.id)).toEqual([]);
  });

  test('an upload without files is rejected', async () => {
    const m = await signUpHousehold(ctx);
    const record = await createRecord(m);
    expect((await upload(m, record.id, [])).status).toBe(400);
  });

  test('uploading to a price record that does not exist fails', async () => {
    const m = await signUpHousehold(ctx);
    const res = await upload(m, crypto.randomUUID(), [{ bytes: image(pngSignature), name: 'a.png' }]);
    expect(res.status).toBe(404);
  });

  test('a single piece is deleted, file included', async () => {
    const m = await signUpHousehold(ctx);
    const record = await createRecord(m);
    const [kept, removed] = await created<Evidence[]>(
      await upload(m, record.id, [
        { bytes: image(pngSignature, 1), name: 'a.png' },
        { bytes: image(pngSignature, 2), name: 'b.png' },
      ]),
    );
    expect(await stored(ctx, removed!.id)).toBe(true);

    expect((await m.request(`/api/evidence/${removed!.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await stored(ctx, removed!.id)).toBe(false);
    expect((await m.request(`/api/evidence/${removed!.id}`)).status).toBe(404);
    expect((await m.request(`/api/evidence/${removed!.id}`, { method: 'DELETE' })).status).toBe(404);
    expect(await evidenceOf(m, record.id)).toEqual([kept!]);
  });

  test('deleting a price record deletes its evidence', async () => {
    const m = await signUpHousehold(ctx);
    const record = await createRecord(m);
    const uploaded = await created<Evidence[]>(
      await upload(m, record.id, [
        { bytes: image(pngSignature, 1), name: 'a.png' },
        { bytes: image(jpegSignature, 2), name: 'b.jpg' },
      ]),
    );

    expect((await m.request(`/api/price-records/${record.id}`, { method: 'DELETE' })).status).toBe(204);
    for (const { id } of uploaded) {
      expect(await stored(ctx, id)).toBe(false);
      expect((await m.request(`/api/evidence/${id}`)).status).toBe(404);
    }
  });
});

describe('evidence isolation', () => {
  test('evidence requires a signed-in member', async () => {
    const owner = await signUpHousehold(ctx);
    const record = await createRecord(owner);
    const [evidence] = await created<Evidence[]>(
      await upload(owner, record.id, [{ bytes: image(pngSignature, 1), name: 'a.png' }]),
    );

    expect((await ctx.app.request(`/api/evidence/${evidence!.id}`)).status).toBe(401);
    expect((await ctx.app.request(`/api/evidence/${evidence!.id}`, { method: 'DELETE' })).status).toBe(401);
    const form = new FormData();
    form.append('files', new File([image(pngSignature)], 'a.png', { type: 'image/png' }));
    const res = await ctx.app.request(`/api/price-records/${record.id}/evidence`, { method: 'POST', body: form });
    expect(res.status).toBe(401);
  });
});

// Serving and guarding evidence over HTTP runs on both stores, so S3 is covered end to end, not only at the store interface.
for (const kind of ['local', 's3'] as const) {
  describe(`evidence in the ${kind} store`, () => {
    const ctx = useTestApp({ evidenceStore: kind });

    test('one or more screenshots are uploaded to a price record and shown in its detail', async () => {
      const m = await signUpHousehold(ctx);
      const record = await createRecord(m);
      const order = image(pngSignature, 1, 2, 3);
      const page = image(jpegSignature, 4, 5);

      const uploaded = await created<Evidence[]>(
        await upload(m, record.id, [
          { bytes: order, name: 'order.png' },
          { bytes: page, name: 'page.jpg', type: 'image/jpeg' },
        ]),
      );
      expect(uploaded).toEqual([
        { id: expect.any(String), contentType: 'image/png', size: order.length, createdAt: expect.any(String) },
        { id: expect.any(String), contentType: 'image/jpeg', size: page.length, createdAt: expect.any(String) },
      ]);
      expect(await evidenceOf(m, record.id)).toEqual(uploaded);

      const more = await created<Evidence[]>(await upload(m, record.id, [{ bytes: order, name: 'again.png' }]));
      expect(await evidenceOf(m, record.id)).toEqual([...uploaded, ...more]);

      const read = await m.request(`/api/evidence/${uploaded[1]!.id}`);
      expect(read.status).toBe(200);
      expect(read.headers.get('content-type')).toBe('image/jpeg');
      expect(read.headers.get('x-content-type-options')).toBe('nosniff');
      expect(new Uint8Array(await read.arrayBuffer())).toEqual(page);
    });

    test("another household's members cannot upload, read or delete it", async () => {
      const owner = await signUpHousehold(ctx);
      const other = await signUpHousehold(ctx);
      const record = await createRecord(owner);
      const [evidence] = await created<Evidence[]>(
        await upload(owner, record.id, [{ bytes: image(pngSignature, 1), name: 'a.png' }]),
      );

      expect((await upload(other, record.id, [{ bytes: image(pngSignature), name: 'b.png' }])).status).toBe(404);
      expect((await other.request(`/api/evidence/${evidence!.id}`)).status).toBe(404);
      expect((await other.request(`/api/evidence/${evidence!.id}`, { method: 'DELETE' })).status).toBe(404);

      expect(await stored(ctx, evidence!.id)).toBe(true);
      expect(await evidenceOf(owner, record.id)).toEqual([evidence!]);
    });
  });
}
