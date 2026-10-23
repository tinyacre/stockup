import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DropdownMenu } from 'radix-ui';
import { Archive, ArchiveRestore, Combine, Ellipsis, Ruler } from 'lucide-react';
import { convert, isConvertible } from '@stockup/domain';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { InputGroup, InputGroupInput, InputAddon } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Panel, PanelBody, PanelFooter, PanelHeader } from '@/components/ui/panel';
import { Alert, attempt } from '@/components/editing';
import { api, type Product } from '@/lib/api';
import { formatSize } from '@/lib/format';
import { loadErrorOf, queries } from '@/lib/queries';
import { unitsLike } from '@/lib/pricing';
import { cn } from '@/lib/utils';

const incompatibleUnit = { incompatible_unit: '单位量纲不同，无法换算' };

export type MaintenanceTask = 'units' | 'merge';

const itemClass = cn(
  'flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px] text-ink outline-none select-none',
  'data-highlighted:bg-surface-hover data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-ink-3',
);

export function ProductMenu({
  product,
  disabled,
  onOpen,
  onArchive,
}: {
  product: Product;
  disabled?: boolean;
  onOpen(task: MaintenanceTask): void;
  onArchive(archived: boolean): void;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button variant="outline" size="icon" aria-label="更多操作" disabled={disabled}>
          <Ellipsis />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-52 rounded-md border border-line bg-surface p-1 shadow-overlay"
        >
          <DropdownMenu.Item className={itemClass} onSelect={() => onOpen('units')}>
            <Ruler />
            修改计价单位和基准规格
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} onSelect={() => onOpen('merge')}>
            <Combine />
            合并重复商品
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-line" />
          {product.archived ? (
            <DropdownMenu.Item className={itemClass} onSelect={() => onArchive(false)}>
              <ArchiveRestore />
              取消归档
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item
              className={cn(itemClass, 'text-record-low [&_svg]:text-record-low')}
              onSelect={() => onArchive(true)}
            >
              <Archive />
              归档商品
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function ProductMaintenance({
  product,
  task,
  onClose,
  onChanged,
}: {
  product: Product;
  task: MaintenanceTask;
  onClose(): void;
  onChanged(): Promise<void>;
}) {
  const done = async () => {
    onClose();
    await onChanged();
    toast.success(task === 'units' ? '已修改计价单位' : '已合并商品');
  };
  return task === 'units' ? (
    <UnitsForm product={product} onCancel={onClose} onSaved={done} />
  ) : (
    <MergeForm product={product} onCancel={onClose} onMerged={done} />
  );
}

function TaskPanel({
  title,
  onSubmit,
  error,
  footer,
  children,
}: {
  title: string;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  error?: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel asChild>
      <form aria-label={title} onSubmit={onSubmit}>
        <PanelHeader title={title} as="h3" />
        <PanelBody className="flex flex-col gap-4">
          {children}
          {error && <Alert>{error}</Alert>}
        </PanelBody>
        <PanelFooter>{footer}</PanelFooter>
      </form>
    </Panel>
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
    if (!(amount > 0)) return setError('基准规格需大于 0');
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
    <TaskPanel
      title="修改计价单位和基准规格"
      onSubmit={handleSubmit}
      error={error}
      footer={
        <>
          <Button type="submit" disabled={pending}>
            保存
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
        </>
      }
    >
      <div className="grid gap-4 wide:max-w-lg wide:grid-cols-2">
        <Field
          label="计价单位"
          htmlFor={`${id}-unit`}
          hint={units.length === 1 ? '计数单位无法换算' : '已有记录的规格随单位换算，单价不变'}
        >
          <NativeSelect
            id={`${id}-unit`}
            value={unitName}
            disabled={units.length === 1}
            onChange={(event) => changeUnit(event.target.value)}
          >
            {units.map((u) => (
              <option key={u.name} value={u.name}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="基准规格" htmlFor={`${id}-base`} hint="入手价随基准规格同比换算">
          <InputGroup>
            <InputGroupInput
              id={`${id}-base`}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              required
              className="numeric"
              value={baseSize}
              onChange={(event) => setBaseSize(event.target.value)}
            />
            <InputAddon boxed>{unit.name}</InputAddon>
          </InputGroup>
        </Field>
      </div>
    </TaskPanel>
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
  const all = useQuery(queries.products(undefined, { includeArchived: true }));
  const candidates = all.data?.filter((p) => p.id !== product.id);
  const [mergedId, setMergedId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [actionError, setError] = useState<string>();
  const error = actionError ?? loadErrorOf(all.error);
  const [pending, setPending] = useState(false);

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
    }, { ...incompatibleUnit, product_not_found: '要合并的商品已不存在' });
    setError(message ?? undefined);
    setConfirming(false);
    setPending(false);
  }

  return (
    <TaskPanel
      title="合并重复商品"
      onSubmit={handleSubmit}
      error={error}
      footer={
        <>
          <Button type="submit" variant={confirming ? 'destructive' : 'default'} disabled={!merged || pending}>
            {confirming && merged ? `确认合并并删除「${merged.name}」` : '合并'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
        </>
      }
    >
      <Field
        label={`要并入「${product.name}」的重复商品`}
        htmlFor={`${id}-merged`}
        hint={`价格记录并入本商品，规格换算为 ${product.pricingUnit.name}，原商品随后删除`}
        className="wide:max-w-lg"
      >
        <NativeSelect
          id={`${id}-merged`}
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
        </NativeSelect>
      </Field>
    </TaskPanel>
  );
}
