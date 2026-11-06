import { afterEach, describe, expect, test } from 'bun:test';
import { DrizzleQueryError, sql } from 'drizzle-orm';
import { errorReporter } from '../src/error-reports';
import type { EvidenceStore } from '../src/evidence-store';
import { readAnswer } from '../src/recognition-answer';
import { RecognizerCallError } from '../src/recognizer';
import { fakeGlitchtip } from './support/fake-glitchtip';
import { fakeRecognizerFactory, fixedRecognition, instanceRecognition } from './support/fake-recognizer';
import { signUpHousehold, useTestApp } from './support/harness';
import { finished, startRecognition } from './support/recognitions';

const dsn = 'https://0123abcd@errors.example.com/5';

// Keeps files in memory and throws `readFailure` on reads while it is set, the way a broken disk or bucket would.
function evidenceThatFailsToRead() {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const store = {
    readFailure: undefined as Error | undefined,
    async put(key: string, data: Uint8Array) {
      files.set(key, new Uint8Array(data));
    },
    async get(key: string) {
      if (store.readFailure) throw store.readFailure;
      return files.get(key) ?? null;
    },
    async delete(key: string) {
      files.delete(key);
    },
  } satisfies EvidenceStore & { readFailure: Error | undefined };
  return store;
}

const allowedFrameFields = ['colno', 'filename', 'function', 'in_app', 'lineno'];

describe('server error reports', () => {
  const glitchtip = fakeGlitchtip();
  const reporter = errorReporter({ dsn, release: '1.4.0', fetch: glitchtip.fetch })!;
  const evidence = evidenceThatFailsToRead();
  const recognizers = fakeRecognizerFactory();
  const ctx = useTestApp({ errorReporter: reporter, evidenceStore: evidence, recognizers, instanceRecognition });

  async function delivered() {
    await reporter.flush(2000);
    return glitchtip.events.splice(0);
  }

  afterEach(() => {
    evidence.readFailure = undefined;
    recognizers.recognizer.respond = async () => fixedRecognition;
  });

  test('a failed request reports only its route template, method, status, release, message and stack', async () => {
    const m = await signUpHousehold(ctx);
    const { id } = await startRecognition(m);
    await finished(m, id);
    evidence.readFailure = new Error('Could not read the evidence of bob@example.com');

    const res = await m.request(`/api/recognitions/${id}/screenshot?token=secret`);

    expect(res.status).toBe(500);
    const [event, ...more] = await delivered();
    expect(more).toEqual([]);
    const { sdk, ...kept } = event!;
    expect(sdk).toBeDefined();
    expect(kept).toEqual({
      event_id: expect.any(String),
      timestamp: expect.any(Number),
      level: 'error',
      platform: expect.any(String),
      release: '1.4.0',
      transaction: 'GET /api/recognitions/:id/screenshot',
      tags: { 'http.method': 'GET', 'http.status_code': '500' },
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Could not read the evidence of [email]',
            stacktrace: { frames: expect.any(Array) },
          },
        ],
      },
    });
    const { frames } = (kept.exception as { values: [{ stacktrace: { frames: Record<string, unknown>[] } }] }).values[0]
      .stacktrace;
    for (const frame of frames) expect(allowedFrameFields).toEqual(expect.arrayContaining(Object.keys(frame)));
    expect(frames).toContainEqual(
      expect.objectContaining({ filename: 'packages/server/test/error-reports.test.ts', in_app: true }),
    );
    expect(glitchtip.urls).toEqual([expect.stringMatching(/^https:\/\/errors\.example\.com\/api\/5\/envelope\//)]);
  });

  test("a failed query reports its SQL and SQLSTATE, never its parameters or the database's message", async () => {
    const m = await signUpHousehold(ctx);
    const { id } = await startRecognition(m);
    await finished(m, id);
    const cause = Object.assign(new Error('invalid input syntax for type integer: "得宝抽纸"'), { code: '22P02' });
    evidence.readFailure = new DrizzleQueryError(
      'update "product" set "name" = $1 where "id" = $2',
      ['得宝抽纸', id],
      cause,
    );

    expect((await m.request(`/api/recognitions/${id}/screenshot`)).status).toBe(500);

    const [event] = await delivered();
    expect(event).toMatchObject({
      exception: {
        values: [{ value: 'Failed query: update "product" set "name" = $1 where "id" = $2 (SQLSTATE 22P02)' }],
      },
    });
    expect(JSON.stringify(event)).not.toContain('得宝抽纸');
  });

  test('a request refused with a 4xx reports nothing', async () => {
    const m = await signUpHousehold(ctx);

    expect((await m.request(`/api/recognitions/${crypto.randomUUID()}`)).status).toBe(404);

    expect(await delivered()).toEqual([]);
  });

  test('a recognition whose drafts cannot be saved reports it as a task', async () => {
    const m = await signUpHousehold(ctx);
    const { db } = ctx.database;
    await db.execute(sql.raw('ALTER TABLE "recognition_draft" ADD CONSTRAINT refuse_all CHECK (false) NOT VALID'));
    try {
      const { id } = await startRecognition(m);
      expect((await finished(m, id)).status).toBe('failed');
    } finally {
      await db.execute(sql.raw('ALTER TABLE "recognition_draft" DROP CONSTRAINT refuse_all'));
    }

    const [event, ...more] = await delivered();
    expect(more).toEqual([]);
    expect(event).toMatchObject({
      transaction: 'task recognition',
      tags: { task: 'recognition' },
      exception: { values: [{ value: expect.stringContaining('insert into "recognition_draft"') }] },
    });
  });

  test("a model's refusal of a screenshot reports nothing", async () => {
    const m = await signUpHousehold(ctx);
    recognizers.recognizer.respond = async () => {
      throw new Error('The model refused: the screenshot shows 得宝抽纸 delivered to 上海市长宁区');
    };

    const { id } = await startRecognition(m);
    expect((await finished(m, id)).status).toBe('failed');

    expect(await delivered()).toEqual([]);
  });

  test("a model's malformed answer reports nothing", async () => {
    const m = await signUpHousehold(ctx);
    recognizers.recognizer.respond = async () => readAnswer('{"items": [{"name": "得宝抽纸", "quantity": "十八"}]}');

    const { id } = await startRecognition(m);
    expect((await finished(m, id)).status).toBe('failed');

    expect(await delivered()).toEqual([]);
  });

  test("a provider's refusal of a recognition reports nothing", async () => {
    const m = await signUpHousehold(ctx);
    recognizers.recognizer.respond = async () => {
      throw new RecognizerCallError('401 invalid x-api-key');
    };

    const { id } = await startRecognition(m);
    expect((await finished(m, id)).status).toBe('failed');

    expect(await delivered()).toEqual([]);
  });
});

test('nothing is reported without a DSN', () => {
  expect(errorReporter({ dsn: undefined, release: '1.4.0' })).toBeUndefined();
});
