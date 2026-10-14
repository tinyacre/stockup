import { lazy, Suspense, useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ChevronLeft, Plus, X } from 'lucide-react';
import { judge } from '@stockup/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, attempt, DeleteButton, describeError, fieldClass, RetryAlert } from '@/components/editing';
import { ProductMaintenance } from '@/components/product-maintenance';
import { JudgmentSummary } from '@/components/verdict';
import {
  api,
  ApiError,
  type Channel,
  type PriceRecord,
  type Product,
  type ProductDetail,
  type Promotion,
} from '@/lib/api';
import { formatSize, formatYuan } from '@/lib/format';
import {
  discountDraft,
  formatUnitPrice,
  lastYearPromotionLowest,
  lowestOf,
  matchDate,
  multipliedQuantity,
  parseYuan,
  preview,
  readPriceDraft,
  recordErrors,
  today,
  unitsLike,
  type DiscountDraft,
} from '@/lib/pricing';
import { cn } from '@/lib/utils';

// Recharts is most of the bundle's weight, so only the product page loads it.
const UnitPriceChart = lazy(() =>
  import('@/components/unit-price-chart').then((m) => ({ default: m.UnitPriceChart })),
);

export function ProductPage({ productId, onBack }: { productId: string; onBack(categoryId?: string): void }) {
  const [product, setProduct] = useState<ProductDetail | null>();
  const [records, setRecords] = useState<PriceRecord[]>();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [filter, setFilter] = useState<RecordFilter>({});

  const reload = useCallback(async () => {
    try {
      const [loadedProduct, loadedRecords, loadedChannels, loadedPromotions] = await Promise.all([
        api.product(productId),
        api.priceRecords(productId),
        api.channels(),
        api.promotions(),
      ]);
      setProduct(loadedProduct);
      setRecords(loadedRecords);
      setChannels(loadedChannels);
      setPromotions(loadedPromotions);
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

  const filtering = Object.values(filter).some((v) => v !== undefined);
  const shown = records?.filter((r) => matches(r, filter));

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
      <ProductMaintenance product={product} onChanged={reload} />
      {loadAlert}
      <StockLineSection product={product} records={records ?? []} onSaved={reload} />

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
        <PriceRecordForm
          product={product}
          channels={channels}
          promotions={promotions}
          records={records ?? []}
          onCancel={() => setCreating(false)}
          onSaved={saved}
        />
      )}
      {records?.length === 0 && !creating && <p className="text-muted-foreground text-sm">还没有价格记录。</p>}
      {((records && records.length > 0) || filtering) && (
        <RecordFilters
          records={records ?? []}
          channels={channels}
          promotions={promotions}
          filter={filter}
          onChange={setFilter}
        />
      )}
      <div className="flex flex-col gap-4">
        {shown && shown.length > 0 && (
          <Suspense fallback={<div className="h-72 rounded-lg border" />}>
            <UnitPriceChart records={shown} product={product} />
          </Suspense>
        )}
        {filtering && shown?.length === 0 && records?.length !== 0 && (
          <p className="text-muted-foreground text-sm">没有符合筛选条件的价格记录。</p>
        )}
        <ul aria-label="价格记录列表" className="flex flex-col gap-2">
          {shown?.map((record) => (
            <li
              key={record.id}
              aria-label={`${record.date} ${record.channel.name}`}
              className="rounded-lg border p-3"
            >
              {editingId === record.id ? (
                <PriceRecordForm
                  product={product}
                  channels={channels}
                  promotions={promotions}
                  records={records ?? []}
                  record={record}
                  onCancel={() => setEditingId(undefined)}
                  onSaved={saved}
                />
              ) : (
                <PriceRecordItem
                  record={record}
                  product={product}
                  onEdit={() => setEditingId(record.id)}
                  onEvidenceChanged={reload}
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
    </div>
  );
}

// Each field narrows the list when present; a null promotion keeps the records without one.
interface RecordFilter {
  purchased?: boolean;
  channelId?: string;
  promotionId?: string | null;
}

function matches(record: PriceRecord, { purchased, channelId, promotionId }: RecordFilter) {
  return (
    (purchased === undefined || record.purchased === purchased) &&
    (channelId === undefined || record.channel.id === channelId) &&
    (promotionId === undefined || (record.promotion?.id ?? null) === promotionId)
  );
}

const promotionNone = 'none';

// Offers only the channels and promotions the product's records use, plus whichever is already chosen.
function RecordFilters({
  records,
  channels,
  promotions,
  filter,
  onChange,
}: {
  records: PriceRecord[];
  channels: Channel[];
  promotions: Promotion[];
  filter: RecordFilter;
  onChange(filter: RecordFilter): void;
}) {
  const id = useId();
  const used = new Set<string | null | undefined>([filter.channelId, filter.promotionId]);
  for (const r of records) used.add(r.channel.id).add(r.promotion?.id);
  const channelChoices = channels.filter((c) => used.has(c.id));
  const promotionChoices = promotions.filter((p) => used.has(p.id));
  const change = (next: RecordFilter) => onChange({ ...filter, ...next });

  return (
    <div role="group" aria-label="筛选价格记录" className="flex flex-wrap items-end gap-3 text-sm">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-purchased`}>购买情况</Label>
        <select
          id={`${id}-purchased`}
          className={cn(fieldClass, 'h-8 w-28')}
          value={filter.purchased === undefined ? '' : String(filter.purchased)}
          onChange={(e) => change({ purchased: e.target.value ? e.target.value === 'true' : undefined })}
        >
          <option value="">全部</option>
          <option value="true">已购</option>
          <option value="false">仅记录</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-channel`}>渠道</Label>
        <select
          id={`${id}-channel`}
          className={cn(fieldClass, 'h-8 w-36')}
          value={filter.channelId ?? ''}
          onChange={(e) => change({ channelId: e.target.value || undefined })}
        >
          <option value="">全部渠道</option>
          {channelChoices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-promotion`}>大促</Label>
        <select
          id={`${id}-promotion`}
          className={cn(fieldClass, 'h-8 w-36')}
          value={filter.promotionId === null ? promotionNone : (filter.promotionId ?? '')}
          onChange={(e) => {
            const value = e.target.value;
            change({ promotionId: value === promotionNone ? null : value || undefined });
          }}
        >
          <option value="">全部</option>
          <option value={promotionNone}>非大促</option>
          {promotionChoices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {Object.values(filter).some((v) => v !== undefined) && (
        <Button variant="ghost" size="sm" onClick={() => onChange({})}>
          清除筛选
        </Button>
      )}
    </div>
  );
}

const recentReferenceCount = 5;
// The server stores cents in a Postgres integer column.
const maxCents = 2_000_000_000;

function StockLineSection({
  product,
  records,
  onSaved,
}: {
  product: ProductDetail;
  records: PriceRecord[];
  onSaved(): Promise<void>;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const baseSize = formatSize(product.baseSize, product.pricingUnit);

  function startEditing() {
    setDraft(product.stockLine === null ? '' : (product.stockLine / 100).toFixed(2));
    setError(undefined);
    setEditing(true);
  }

  async function save(stockLine: number | null) {
    setPending(true);
    const message = await attempt(async () => {
      await api.updateProduct(product.id, { stockLine });
      await onSaved();
    });
    setPending(false);
    if (message) return setError(message);
    setEditing(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stockLine = parseYuan(draft);
    if (stockLine === null || stockLine === 0) return setError('请填写入手价，最多两位小数，必须大于 0。');
    if (stockLine > maxCents) return setError('入手价太大了。');
    save(stockLine);
  }

  return (
    <section aria-label="入手价" className="flex flex-col gap-3 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          入手价{' '}
          <span className="font-semibold tabular-nums">
            {product.stockLine === null ? '未设置' : formatUnitPrice(product.stockLine, product)}
          </span>
        </span>
        <span>
          历史最低单价{' '}
          <span className="font-semibold tabular-nums">
            {product.lowestUnitPrice === null ? '暂无' : formatUnitPrice(product.lowestUnitPrice, product)}
          </span>
        </span>
        {!editing && (
          <Button variant="ghost" size="xs" className="ml-auto" onClick={startEditing}>
            {product.stockLine === null ? '设置入手价' : '修改入手价'}
          </Button>
        )}
      </div>

      {editing && (
        <form aria-label="设置入手价" className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-stock-line`}>入手价（元 / {baseSize}）</Label>
            <Input
              id={`${id}-stock-line`}
              inputMode="decimal"
              required
              autoFocus
              className="max-w-40"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          <div aria-label="参考单价" className="text-muted-foreground flex flex-col gap-1">
            {records.length === 0 ? (
              <p>还没有价格记录可作参考。</p>
            ) : (
              <>
                {product.lowestUnitPrice !== null && (
                  <p>历史最低单价 {formatUnitPrice(product.lowestUnitPrice, product)}</p>
                )}
                <p>最近 {Math.min(records.length, recentReferenceCount)} 条单价：</p>
                <ul className="flex flex-col gap-0.5 tabular-nums">
                  {records.slice(0, recentReferenceCount).map((r) => (
                    <li key={r.id}>
                      {r.date} {r.channel.name} {formatUnitPrice(r.unitPrice, product)}
                      {!r.purchased && '（仅记录）'}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              保存入手价
            </Button>
            {product.stockLine !== null && (
              <Button type="button" variant="outline" disabled={pending} onClick={() => save(null)}>
                清除入手价
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function PriceRecordItem({
  record,
  product,
  onEdit,
  onDelete,
  onEvidenceChanged,
}: {
  record: PriceRecord;
  product: Product;
  onEdit(): void;
  onDelete(): Promise<string | void>;
  onEvidenceChanged(): Promise<void>;
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
        {record.promotion && (
          <span aria-label="大促" className="rounded border px-1.5 py-0.5 text-xs">
            {record.promotion.name}
          </span>
        )}
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
      <EvidenceList record={record} onChanged={onEvidenceChanged} />
    </div>
  );
}

const evidenceErrors = {
  unsupported_evidence_type: '凭证只支持 PNG、JPEG、WebP 或 GIF 图片。',
  evidence_too_large: '每张凭证不能超过 10 MB。',
};

function EvidenceList({ record, onChanged }: { record: PriceRecord; onChanged(): Promise<void> }) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const label = `${record.date} ${record.channel.name}`;

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setError(
      (await attempt(async () => {
        await api.uploadEvidence(record.id, files);
        await onChanged();
      }, evidenceErrors)) ?? undefined,
    );
    setUploading(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <ul aria-label="凭证" className="flex flex-wrap items-end gap-2">
        {(record.evidence ?? []).map((e, i) => (
          <li key={e.id} className="flex flex-col items-start gap-0.5">
            <a href={api.evidenceUrl(e.id)} target="_blank" rel="noreferrer">
              <img
                src={api.evidenceUrl(e.id)}
                alt={`${label} 的凭证 ${i + 1}`}
                loading="lazy"
                className="size-20 rounded border object-cover"
              />
            </a>
            <DeleteButton
              label={`删除 ${label} 的凭证 ${i + 1}`}
              onDelete={() =>
                attempt(async () => {
                  await api.deleteEvidence(e.id);
                  await onChanged();
                })
              }
            />
          </li>
        ))}
      </ul>
      <div>
        <Button variant="outline" size="xs" disabled={uploading} asChild>
          <label htmlFor={inputId}>{uploading ? '上传中…' : '添加凭证'}</label>
        </Button>
        <input
          id={inputId}
          type="file"
          aria-label={`给 ${label} 添加凭证`}
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="sr-only"
          disabled={uploading}
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = '';
            void upload(files);
          }}
        />
      </div>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}

function PriceRecordForm({
  product,
  channels,
  promotions,
  records,
  record,
  onCancel,
  onSaved,
}: {
  product: Product;
  channels: Channel[];
  promotions: Promotion[];
  records: PriceRecord[];
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
  // A new record's tag follows the date until the member picks a promotion, or none, by hand;
  // an existing record keeps the tag it has.
  const [promotionId, setPromotionId] = useState(() =>
    record ? (record.promotion?.id ?? '') : (matchDate(date, promotions)?.id ?? ''),
  );
  const [promotionPicked, setPromotionPicked] = useState(record !== undefined);
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

  const read = readPriceDraft(product, { listPrice, discounts, quantity, sizeAmount, sizeUnitName });
  const price = 'input' in read ? preview(product, read.input) : null;
  const multiplied = multipliedQuantity(quantity);
  // An edited record is judged against the other records, as its stored price is about to be replaced.
  const lowest = lowestOf(records.filter((r) => r.id !== record?.id));
  const datePromotion = matchDate(date, promotions);
  const lastYearLowest = datePromotion
    ? lastYearPromotionLowest(date, datePromotion, records.filter((r) => r.id !== record?.id))
    : null;
  const judgment =
    price !== null && typeof price === 'object'
      ? judge({
          unitPrice: price.unitPrice,
          stockLine: product.stockLine,
          lowestUnitPrice: lowest,
          lastYearPromotionLowest: lastYearLowest,
        })
      : null;

  function changeDate(next: string) {
    setDate(next);
    if (!promotionPicked) setPromotionId(matchDate(next, promotions)?.id ?? '');
  }

  const updateDiscount = (key: number, change: Partial<DiscountDraft>) =>
    setDiscounts((all) => all.map((d) => (d.key === key ? { ...d, ...change } : d)));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ('error' in read) return setError(read.error);
    if (typeof price === 'string') return setError(price);
    if (!channelId) return setError('请选择渠道。');
    const input = { ...read.input, date, channelId, purchased, promotionId: promotionId || null, note };
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
          <Input id={`${id}-date`} type="date" required value={date} onChange={(e) => changeDate(e.target.value)} />
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

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-promotion`}>大促</Label>
        <select
          id={`${id}-promotion`}
          className={cn(fieldClass, 'h-9 max-w-60')}
          value={promotionId}
          onChange={(e) => {
            setPromotionId(e.target.value);
            setPromotionPicked(true);
          }}
        >
          <option value="">无</option>
          {promotions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
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
            {multiplied !== null ? `共 ${multiplied} 件，` : ''}赠品也计入件数
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
            {judgment && <JudgmentSummary judgment={judgment} />}
            {lowest !== null && (
              <span className="text-muted-foreground">历史最低单价 {formatUnitPrice(lowest, product)}</span>
            )}
            {datePromotion && lastYearLowest !== null && (
              <span className="text-muted-foreground">
                去年{datePromotion.name}最低单价 {formatUnitPrice(lastYearLowest, product)}
              </span>
            )}
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
