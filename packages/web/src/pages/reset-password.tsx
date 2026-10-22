import { useState } from 'react';
import { AuthForm, AuthLayout, AuthNotice } from '@/components/auth-form';
import { codeErrors, EmailCodeField } from '@/components/email-code-field';
import { turnstileErrors, useTurnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/components/editing';
import { api } from '@/lib/api';
import { useCapabilities } from '@/lib/capabilities';

const resetErrors = { ...codeErrors, ...turnstileErrors, email_unavailable: '实例未配置邮件，无法找回密码' };

// The reset signs the account out everywhere, this browser included, so the member signs in again afterwards.
export function ResetPasswordPage() {
  const capabilities = useCapabilities();
  const turnstile = useTurnstile();
  const [done, setDone] = useState(false);

  const signIn = (label: string) => (
    <Button variant="link" className="self-center" asChild>
      <a href="/">{label}</a>
    </Button>
  );

  if (!capabilities) {
    return (
      <AuthLayout>
        <Skeleton className="h-80 w-full" />
      </AuthLayout>
    );
  }
  if (!capabilities.email) {
    return (
      <AuthLayout>
        <AuthNotice>实例未配置邮件，无法找回密码，请联系实例管理员</AuthNotice>
        {signIn('返回登录')}
      </AuthLayout>
    );
  }
  if (done) {
    return (
      <AuthLayout>
        <AuthNotice>密码已重置，其他设备上的登录已失效</AuthNotice>
        {signIn('用新密码登录')}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthForm
        title="找回密码"
        description="向账号绑定的邮箱发送验证码"
        submitLabel="重置密码"
        turnstile={turnstile}
        fields={[
          {
            name: 'newPassword',
            label: '新密码',
            type: 'password',
            autoComplete: 'new-password',
            hint: '至少 8 位',
            minLength: 8,
            maxLength: 128,
          },
        ]}
        onSubmit={async ({ email, code, newPassword }) => {
          try {
            await api.resetPassword({ email: email!, code: code!, newPassword: newPassword! }, turnstile.token);
          } catch (error) {
            return describeError(error, resetErrors);
          }
          setDone(true);
        }}
      >
        <EmailCodeField purpose="password-reset" turnstile={turnstile} />
      </AuthForm>
      {signIn('返回登录')}
    </AuthLayout>
  );
}
