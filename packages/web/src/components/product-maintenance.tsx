import { useEffect, useId, useState, type FormEvent } from 'react';
import { convert, isConvertible } from '@stockup/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, attempt, describeError, fieldClass } from '@/components/editing';
import { api, type Product } from '@/lib/api';
import { formatSize } from '@/lib/format';
import { unitsLike } from '@/lib/pricing';
import { cn } from '@/lib/utils';

const incompatibleUnit = { incompatible_unit: '不同量纲的单位之间无法换算，请新建一个商品。' };

type Panel = 'units' | 'merge';

export function ProductMaintenance({
  product,
  onChanged,
}: {
  product: Product;
  onChanged(): Promise<void>;
}) {
  const [open, setOpen] = useState<Panel>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function setArchived(archived: boolean) {
    setPending(true);
    setError(
      (await attempt(async () => {
        await api.updateProduct(product.id, { archived });
        await onChanged();
      })) ?? undefined,
    );
    setPending(false);
  }

  const done = async () => {
    setOpen(undefined);
    await onChanged();
  };

  return (
    <section aria-label="商品维护" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {product.archived && <span className="bg-muted rounded px-1.5 py-0.5 text-xs">已归档</span>}
        <Button variant="outline" size="xs" onClick={() => setOpen(open === 'units' ? undefined : 'units')}>
          修改计价单位和基准规格
        </Button>
        <Button variant="outline" size="xs" onClick={() => setOpen(open === 'merge' ? undefined : 'merge')}>
          合并重复商品
        </Button>
        <Button variant="outline" size="xs" disabled={pending} onClick={() => setArchived(!product.archived)}>
          {product.archived ? '取消归档' : '归档商品'}
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
      {open === 'units' && <UnitsForm product={product} onCancel={() => setOpen(undefined)} onSaved={done} />}
      {open === 'merge' && <MergeForm product={product} onCancel={() => setOpen(undefined)} onMerged={done} />}
    </section>
  );
}

function UnitsForm({
  product,
  onCancel,
  onSaved,
}: {
  product: Product;
  onCancel(): void;
  onSaved(): Promise<void>;
}) {
  const id = useId();
  const [unitName, setUnitName] = useState(product.pricingUnit.name);
  const units = unitsLike(product.pricingUnit);
  const unit = units.find((u) => u.name === unitName)!;
  const [baseSize, setBaseSize] = useState(String(product.baseSize));
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  // The base size follows the unit, so switching g to kg keeps the same quantity until the member edits it.
  function changeUnit(name: string) {
    const next = units.find((u) => u.name === name)!;
    const amount = Number(baseSize);
    if (amount > 0) setBaseSize(String(Number(convert(amount, unit, next).toFixed(6))));
    setUnitName(name);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(baseSize);
    if (!(amount > 0)) return setError('基准规格必须大于 0。');
    setPending(true);
    const message = await attempt(async () => {
      await api.updateProduct(product.id, {
        ...(unit.name === product.pricingUnit.name ? {} : { pricingUnit: unit }),
        baseSize: amount,
      });
      await onSaved();
    }, incompatibleUnit);
    setError(message ?? undefined);
    setPending(false);
  }

  return (
    <form aria-label="修改计价单位和基准规格" className="flex flex-col gap-3 rounded-lg border p-3" onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-unit`}>计价单位</Label>
          <select
            id={`${id}-unit`}
            className={cn(fieldClass, 'h-9')}
            value={unitName}
            disabled={units.length === 1}
            onChange={(event) => changeUnit(event.target.value)}
          >
            {units.map((u) => (
              <option key={u.name} value={u.name}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-base`}>基准规格</Label>
          <div className="flex items-center gap-2">
            <Input
              id={`${id}-base`}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              required
              value={baseSize}
              onChange={(event) => setBaseSize(event.target.value)}
            />
            <span className="text-muted-foreground text-sm">{unit.name}</span>
          </div>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        {units.length === 1
          ? `计数单位「${unit.name}」无法换算成别的单位；要换单位，请新建一个商品。`
          : '换单位时，已有价格记录的规格会自动换算，单价不变；要换成其他量纲的单位，请新建一个商品。'}
        改基准规格只改变单价的显示口径，入手价按同样比例换算。
      </p>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          保存
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

function MergeForm({
  product,
  onCancel,
  onMerged,
}: {
  product: Product;
  onCancel(): void;
  onMerged(): Promise<void>;
}) {
  const id = useId();
  const [candidates, setCandidates] = useState<Product[]>();
  const [mergedId, setMergedId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api.products(undefined, { includeArchived: true }).then(
      (products) => setCandidates(products.filter((p) => p.id !== product.id)),
      (e) => setError(describeError(e)),
    );
  }, [product.id]);

  const compatible = candidates?.filter((p) => isConvertible(p.pricingUnit, product.pricingUnit)) ?? [];
  const merged = compatible.find((p) => p.id === mergedId);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!merged) return;
    if (!confirming) return setConfirming(true);
    setPending(true);
    const message = await attempt(async () => {
      await api.mergeProduct(product.id, merged.id);
      await onMerged();
    }, { ...incompatibleUnit, product_not_found: '要合并的商品已经不存在了。' });
    setError(message ?? undefined);
    setConfirming(false);
    setPending(false);
  }

  return (
    <form aria-label="合并重复商品" className="flex flex-col gap-3 rounded-lg border p-3" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-merged`}>要并入「{product.name}」的重复商品</Label>
        <select
          id={`${id}-merged`}
          className={cn(fieldClass, 'h-9')}
          value={mergedId}
          disabled={!candidates}
          onChange={(event) => {
            setMergedId(event.target.value);
            setConfirming(false);
          }}
        >
          <option value="" disabled>
            选择商品
          </option>
          {compatible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{formatSize(p.baseSize, p.pricingUnit)}）{p.archived ? '（已归档）' : ''}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          被合并商品的全部价格记录会归到这个商品下，规格按{product.pricingUnit.name}换算，然后删除被合并的商品。
          计价单位无法换算成{product.pricingUnit.name}的商品不能合并。
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" variant={confirming ? 'destructive' : 'default'} disabled={!merged || pending}>
          {confirming && merged ? `确认合并并删除「${merged.name}」` : '合并'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
