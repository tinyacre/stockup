import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, attempt, DeleteButton, describeError, EditableTitle, NameForm, RetryAlert } from '@/components/editing';
import { api, type Channel } from '@/lib/api';

// Archived channels keep their names, so a new or renamed channel can collide with one of them.
const nameTaken = { name_taken: '这个名称已经被使用，可能是某个已归档的渠道。' };

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
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <h2 className="text-xl font-semibold">渠道</h2>
      {loadError && <RetryAlert message={`渠道加载失败：${loadError}`} onRetry={reload} />}
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
      {channels && (
        <>
          {active.length === 0 && (
            <p className="text-muted-foreground text-sm">还没有渠道，比如「京东」「天猫超市」「山姆」。</p>
          )}
          <ChannelList label="使用中的渠道" channels={active} onChange={reload} />
          {archived.length > 0 && (
            <section aria-label="已归档的渠道" className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-sm font-medium">已归档</h3>
              <p className="text-muted-foreground text-xs">已归档的渠道不再出现在选择列表中，已有的价格记录仍指向它们。</p>
              <ChannelList label="已归档的渠道列表" channels={archived} onChange={reload} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ChannelList({ label, channels, onChange }: { label: string; channels: Channel[]; onChange(): Promise<void> }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {channels.map((channel) => (
        <li key={channel.id} aria-label={channel.name} className="rounded-lg border px-3 py-2">
          <ChannelItem channel={channel} onChange={onChange} />
        </li>
      ))}
    </ul>
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
      className={channel.archived ? 'text-muted-foreground' : undefined}
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
              attempt(async () => {
                await api.deleteChannel(channel.id);
                await onChange();
              }, { in_use: '已有价格记录使用这个渠道，可以改为归档。' })
            }
          />
          {error && <Alert className="basis-full">{error}</Alert>}
        </>
      }
    />
  );
}
