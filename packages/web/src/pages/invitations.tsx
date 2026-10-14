import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, attempt, describeError, fieldClass, RetryAlert } from '@/components/editing';
import { api, type Invitation } from '@/lib/api';

const expiryOptions = [
  { days: 1, label: '1 天' },
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
];

const statusLabels: Record<Invitation['status'], string> = {
  pending: '待使用',
  accepted: '已使用',
  revoked: '已作废',
  expired: '已过期',
};

function invitationLink(id: string) {
  return `${window.location.origin}/join/${encodeURIComponent(id)}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function InvitationsPage() {
  const [invitations, setInvitations] = useState<Invitation[]>();
  const [loadError, setLoadError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setInvitations(await api.invitations());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const pending = invitations?.filter((i) => i.status === 'pending') ?? [];
  const past = invitations?.filter((i) => i.status !== 'pending') ?? [];

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <div>
        <h2 className="text-xl font-semibold">邀请</h2>
        <p className="text-muted-foreground text-sm">
          把邀请链接发给家人，对方用它注册后就成为这个家庭的成员。每个链接只能用一次，过期或作废后失效。
        </p>
      </div>
      {loadError && <RetryAlert message={`邀请加载失败：${loadError}`} onRetry={reload} />}
      <NewInvitationForm onCreated={reload} />
      {invitations && (
        <>
          {pending.length === 0 && <p className="text-muted-foreground text-sm">没有待使用的邀请链接。</p>}
          <ul aria-label="待使用的邀请" className="flex flex-col gap-2">
            {pending.map((invitation) => (
              <li key={invitation.id} className="rounded-lg border px-3 py-2">
                <PendingInvitation invitation={invitation} onChange={reload} />
              </li>
            ))}
          </ul>
          {past.length > 0 && (
            <section aria-label="已失效的邀请" className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-sm font-medium">已失效</h3>
              <ul className="flex flex-col gap-1">
                {past.map((invitation) => (
                  <li key={invitation.id} className="text-muted-foreground flex justify-between text-sm">
                    <span>
                      {invitation.invitedBy.name} 创建于 {formatTime(invitation.createdAt)}
                    </span>
                    <span>{statusLabels[invitation.status]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function NewInvitationForm({ onCreated }: { onCreated(): Promise<void> }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const expiresInDays = Number(new FormData(event.currentTarget).get('expiresInDays'));
    setPending(true);
    setError(
      (await attempt(async () => {
        await api.createInvitation({ expiresInDays });
        await onCreated();
      })) ?? undefined,
    );
    setPending(false);
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="expiresInDays">有效期</Label>
          <select id="expiresInDays" name="expiresInDays" defaultValue={7} className={`${fieldClass} h-9`}>
            {expiryOptions.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          生成邀请链接
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
    </form>
  );
}

function PendingInvitation({ invitation, onChange }: { invitation: Invitation; onChange(): Promise<void> }) {
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const link = invitationLink(invitation.id);

  return (
    <div className="flex flex-col gap-2">
      <Input readOnly aria-label="邀请链接" value={link} onFocus={(event) => event.currentTarget.select()} />
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-muted-foreground mr-auto text-xs">
          {invitation.invitedBy.name} 创建，{formatTime(invitation.expiresAt)} 过期
        </span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            navigator.clipboard.writeText(link).then(
              () => setCopied(true),
              () => setError('无法自动复制，请手动选中链接复制。'),
            )
          }
        >
          {copied ? '已复制' : '复制'}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={async () => {
            const message = await attempt(() => api.revokeInvitation(invitation.id), {
              invitation_used: '这个邀请链接刚刚已被使用。',
            });
            setError(message ?? undefined);
            if (!message) await onChange();
          }}
        >
          作废
        </Button>
        {error && <Alert className="basis-full">{error}</Alert>}
      </div>
    </div>
  );
}
