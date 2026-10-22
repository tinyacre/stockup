import { useState, type FormEvent } from 'react';
import { AuthCard, AuthLayout, AuthNotice } from '@/components/auth-form';
import { codeErrors, EmailCodeField } from '@/components/email-code-field';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/components/editing';
import { api } from '@/lib/api';
import { useCapabilities } from '@/lib/capabilities';

const signUpErrors = {
  ...codeErrors,
  username_taken: '用户名已被使用',
  email_taken: '邮箱已被使用',
  signup_closed: '注册未开放',
};

// Registering also creates the member's own household, named after the username until they rename it.
export function SignUpPage({ onDone }: { onDone(): void }) {
  const capabilities = useCapabilities();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? '');
    setPending(true);
    setError(undefined);
    try {
      await api.signUp({
        email: value('email'),
        code: value('code'),
        name: value('name'),
        username: value('username'),
        password: value('password'),
      });
    } catch (error) {
      setError(describeError(error, signUpErrors));
      setPending(false);
      return;
    }
    window.history.replaceState(null, '', '/');
    onDone();
  }

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
      <AuthCard title="注册 StockUp" description="注册后会为你创建一个家庭，可以邀请家人加入">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <EmailCodeField purpose="register" />
          <Field label="显示名称" htmlFor="name">
            <Input id="name" name="name" maxLength={50} required />
          </Field>
          <Field label="用户名" htmlFor="username" hint="3–30 位字母、数字、下划线或点">
            <Input id="username" name="username" autoComplete="username" required />
          </Field>
          <Field label="密码" htmlFor="password" hint="至少 8 位">
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          </Field>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={pending}>
            注册
          </Button>
        </form>
      </AuthCard>
      {signIn}
    </AuthLayout>
  );
}
