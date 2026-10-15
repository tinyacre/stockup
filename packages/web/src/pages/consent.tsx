import { useEffect, useState } from 'react';
import { AuthCard, AuthLayout, AuthNotice } from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { List, ListRow } from '@/components/ui/list';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError, type Me, type OAuthClient } from '@/lib/api';
import { clientHost, scopeDescriptions } from '@/lib/oauth';

type Authorization =
  | { state: 'loading' }
  | { state: 'ready'; client: OAuthClient; me: Me | null }
  | { state: 'error'; message: string };

function failureMessage(failure: unknown) {
  if (!(failure instanceof ApiError) || failure.status >= 500) return '无法连接 StockUp';
  if (failure.status === 401) return '登录已失效';
  return '找不到请求授权的应用';
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
      setError('授权未完成');
      setPending(false);
    }
  }

  if (authorization.state === 'loading') {
    return (
      <AuthLayout>
        <Skeleton className="h-64 w-full" />
      </AuthLayout>
    );
  }
  if (authorization.state === 'error') {
    return (
      <AuthLayout>
        <AuthNotice>{authorization.message}</AuthNotice>
      </AuthLayout>
    );
  }

  const name = authorization.client.client_name;
  return (
    <AuthLayout>
      <AuthCard
        title={`授权 ${clientHost(clientId)} 访问 StockUp`}
        description={
          <>
            {name && <span className="block">这个应用自称「{name}」</span>}
            <span className="block">
              {authorization.me
                ? `以「${authorization.me.user.name}」的身份访问「${authorization.me.household.name}」的数据`
                : '当前账号不属于任何家庭'}
            </span>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <List variant="ruled" className="-mx-6 border-y border-line price-tag:border-rule">
            {scopes.map((scope) => (
              <ListRow key={scope} asChild className="min-h-10 px-6 py-2 text-sm">
                <li>{scopeDescriptions[scope] ?? scope}</li>
              </ListRow>
            ))}
          </List>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="lg" className="flex-1" disabled={pending} onClick={() => answer(true)}>
              允许
            </Button>
            <Button size="lg" className="flex-1" variant="outline" disabled={pending} onClick={() => answer(false)}>
              拒绝
            </Button>
          </div>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}
