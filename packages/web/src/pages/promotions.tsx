import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { isMonthDay } from '@stockup/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, attempt, describeError, EditableTitle, nameTaken, RetryAlert } from '@/components/editing';
import { api, type Promotion } from '@/lib/api';

type Range = Pick<Promotion, 'startsOn' | 'endsOn'>;

export function formatRange({ startsOn, endsOn }: Range) {
  return `${startsOn} 至 ${endsOn}${endsOn < startsOn ? '（跨年）' : ''}`;
}

function rangeOf({ startsOn, endsOn }: Range): Range {
  return { startsOn, endsOn };
}

const rangeError = '日期请写成 月-日，如 05-31。';

export function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>();
  const [loadError, setLoadError] = useState<string>();

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
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <div>
        <h2 className="text-xl font-semibold">大促</h2>
        <p className="text-muted-foreground text-sm">
          每年按这些日期范围自动标注价格记录；多个大促重叠时取范围最短的一个。修改范围只影响之后新建的记录。
        </p>
      </div>
      {loadError && <RetryAlert message={`大促加载失败：${loadError}`} onRetry={reload} />}
      <NewPromotionForm onCreated={reload} />
      {promotions && (
        <ul aria-label="大促列表" className="flex flex-col gap-2">
          {promotions.map((promotion) => (
            <li key={promotion.id} aria-label={promotion.name} className="rounded-lg border px-3 py-2">
              <PromotionItem promotion={promotion} onChange={reload} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RangeFields({ range, onChange }: { range: Range; onChange(range: Range): void }) {
  const id = useId();
  return (
    <div className="flex gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-start`}>开始（月-日）</Label>
        <Input
          id={`${id}-start`}
          required
          placeholder="05-31"
          className="w-28"
          value={range.startsOn}
          onChange={(e) => onChange({ ...range, startsOn: e.target.value.trim() })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-end`}>结束（月-日）</Label>
        <Input
          id={`${id}-end`}
          required
          placeholder="06-20"
          className="w-28"
          value={range.endsOn}
          onChange={(e) => onChange({ ...range, endsOn: e.target.value.trim() })}
        />
      </div>
    </div>
  );
}

function NewPromotionForm({ onCreated }: { onCreated(): Promise<void> }) {
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
    if (message) return;
    setName('');
    setRange({ startsOn: '', endsOn: '' });
  }

  return (
    <form aria-label="新建大促" className="flex flex-col gap-3 rounded-lg border p-3" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-name`}>新大促名称</Label>
        <Input
          id={`${id}-name`}
          required
          maxLength={50}
          placeholder="如 超市周年庆"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <RangeFields range={range} onChange={setRange} />
      {error && <Alert>{error}</Alert>}
      <Button type="submit" variant="outline" className="self-start" disabled={pending}>
        新建大促
      </Button>
    </form>
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
    <div className="flex flex-col gap-2">
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
      />
      {editing ? (
        <form aria-label={`修改 ${promotion.name} 的日期范围`} className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <RangeFields range={range} onChange={setRange} />
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
      ) : (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground tabular-nums">{formatRange(promotion)}</span>
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => {
              setRange(rangeOf(promotion));
              setError(undefined);
              setEditing(true);
            }}
          >
            修改范围
          </Button>
        </div>
      )}
    </div>
  );
}
