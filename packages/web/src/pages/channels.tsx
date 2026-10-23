import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { List, ListCell, ListRow } from '@/components/ui/list';
import { PageContent, PageHeader } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Alert, attempt, DeleteButton, EditableTitle, ListSkeleton, NameForm, RetryAlert } from '@/components/editing';
import { api, type Channel } from '@/lib/api';
import { loadErrorOf, queries, useRefresh } from '@/lib/queries';

// Archived channels keep their names, so a new or renamed channel can collide with one of them.
const nameTaken = { name_taken: '名称已被使用（含已归档）' };

export function ChannelsPage() {
  const loaded = useQuery(queries.channels());
  const channels = loaded.data;
  const loadError = loadErrorOf(loaded.error);
  const reload = useRefresh();

  const [creating, setCreating] = useState(false);

  const active = channels?.filter((c) => !c.archived) ?? [];
  const archived = channels?.filter((c) => c.archived) ?? [];

  return (
    <PageContent width="narrow">
      <PageHeader
        title="渠道"
        actions={
          !creating && (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              新建渠道
            </Button>
          )
        }
      />
      {loadError && <RetryAlert message={`加载失败：${loadError}`} onRetry={reload} />}
      {creating && (
        <Panel>
          <PanelHeader title="新建渠道" />
          <PanelBody>
            <NameForm
              label="新渠道名称"
              submitLabel="新建渠道"
              autoFocus
              onCancel={() => setCreating(false)}
              onSubmit={async (name) => {
                const message = await attempt(async () => {
                  await api.createChannel({ name });
                  await reload();
                }, nameTaken);
                if (!message) {
                  setCreating(false);
                  toast.success(`已新建渠道「${name}」`);
                }
                return message;
              }}
            />
          </PanelBody>
        </Panel>
      )}
      <Panel>
        <PanelHeader title="使用中" count={channels && active.length} />
        {!channels && <ListSkeleton />}
        {channels && active.length === 0 && <EmptyState title="暂无渠道" />}
        {active.length > 0 && <ChannelList label="使用中的渠道" channels={active} onChange={reload} />}
      </Panel>
      {archived.length > 0 && (
        <Panel asChild>
          <section aria-label="已归档的渠道">
            <PanelHeader title="已归档" count={archived.length} />
            <ChannelList label="已归档的渠道列表" channels={archived} onChange={reload} />
          </section>
        </Panel>
      )}
    </PageContent>
  );
}

function ChannelList({ label, channels, onChange }: { label: string; channels: Channel[]; onChange(): Promise<void> }) {
  return (
    <List variant="ruled" aria-label={label}>
      {channels.map((channel) => (
        <ListRow key={channel.id} asChild>
          <li aria-label={channel.name}>
            <ChannelItem channel={channel} onChange={onChange} />
          </li>
        </ListRow>
      ))}
    </List>
  );
}

function ChannelItem({ channel, onChange }: { channel: Channel; onChange(): Promise<void> }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function setArchived(archived: boolean) {
    setPending(true);
    const message = await attempt(async () => {
      await api.updateChannel(channel.id, { archived });
      await onChange();
    });
    setError(message ?? undefined);
    setPending(false);
    if (!message) {
      toast.success(archived ? `已归档「${channel.name}」` : `已恢复「${channel.name}」`, {
        action: { label: '撤销', onClick: () => setArchived(!archived) },
      });
    }
  }

  return (
    <EditableTitle
      as="h3"
      className={channel.archived ? 'text-ink-3' : undefined}
      name={channel.name}
      label="渠道名称"
      onRename={(name) =>
        attempt(async () => {
          await api.updateChannel(channel.id, { name });
          await onChange();
        }, nameTaken)
      }
      actions={
        <>
          <ListCell trail>
            <Button variant="ghost" size="xs" disabled={pending} onClick={() => setArchived(!channel.archived)}>
              {channel.archived ? '恢复' : '归档'}
            </Button>
            <DeleteButton
              label={`删除渠道 ${channel.name}`}
              title={`删除渠道「${channel.name}」？`}
              onDelete={() =>
                attempt(
                  async () => {
                    await api.deleteChannel(channel.id);
                    await onChange();
                    toast.success(`已删除渠道「${channel.name}」`);
                  },
                  { in_use: '渠道已有价格记录，只能归档' },
                )
              }
            />
          </ListCell>
          {error && <Alert className="basis-full">{error}</Alert>}
        </>
      }
    />
  );
}
