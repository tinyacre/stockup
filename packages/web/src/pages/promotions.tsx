import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { isMonthDay } from '@stockup/domain';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { List, ListRow } from '@/components/ui/list';
import { PageContent, PageHeader } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import {
  Alert,
  attempt,
  describeError,
  EditableTitle,
  ListSkeleton,
  nameTaken,
  RetryAlert,
} from '@/components/editing';
import { api, type Promotion } from '@/lib/api';

type Range = Pick<Promotion, 'startsOn' | 'endsOn'>;

export function formatRange({ startsOn, endsOn }: Range) {
  return `${startsOn} 至 ${endsOn}${endsOn < startsOn ? '（跨年）' : ''}`;
}

function rangeOf({ startsOn, endsOn }: Range): Range {
  return { startsOn, endsOn };
}

const rangeError = '日期格式应为 月-日';

export function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>();
  const [loadError, setLoadError] = useState<string>();
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    try {
      setPromotions(await api.promotions());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <PageContent>
      <PageHeader
        title="大促"
        actions={
          !creating && (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              新建大促
            </Button>
          )
        }
      />
      {loadError && <RetryAlert message={`加载失败：${loadError}`} onRetry={reload} />}
      {creating && (
        <NewPromotionForm
          onCancel={() => setCreating(false)}
          onCreated={async () => {
            await reload();
            setCreating(false);
          }}
        />
      )}
      <Panel>
        <PanelHeader title="全部大促" count={promotions?.length} />
        {!promotions && <ListSkeleton />}
        {promotions?.length === 0 && <EmptyState title="暂无大促" />}
        {promotions && promotions.length > 0 && (
          <List variant="ruled" aria-label="大促列表">
            {promotions.map((promotion) => (
              <ListRow key={promotion.id} asChild className="flex-col items-stretch justify-center gap-1.5 py-2.5">
                <li aria-label={promotion.name}>
                  <PromotionItem promotion={promotion} onChange={reload} />
                </li>
              </ListRow>
            ))}
          </List>
        )}
      </Panel>
    </PageContent>
  );
}

function RangeFields({ range, onChange }: { range: Range; onChange(range: Range): void }) {
  const id = useId();
  return (
    <>
      <Field label="开始（月-日）" htmlFor={`${id}-start`}>
        <Input
          id={`${id}-start`}
          required
          placeholder="05-31"
          className="numeric w-28"
          value={range.startsOn}
          onChange={(e) => onChange({ ...range, startsOn: e.target.value.trim() })}
        />
      </Field>
      <Field label="结束（月-日）" htmlFor={`${id}-end`}>
        <Input
          id={`${id}-end`}
          required
          placeholder="06-20"
          className="numeric w-28"
          value={range.endsOn}
          onChange={(e) => onChange({ ...range, endsOn: e.target.value.trim() })}
        />
      </Field>
    </>
  );
}

function NewPromotionForm({ onCreated, onCancel }: { onCreated(): Promise<void>; onCancel(): void }) {
  const id = useId();
  const [name, setName] = useState('');
  const [range, setRange] = useState<Range>({ startsOn: '', endsOn: '' });
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isMonthDay(range.startsOn) || !isMonthDay(range.endsOn)) return setError(rangeError);
    setPending(true);
    const message = await attempt(async () => {
      await api.createPromotion({ name: name.trim(), ...range });
      await onCreated();
    }, nameTaken);
    setPending(false);
    setError(message ?? undefined);
  }

  return (
    <Panel asChild>
      <form aria-label="新建大促" onSubmit={handleSubmit}>
        <PanelHeader title="新建大促" />
        <PanelBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="新大促名称" htmlFor={`${id}-name`} className="w-full sm:w-64">
              <Input
                id={`${id}-name`}
                required
                autoFocus
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <RangeFields range={range} onChange={setRange} />
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                新建大促
              </Button>
              <Button type="button" variant="ghost" onClick={onCancel}>
                取消
              </Button>
            </div>
          </div>
          {error && <Alert>{error}</Alert>}
        </PanelBody>
      </form>
    </Panel>
  );
}

function PromotionItem({ promotion, onChange }: { promotion: Promotion; onChange(): Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [range, setRange] = useState<Range>(() => rangeOf(promotion));
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isMonthDay(range.startsOn) || !isMonthDay(range.endsOn)) return setError(rangeError);
    setPending(true);
    const message = await attempt(async () => {
      await api.updatePromotion(promotion.id, range);
      await onChange();
    });
    setPending(false);
    setError(message ?? undefined);
    if (!message) setEditing(false);
  }

  return (
    <>
      <EditableTitle
        as="h3"
        name={promotion.name}
        label="大促名称"
        onRename={(name) =>
          attempt(async () => {
            await api.updatePromotion(promotion.id, { name });
            await onChange();
          }, nameTaken)
        }
        actions={
          !editing && (
            <>
              <span className="numeric mx-2 text-sm text-ink-3 wide:mx-0 wide:w-48">{formatRange(promotion)}</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setRange(rangeOf(promotion));
                  setError(undefined);
                  setEditing(true);
                }}
              >
                修改范围
              </Button>
            </>
          )
        }
      />
      {editing && (
        <form aria-label={`修改 ${promotion.name} 的日期范围`} className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-wrap items-end gap-3">
            <RangeFields range={range} onChange={setRange} />
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              保存范围
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
