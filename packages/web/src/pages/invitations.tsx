import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { List, ListRow } from '@/components/ui/list';
import { NativeSelect } from '@/components/ui/native-select';
import { PageContent, PageHeader } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Alert, attempt, describeError, ListSkeleton, listPageClass, RetryAlert } from '@/components/editing';
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
    <PageContent className={listPageClass}>
      <PageHeader title="邀请" />
      {loadError && <RetryAlert message={`加载失败：${loadError}`} onRetry={reload} />}
      <Panel>
        <PanelHeader title="待使用" count={invitations && pending.length}>
          <NewInvitationForm onCreated={reload} />
        </PanelHeader>
        {!invitations && <ListSkeleton />}
        {invitations && pending.length === 0 && <EmptyState title="暂无待使用的邀请" />}
        {pending.length > 0 && (
          <List variant="ruled" aria-label="待使用的邀请">
            {pending.map((invitation) => (
              <ListRow key={invitation.id} asChild className="items-stretch py-3">
                <li>
                  <PendingInvitation invitation={invitation} onChange={reload} />
                </li>
              </ListRow>
            ))}
          </List>
        )}
      </Panel>
      {past.length > 0 && (
        <Panel asChild>
          <section aria-label="已失效的邀请">
            <PanelHeader title="已失效" count={past.length} />
            <List variant="ruled">
              {past.map((invitation) => (
                <ListRow key={invitation.id} asChild className="justify-between text-sm text-ink-2">
                  <li>
                    <span>
                      {invitation.invitedBy.name} 创建于 {formatTime(invitation.createdAt)}
                    </span>
                    <Badge tone="outline">{statusLabels[invitation.status]}</Badge>
                  </li>
                </ListRow>
              ))}
            </List>
          </section>
        </Panel>
      )}
    </PageContent>
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
    <form className="ml-auto flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
      <Label htmlFor="expiresInDays" className="text-ink-3">
        有效期
      </Label>
      <NativeSelect id="expiresInDays" name="expiresInDays" defaultValue={7}>
        {expiryOptions.map((o) => (
          <option key={o.days} value={o.days}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" size="sm" disabled={pending}>
        生成邀请链接
      </Button>
      {error && <Alert className="basis-full">{error}</Alert>}
    </form>
  );
}

function PendingInvitation({ invitation, onChange }: { invitation: Invitation; onChange(): Promise<void> }) {
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const link = invitationLink(invitation.id);

  return (
    <div className="flex w-full flex-col gap-2">
      <Input readOnly aria-label="邀请链接" value={link} onFocus={(event) => event.currentTarget.select()} />
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-auto text-xs text-ink-3">
          {invitation.invitedBy.name} 创建 · {formatTime(invitation.expiresAt)} 过期
        </span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            navigator.clipboard.writeText(link).then(
              () => setCopied(true),
              () => setError('复制失败'),
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
              invitation_used: '邀请链接已被使用',
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
