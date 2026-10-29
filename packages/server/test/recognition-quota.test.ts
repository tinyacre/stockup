import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { fakeRecognizerFactory, fixedRecognition, instanceRecognizer } from './support/fake-recognizer';
import { joinHousehold, signUpHousehold, useTestApp, type SignedInMember } from './support/harness';

interface RecognitionStatus {
  available: boolean;
  source: 'instance' | null;
  quota: { monthly: number; used: number; resetsOn: string } | null;
  householdAdmin: boolean;
}

interface Recognition {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  error: string | null;
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function screenshot(...rest: number[]) {
  return new Uint8Array([...pngSignature, ...rest]);
}

async function upload(m: SignedInMember, bytes = screenshot()) {
  const form = new FormData();
  form.append('file', new File([bytes], 'order.png', { type: 'image/png' }));
  const res = await m.request('/api/recognitions', { method: 'POST', body: form });
  expect(res.status).toBe(201);
  return (await res.json()) as Recognition;
}

async function finished(m: SignedInMember, id: string) {
  for (let i = 0; i < 200; i++) {
    const recognition = (await (await m.request(`/api/recognitions/${id}`)).json()) as Recognition;
    if (recognition.status !== 'pending') return recognition;
    await Bun.sleep(10);
  }
  throw new Error(`recognition ${id} is still pending`);
}

async function recognize(m: SignedInMember) {
  return finished(m, (await upload(m)).id);
}

async function statusOf(m: SignedInMember) {
  const res = await m.request('/api/recognizer');
  expect(res.status).toBe(200);
  return (await res.json()) as RecognitionStatus;
}

function localDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthStart(offset: number) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, 1);
}

describe('the monthly recognition quota', () => {
  const recognizers = fakeRecognizerFactory();
  const { recognizer } = recognizers;
  const ctx = useTestApp({ recognizers, instanceRecognition: { recognizer: instanceRecognizer, monthlyQuota: 2 } });

  afterEach(() => {
    recognizer.respond = async () => fixedRecognition;
    setSystemTime();
  });

  test('a new household has the whole quota until the first of next month', async () => {
    const m = await signUpHousehold(ctx);
    expect(await statusOf(m)).toEqual({
      available: true,
      source: 'instance',
      quota: { monthly: 2, used: 0, resetsOn: localDate(monthStart(1)) },
      householdAdmin: true,
    });
  });

  test('each successful recognition uses one, and a failed one none', async () => {
    const m = await signUpHousehold(ctx);
    expect((await recognize(m)).status).toBe('succeeded');
    expect((await statusOf(m)).quota).toMatchObject({ used: 1 });

    recognizer.respond = async () => {
      throw new Error('model unavailable');
    };
    expect(await recognize(m)).toMatchObject({ status: 'failed', error: 'recognition_failed' });
    expect(await statusOf(m)).toMatchObject({ available: true, quota: { used: 1 } });
  });

  test('a recognition still running holds its turn', async () => {
    const m = await signUpHousehold(ctx);
    let answer!: () => void;
    recognizer.respond = () => new Promise((resolve) => (answer = () => resolve(fixedRecognition)));
    const running = await upload(m);
    expect((await statusOf(m)).quota).toMatchObject({ used: 1 });

    answer();
    await finished(m, running.id);
    expect((await statusOf(m)).quota).toMatchObject({ used: 1 });
  });

  test('once used up, recognitions fail at once and keep the screenshot', async () => {
    const m = await signUpHousehold(ctx);
    await recognize(m);
    await recognize(m);
    expect(await statusOf(m)).toMatchObject({ available: false, source: 'instance', quota: { monthly: 2, used: 2 } });

    const seen = recognizer.screenshots.length;
    const bytes = screenshot(9);
    const refused = await upload(m, bytes);
    expect(refused).toMatchObject({ status: 'failed', error: 'recognition_quota_exhausted' });
    expect(recognizer.screenshots).toHaveLength(seen);
    const kept = await m.request(`/api/recognitions/${refused.id}/screenshot`);
    expect(new Uint8Array(await kept.arrayBuffer())).toEqual(bytes);
    expect((await statusOf(m)).quota).toMatchObject({ used: 2 });
  });

  test("one household using up its quota leaves another's untouched", async () => {
    const spent = await signUpHousehold(ctx);
    const other = await signUpHousehold(ctx);
    await recognize(spent);
    await recognize(spent);

    expect(await statusOf(other)).toMatchObject({ available: true, quota: { used: 0 } });
    expect((await recognize(other)).status).toBe('succeeded');
  });

  test('is shared by the household and reports who is its admin', async () => {
    const admin = await signUpHousehold(ctx);
    const housemate = await joinHousehold(ctx, admin);
    await recognize(admin);
    await recognize(housemate);

    expect(await statusOf(housemate)).toMatchObject({ available: false, quota: { used: 2 }, householdAdmin: false });
    expect((await upload(housemate)).error).toBe('recognition_quota_exhausted');
  });

  test('starts over on the first of the month', async () => {
    const m = await signUpHousehold(ctx);
    const thisMonth = monthStart(0);
    setSystemTime(new Date(thisMonth.getTime() - 60_000));
    await recognize(m);
    await recognize(m);
    expect(await statusOf(m)).toMatchObject({
      available: false,
      quota: { used: 2, resetsOn: localDate(thisMonth) },
    });

    setSystemTime(thisMonth);
    expect(await statusOf(m)).toMatchObject({
      available: true,
      quota: { used: 0, resetsOn: localDate(monthStart(1)) },
    });
    expect((await recognize(m)).status).toBe('succeeded');
  });
});

describe('a monthly quota of 0', () => {
  const recognizers = fakeRecognizerFactory();
  const ctx = useTestApp({ recognizers, instanceRecognition: { recognizer: instanceRecognizer, monthlyQuota: 0 } });

  test('offers no recognition on the instance provider', async () => {
    const m = await signUpHousehold(ctx);
    expect(await statusOf(m)).toEqual({ available: false, source: null, quota: null, householdAdmin: true });
    expect((await upload(m)).error).toBe('recognition_unavailable');
    expect(recognizers.recognizer.screenshots).toHaveLength(0);
  });
});
