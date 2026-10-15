import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource as fetchPublicClientMetadata } from '@better-auth/cimd/node';
import { mcp } from '@better-auth/mcp';
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, organization, username } from 'better-auth/plugins';
import type { Database } from '../db';
import * as schema from '../db/schema';

export const MCP_READ_SCOPE = 'stockup:read';
export const MCP_WRITE_SCOPE = 'stockup:write';
export const MCP_SCOPES = ['openid', 'profile', 'offline_access', MCP_READ_SCOPE, MCP_WRITE_SCOPE];

export const mcpResource = (baseURL: string) => new URL('/mcp', baseURL).toString();

// The mcp() plugin accepts only an HTTPS resource, or plain HTTP on loopback for development.
export function mcpAvailable(baseURL: string) {
  const { protocol, hostname } = new URL(baseURL);
  if (protocol === 'https:') return true;
  return protocol === 'http:' && (hostname === 'localhost' || hostname === '[::1]' || /^127(\.\d{1,3}){3}$/.test(hostname));
}

export interface AuthOptions {
  db: Database;
  secret: string;
  baseURL: string;
  // The default transport only fetches client metadata from publicly routable HTTPS hosts.
  fetchClientMetadataResource?: ClientMetadataResourceFetch;
}

export function createAuth({ db, secret, baseURL, fetchClientMetadataResource }: AuthOptions) {
  return betterAuth({
    baseURL,
    basePath: '/api/auth',
    secret,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    // Accounts are created by onboarding and (later) invitations, never by open sign-up.
    emailAndPassword: { enabled: true, disableSignUp: true },
    user: {
      additionalFields: {
        role: { type: 'string', required: true, defaultValue: 'user', input: false },
      },
    },
    plugins: [
      username(),
      // Households are created by StockUp's own services, which also enforce one household per member.
      organization({ allowUserToCreateOrganization: false }),
      ...(mcpAvailable(baseURL) ? mcpPlugins(baseURL, fetchClientMetadataResource) : []),
    ],
  });
}

function mcpPlugins(baseURL: string, fetchClientMetadataResource?: ClientMetadataResourceFetch) {
  return [
    jwt(),
    // MCP clients register only through Client ID Metadata Documents. Dynamic registration and the
    // client and resource management endpoints stay closed, since each would let any account register
    // a client with any redirect URI (ADR 0002).
    mcp({
      loginPage: '/oauth/sign-in',
      consentPage: '/oauth/consent',
      resource: mcpResource(baseURL),
      scopes: MCP_SCOPES,
      clientPrivileges: () => false,
      resourcePrivileges: () => false,
    }),
    cimd({
      fetchClientMetadataResource: fetchClientMetadataResource ?? fetchPublicClientMetadata,
      metadataProfile: 'mcp-2026-07-28',
    }),
  ];
}

export type Auth = ReturnType<typeof createAuth>;
