import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center p-4">{children}</main>;
}

export interface Field {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
}

// A card with labelled inputs; `onSubmit` receives the values and returns an error message or nothing.
export function AuthForm({
  title,
  description,
  fields,
  submitLabel,
  onSubmit,
}: {
  title: string;
  description?: string;
  fields: Field[];
  submitLabel: string;
  onSubmit(values: Record<string, string>): Promise<string | void>;
}) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = Object.fromEntries(fields.map((f) => [f.name, String(data.get(f.name) ?? '')]));
    setPending(true);
    setError(undefined);
    try {
      setError((await onSubmit(values)) ?? undefined);
    } catch {
      setError('出错了，请稍后再试。');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {fields.map((f) => (
            <div key={f.name} className="flex flex-col gap-2">
              <Label htmlFor={f.name}>{f.label}</Label>
              <Input id={f.name} name={f.name} type={f.type ?? 'text'} autoComplete={f.autoComplete} required />
              {f.hint && <p className="text-muted-foreground text-xs">{f.hint}</p>}
            </div>
          ))}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
