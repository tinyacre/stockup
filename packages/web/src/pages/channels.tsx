import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { List, ListRow } from '@/components/ui/list';
import { PageContent, PageHeader } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import {
  Alert,
  attempt,
  DeleteButton,
  describeError,
  EditableTitle,
  ListSkeleton,
  listPageClass,
  NameForm,
  RetryAlert,
} from '@/components/editing';
import { api, type Channel } from '@/lib/api';

// Archived channels keep their names, so a new or renamed channel can collide with one of them.
const nameTaken = { name_taken: '名称已被使用（含已归档）' };

export function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>();
  const [loadError, setLoadError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setChannels(await api.channels());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const active = channels?.filter((c) => !c.archived) ?? [];
  const archived = channels?.filter((c) => c.archived) ?? [];

  return (
    <PageContent className={listPageClass}>
      <PageHeader title="渠道" />
      {loadError && <RetryAlert message={`加载失败：${loadError}`} onRetry={reload} />}
      <Panel>
        <PanelHeader title="使用中" count={channels && active.length} />
        <PanelBody className="border-b border-line">
          <NameForm
            label="新渠道名称"
            submitLabel="新建渠道"
            onSubmit={(name) =>
              attempt(async () => {
                await api.createChannel({ name });
                await reload();
              }, nameTaken)
            }
          />
        </PanelBody>
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
    setError(
      (await attempt(async () => {
        await api.updateChannel(channel.id, { archived });
        await onChange();
      })) ?? undefined,
    );
    setPending(false);
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
          <Button variant="ghost" size="xs" disabled={pending} onClick={() => setArchived(!channel.archived)}>
            {channel.archived ? '恢复' : '归档'}
          </Button>
          <DeleteButton
            label={`删除渠道 ${channel.name}`}
            onDelete={() =>
              attempt(
                async () => {
                  await api.deleteChannel(channel.id);
                  await onChange();
                },
                { in_use: '已有价格记录使用该渠道，可改为归档' },
              )
            }
          />
          {error && <Alert className="basis-full">{error}</Alert>}
        </>
      }
    />
  );
}
