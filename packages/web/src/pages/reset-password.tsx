import { useState, type FormEvent } from 'react';
import { AuthCard, AuthLayout, AuthNotice } from '@/components/auth-form';
import { codeErrors, EmailCodeField } from '@/components/email-code-field';
import { turnstileErrors, useTurnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/components/editing';
import { api } from '@/lib/api';
import { useCapabilities } from '@/lib/capabilities';

const resetErrors = { ...codeErrors, ...turnstileErrors, email_unavailable: '实例未配置邮件，无法找回密码' };

// The reset signs the account out everywhere, this browser included, so the member signs in again afterwards.
export function ResetPasswordPage() {
  const capabilities = useCapabilities();
  const turnstile = useTurnstile();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? '');
    setPending(true);
    setError(undefined);
    try {
      await api.resetPassword(
        { email: value('email'), code: value('code'), newPassword: value('newPassword') },
        turnstile.token,
      );
    } catch (error) {
      setError(describeError(error, resetErrors));
      setPending(false);
      return;
    } finally {
      turnstile.spend();
    }
    setDone(true);
  }

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
      <AuthCard title="找回密码" description="向账号绑定的邮箱发送验证码">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <EmailCodeField purpose="password-reset" turnstile={turnstile} />
          <Field label="新密码" htmlFor="newPassword" hint="至少 8 位">
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
            />
          </Field>
          {turnstile.widget}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={pending || !turnstile.ready}>
            重置密码
          </Button>
        </form>
      </AuthCard>
      {signIn('返回登录')}
    </AuthLayout>
  );
}
