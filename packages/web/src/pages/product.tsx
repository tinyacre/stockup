import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ChevronLeft, Plus, X } from 'lucide-react';
import {
  calculatePrice,
  IncompatibleUnitsError,
  parseQuantity,
  volumeUnits,
  weightUnits,
  type Price,
  type Unit,
} from '@stockup/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, attempt, DeleteButton, describeError, fieldClass, RetryAlert } from '@/components/editing';
import { api, ApiError, type Channel, type PriceRecord, type PriceRecordInput, type Product } from '@/lib/api';
import { formatSize, formatYuan } from '@/lib/format';
import { cn } from '@/lib/utils';

function formatUnitPrice(unitPrice: number, product: Product) {
  return `${formatYuan(unitPrice)} / ${formatSize(product.baseSize, product.pricingUnit)}`;
}

function parseYuan(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

function today() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function unitsLike(unit: Unit): Unit[] {
  if (unit.dimension === 'weight') return weightUnits.map((name) => ({ dimension: 'weight', name }));
  if (unit.dimension === 'volume') return volumeUnits.map((name) => ({ dimension: 'volume', name }));
  return [unit];
}

const recordErrors = {
  channel_not_found: '这个渠道已不存在，请重新选择。',
  incompatible_unit: '规格的单位和商品的计价单位不是同一量纲。',
  invalid_price: '优惠之和必须小于原价。',
};

export function ProductPage({ productId, onBack }: { productId: string; onBack(categoryId?: string): void }) {
  const [product, setProduct] = useState<Product | null>();
  const [records, setRecords] = useState<PriceRecord[]>();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const [loadedProduct, loadedRecords, loadedChannels] = await Promise.all([
        api.product(productId),
        api.priceRecords(productId),
        api.channels(),
      ]);
      setProduct(loadedProduct);
      setRecords(loadedRecords);
      setChannels(loadedChannels);
      setLoadError(undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return setProduct(null);
      setLoadError(describeError(error));
    }
  }, [productId]);
  useEffect(() => {
    reload();
  }, [reload]);

  const back = (
    <Button variant="ghost" size="sm" className="self-start" onClick={() => onBack(product?.categoryId)}>
      <ChevronLeft />
      商品列表
    </Button>
  );
  const loadAlert = loadError && <RetryAlert message={`价格记录加载失败：${loadError}`} onRetry={reload} />;

  if (product === null) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        {back}
        <p className="text-muted-foreground text-sm">找不到这个商品，它可能已被删除。</p>
      </div>
    );
  }
  if (!product) return loadAlert ? <div className="p-4">{loadAlert}</div> : null;

  const saved = async () => {
    setCreating(false);
    setEditingId(undefined);
    await reload();
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      {back}
      <div>
        <h2 className="text-xl font-semibold">{product.name}</h2>
        <p className="text-muted-foreground text-sm">
          计价单位 {product.pricingUnit.name} · 基准规格 {formatSize(product.baseSize, product.pricingUnit)}
        </p>
        {product.note && <p className="text-muted-foreground mt-1 text-sm whitespace-pre-wrap">{product.note}</p>}
      </div>
      {loadAlert}

      <div className="flex items-center justify-between">
        <h3 className="font-medium">价格记录</h3>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            记录价格
          </Button>
        )}
      </div>
      {creating && (
        <PriceRecordForm product={product} channels={channels} onCancel={() => setCreating(false)} onSaved={saved} />
      )}
      {records?.length === 0 && !creating && <p className="text-muted-foreground text-sm">还没有价格记录。</p>}
      <ul aria-label="价格记录列表" className="flex flex-col gap-2">
        {records?.map((record) => (
          <li
            key={record.id}
            aria-label={`${record.date} ${record.channel.name}`}
            className="rounded-lg border p-3"
          >
            {editingId === record.id ? (
              <PriceRecordForm
                product={product}
                channels={channels}
                record={record}
                onCancel={() => setEditingId(undefined)}
                onSaved={saved}
              />
            ) : (
              <PriceRecordItem
                record={record}
                product={product}
                onEdit={() => setEditingId(record.id)}
                onDelete={() =>
                  attempt(async () => {
                    await api.deletePriceRecord(record.id);
                    await reload();
                  })
                }
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PriceRecordItem({
  record,
  product,
  onEdit,
  onDelete,
}: {
  record: PriceRecord;
  product: Product;
  onEdit(): void;
  onDelete(): Promise<string | void>;
}) {
  const { enteredSize, size } = record;
  const converted = enteredSize.unit.name !== size.unit.name;
  const discountTotal = record.listPrice - record.netPrice;

  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="tabular-nums">{record.date}</span>
        <span>{record.channel.name}</span>
        <span className="bg-muted rounded px-1.5 py-0.5 text-xs">{record.purchased ? '已购' : '仅记录'}</span>
        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={onEdit}>
            编辑
          </Button>
          <DeleteButton label={`删除 ${record.date} ${record.channel.name} 的价格记录`} onDelete={onDelete} />
        </span>
      </div>
      <p>
        单价 <span className="text-base font-semibold tabular-nums">{formatUnitPrice(record.unitPrice, product)}</span>
        <span className="text-muted-foreground"> · 到手价 </span>
        <span className="tabular-nums">{formatYuan(record.netPrice)}</span>
      </p>
      <p className="text-muted-foreground tabular-nums">
        原价 {formatYuan(record.listPrice)}
        {discountTotal > 0 && ` − 优惠 ${formatYuan(discountTotal)}`} · {record.quantity} 件 ×{' '}
        {formatSize(size.amount, size.unit)}
        {converted && `（录入为 ${formatSize(enteredSize.amount, enteredSize.unit)}）`}
      </p>
      {record.discounts.length > 0 && (
        <ul aria-label="优惠" className="text-muted-foreground flex flex-wrap gap-x-3">
          {record.discounts.map((d, i) => (
            <li key={i}>
              {d.name ?? '优惠'} {formatYuan(d.amount)}
            </li>
          ))}
        </ul>
      )}
      {record.note && <p className="whitespace-pre-wrap">{record.note}</p>}
      <p className="text-muted-foreground text-xs">录入人 {record.recordedBy?.name ?? '已离开的成员'}</p>
    </div>
  );
}

interface DiscountDraft {
  key: number;
  amount: string;
  name: string;
}

let nextDiscountKey = 0;

function discountDraft(amount = '', name = ''): DiscountDraft {
  return { key: nextDiscountKey++, amount, name };
}

// Reads the drafts into an input, or explains the first field that does not parse.
function readForm(
  product: Product,
  draft: {
    listPrice: string;
    discounts: DiscountDraft[];
    quantity: string;
    sizeAmount: string;
    sizeUnitName: string;
  },
): { input: Omit<PriceRecordInput, 'date' | 'channelId' | 'purchased' | 'note'> } | { error: string } {
  const listPrice = parseYuan(draft.listPrice);
  if (listPrice === null || listPrice === 0) return { error: '请填写原价，最多两位小数。' };
  const discounts = [];
  for (const d of draft.discounts) {
    if (!d.amount.trim() && !d.name.trim()) continue;
    const amount = parseYuan(d.amount);
    if (amount === null || amount === 0) return { error: '请填写每项优惠的金额，最多两位小数。' };
    discounts.push(d.name.trim() ? { amount, name: d.name.trim() } : { amount });
  }
  const quantity = parseQuantity(draft.quantity);
  if (quantity === null) return { error: '件数应为正整数，可以写成 3 × 6。' };
  const sizeAmount = Number(draft.sizeAmount);
  if (!draft.sizeAmount.trim() || !(sizeAmount > 0)) return { error: '请填写规格，必须大于 0。' };
  const unit = unitsLike(product.pricingUnit).find((u) => u.name === draft.sizeUnitName) ?? product.pricingUnit;
  return { input: { listPrice, discounts, quantity, size: { amount: sizeAmount, unit } } };
}

function preview(input: Parameters<typeof calculatePrice>[0]): Price | string {
  try {
    return calculatePrice(input);
  } catch (error) {
    if (error instanceof IncompatibleUnitsError) return recordErrors.incompatible_unit;
    return recordErrors.invalid_price;
  }
}

function PriceRecordForm({
  product,
  channels,
  record,
  onCancel,
  onSaved,
}: {
  product: Product;
  channels: Channel[];
  record?: PriceRecord;
  onCancel(): void;
  onSaved(): Promise<void>;
}) {
  const id = useId();
  const [date, setDate] = useState(record?.date ?? today());
  // An archived channel stays selectable on the record that already names it.
  const choices = channels.filter((c) => !c.archived || c.id === record?.channel.id);
  const [channelId, setChannelId] = useState(record?.channel.id ?? choices[0]?.id ?? '');
  const [purchased, setPurchased] = useState(record?.purchased ?? true);
  const [listPrice, setListPrice] = useState(record ? (record.listPrice / 100).toFixed(2) : '');
  const [discounts, setDiscounts] = useState<DiscountDraft[]>(() =>
    record?.discounts.length
      ? record.discounts.map((d) => discountDraft((d.amount / 100).toFixed(2), d.name ?? ''))
      : [discountDraft()],
  );
  const [quantity, setQuantity] = useState(record ? String(record.quantity) : '1');
  const [sizeAmount, setSizeAmount] = useState(record ? String(record.enteredSize.amount) : '');
  const [sizeUnitName, setSizeUnitName] = useState(record?.enteredSize.unit.name ?? product.pricingUnit.name);
  const [note, setNote] = useState(record?.note ?? '');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const read = readForm(product, { listPrice, discounts, quantity, sizeAmount, sizeUnitName });
  const price =
    'input' in read
      ? preview({ ...read.input, pricingUnit: product.pricingUnit, baseSize: product.baseSize })
      : null;
  const parsedQuantity = parseQuantity(quantity);

  const updateDiscount = (key: number, change: Partial<DiscountDraft>) =>
    setDiscounts((all) => all.map((d) => (d.key === key ? { ...d, ...change } : d)));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ('error' in read) return setError(read.error);
    if (typeof price === 'string') return setError(price);
    if (!channelId) return setError('请选择渠道。');
    const input = { ...read.input, date, channelId, purchased, note };
    setPending(true);
    setError(
      (await attempt(async () => {
        if (record) await api.replacePriceRecord(record.id, input);
        else await api.createPriceRecord({ ...input, productId: product.id });
        await onSaved();
      }, recordErrors)) ?? undefined,
    );
    setPending(false);
  }

  return (
    <form
      aria-label={record ? '编辑价格记录' : '新建价格记录'}
      className="flex flex-col gap-3 rounded-lg border p-3"
      onSubmit={handleSubmit}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-date`}>日期</Label>
          <Input id={`${id}-date`} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-channel`}>渠道</Label>
          <select
            id={`${id}-channel`}
            className={cn(fieldClass, 'h-9')}
            required
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
          >
            {choices.length === 0 && <option value="">先在「渠道」页添加渠道</option>}
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.archived ? `${c.name}（已归档）` : c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">已购还是仅记录</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="purchased" checked={purchased} onChange={() => setPurchased(true)} />
          已购
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="purchased" checked={!purchased} onChange={() => setPurchased(false)} />
          仅记录
        </label>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-list`}>原价（元）</Label>
        <Input
          id={`${id}-list`}
          inputMode="decimal"
          required
          placeholder="99.00"
          className="max-w-40"
          value={listPrice}
          onChange={(e) => setListPrice(e.target.value)}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">优惠</legend>
        {discounts.map((d, i) => (
          <div key={d.key} className="flex gap-2">
            <Input
              aria-label={`优惠 ${i + 1} 金额（元）`}
              inputMode="decimal"
              placeholder="金额"
              className="max-w-28"
              value={d.amount}
              onChange={(e) => updateDiscount(d.key, { amount: e.target.value })}
            />
            <Input
              aria-label={`优惠 ${i + 1} 名称`}
              placeholder="名称（可选），如 满 199 减 100"
              maxLength={50}
              value={d.name}
              onChange={(e) => updateDiscount(d.key, { name: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`移除优惠 ${i + 1}`}
              onClick={() => setDiscounts((all) => all.filter((x) => x.key !== d.key))}
            >
              <X />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setDiscounts((all) => [...all, discountDraft()])}
        >
          <Plus />
          添加优惠
        </Button>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-quantity`}>件数</Label>
          <Input
            id={`${id}-quantity`}
            required
            placeholder="3 × 6"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            {parsedQuantity !== null && /[×✕xX*＊]/.test(quantity) ? `共 ${parsedQuantity} 件，` : ''}赠品也计入件数
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-size`}>每件规格</Label>
          <div className="flex gap-2">
            <Input
              id={`${id}-size`}
              inputMode="decimal"
              required
              placeholder="130"
              value={sizeAmount}
              onChange={(e) => setSizeAmount(e.target.value)}
            />
            <select
              aria-label="规格单位"
              className={cn(fieldClass, 'h-9 w-20 shrink-0')}
              value={sizeUnitName}
              onChange={(e) => setSizeUnitName(e.target.value)}
            >
              {unitsLike(product.pricingUnit).map((u) => (
                <option key={u.name} value={u.name}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-note`}>备注</Label>
        <textarea
          id={`${id}-note`}
          rows={2}
          maxLength={500}
          placeholder="如 凑单买的洗衣液"
          className={cn(fieldClass, 'py-2')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <output aria-label="价格预览" className="bg-muted/50 flex flex-wrap gap-x-4 rounded-md px-3 py-2 text-sm">
        {price === null && <span className="text-muted-foreground">填写原价、件数和规格后显示到手价和单价</span>}
        {typeof price === 'string' && <span className="text-destructive">{price}</span>}
        {price !== null && typeof price === 'object' && (
          <>
            <span>
              到手价 <span className="font-semibold tabular-nums">{formatYuan(price.netPrice)}</span>
            </span>
            <span>
              单价 <span className="font-semibold tabular-nums">{formatUnitPrice(price.unitPrice, product)}</span>
            </span>
          </>
        )}
      </output>

      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {record ? '保存' : '保存记录'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
