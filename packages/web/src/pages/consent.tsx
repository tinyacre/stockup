import { useEffect, useState } from 'react';
import { AuthLayout } from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError, type Me, type OAuthClient } from '@/lib/api';

const scopeDescriptions: Record<string, string> = {
  'stockup:read': '查看家庭的商品和价格',
  openid: '确认你的身份',
  profile: '读取你的显示名称和用户名',
  offline_access: '保持连接，不必每次重新授权',
};

type Authorization =
  | { state: 'loading' }
  | { state: 'ready'; client: OAuthClient; me: Me | null }
  | { state: 'error'; message: string };

// The client ID of an MCP client is the URL of its metadata document, so its host is what the member can
// trust. The name comes from that document, so any client can claim to be Claude.
function clientHost(clientId: string) {
  return URL.canParse(clientId) ? new URL(clientId).host : clientId;
}

function failureMessage(failure: unknown) {
  if (!(failure instanceof ApiError) || failure.status >= 500) return '暂时无法连接 StockUp，请稍后再试。';
  if (failure.status === 401) return '登录已失效，请回到应用重新连接 StockUp。';
  return '找不到请求授权的应用，请回到应用重新连接 StockUp。';
}

export function ConsentPage({ oauthQuery }: { oauthQuery: string }) {
  const params = new URLSearchParams(oauthQuery);
  const clientId = params.get('client_id') ?? '';
  const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean);
  const [authorization, setAuthorization] = useState<Authorization>({ state: 'loading' });
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const me = api.me().catch((error) => {
      if (error instanceof ApiError && error.code === 'no_household') return null;
      throw error;
    });
    Promise.all([api.oauthClient(clientId), me]).then(
      ([client, me]) => setAuthorization({ state: 'ready', client, me }),
      (failure) => setAuthorization({ state: 'error', message: failureMessage(failure) }),
    );
  }, [clientId]);

  async function answer(accept: boolean) {
    setPending(true);
    setError(undefined);
    try {
      window.location.assign((await api.consent({ accept, oauthQuery })).url);
    } catch {
      setError('授权没有完成，请回到应用重新连接 StockUp。');
      setPending(false);
    }
  }

  if (authorization.state === 'loading') return null;
  if (authorization.state === 'error') {
    return (
      <AuthLayout>
        <p role="alert" className="text-center">
          {authorization.message}
        </p>
      </AuthLayout>
    );
  }

  const name = authorization.client.client_name;
  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">授权 {clientHost(clientId)} 访问 StockUp</CardTitle>
          <CardDescription>
            {name && `这个应用自称「${name}」，请确认上面的域名属于它。`}
            {authorization.me
              ? `它将以「${authorization.me.user.name}」的身份访问「${authorization.me.household.name}」的数据。`
              : '你目前不属于任何家庭，授权后它也看不到任何数据。'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="list-disc pl-5 text-sm">
            {scopes.map((scope) => (
              <li key={scope}>{scopeDescriptions[scope] ?? scope}</li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button className="flex-1" disabled={pending} onClick={() => answer(true)}>
              允许
            </Button>
            <Button className="flex-1" variant="outline" disabled={pending} onClick={() => answer(false)}>
              拒绝
            </Button>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
