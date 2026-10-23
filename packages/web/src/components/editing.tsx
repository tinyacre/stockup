import { useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
    <div className="group/title flex w-full flex-wrap items-center gap-1">
      <ListCell lead className="flex items-center gap-1">
        <Heading className={cn('min-w-0 truncate text-sm font-medium', className)}>{name}</Heading>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`重命名 ${name}`}
          className="wide:opacity-0 wide:group-focus-within/title:opacity-100 wide:group-hover/title:opacity-100"
          onClick={() => setEditing(true)}
        >
          <Pencil />
        </Button>
      </ListCell>
      {actions}
    </div>
  );
}

export interface Blocked {
  title: string;
  reason: string;
  // What the member can do instead, such as archiving what cannot be deleted.
  alternative?: { label: string; run(): Promise<void> };
}

// Asks before an action that cannot be taken back. `blocked` explains up front why the action is unavailable,
// when the page already knows. A refusal from the server stays in the dialog beside the choice that caused it.
export function ConfirmButton({
  children,
  ariaLabel,
  variant = 'ghost',
  size = 'xs',
  title,
  description,
  confirmLabel,
  blocked,
  onConfirm,
}: {
  children: ReactNode;
  ariaLabel?: string;
  variant?: ComponentProps<typeof Button>['variant'];
  size?: ComponentProps<typeof Button>['size'];
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  blocked?: Blocked;
  onConfirm: Action;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function run(action: () => Promise<string | void>) {
    setPending(true);
    const message = await action();
    setPending(false);
    setError(message ?? undefined);
    if (!message) setOpen(false);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(undefined);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} aria-label={ariaLabel}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <div className="flex flex-col gap-1.5">
          <AlertDialogTitle>{blocked ? blocked.title : title}</AlertDialogTitle>
          <AlertDialogDescription>{blocked ? blocked.reason : description}</AlertDialogDescription>
        </div>
        {error && <Alert>{error}</Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline">{blocked ? '知道了' : '取消'}</Button>
          </AlertDialogCancel>
          {blocked?.alternative && (
            <Button disabled={pending} onClick={() => run(blocked.alternative!.run)}>
              {blocked.alternative.label}
            </Button>
          )}
          {!blocked && (
            <Button
              variant="destructive"
              disabled={pending}
              aria-label={ariaLabel && `确认${ariaLabel}`}
              onClick={() => run(onConfirm)}
            >
              {confirmLabel}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteButton({
  label,
  name,
  title = `删除「${name}」？`,
  description = '删除后无法恢复。',
  blocked,
  onDelete,
}: {
  label: string;
  name?: string;
  title?: string;
  description?: ReactNode;
  blocked?: Blocked;
  onDelete: Action;
}) {
  return (
    <ConfirmButton
      ariaLabel={label}
      title={title}
      description={description}
      confirmLabel="删除"
      blocked={blocked}
      onConfirm={onDelete}
    >
      删除
    </ConfirmButton>
  );
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
