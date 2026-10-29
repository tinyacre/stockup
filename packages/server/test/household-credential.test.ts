import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { publicOnly, type Fetch, type ResolveHost } from '../src/public-endpoint';
import { RecognizerCallError, type RecognizerConfig } from '../src/recognizer';
import { providerRecognizers } from '../src/recognizer-factory';
import { fakeRecognizer, fakeRecognizerFactory, fixedRecognition, instanceRecognizer } from './support/fake-recognizer';
import {
  joinHousehold,
  jsonRequest,
  requestAs,
  signUpHousehold,
  useTestApp,
  type SignedInMember,
  type TestContext,
} from './support/harness';
import { recognize, startRecognition, statusOf, type RecognitionCredential } from './support/recognitions';

const encryptionKey = Buffer.alloc(32, 1);
const householdKey = 'sk-household-0123456789-wxyz';
const openRouter = {
  provider: 'openai',
  apiKey: householdKey,
  baseURL: 'https://openrouter.ai/api/v1',
  model: 'google/gemini-3-flash',
} as const;

function saveCredential(m: SignedInMember, body: object = openRouter) {
  return m.request('/api/household/recognition-credential', jsonRequest('PUT', body));
}

function deleteCredential(m: SignedInMember) {
  return m.request('/api/household/recognition-credential', { method: 'DELETE' });
}

// Gives the instance's configuration and households' configurations recognizers of their own, so a test can tell
// which one read a screenshot.
function recognizersByKey() {
  const instance = fakeRecognizer();
  const household = fakeRecognizer();
  const recognizers = fakeRecognizerFactory();
  recognizers.create = (config: RecognizerConfig) => {
    recognizers.created.push(config);
    return config.apiKey === instanceRecognizer.apiKey ? instance : household;
  };
  return { recognizers, instance, household };
}

