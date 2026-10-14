import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, attempt } from '@/components/editing';
import { api, type Me } from '@/lib/api';

// The header shows the display name, so `onRenamed` reloads the session.
export function SettingsPage({ me, onRenamed }: { me: Me; onRenamed(): void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8 p-4">
      <h2 className="text-xl font-semibold">个人设置</h2>
      <SettingsForm
        title="显示名称"
        description="家人在价格记录上看到的名字，修改后已有的记录也会显示新名字。"
        submitLabel="保存名称"
        onSubmit={async (data) => {
          const message = await attempt(() => api.rename({ name: String(data.get('name')).trim() }));
          if (!message) onRenamed();
          return message ? { error: message } : { done: '名称已保存。' };
        }}
      >
        <Field name="name" label="显示名称" defaultValue={me.user.name} maxLength={50} />
      </SettingsForm>
      <SettingsForm
        title="密码"
        description={`用户名 ${me.user.username}`}
        submitLabel="修改密码"
        onSubmit={async (data) => {
          const message = await attempt(
            () =>
              api.changePassword({
                currentPassword: String(data.get('currentPassword')),
                newPassword: String(data.get('newPassword')),
              }),
            { wrong_password: '当前密码不正确。' },
          );
          return message ? { error: message } : { done: '密码已修改，下次登录请使用新密码。', reset: true };
        }}
      >
        <Field name="currentPassword" label="当前密码" type="password" autoComplete="current-password" />
        <Field
          name="newPassword"
          label="新密码"
          type="password"
          autoComplete="new-password"
          minLength={8}
          hint="至少 8 位"
        />
      </SettingsForm>
      <SettingsForm
        title="登出所有设备"
        description="手机丢了或在别人的设备上登录过时使用：其他设备上的登录会立即失效，这台设备保持登录。"
        submitLabel="登出其他设备"
        onSubmit={async () => {
          const message = await attempt(() => api.signOutOthers());
          return message ? { error: message } : { done: '其他设备已登出。' };
        }}
      />
    </div>
  );
}

type Outcome = { error: string } | { done: string; reset?: boolean };

function SettingsForm({
  title,
  description,
  submitLabel,
  onSubmit,
  children,
}: {
  title: string;
  description: string;
  submitLabel: string;
  onSubmit(data: FormData): Promise<Outcome>;
  children?: ReactNode;
}) {
  const [outcome, setOutcome] = useState<Outcome>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setOutcome(undefined);
    const result = await onSubmit(new FormData(form));
    if ('reset' in result && result.reset) form.reset();
    setOutcome(result);
    setPending(false);
  }

  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        {children}
        <div>
          <Button type="submit" variant="outline" disabled={pending}>
            {submitLabel}
          </Button>
        </div>
        {outcome && 'error' in outcome && <Alert>{outcome.error}</Alert>}
        {outcome && 'done' in outcome && (
          <p role="status" className="text-sm">
            {outcome.done}
          </p>
        )}
      </form>
    </section>
  );
}

function Field({
  name,
  label,
  hint,
  ...input
}: {
  name: string;
  label: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  maxLength?: number;
  minLength?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} required {...input} />
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}
