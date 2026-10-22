import { AuthForm, AuthLayout } from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { useCapabilities } from '@/lib/capabilities';

export function SignInPage({ onDone, oauthQuery }: { onDone(): void; oauthQuery?: string }) {
  const capabilities = useCapabilities();
  return (
    <AuthLayout>
      <AuthForm
        title="登录 StockUp"
        submitLabel="登录"
        fields={[
          { name: 'username', label: '用户名或邮箱', autoComplete: 'username' },
          { name: 'password', label: '密码', type: 'password', autoComplete: 'current-password' },
        ]}
        onSubmit={async (values) => {
          let next: string | undefined;
          try {
            ({ url: next } = await api.signIn({ username: values.username!, password: values.password!, oauthQuery }));
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) return '用户名或密码错误';
            throw error;
          }
          // An authorization request continues at the page the response names; without one, the app opens.
          if (oauthQuery !== undefined) window.location.assign(next ?? '/');
          else onDone();
        }}
      />
      {/* Registering would drop an MCP client's authorization request, so it is offered only on the app's own page. */}
      {capabilities?.signup && oauthQuery === undefined && (
        <Button variant="link" className="self-center" asChild>
          <a href="/sign-up">没有账号？注册</a>
        </Button>
      )}
    </AuthLayout>
  );
}
