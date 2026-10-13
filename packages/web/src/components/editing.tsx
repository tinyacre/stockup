import { useState, type FormEvent, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

// Resolves to an error message for the member, or nothing when the action succeeded.
export type Action = () => Promise<string | void>;

export function describeError(error: unknown, messages: Record<string, string> = {}) {
  if (error instanceof ApiError && error.code && messages[error.code]) return messages[error.code];
  if (error instanceof ApiError && error.status === 400) return '请检查填写的内容。';
  return '出错了，请稍后再试。';
}

export async function attempt(run: () => Promise<unknown>, messages?: Record<string, string>) {
  try {
    await run();
  } catch (error) {
    return describeError(error, messages);
  }
}

export const nameTaken = { name_taken: '这个名称已经被使用。' };

export function NameForm({
  label,
  submitLabel,
  defaultValue,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  defaultValue?: string;
  autoFocus?: boolean;
  onSubmit(name: string): Promise<string | void>;
  onCancel?(): void;
}) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name')).trim();
    if (!name) return;
    setPending(true);
    const message = await onSubmit(name);
    setError(message ?? undefined);
    if (!message && !defaultValue) form.reset();
    setPending(false);
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <div className="flex gap-2">
        <Input
          name="name"
          aria-label={label}
          placeholder={label}
          required
          maxLength={50}
          defaultValue={defaultValue}
          autoFocus={autoFocus}
          onKeyDown={(event) => event.key === 'Escape' && onCancel?.()}
        />
        <Button type="submit" variant="outline" disabled={pending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
    </form>
  );
}

export function EditableTitle({
  as: Heading,
  className,
  name,
  label,
  onRename,
  actions,
}: {
  as: 'h2' | 'h3';
  className?: string;
  name: string;
  label: string;
  onRename(name: string): Promise<string | void>;
  actions?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <NameForm
        label={label}
        submitLabel="保存"
        defaultValue={name}
        autoFocus
        onCancel={() => setEditing(false)}
        onSubmit={async (next) => {
          const error = await onRename(next);
          if (!error) setEditing(false);
          return error;
        }}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Heading className={cn('mr-auto', className)}>{name}</Heading>
      <Button variant="ghost" size="icon-xs" aria-label={`重命名 ${name}`} onClick={() => setEditing(true)}>
        <Pencil />
      </Button>
      {actions}
    </div>
  );
}

// Deletion takes a second click on the same button instead of a browser dialog.
export function DeleteButton({ label, onDelete }: { label: string; onDelete: Action }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <>
      <Button
        variant={confirming ? 'destructive' : 'ghost'}
        size="xs"
        aria-label={confirming ? `确认${label}` : label}
        onBlur={() => setConfirming(false)}
        onClick={async () => {
          if (!confirming) {
            setError(undefined);
            return setConfirming(true);
          }
          setConfirming(false);
          setError((await onDelete()) ?? undefined);
        }}
      >
        {confirming ? '确认删除' : '删除'}
      </Button>
      {error && <Alert className="basis-full">{error}</Alert>}
    </>
  );
}

export function RetryAlert({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="flex items-center gap-2">
      <Alert>{message}</Alert>
      <Button variant="outline" size="xs" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

export function Alert({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn('text-destructive text-sm', className)}>
      {children}
    </p>
  );
}
