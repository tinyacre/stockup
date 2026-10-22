import { useState, type FormEvent, type ReactNode } from 'react';
import { BrandMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Field as FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import type { TurnstileChallenge } from '@/components/turnstile';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 p-4">
      <BrandMark className="self-center" />
      {children}
    </main>
  );
}

// A titled panel for the pages shown before the app opens.
export function AuthCard({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel className="gap-5 p-6 price-tag:border-t-4 price-tag:bg-surface price-tag:px-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold price-tag:tracking-[.02em]">{title}</h1>
        {description && <p className="text-[13px] text-ink-3">{description}</p>}
      </div>
      {children}
    </Panel>
  );
}

// A terminal message on a pre-app page, for example an unusable invitation.
export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <Panel className="p-6 price-tag:border-t-4 price-tag:bg-surface">
      <p role="alert" className="text-center text-sm">
        {children}
      </p>
    </Panel>
  );
}

export interface Field {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
}

// A card with labelled inputs; `onSubmit` receives the values of every named input, `children`'s included,
// and returns an error message or nothing. With `turnstile`, the form waits for the challenge and asks for a
// fresh one after every submit.
export function AuthForm({
  title,
  description,
  fields,
  submitLabel,
  onSubmit,
  children,
  turnstile,
}: {
  title: string;
  description?: string;
  fields: Field[];
  submitLabel: string;
  onSubmit(values: Record<string, string>): Promise<string | void>;
  // Inputs placed above `fields`.
  children?: ReactNode;
  turnstile?: TurnstileChallenge;
}) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = Object.fromEntries([...data].map(([name, value]) => [name, String(value)]));
    setPending(true);
    setError(undefined);
    try {
      setError((await onSubmit(values)) ?? undefined);
    } catch {
      setError('操作失败');
    } finally {
      setPending(false);
      turnstile?.spend();
    }
  }

  return (
    <AuthCard title={title} description={description}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        {children}
        {fields.map((f) => (
          <FormField key={f.name} label={f.label} htmlFor={f.name} hint={f.hint}>
            <Input id={f.name} name={f.name} type={f.type ?? 'text'} autoComplete={f.autoComplete} required />
          </FormField>
        ))}
        {turnstile?.widget}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending || (turnstile && !turnstile.ready)}>
          {submitLabel}
        </Button>
      </form>
    </AuthCard>
  );
}
