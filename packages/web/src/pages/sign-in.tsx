import { AuthForm, AuthLayout } from '@/components/auth-form';
import { api, ApiError } from '@/lib/api';

export function SignInPage({ onDone, oauthQuery }: { onDone(): void; oauthQuery?: string }) {
  return (
    <AuthLayout>
      <AuthForm
        title="登录 StockUp"
        submitLabel="登录"
        fields={[
          { name: 'username', label: '用户名', autoComplete: 'username' },
          { name: 'password', label: '密码', type: 'password', autoComplete: 'current-password' },
        ]}
        onSubmit={async (values) => {
          let next: string | undefined;
          try {
            ({ url: next } = await api.signIn({ username: values.username!, password: values.password!, oauthQuery }));
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) return '用户名或密码不正确。';
            throw error;
          }
          // An authorization request continues at the page the response names; without one, the app opens.
          if (oauthQuery !== undefined) window.location.assign(next ?? '/');
          else onDone();
        }}
      />
    </AuthLayout>
  );
}
