import { useId, useState, type ComponentProps, type FormEvent } from 'react';
import { isUnit, volumeUnits, weightUnits, type Unit } from '@stockup/domain';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, InputAddon, InputGroup, InputGroupInput, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Panel, PanelBody, PanelFooter, PanelHeader } from '@/components/ui/panel';
import { Alert, attempt } from '@/components/editing';
import { api, type CategoryGroup, type Placement, type Product } from '@/lib/api';
import { outsideCategories, parsePlacementKey, placementKey } from '@/lib/catalog';

// The select's value is "dimension:name"; the count option leaves the name to a separate input.
const countUnit = 'count:';

// A product goes either into a known placement or into one the member picks from the groups.
type Destination = { placement: Placement; groups?: never } | { placement?: never; groups: CategoryGroup[] };

// Each group offers itself first, for products outside its categories.
export function PlacementSelect({
  groups,
  ...props
}: { groups: CategoryGroup[] } & ComponentProps<typeof NativeSelect>) {
  return (
    <NativeSelect {...props}>
      {props.defaultValue === '' && (
        <option value="" disabled>
          选择品类
        </option>
      )}
      {groups.map((g) => (
        <optgroup key={g.id} label={g.name}>
          <option value={placementKey({ categoryGroupId: g.id })}>{outsideCategories}</option>
          {g.categories.map((c) => (
            <option key={c.id} value={placementKey({ categoryId: c.id })}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </NativeSelect>
  );
}

export function NewProductForm({
  placement,
  groups,
  defaultName,
  className,
  onCancel,
  onCreated,
}: Destination & {
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
      setError('计数单位名称不能为空，也不能与重量或体积单位同名');
      return;
    }
    const baseSize = Number(data.get('baseSize'));
    if (!(baseSize > 0)) {
      setError('基准规格需大于 0');
      return;
    }
    setPending(true);
    setError(
      (await attempt(async () => {
        const product = await api.createProduct({
          ...(placement ?? parsePlacementKey(String(data.get('placement')))!),
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
    <Panel asChild className={className}>
      <form aria-label="新建商品" onSubmit={handleSubmit}>
        <PanelHeader title="新建商品" as="h3" />
        <PanelBody className="flex flex-col gap-4">
          <Field label="商品名称" htmlFor={`${id}-name`}>
            <Input id={`${id}-name`} name="name" required maxLength={100} autoFocus defaultValue={defaultName} />
          </Field>
          {groups && (
            <Field label="所属品类" htmlFor={`${id}-category`} hint={groups.length === 0 && '暂无大类'}>
              <PlacementSelect
                id={`${id}-category`}
                name="placement"
                required
                defaultValue=""
                className="w-full"
                groups={groups}
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="计价单位" htmlFor={`${id}-unit`}>
              <NativeSelect
                id={`${id}-unit`}
                className="w-full"
                value={unitChoice}
                onChange={(event) => setUnitChoice(event.target.value)}
              >
                <option value={countUnit}>计数</option>
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
              </NativeSelect>
            </Field>
            {dimension === 'count' && (
              <Field label="计数单位名称" htmlFor={`${id}-count`}>
                <Input
                  id={`${id}-count`}
                  required
                  maxLength={10}
                  value={countName}
                  onChange={(event) => setCountName(event.target.value)}
                />
              </Field>
            )}
          </div>
          <Field label="基准规格" htmlFor={`${id}-base`} hint="单价按此规格显示">
            <InputGroup className="max-w-48">
              <InputGroupInput
                id={`${id}-base`}
                name="baseSize"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                required
                className="numeric"
              />
              {pricingUnit.name && <InputAddon boxed>{pricingUnit.name}</InputAddon>}
            </InputGroup>
          </Field>
          <NoteField id={`${id}-note`} />
          {error && <Alert>{error}</Alert>}
        </PanelBody>
        <PanelFooter>
          <Button type="submit" disabled={pending}>
            创建商品
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
        </PanelFooter>
      </form>
    </Panel>
  );
}

export function NoteField({ id, defaultValue }: { id: string; defaultValue?: string }) {
  return (
    <Field label="备注" htmlFor={id}>
      <Textarea id={id} name="note" rows={2} maxLength={500} defaultValue={defaultValue} />
    </Field>
  );
}
