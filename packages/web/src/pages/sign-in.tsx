import { AuthForm, AuthLayout } from '@/components/auth-form';
import { api, ApiError } from '@/lib/api';

export function SignInPage({ onDone }: { onDone(): void }) {
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
          try {
            await api.signIn({ username: values.username!, password: values.password! });
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) return '用户名或密码不正确。';
            throw error;
          }
          onDone();
        }}
      />
    </AuthLayout>
  );
}
