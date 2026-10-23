import { lazy, Suspense, useId, useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImagePlus, Package, Pencil, Plus, ReceiptText, X } from 'lucide-react';
import { judge, type Verdict } from '@stockup/domain';
import { Badge, PromotionTag, PurchaseBadge, VerdictBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, InputAddon, InputGroup, InputGroupInput, Textarea } from '@/components/ui/input';
import { List } from '@/components/ui/list';
import { NativeSelect } from '@/components/ui/native-select';
import { PageContent, PageHeader } from '@/components/ui/page';
import { Panel, PanelFooter, PanelHeader } from '@/components/ui/panel';
import { PriceFigure } from '@/components/ui/price-figure';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, attempt, DeleteButton, RetryAlert } from '@/components/editing';
import { ProductMaintenance, ProductMenu, type MaintenanceTask } from '@/components/product-maintenance';
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
import { placementKey, placementOf } from '@/lib/catalog';
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
import { loadErrorOf, queries, useRefresh } from '@/lib/queries';
import { cn } from '@/lib/utils';

// Recharts is most of the bundle's weight, so only the product page loads it.
const UnitPriceChart = lazy(() =>
  import('@/components/unit-price-chart').then((m) => ({ default: m.UnitPriceChart })),
);

export function ProductPage({ productId, onBack }: { productId: string; onBack(placement?: string): void }) {
  const productQuery = useQuery(queries.product(productId));
  const recordsQuery = useQuery(queries.priceRecords(productId));
  const channelsQuery = useQuery(queries.channels());
  const promotionsQuery = useQuery(queries.promotions());
  // The breadcrumb is the only reader, so a failed load leaves it at the section name.
  const catalog = useQuery(queries.catalog()).data ?? [];
  const pageQueries = [productQuery, recordsQuery, channelsQuery, promotionsQuery];
  const missing = productQuery.error instanceof ApiError && productQuery.error.status === 404;
  const product = missing ? null : productQuery.data;
  const records = recordsQuery.data;
  const channels = channelsQuery.data ?? [];
  const promotions = promotionsQuery.data ?? [];
  const loadError = loadErrorOf(pageQueries.find((q) => q.error)?.error ?? null);
  const reload = useRefresh();
  const [actionError, setActionError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [editingStockLine, setEditingStockLine] = useState(false);
  const [task, setTask] = useState<MaintenanceTask>();
  const [filter, setFilter] = useState<RecordFilter>({});

  const loadAlert = loadError && (
    <RetryAlert
      message={`加载失败：${loadError}`}
      onRetry={() => pageQueries.filter((q) => q.error).forEach((q) => q.refetch())}
    />
  );

  if (product === null) {
    return (
      <PageContent>
        <EmptyState
          title="商品不存在"
          icon={<Package />}
          action={
            <Button variant="outline" onClick={() => onBack()}>
              返回商品
            </Button>
          }
        />
      </PageContent>
    );
  }
  if (!product || !records) return <PageContent>{loadAlert || <ProductSkeleton />}</PageContent>;

  const all = records ?? [];
  const filtering = Object.values(filter).some((v) => v !== undefined);
  const shown = all.filter((r) => matches(r, filter));
  const group = catalog.find((g) => g.id === product.categoryGroupId);
  const category = group?.categories.find((c) => c.id === product.categoryId);

  const saved = (done: string) => async () => {
    setCreating(false);
    setEditingId(undefined);
    await reload();
    toast.success(done);
  };
  const archive = async (archived: boolean) => {
    const message = await attempt(async () => {
      await api.updateProduct(product.id, { archived });
      await reload();
    });
    setActionError(message ?? undefined);
    if (!message) {
      toast.success(archived ? '已归档，录入时不再列出' : '已恢复', {
        action: { label: '撤销', onClick: () => archive(!archived) },
      });
    }
  };

  return (
    <PageContent>
      <div className="flex flex-col gap-4 wide:flex-row wide:items-start">
        <PageHeader
          title={product.name}
          crumbs={[
            { label: '商品', onClick: () => onBack() },
            ...(group
              ? [{ label: group.name, onClick: category ? undefined : () => onBack(placementKey(placementOf(product))) }]
              : []),
            ...(category ? [{ label: category.name, onClick: () => onBack(placementKey(placementOf(product))) }] : []),
          ]}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
            {product.archived && <Badge tone="outline">已归档</Badge>}
            <span>
              计价单位 <span className="font-medium text-ink-2">{product.pricingUnit.name}</span> · 基准规格{' '}
              <span className="font-medium text-ink-2">{formatSize(product.baseSize, product.pricingUnit)}</span>
            </span>
          </p>
          {product.note && <p className="text-[13px] whitespace-pre-wrap text-ink-2">{product.note}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={() => setEditingStockLine(true)}>
            <Pencil />
            {product.stockLine === null ? '设置入手价' : '修改入手价'}
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus />
            记录价格
          </Button>
          <ProductMenu product={product} onOpen={setTask} onArchive={archive} />
        </div>
      </div>

      {actionError && <Alert>{actionError}</Alert>}
      {loadAlert}
      {task && (
        <ProductMaintenance product={product} task={task} onClose={() => setTask(undefined)} onChanged={reload} />
      )}
      {creating && (
        <Panel>
          <PanelHeader title="记录价格" as="h3" />
          <PriceRecordForm
            product={product}
            channels={channels}
            promotions={promotions}
            records={all}
            onCancel={() => setCreating(false)}
            onSaved={saved('已记录价格')}
          />
        </Panel>
      )}

      <div className="grid items-start gap-6 min-[1200px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          {shown.length > 0 && (
            <Suspense fallback={<Skeleton className="h-[19rem]" />}>
              <UnitPriceChart records={shown} product={product} />
            </Suspense>
          )}
          <Panel asChild>
            <section aria-label="价格记录">
              <PanelHeader
                title="价格记录"
                count={records && shown.length}
                actions={
                  (all.length > 0 || filtering) && (
                    <RecordFilters
                      records={all}
                      channels={channels}
                      promotions={promotions}
                      filter={filter}
                      onChange={setFilter}
                    />
                  )
                }
              />
              {!records ? (
                <div className="flex flex-col gap-3 px-(--panel-padding) py-4">
                  <Skeleton className="h-14" />
                  <Skeleton className="h-14" />
                </div>
              ) : all.length === 0 ? (
                <EmptyState title="暂无价格记录" icon={<ReceiptText />} />
              ) : (
                shown.length === 0 && <EmptyState title="无匹配的价格记录" icon={<ReceiptText />} />
              )}
              {shown.length > 0 && (
                <List variant="ruled" aria-label="价格记录列表">
                  {shown.map((record) => (
                    <li key={record.id} aria-label={recordLabel(record)}>
                      {editingId === record.id ? (
                        <PriceRecordForm
                          product={product}
                          channels={channels}
                          promotions={promotions}
                          records={all}
                          record={record}
                          onCancel={() => setEditingId(undefined)}
                          onSaved={saved('已保存修改')}
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
                              toast.success('已删除价格记录');
                            })
                          }
                        />
                      )}
                    </li>
                  ))}
                </List>
              )}
            </section>
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-6 max-[1199px]:order-first">
          <PriceOverview
            product={product}
            records={all}
            promotions={promotions}
            editing={editingStockLine}
            onEdit={() => setEditingStockLine(true)}
            onClose={() => setEditingStockLine(false)}
            onSaved={async () => {
              await reload();
              toast.success('已保存入手价');
            }}
          />
          {all.length > 0 && <ChannelLowest product={product} records={all} />}
        </aside>
      </div>
    </PageContent>
  );
}

function ProductSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-3 w-48" />
      </div>
      <div className="grid gap-6 min-[1200px]:grid-cols-[minmax(0,1fr)_300px]">
        <Skeleton className="h-[19rem]" />
        <Skeleton className="h-[19rem]" />
      </div>
    </div>
  );
}

const recordLabel = (record: PriceRecord) => `${record.date} ${record.channel.name}`;

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

const purchaseChoices = [
  { value: 'all', label: '全部' },
  { value: 'purchased', label: '已购' },
  { value: 'seen', label: '仅记录' },
] as const;

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
  const used = new Set<string | null | undefined>([filter.channelId, filter.promotionId]);
  for (const r of records) used.add(r.channel.id).add(r.promotion?.id);
  const channelChoices = channels.filter((c) => used.has(c.id));
  const promotionChoices = promotions.filter((p) => used.has(p.id));
  const change = (next: RecordFilter) => onChange({ ...filter, ...next });
  const purchase = filter.purchased === undefined ? 'all' : filter.purchased ? 'purchased' : 'seen';

  return (
    <div role="group" aria-label="筛选价格记录" className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        aria-label="购买情况"
        options={[...purchaseChoices]}
        value={purchase}
        onValueChange={(value) => change({ purchased: value === 'all' ? undefined : value === 'purchased' })}
      />
      <NativeSelect
        aria-label="渠道"
        className="w-32"
        value={filter.channelId ?? ''}
        onChange={(e) => change({ channelId: e.target.value || undefined })}
      >
        <option value="">全部渠道</option>
        {channelChoices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label="大促"
        className="w-32"
        value={filter.promotionId === null ? promotionNone : (filter.promotionId ?? '')}
        onChange={(e) => {
          const value = e.target.value;
          change({ promotionId: value === promotionNone ? null : value || undefined });
        }}
      >
        <option value="">全部大促</option>
        <option value={promotionNone}>非大促</option>
        {promotionChoices.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </NativeSelect>
      {Object.values(filter).some((v) => v !== undefined) && (
        <Button variant="ghost" size="sm" onClick={() => onChange({})}>
          清除筛选
        </Button>
      )}
    </div>
  );
}

function UnitPrice({ product, ...props }: Omit<ComponentProps<typeof PriceFigure>, 'per'> & { product: Product }) {
  return <PriceFigure per={formatSize(product.baseSize, product.pricingUnit)} {...props} />;
}

function RecordSource({ record }: { record: PriceRecord }) {
  return (
    <dd className="text-xs text-ink-3">
      <span className="numeric text-[13px]">{record.date}</span> · {record.channel.name}
      {record.promotion && ` · ${record.promotion.name}`}
    </dd>
  );
}

// The latest record is judged against the records before it, as it was when recorded.
function latestVerdict(product: ProductDetail, records: PriceRecord[], promotions: Promotion[]): Verdict | null {
  const [latest, ...earlier] = records;
  if (!latest) return null;
  const promotion = promotions.find((p) => p.id === latest.promotion?.id);
  return judge({
    unitPrice: latest.unitPrice,
    stockLine: product.stockLine,
    lowestUnitPrice: lowestOf(earlier),
    lastYearPromotionLowest: promotion ? lastYearPromotionLowest(latest.date, promotion, earlier) : null,
  }).verdict;
}

const overviewRow = 'relative flex flex-col gap-1 border-b border-line px-(--panel-padding) py-3.5 last:border-b-0';

function PriceOverview({
  product,
  records,
  promotions,
  editing,
  onEdit,
  onClose,
  onSaved,
}: {
  product: ProductDetail;
  records: PriceRecord[];
  promotions: Promotion[];
  editing: boolean;
  onEdit(): void;
  onClose(): void;
  onSaved(): Promise<void>;
}) {
  const lowest = records.find((r) => r.unitPrice === product.lowestUnitPrice);
  const latest = records[0];
  const verdict = latestVerdict(product, records, promotions);

  return (
    <Panel asChild>
      <section aria-label="价格概览">
        <PanelHeader title="价格概览" />
        <dl>
          <div
            className={cn(
              overviewRow,
              'pl-[max(var(--panel-padding),14px)] before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:bg-gold',
            )}
          >
            <dt className="text-xs text-ink-3">入手价</dt>{' '}
            <dd>
              {editing ? (
                <StockLineForm product={product} records={records} onClose={onClose} onSaved={onSaved} />
              ) : product.stockLine === null ? (
                <span className="text-sm text-ink-3">未设置</span>
              ) : (
                <UnitPrice cents={product.stockLine} product={product} tone="target" size="xl" />
              )}
            </dd>
            {!editing && (
              <Button variant="ghost" size="xs" className="absolute top-2.5 right-(--panel-padding)" onClick={onEdit}>
                <Pencil />
                {product.stockLine === null ? '设置入手价' : '修改入手价'}
              </Button>
            )}
          </div>
          <div className={overviewRow}>
            <dt className="text-xs text-ink-3">历史最低单价</dt>{' '}
            <dd>
              {product.lowestUnitPrice === null ? (
                <span className="text-sm text-ink-3">暂无</span>
              ) : (
                <UnitPrice cents={product.lowestUnitPrice} product={product} tone="low" size="xl" />
              )}
            </dd>
            {lowest && <RecordSource record={lowest} />}
          </div>
          <div className={overviewRow}>
            <dt className="text-xs text-ink-3">最近单价</dt>{' '}
            <dd className="flex items-baseline gap-2">
              {latest ? (
                <>
                  <span>
                    <UnitPrice cents={latest.unitPrice} product={product} size="xl" />
                  </span>
                  {verdict && <VerdictBadge verdict={verdict} className="ml-auto self-center" />}
                </>
              ) : (
                <span className="text-sm text-ink-3">暂无</span>
              )}
            </dd>
            {latest && <RecordSource record={latest} />}
          </div>
        </dl>
      </section>
    </Panel>
  );
}

function ChannelLowest({ product, records }: { product: Product; records: PriceRecord[] }) {
  const byChannel = new Map<string, { channel: Channel; lowest: number; count: number }>();
  for (const r of records) {
    const entry = byChannel.get(r.channel.id);
    if (entry) {
      entry.lowest = Math.min(entry.lowest, r.unitPrice);
      entry.count += 1;
    } else byChannel.set(r.channel.id, { channel: r.channel, lowest: r.unitPrice, count: 1 });
  }
  const rows = [...byChannel.values()].sort((a, b) => a.lowest - b.lowest);
  const min = rows[0]!.lowest;
  const max = rows.at(-1)!.lowest;

  return (
    <Panel asChild>
      <section aria-label="各渠道最低单价">
        <PanelHeader title="各渠道最低单价" />
        <ul className="flex flex-col gap-3 px-(--panel-padding) py-4">
          {rows.map(({ channel, lowest, count }, i) => (
            <li key={channel.id} className="grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)_auto] items-center gap-3">
              <span className="truncate text-[13px]">{channel.name}</span>
              {/* The cheapest channel fills the track; the dearest keeps a third of it. */}
              <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
                <span
                  className={cn('block h-full rounded-full', i === 0 ? 'bg-record-low' : 'bg-ink-4')}
                  style={{ width: `${max === min ? 100 : 100 - ((lowest - min) / (max - min)) * 66}%` }}
                />
              </span>
              <span className="flex items-baseline justify-end gap-1.5 whitespace-nowrap">
                <PriceFigure cents={lowest} size="sm" tone={i === 0 ? 'low' : 'default'} />
                <span className="text-[11px] text-ink-3">{count} 条</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="sr-only">单价按 {formatSize(product.baseSize, product.pricingUnit)} 计</p>
      </section>
    </Panel>
  );
}

const recentReferenceCount = 5;
// The server stores cents in a Postgres integer column.
const maxCents = 2_000_000_000;

function StockLineForm({
  product,
  records,
  onClose,
  onSaved,
}: {
  product: ProductDetail;
  records: PriceRecord[];
  onClose(): void;
  onSaved(): Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(product.stockLine === null ? '' : (product.stockLine / 100).toFixed(2));
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const baseSize = formatSize(product.baseSize, product.pricingUnit);

  async function save(stockLine: number | null) {
    setPending(true);
    const message = await attempt(async () => {
      await api.updateProduct(product.id, { stockLine });
      await onSaved();
    });
    setPending(false);
    if (message) return setError(message);
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stockLine = parseYuan(draft);
    if (stockLine === null || stockLine === 0) return setError('入手价需大于 0，最多两位小数');
    if (stockLine > maxCents) return setError('入手价超出范围');
    save(stockLine);
  }

  return (
    <form aria-label="设置入手价" className="mt-1 flex flex-col gap-3" onSubmit={handleSubmit}>
      <Field label={`入手价（元 / ${baseSize}）`} htmlFor={`${id}-stock-line`}>
        <InputGroup>
          <InputAddon>¥</InputAddon>
          <InputGroupInput
            id={`${id}-stock-line`}
            inputMode="decimal"
            required
            autoFocus
            className="numeric text-num-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </InputGroup>
      </Field>
      {records.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-ink-3">最近 {Math.min(records.length, recentReferenceCount)} 条</p>
          <ul aria-label="参考单价" className="flex flex-col gap-0.5 text-xs text-ink-2">
            {records.slice(0, recentReferenceCount).map((r) => (
              <li key={r.id} className="flex gap-2">
                <span className="numeric text-[13px]">{r.date}</span>
                <span className="min-w-0 flex-1 truncate">
                  {r.channel.name}
                  {!r.purchased && '（仅记录）'}
                </span>{' '}
                <span className="numeric text-[13px]">{formatUnitPrice(r.unitPrice, product)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          保存入手价
        </Button>
        {product.stockLine !== null && (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => save(null)}>
            清除入手价
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          取消
        </Button>
      </div>
    </form>
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
  const label = recordLabel(record);
  // The breakdown line already shows the discount total, so only named discounts add anything.
  const named = record.discounts.filter((d) => d.name);

  return (
    <div className="flex flex-col gap-3 px-(--panel-padding) py-3.5 wide:flex-row wide:items-center wide:gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <PurchaseBadge purchased={record.purchased} />
          <span className="numeric text-num-sm font-medium">{record.date}</span>
          <span className="text-[13px] font-medium">{record.channel.name}</span>
          {record.promotion && <PromotionTag aria-label="大促">{record.promotion.name}</PromotionTag>}
        </div>
        <p className="text-xs text-ink-3">
          原价 {formatYuan(record.listPrice)}
          {discountTotal > 0 && ` − 优惠 ${formatYuan(discountTotal)}`} · {record.quantity} 件 ×{' '}
          {formatSize(size.amount, size.unit)}
          {converted && `（录入为 ${formatSize(enteredSize.amount, enteredSize.unit)}）`}
        </p>
        {named.length > 0 && (
          <ul aria-label="优惠" className="flex flex-wrap gap-x-3 text-xs text-ink-3">
            {named.map((d, i) => (
              <li key={i}>
                {d.name} {formatYuan(d.amount)}
              </li>
            ))}
          </ul>
        )}
        {record.note && <p className="text-[13px] whitespace-pre-wrap text-ink-2">{record.note}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5">
          <p className="text-xs text-ink-3">录入人 {record.recordedBy?.name ?? '已离开的成员'}</p>
          <EvidenceList record={record} label={label} onChanged={onEvidenceChanged} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col wide:items-end">
          <p className="whitespace-nowrap">
            <span className="sr-only">单价 </span>
            <UnitPrice cents={record.unitPrice} product={product} size="lg" />
          </p>
          <p className="text-xs whitespace-nowrap text-ink-3">
            到手价 <span className="numeric text-[13px] text-ink-2">{formatYuan(record.netPrice)}</span>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" aria-label={`编辑 ${label} 的价格记录`} onClick={onEdit}>
            <Pencil />
          </Button>
          <DeleteButton label={`删除 ${label} 的价格记录`} onDelete={onDelete} />
        </div>
      </div>
    </div>
  );
}

const evidenceErrors = {
  unsupported_evidence_type: '凭证仅支持 PNG、JPEG、WebP、GIF',
  evidence_too_large: '单张凭证不超过 10 MB',
};

function EvidenceList({ record, label, onChanged }: { record: PriceRecord; label: string; onChanged(): Promise<void> }) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();

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
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-start gap-2">
        {(record.evidence?.length ?? 0) > 0 && (
          <ul aria-label="凭证" className="flex flex-wrap items-start gap-2">
            {record.evidence!.map((e, i) => (
              <li key={e.id} className="flex flex-col items-center gap-0.5">
                <a
                  href={api.evidenceUrl(e.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md focus-visible:shadow-focus"
                >
                  <img
                    src={api.evidenceUrl(e.id)}
                    alt={`${label} 的凭证 ${i + 1}`}
                    loading="lazy"
                    className="size-12 rounded-md border border-line object-cover"
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
        )}
        <Button variant="outline" size="xs" disabled={uploading} asChild>
          <label htmlFor={inputId}>
            <ImagePlus />
            {uploading ? '上传中…' : '添加凭证'}
          </label>
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
    if (!channelId) return setError('未选择渠道');
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
    <form aria-label={record ? '编辑价格记录' : '新建价格记录'} onSubmit={handleSubmit}>
      <div className="flex max-w-4xl flex-col gap-4 px-(--panel-padding) py-4">
        <div className="grid gap-4 wide:grid-cols-3">
          <Field label="日期" htmlFor={`${id}-date`}>
            <Input
              id={`${id}-date`}
              type="date"
              required
              className="numeric text-[15px]"
              value={date}
              onChange={(e) => changeDate(e.target.value)}
            />
          </Field>
          <Field label="渠道" htmlFor={`${id}-channel`}>
            <NativeSelect
              id={`${id}-channel`}
              required
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            >
              {choices.length === 0 && <option value="">暂无渠道</option>}
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.archived ? `${c.name}（已归档）` : c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="大促" htmlFor={`${id}-promotion`}>
            <NativeSelect
              id={`${id}-promotion`}
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
            </NativeSelect>
          </Field>
        </div>

        <SegmentedControl<boolean>
          aria-label="已购还是仅记录"
          className="self-start"
          options={[
            { value: true, label: '已购' },
            { value: false, label: '仅记录' },
          ]}
          value={purchased}
          onValueChange={setPurchased}
        />

        <div className="grid gap-4 wide:grid-cols-3">
          <Field label="原价（元）" htmlFor={`${id}-list`}>
            <InputGroup>
              <InputAddon>¥</InputAddon>
              <InputGroupInput
                id={`${id}-list`}
                inputMode="decimal"
                required
                className="numeric text-num-sm"
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
              />
            </InputGroup>
          </Field>
          <Field
            label="件数"
            htmlFor={`${id}-quantity`}
            hint={`${multiplied !== null ? `共 ${multiplied} 件 · ` : ''}含赠品`}
          >
            <Input
              id={`${id}-quantity`}
              required
              className="numeric text-num-sm"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field label="每件规格" htmlFor={`${id}-size`}>
            <div className="flex gap-2">
              <Input
                id={`${id}-size`}
                inputMode="decimal"
                required
                className="numeric text-num-sm"
                value={sizeAmount}
                onChange={(e) => setSizeAmount(e.target.value)}
              />
              <NativeSelect
                aria-label="规格单位"
                className="w-20 shrink-0"
                value={sizeUnitName}
                onChange={(e) => setSizeUnitName(e.target.value)}
              >
                {unitsLike(product.pricingUnit).map((u) => (
                  <option key={u.name} value={u.name}>
                    {u.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-xs font-medium text-ink-2">优惠</legend>
          {discounts.map((d, i) => (
            <div key={d.key} className="flex gap-2 wide:max-w-xl">
              <InputGroup className="w-32 shrink-0">
                <InputAddon>¥</InputAddon>
                <InputGroupInput
                  aria-label={`优惠 ${i + 1} 金额（元）`}
                  inputMode="decimal"
                  placeholder="金额"
                  className="numeric text-num-sm"
                  value={d.amount}
                  onChange={(e) => updateDiscount(d.key, { amount: e.target.value })}
                />
              </InputGroup>
              <Input
                aria-label={`优惠 ${i + 1} 名称`}
                placeholder="名称（可选）"
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

        <Field label="备注" htmlFor={`${id}-note`}>
          <Textarea
            id={`${id}-note`}
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        <output
          aria-label="价格预览"
          className="flex flex-wrap items-baseline gap-x-5 gap-y-2 rounded-md bg-surface-subtle px-3 py-2.5 text-[13px]"
        >
          {price === null && <span className="text-ink-3">填写原价、件数和规格</span>}
          {typeof price === 'string' && <span className="text-destructive">{price}</span>}
          {price !== null && typeof price === 'object' && (
            <>
              <span>
                <span className="text-xs text-ink-3">单价 </span>
                <UnitPrice cents={price.unitPrice} product={product} />
              </span>
              <span>
                <span className="text-xs text-ink-3">到手价 </span>
                <span className="numeric text-num-sm font-semibold">{formatYuan(price.netPrice)}</span>
              </span>
              {judgment && <JudgmentSummary judgment={judgment} />}
              {lowest !== null && (
                <span className="text-xs text-ink-3">历史最低单价 {formatUnitPrice(lowest, product)}</span>
              )}
              {datePromotion && lastYearLowest !== null && (
                <span className="text-xs text-ink-3">
                  去年{datePromotion.name}最低单价 {formatUnitPrice(lastYearLowest, product)}
                </span>
              )}
            </>
          )}
        </output>
        {error && <Alert>{error}</Alert>}
      </div>
      <PanelFooter>
        <Button type="submit" disabled={pending}>
          {record ? '保存' : '保存记录'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </PanelFooter>
    </form>
  );
}
