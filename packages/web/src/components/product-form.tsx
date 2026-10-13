import { useId, useState, type FormEvent } from 'react';
import { isUnit, volumeUnits, weightUnits, type Unit } from '@stockup/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, attempt, fieldClass } from '@/components/editing';
import { api, type CategoryGroup, type Product } from '@/lib/api';
import { cn } from '@/lib/utils';

// The select's value is "dimension:name"; the count option leaves the name to a separate input.
const countUnit = 'count:';

// A product goes either into a known category or into one the member picks from the groups.
type Placement = { categoryId: string; groups?: never } | { categoryId?: never; groups: CategoryGroup[] };

export function NewProductForm({
  categoryId,
  groups,
  defaultName,
  className,
  onCancel,
  onCreated,
}: Placement & {
  defaultName?: string;
  className?: string;
  onCancel(): void;
  onCreated(product: Product): Promise<void>;
}) {
  const id = useId();
  const [unitChoice, setUnitChoice] = useState(countUnit);
  const [countName, setCountName] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const separator = unitChoice.indexOf(':');
  const dimension = unitChoice.slice(0, separator) as Unit['dimension'];
  const choiceName = unitChoice.slice(separator + 1);
  const pricingUnit = { dimension, name: dimension === 'count' ? countName.trim() : choiceName };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!isUnit(pricingUnit)) {
      setError('请填写计数单位的名称，比如「抽」「片」，不能和重量或体积单位同名。');
      return;
    }
    const baseSize = Number(data.get('baseSize'));
    if (!(baseSize > 0)) {
      setError('基准规格必须大于 0。');
      return;
    }
    setPending(true);
    setError(
      (await attempt(async () => {
        const product = await api.createProduct({
          categoryId: categoryId ?? String(data.get('categoryId')),
          name: String(data.get('name')),
          pricingUnit,
          baseSize,
          note: String(data.get('note')),
        });
        await onCreated(product);
      })) ?? undefined,
    );
    setPending(false);
  }

  return (
    <form aria-label="新建商品" className={cn('flex flex-col gap-3 rounded-lg border p-3', className)} onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-name`}>商品名称</Label>
        <Input
          id={`${id}-name`}
          name="name"
          required
          maxLength={100}
          autoFocus
          placeholder="得宝抽纸 M 码"
          defaultValue={defaultName}
        />
      </div>
      {groups && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-category`}>所属品类</Label>
          <select id={`${id}-category`} name="categoryId" required className={cn(fieldClass, 'h-9')} defaultValue="">
            <option value="" disabled>
              选择品类
            </option>
            {groups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {groups.every((g) => g.categories.length === 0) && (
            <p className="text-muted-foreground text-xs">还没有品类，先在「商品」页添加。</p>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-unit`}>计价单位</Label>
          <select
            id={`${id}-unit`}
            className={cn(fieldClass, 'h-9')}
            value={unitChoice}
            onChange={(event) => setUnitChoice(event.target.value)}
          >
            <option value={countUnit}>计数（自定义名称）</option>
            <optgroup label="重量">
              {weightUnits.map((name) => (
                <option key={name} value={`weight:${name}`}>
                  {name}
                </option>
              ))}
            </optgroup>
            <optgroup label="体积">
              {volumeUnits.map((name) => (
                <option key={name} value={`volume:${name}`}>
                  {name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        {dimension === 'count' && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-count`}>计数单位名称</Label>
            <Input
              id={`${id}-count`}
              required
              maxLength={10}
              placeholder="抽、片、卷、颗"
              value={countName}
              onChange={(event) => setCountName(event.target.value)}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-base`}>基准规格</Label>
        <div className="flex items-center gap-2">
          <Input id={`${id}-base`} name="baseSize" type="number" inputMode="decimal" min="0" step="any" required className="max-w-40" />
          <span className="text-muted-foreground text-sm">{pricingUnit.name}</span>
        </div>
        <p className="text-muted-foreground text-xs">单价按这个量显示，如 90 抽、25 磅、500 g。</p>
      </div>
      <NoteField id={`${id}-note`} />
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          创建商品
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

export function NoteField({ id, defaultValue }: { id: string; defaultValue?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>备注</Label>
      <textarea
        id={id}
        name="note"
        rows={2}
        maxLength={500}
        defaultValue={defaultValue}
        placeholder="可互换的变体，如香型、颜色"
        className={cn(fieldClass, 'py-2')}
      />
    </div>
  );
}
