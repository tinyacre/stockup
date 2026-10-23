import { useState, type FormEvent, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ListCell } from '@/components/ui/list';
import { controlClass, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, NetworkError } from '@/lib/api';
import { cn } from '@/lib/utils';

export const fieldClass = cn(controlClass, 'px-2.5 py-1 text-base wide:text-[13px] price-tag:wide:text-sm');

// Resolves to an error message for the member, or nothing when the action succeeded.
export type Action = () => Promise<string | void>;

export function describeError(error: unknown, messages: Record<string, string> = {}) {
  const message = error instanceof ApiError && error.code ? messages[error.code] : undefined;
  if (message) return message;
  if (error instanceof ApiError && error.status === 400) return '填写有误';
  if (error instanceof NetworkError) return '网络不可用';
  return '操作失败';
}

export async function attempt(run: () => Promise<unknown>, messages?: Record<string, string>) {
  try {
    await run();
  } catch (error) {
    return describeError(error, messages);
  }
}

// Shows the outcome of an action whose result leaves the place it was taken, as a deletion does.
export async function report(outcome: Promise<string | void>, done: string) {
  const message = await outcome;
  if (message) toast.error(message);
  else toast.success(done);
}

export const nameTaken = { name_taken: '名称已被使用' };

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
    <form className="flex w-full max-w-md flex-col gap-2" onSubmit={handleSubmit}>
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
    <div className="flex w-full flex-wrap items-center gap-1">
      <ListCell lead className="flex items-center gap-1">
        <Heading className={cn('min-w-0 truncate text-sm font-medium', className)}>{name}</Heading>
        <Button variant="ghost" size="icon-xs" aria-label={`重命名 ${name}`} onClick={() => setEditing(true)}>
          <Pencil />
        </Button>
      </ListCell>
      {actions}
    </div>
  );
}

// Destructive actions take a second click on the same button instead of a browser dialog.
export function ConfirmButton({
  label,
  confirmLabel,
  ariaLabel = label,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  ariaLabel?: string;
  onConfirm: Action;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <>
      <Button
        variant={confirming ? 'destructive' : 'ghost'}
        size="xs"
        aria-label={confirming ? `确认${ariaLabel}` : ariaLabel}
        onBlur={() => setConfirming(false)}
        onClick={async () => {
          if (!confirming) {
            setError(undefined);
            return setConfirming(true);
          }
          setConfirming(false);
          setError((await onConfirm()) ?? undefined);
        }}
      >
        {confirming ? confirmLabel : label}
      </Button>
      {error && <Alert className="basis-full">{error}</Alert>}
    </>
  );
}

export function DeleteButton({ label, onDelete }: { label: string; onDelete: Action }) {
  return <ConfirmButton label="删除" confirmLabel="确认删除" ariaLabel={label} onConfirm={onDelete} />;
}

export function RetryAlert({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
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

export function ListSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3 px-4 py-4">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-5 w-56" />
    </div>
  );
}