describe("a household's own recognition credential", () => {
  const { recognizers, instance, household } = recognizersByKey();
  const ctx = useTestApp({
    recognizers,
    householdRecognizers: recognizers,
    instanceRecognition: { recognizer: instanceRecognizer, monthlyQuota: 1 },
    encryptionKey,
  });

  afterEach(() => {
    recognizers.validation = { ok: true };
    household.respond = async () => fixedRecognition;
  });

  test('the household admin saves one after the provider accepts it, and sees only its last four characters', async () => {
    const admin = await signUpHousehold(ctx);
    const res = await saveCredential(admin);
    expect(res.status).toBe(200);
    const saved = (await res.json()) as RecognitionCredential;
    expect(saved).toEqual({
      provider: 'openai',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-3-flash',
      apiKeyLastFour: 'wxyz',
      updatedAt: expect.any(String),
      updatedBy: { id: admin.userId, name: admin.name },
    });
    expect(recognizers.validated.at(-1)).toEqual(openRouter);

    const status = await statusOf(admin);
    expect(status).toEqual({
      available: true,
      source: 'household',
      quota: null,
      householdAdmin: true,
      householdCredentials: true,
      credential: saved,
    });
    expect(JSON.stringify(status)).not.toContain(householdKey);
  });

  test('keeps no plaintext key in the database', async () => {
    const admin = await signUpHousehold(ctx);
    expect((await saveCredential(admin)).status).toBe(200);
    const rows = await ctx.database.db.execute<{ row: string }>(
      sql`select row_to_json(c)::text as row from household_recognition_credential c where household_id = ${admin.householdId}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.row).not.toContain(householdKey.slice(0, -4));
  });

  test('a provider default and its own endpoint stand in for an empty model and base URL', async () => {
    const admin = await signUpHousehold(ctx);
    const res = await saveCredential(admin, {
      provider: 'anthropic',
      apiKey: 'sk-ant-own-1234',
      baseURL: '',
      model: '',
    });
    expect(await res.json()).toMatchObject({
      provider: 'anthropic',
      baseURL: null,
      model: null,
      apiKeyLastFour: '1234',
    });
    expect(recognizers.validated.at(-1)).toEqual({ provider: 'anthropic', apiKey: 'sk-ant-own-1234' });
  });

  test("is refused with the kind of reason, not the provider's words, when the provider turns it down", async () => {
    const admin = await signUpHousehold(ctx);
    recognizers.validation = { ok: false, problem: 'authentication_failed', message: 'invalid x-api-key' };
    const res = await saveCredential(admin);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'credential_rejected', problem: 'authentication_failed' });
    expect(await statusOf(admin)).toMatchObject({ source: 'instance', credential: null });
  });

  test('refuses a base URL that is not https and a key too short to mask', async () => {
    const admin = await signUpHousehold(ctx);
    expect((await saveCredential(admin, { ...openRouter, baseURL: 'ftp://openrouter.ai' })).status).toBe(400);
    expect((await saveCredential(admin, { ...openRouter, baseURL: 'http://openrouter.ai/api/v1' })).status).toBe(400);
    expect((await saveCredential(admin, { ...openRouter, apiKey: 'sk-1234' })).status).toBe(400);
    expect((await saveCredential(admin, { ...openRouter, provider: 'gemini' })).status).toBe(400);
  });

  test('is replaced by saving another', async () => {
    const admin = await signUpHousehold(ctx);
    await saveCredential(admin);
    const res = await saveCredential(admin, { provider: 'anthropic', apiKey: 'sk-ant-replaced-9876' });
    expect(res.status).toBe(200);
    expect((await statusOf(admin)).credential).toMatchObject({
      provider: 'anthropic',
      baseURL: null,
      model: null,
      apiKeyLastFour: '9876',
    });
  });

  test('members other than the admin can neither set nor delete it, nor see any of it', async () => {
    const admin = await signUpHousehold(ctx);
    const housemate = await joinHousehold(ctx, admin);
    expect((await saveCredential(housemate)).status).toBe(403);
    expect(await statusOf(admin)).toMatchObject({ source: 'instance', credential: null });

    await saveCredential(admin);
    expect(await saveCredential(housemate).then((r) => r.json())).toEqual({ error: 'forbidden' });
    expect((await deleteCredential(housemate)).status).toBe(403);
    const status = await statusOf(housemate);
    expect(status).toEqual({
      available: true,
      source: 'household',
      quota: null,
      householdAdmin: false,
      householdCredentials: true,
      credential: null,
    });
  });

  test("recognizes the whole household's screenshots without counting against the quota", async () => {
    const admin = await signUpHousehold(ctx);
    const housemate = await joinHousehold(ctx, admin);
    await saveCredential(admin);
    const seen = household.screenshots.length;

    expect((await recognize(admin)).status).toBe('succeeded');
    expect((await recognize(housemate)).status).toBe('succeeded');
    expect(household.screenshots).toHaveLength(seen + 2);
    expect(recognizers.created.at(-1)).toEqual(openRouter);

    expect((await deleteCredential(admin)).status).toBe(204);
    expect(await statusOf(housemate)).toMatchObject({ available: true, source: 'instance', quota: { used: 0 } });
  });

  test('a key that stops working fails the recognition rather than using the instance provider', async () => {
    const admin = await signUpHousehold(ctx);
    await saveCredential(admin);
    household.respond = async () => {
      throw new RecognizerCallError('invalid x-api-key');
    };
    const seen = instance.screenshots.length;

    expect(await recognize(admin)).toMatchObject({ status: 'failed', error: 'household_key_unavailable' });
    expect(instance.screenshots).toHaveLength(seen);
    expect(await statusOf(admin)).toMatchObject({ available: true, source: 'household' });
  });

  test('an answer it cannot read fails as any recognition does', async () => {
    const admin = await signUpHousehold(ctx);
    await saveCredential(admin);
    household.respond = async () => {
      throw new Error('The model stopped with max_tokens');
    };
    expect(await recognize(admin)).toMatchObject({ status: 'failed', error: 'recognition_failed' });
  });

  test('deleting it goes back to the instance quota, and deleting none is no error', async () => {
    const admin = await signUpHousehold(ctx);
    await saveCredential(admin);
    expect((await deleteCredential(admin)).status).toBe(204);
    expect(await statusOf(admin)).toMatchObject({ source: 'instance', quota: { monthly: 1 }, credential: null });
    expect((await deleteCredential(admin)).status).toBe(204);

    const seen = instance.screenshots.length;
    expect((await recognize(admin)).status).toBe('succeeded');
    expect(instance.screenshots).toHaveLength(seen + 1);
  });

  test('sealed with another encryption key, it is unavailable rather than replaced by the instance provider', async () => {
    const admin = await signUpHousehold(ctx);
    await saveCredential(admin);
    const restarted = withApp(
      ctx,
      createApp({
        db: ctx.database.db,
        auth: ctx.auth,
        evidence: ctx.evidence,
        recognizers,
        householdRecognizers: recognizers,
        instanceRecognition: { recognizer: instanceRecognizer, monthlyQuota: 1 },
        encryptionKey: Buffer.alloc(32, 2),
      }),
      admin,
    );
    const seen = instance.screenshots.length;

    expect(await statusOf(restarted)).toMatchObject({ available: false, source: 'household', quota: null });
    expect((await startRecognition(restarted)).error).toBe('household_key_unavailable');
    expect(instance.screenshots).toHaveLength(seen);

    expect((await saveCredential(restarted)).status).toBe(200);
    expect((await recognize(restarted)).status).toBe('succeeded');
  });
});

function withApp(ctx: TestContext, app: TestContext['app'], m: SignedInMember): SignedInMember {
  return { ...m, request: (path, init) => requestAs({ ...ctx, app }, m.cookie, path, init) };
}

describe('without an encryption key', () => {
  const recognizers = fakeRecognizerFactory();
  const ctx = useTestApp({ recognizers, instanceRecognition: { recognizer: instanceRecognizer, monthlyQuota: 1 } });

  test('households cannot configure a credential of their own', async () => {
    const admin = await signUpHousehold(ctx);
    for (const res of [await saveCredential(admin), await deleteCredential(admin)]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'household_credentials_unavailable' });
    }
    expect(recognizers.validated).toHaveLength(0);
    expect(await statusOf(admin)).toMatchObject({
      source: 'instance',
      householdCredentials: false,
      credential: null,
    });
  });
});

describe("households' recognizers by default", () => {
  const recognizers = fakeRecognizerFactory();
  const ctx = useTestApp({
    recognizers,
    instanceRecognition: { recognizer: instanceRecognizer, monthlyQuota: 1 },
    encryptionKey,
  });

  test('refuse a base URL at a non-public address, whatever serves the instance', async () => {
    const admin = await signUpHousehold(ctx);
    const res = await saveCredential(admin, { ...openRouter, baseURL: 'https://127.0.0.1:1/v1' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'credential_rejected', problem: 'endpoint_not_public' });
    expect(recognizers.validated).toHaveLength(0);
  });
});

describe("calling a household's own provider", () => {
  // DNS as a test sets it, and every request the providers would have received.
  const addresses = new Map<string, string[]>();
  const requests: { url: string; redirect: RequestInit['redirect'] }[] = [];
  const reply = {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'google/gemini-3-flash',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(fixedRecognition), refusal: null },
        finish_reason: 'stop',
      },
    ],
  };
  const fetch: Fetch = async (url, init) => {
    requests.push({ url: String(url), redirect: init?.redirect });
    return Response.json(reply);
  };
  const resolve: ResolveHost = async (hostname) => {
    const found = addresses.get(hostname);
    if (!found) throw new Error(`getaddrinfo ENOTFOUND ${hostname}`);
    return found;
  };
  const ctx = useTestApp({
    householdRecognizers: providerRecognizers({ fetch: publicOnly(fetch, resolve) }),
    instanceRecognition: { recognizer: instanceRecognizer, monthlyQuota: 1 },
    encryptionKey,
  });

  afterEach(() => {
    addresses.clear();
    requests.length = 0;
  });

  test.each([
    ['loopback', 'https://gateway.example/v1', ['127.0.0.1']],
    ['private', 'https://gateway.example/v1', ['93.184.215.14', '10.0.0.7']],
    ['cloud metadata', 'https://gateway.example/v1', ['169.254.169.254']],
    ['carrier-grade NAT', 'https://gateway.example/v1', ['100.64.1.1']],
    ['unique local IPv6', 'https://gateway.example/v1', ['fd12:3456::1']],
    ['IPv4-mapped loopback', 'https://gateway.example/v1', ['::ffff:127.0.0.1']],
    ['literal private', 'https://192.168.1.1/v1', []],
    ['literal IPv6 loopback', 'https://[::1]/v1', []],
    ['unspecified', 'https://0.0.0.0/v1', []],
  ])('refuses a base URL at a %s address without calling it', async (_, baseURL, resolved) => {
    addresses.set('gateway.example', resolved);
    const admin = await signUpHousehold(ctx);
    const res = await saveCredential(admin, { ...openRouter, baseURL });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'credential_rejected', problem: 'endpoint_not_public' });
    expect(requests).toHaveLength(0);
  });

  test('saves one at a public address, and checks the address again on every recognition', async () => {
    addresses.set('openrouter.ai', ['104.18.2.115']);
    const admin = await signUpHousehold(ctx);
    expect((await saveCredential(admin)).status).toBe(200);
    expect(requests).toEqual([{ url: 'https://openrouter.ai/api/v1/chat/completions', redirect: 'error' }]);

    expect((await recognize(admin)).status).toBe('succeeded');
    expect(requests).toHaveLength(2);

    addresses.set('openrouter.ai', ['192.168.0.10']);
    expect(await recognize(admin)).toMatchObject({ status: 'failed', error: 'household_key_unavailable' });
    expect(requests).toHaveLength(2);
  });

  test("calls the provider's own endpoint, which is public, when the base URL is empty", async () => {
    addresses.set('api.anthropic.com', ['160.79.104.10']);
    const admin = await signUpHousehold(ctx);
    const res = await saveCredential(admin, { provider: 'anthropic', apiKey: 'sk-ant-own-1234' });
    // The fake answers in OpenAI's shape, which the Anthropic SDK still takes as a successful call.
    expect(res.status).toBe(200);
    expect(requests).toEqual([{ url: 'https://api.anthropic.com/v1/messages', redirect: 'error' }]);
  });
});
