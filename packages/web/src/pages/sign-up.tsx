import { AuthForm, AuthLayout, AuthNotice } from '@/components/auth-form';
import { codeErrors, EmailCodeField } from '@/components/email-code-field';
import { turnstileErrors, useTurnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/components/editing';
import { api } from '@/lib/api';
import { useCapabilities } from '@/lib/capabilities';

const signUpErrors = {
  ...codeErrors,
  ...turnstileErrors,
  username_taken: '用户名已被使用',
  email_taken: '邮箱已被使用',
  signup_closed: '注册未开放',
};

// Registering also creates the member's own household, named after the username until they rename it.
export function SignUpPage({ onDone }: { onDone(): void }) {
  const capabilities = useCapabilities();
  const turnstile = useTurnstile();

  const signIn = (
    <Button variant="link" className="self-center" asChild>
      <a href="/">已有账号？登录</a>
    </Button>
  );

  if (!capabilities) {
    return (
      <AuthLayout>
        <Skeleton className="h-96 w-full" />
      </AuthLayout>
    );
  }
  if (!capabilities.signup) {
    return (
      <AuthLayout>
        <AuthNotice>注册未开放</AuthNotice>
        {signIn}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthForm
        title="注册 StockUp"
        description="注册后会为你创建一个家庭，可以邀请家人加入"
        submitLabel="注册"
        turnstile={turnstile}
        fields={[
          { name: 'name', label: '显示名称', maxLength: 50 },
          { name: 'username', label: '用户名', autoComplete: 'username', hint: '3–30 位字母、数字、下划线或点' },
          {
            name: 'password',
            label: '密码',
            type: 'password',
            autoComplete: 'new-password',
            hint: '至少 8 位',
            minLength: 8,
          },
        ]}
        onSubmit={async ({ email, code, name, username, password }) => {
          try {
            await api.signUp(
              { email: email!, code: code!, name: name!, username: username!, password: password! },
              turnstile.token,
            );
          } catch (error) {
            return describeError(error, signUpErrors);
          }
          window.history.replaceState(null, '', '/');
          onDone();
        }}
      >
        <EmailCodeField purpose="register" turnstile={turnstile} />
      </AuthForm>
      {signIn}
    </AuthLayout>
  );
}
