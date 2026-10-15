import { Client, StreamableHTTPClientTransport, UnauthorizedError } from '@modelcontextprotocol/client';
import type { OAuthClientProvider } from '@modelcontextprotocol/client';
import { CLAUDE_CLIENT_ID, claudeMetadata } from './claude-metadata';
import { jsonRequest, type SignedInMember } from './harness';

// Plays the part of Claude: the OAuth state lives in memory and the redirect to the authorization
// page is captured, so the test can sign in and consent as the member would in the browser.
class ClaudeAuthProvider implements OAuthClientProvider {
  clientMetadataUrl = CLAUDE_CLIENT_ID;
  authorizationUrl: URL | undefined;
  private saved: { tokens?: Awaited<ReturnType<OAuthClientProvider['tokens']>>; verifier?: string } = {};

  // Replaces the scope the client would request, as a client asking for less than the server suggests.
  constructor(private scope: string | undefined) {}

  get redirectUrl() {
    return claudeMetadata.redirect_uris[0];
  }
  get clientMetadata() {
    return claudeMetadata;
  }
  clientInformation() {
    return { client_id: CLAUDE_CLIENT_ID };
  }
  tokens() {
    return this.saved.tokens;
  }
  saveTokens(tokens: Awaited<ReturnType<OAuthClientProvider['tokens']>>) {
    this.saved.tokens = tokens;
  }
  redirectToAuthorization(url: URL) {
    if (this.scope !== undefined) url.searchParams.set('scope', this.scope);
    this.authorizationUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    this.saved.verifier = verifier;
  }
  codeVerifier() {
    if (!this.saved.verifier) throw new Error('no code verifier saved');
    return this.saved.verifier;
  }
}

async function expectStatus(res: Response, status: number) {
  if (res.status !== status) throw new Error(`${res.url} answered ${res.status}: ${await res.text()}`);
  return res;
}

// What the member does in the browser: the authorization endpoint sends them to sign in, then to consent,
// and finally back to Claude's callback with an authorization code.
async function signInAndConsent(baseUrl: string, member: SignedInMember, authorizationUrl: URL) {
  const toSignIn = await expectStatus(await fetch(authorizationUrl, { redirect: 'manual' }), 302);
  const signInUrl = new URL(toSignIn.headers.get('location')!, baseUrl);
  if (signInUrl.pathname !== '/oauth/sign-in') throw new Error(`expected the sign-in page, got ${signInUrl}`);

  const signedIn = await expectStatus(
    await fetch(
      new URL('/api/auth/sign-in/username', baseUrl),
      jsonRequest('POST', {
        username: member.username,
        password: member.password,
        oauth_query: signInUrl.search.slice(1),
      }),
    ),
    200,
  );
  const cookie = signedIn.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const consentUrl = new URL(((await signedIn.json()) as { url: string }).url, baseUrl);
  if (consentUrl.pathname !== '/oauth/consent') throw new Error(`expected the consent page, got ${consentUrl}`);

  const consented = await expectStatus(
    await fetch(new URL('/api/auth/oauth2/consent', baseUrl), {
      ...jsonRequest('POST', { accept: true, oauth_query: consentUrl.search.slice(1) }),
      headers: { 'content-type': 'application/json', cookie },
    }),
    200,
  );
  return new URL(((await consented.json()) as { url: string }).url).searchParams;
}

// Authorizes the way Claude does: the first attempt is turned away, discovery leads to the authorization
// server, the member authorizes in the browser, and the code is exchanged for tokens.
export async function authorizeAsClaude(baseUrl: string, member: SignedInMember, { scope }: { scope?: string } = {}) {
  const mcpUrl = new URL('/mcp', baseUrl);
  const provider = new ClaudeAuthProvider(scope);
  const unauthorized = await new Client({ name: 'claude-ai', version: '0' })
    .connect(new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider }))
    .then(
      () => null,
      (error: unknown) => error,
    );
  if (!(unauthorized instanceof UnauthorizedError) || !provider.authorizationUrl) {
    throw new Error(`expected the MCP endpoint to ask for authorization, got ${String(unauthorized)}`);
  }

  const callback = await signInAndConsent(baseUrl, member, provider.authorizationUrl);
  const transport = new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider });
  await transport.finishAuth(callback);
  const tokens = provider.tokens()!;
  return { transport, accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

export async function connectAsClaude(baseUrl: string, member: SignedInMember, options: { scope?: string } = {}) {
  const { transport, accessToken } = await authorizeAsClaude(baseUrl, member, options);
  const client = new Client({ name: 'claude-ai', version: '0' });
  await client.connect(transport);
  return { client, accessToken };
}
