import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider';

// Verbatim copy of https://claude.ai/oauth/mcp-oauth-client-metadata as published on 2026-10-13.
export const CLAUDE_CLIENT_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
export const claudeMetadata = {
  client_id: CLAUDE_CLIENT_ID,
  client_name: 'Claude',
  client_uri: 'https://claude.ai',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:jwt-bearer'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

// Serves Claude's client metadata document in place of claude.ai, which tests do not reach.
export const fetchClaudeMetadata: ClientMetadataResourceFetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url !== CLAUDE_CLIENT_ID) return new Response('not found', { status: 404 });
  return Response.json(claudeMetadata, { headers: { 'cache-control': 'max-age=300' } });
};
