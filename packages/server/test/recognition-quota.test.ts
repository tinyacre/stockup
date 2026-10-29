import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { localDate } from '@stockup/domain';
import { fakeRecognizerFactory, fixedRecognition, instanceRecognizer } from './support/fake-recognizer';
import { joinHousehold, signUpHousehold, useTestApp } from './support/harness';
import { finished, recognize, screenshot, startRecognition, statusOf } from './support/recognitions';

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
      householdCredentials: false,
      credential: null,
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

  test('a recognition that finds nothing on the screenshot gives its turn back', async () => {
    const m = await signUpHousehold(ctx);
    recognizer.respond = async () => ({ items: [], orderDiscounts: [], date: null, channel: null });
    expect(await recognize(m)).toMatchObject({ status: 'succeeded', drafts: [] });
    expect(await statusOf(m)).toMatchObject({ available: true, quota: { used: 0 } });
  });

  test('a recognition keeps its turn once its drafts are gone', async () => {
    const m = await signUpHousehold(ctx);
    const { id } = await recognize(m);
    const { drafts } = (await (await m.request(`/api/recognitions/${id}`)).json()) as { drafts: { id: string }[] };
    for (const draft of drafts) {
      expect((await m.request(`/api/recognitions/${id}/drafts/${draft.id}`, { method: 'DELETE' })).status).toBe(200);
    }
    expect(await statusOf(m)).toMatchObject({ quota: { used: 1 } });
  });

  test('a recognition still running holds its turn', async () => {
    const m = await signUpHousehold(ctx);
    let answer!: () => void;
    recognizer.respond = () => new Promise((resolve) => (answer = () => resolve(fixedRecognition)));
    const running = await startRecognition(m);
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
    const refused = await startRecognition(m, bytes);
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
    expect((await startRecognition(housemate)).error).toBe('recognition_quota_exhausted');
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
