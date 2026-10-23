import { useEffect, useId, useRef, useState } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { ChevronRight, Plus, ScanText, Search, SquarePen, X } from 'lucide-react';
import { findLastYearPromotionLowest, judge, type Judgment, type Price } from '@stockup/domain';
import { Alert, attempt, RetryAlert } from '@/components/editing';
import { PriceRuler, type RulerReferences } from '@/components/price-ruler';
import { NewProductForm } from '@/components/product-form';
import { Button } from '@/components/ui/button';
import { ChipGroup, Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, InputAddon, InputGroup, InputGroupInput } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { List, ListRow } from '@/components/ui/list';
import { PriceFigure } from '@/components/ui/price-figure';
import { NativeSelect } from '@/components/ui/native-select';
import { PageHeader } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { SectionHeader } from '@/components/ui/section-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { VerdictDisplay, verdictTone } from '@/components/verdict';
import {
  api,
  type CategoryGroup,
  type Channel,
  type PriceReferences,
  type ProductSummary,
  type Promotion,
} from '@/lib/api';
import { formatSize, formatStockLineGap, formatYuan } from '@/lib/format';
import { outsideCategories, placementLabel } from '@/lib/catalog';
import { Link, productPath } from '@/lib/navigation';
import { useHistoryState } from '@/lib/history';
import { useWideScreen } from '@/lib/layout';
import { useOnline } from '@/lib/online';
import { loadErrorOf, queries, useRefresh } from '@/lib/queries';
import { useLocalProductSearch } from '@/lib/search';
import {
  discountDraft,
  matchDate,
  multipliedQuantity,
  preview,
  readPriceDraft,
  recordErrors,
  today,
  unitsLike,
  verdictLabels,
  type DiscountDraft,
} from '@/lib/pricing';
import { cn } from '@/lib/utils';

interface Household {
  groups: CategoryGroup[];
  products: ProductSummary[];
  channels: Channel[];
  promotions: Promotion[];
  lastUsedChannel: Channel | null;
  references: PriceReferences[];
}

type Layout = 'narrow' | 'wide';

function perBase(product: ProductSummary) {
  return formatSize(product.baseSize, product.pricingUnit);
}

// Dates in the current year drop the year, as on a shelf label.
function shortDate(date: string) {
  return date.startsWith(today().slice(0, 5)) ? date.slice(5) : date;
}

// A column that stays in view under the page bar and scrolls on its own.
const stickyColumn = 'sticky top-(--page-bar-height) h-[calc(100svh-var(--page-bar-height))] overflow-y-auto';

// Defined once so TanStack Query hands back the same household until one of its parts changes.
function combineHousehold(
  results: [
    UseQueryResult<CategoryGroup[]>,
    UseQueryResult<ProductSummary[]>,
    UseQueryResult<Channel[]>,
    UseQueryResult<Promotion[]>,
    UseQueryResult<{ channel: Channel | null }>,
    UseQueryResult<PriceReferences[]>,
  ],
) {
  const [groups, products, channels, promotions, lastUsed, references] = results;
  const error = results.find((r) => r.error)?.error ?? null;
  const retry = () => results.filter((r) => r.error).forEach((r) => r.refetch());
  if (!groups.data || !products.data || !channels.data || !promotions.data || !lastUsed.data || !references.data) {
    return { data: undefined, error, retry };
  }
  const data: Household = {
    groups: groups.data,
    products: products.data,
    channels: channels.data,
    promotions: promotions.data,
    lastUsedChannel: lastUsed.data.channel,
    references: references.data,
  };
  return { data, error, retry };
}

export function QuickPricePage() {
  const wide = useWideScreen();
  const online = useOnline();
  const {
    data: household,
    error,
    retry,
  } = useQueries({
    queries: [
      queries.catalog(),
      queries.products(),
      queries.channels(),
      queries.promotions(),
      queries.lastUsedChannel(),
      queries.priceReferences(),
    ],
    combine: combineHousehold,
  });
  const loadError = loadErrorOf(error);
  const refresh = useRefresh();
  const [productId, setProductId] = useHistoryState<string | undefined>('quickPriceProductId', undefined);
  // Picking a product, even the one on screen, starts a fresh pricing.
  const [picks, setPicks] = useState(0);
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  // Enter waits for the search to load before it picks the first result.
  const [choosing, setChoosing] = useState(false);
  // The name a new product starts with, while the member creates it.
  const [creating, setCreating] = useState<string>();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      // A slash typed into a field is text.
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      searchRef.current?.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const product = household?.products.find((p) => p.id === productId && !p.archived);
  const found = useLocalProductSearch(household?.products, trimmed);
  const changeQuery = (next: string) => {
    setQuery(next);
    setChoosing(false);
  };
  const pick = (id: string) => {
    setProductId(id);
    setPicks((n) => n + 1);
    changeQuery('');
    setCreating(undefined);
  };
  const create = (name: string) => {
    setCreating(name);
    changeQuery('');
  };
  const choose = (results: ProductSummary[]) => {
    if (results[0]) pick(results[0].id);
    else create(trimmed);
  };

  useEffect(() => {
    if (!choosing || !found) return;
    setChoosing(false);
    choose(found);
  }, [found, choosing]);

  const search = (
    <InputGroup className="h-9 bg-surface">
      <Search />
      <InputGroupInput
        ref={searchRef}
        type="search"
        aria-label="搜索商品"
        aria-keyshortcuts="/"
        placeholder="搜索商品"
        className="[&::-webkit-search-cancel-button]:hidden"
        value={query}
        onChange={(e) => changeQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') changeQuery('');
          // Enter while an IME composes commits the composition.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && trimmed) {
            e.preventDefault();
            if (found) choose(found);
            else setChoosing(true);
          }
        }}
      />
      {query ? (
        <Button variant="ghost" size="icon-xs" aria-label="清空搜索" onClick={() => changeQuery('')}>
          <X />
        </Button>
      ) : (
        <Kbd className="hidden wide:inline-grid">/</Kbd>
      )}
    </InputGroup>
  );
  const results = trimmed && household && found && (
    <SearchResults query={trimmed} products={found} groups={household.groups} onPick={pick} onCreate={create} />
  );
  const list = household ? (
    <ProductList groups={household.groups} products={household.products} selectedId={product?.id} onPick={pick} />
  ) : (
    !loadError && <ListSkeleton />
  );
  const newProduct = household && creating !== undefined && (
    <Panel className="p-4">
      <NewProductForm
        key={creating}
        groups={household.groups}
        defaultName={creating}
        onCancel={() => setCreating(undefined)}
        onCreated={async (created) => {
          await refresh();
          pick(created.id);
        }}
      />
    </Panel>
  );
  const loadAlert = loadError && <RetryAlert message={`加载失败：${loadError}`} onRetry={retry} />;
  const quickPrice = (layout: Layout) =>
    household &&
    product && (
      <QuickPrice
        key={`${product.id}:${picks}`}
        layout={layout}
        product={product}
        household={household}
        online={online}
        onSaved={refresh}
        onClear={() => pick(product.id)}
      />
    );

  // Both layouts keep the search box and QuickPrice at the same place in the tree, so crossing the
  // breakpoint, like rotating a tablet, keeps the search and the price being entered.
  return (
    <div
      className={cn(
        wide ? 'grid grid-cols-[320px_minmax(0,1fr)_376px] items-start' : 'flex flex-col gap-3 px-4 pt-3',
        !wide && (product && !newProduct ? 'pb-40' : 'pb-8'),
      )}
    >
      <PageHeader
        title="录入"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/recognitions">
              <ScanText />
              识别截图
            </Link>
          </Button>
        }
      />
      <div
        className={
          wide
            ? cn(stickyColumn, 'flex flex-col gap-3 border-r border-line bg-surface p-3')
            : '-mx-4 sticky top-0 z-10 flex flex-col gap-2 bg-background px-4 pt-1 pb-2'
        }
      >
        {search}
        {wide && loadAlert}
        {wide ? results || list : results}
      </div>
      {!wide && loadAlert}
      {newProduct ? (
        <div className={cn('flex flex-col', wide && 'col-span-2 max-w-2xl px-(--gutter) py-5')}>{newProduct}</div>
      ) : product ? (
        quickPrice(wide ? 'wide' : 'narrow')
      ) : wide ? (
        <div className="col-span-2 flex h-[calc(100svh-var(--page-bar-height))]">
          {household && <EmptyState title="未选择商品" icon={<SquarePen />} />}
        </div>
      ) : (
        !trimmed && list
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-2 py-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}

function SearchResults({
  query,
  products,
  groups,
  onPick,
  onCreate,
}: {
  query: string;
  products: ProductSummary[];
  groups: CategoryGroup[];
  onPick(id: string): void;
  onCreate(name: string): void;
}) {
  const createButton = (
    <Button variant="outline" size="sm" className="self-start" onClick={() => onCreate(query)}>
      <Plus />
      新建「{query}」
    </Button>
  );
  return (
    <section aria-label="搜索结果" className="-mx-1 flex flex-col gap-2">
      {products.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-2 py-3">
          <p className="text-sm text-ink-3">无匹配商品</p>
          {createButton}
        </div>
      ) : (
        <>
          <List>
            {products.map((p, i) => (
              <li key={p.id}>
                <ListRow asChild className={cn('w-full justify-between', i === 0 && 'wide:bg-surface-hover')}>
                  <button type="button" onClick={() => onPick(p.id)}>
                    <span className="min-w-0 truncate text-sm text-ink wide:text-[13px]">{p.name}</span>
                    <span className="shrink-0 text-xs text-ink-3">{placementLabel(groups, p)}</span>
                  </button>
                </ListRow>
              </li>
            ))}
          </List>
          {/* Similar names still leave room for a new product under exactly this name. */}
          {!products.some((p) => p.name === query) && <div className="px-2">{createButton}</div>}
        </>
      )}
    </section>
  );
}

function ProductList({
  groups,
  products,
  selectedId,
  onPick,
}: {
  groups: CategoryGroup[];
  products: ProductSummary[];
  selectedId: string | undefined;
  onPick(id: string): void;
}) {
  const [groupId, setGroupId] = useHistoryState<string | undefined>('quickPriceGroupId', undefined);
  const active = products.filter((p) => !p.archived);
  if (active.length === 0) return <EmptyState title="暂无商品" />;
  const inGroup = (g: CategoryGroup) => active.filter((p) => p.categoryGroupId === g.id).length;
  const shownGroups = groups.filter((g) => inGroup(g) > 0 && (!groupId || g.id === groupId));

  return (
    <section aria-label="商品列表" className="-mx-3 flex flex-col max-wide:-mx-4">
      <div role="tablist" aria-label="大类" className="flex shrink-0 gap-4 overflow-x-auto border-b border-line px-4">
        {[
          { id: undefined, name: '全部', count: active.length },
          ...groups.map((g) => ({ ...g, count: inGroup(g) })),
        ].map((g) => (
          <button
            key={g.id ?? ''}
            type="button"
            role="tab"
            aria-selected={groupId === g.id}
            className="-mb-px flex h-9 shrink-0 items-baseline gap-1 border-b-2 border-transparent pt-2.5 text-[13px] text-ink-3 hover:text-ink aria-selected:border-ink aria-selected:font-semibold aria-selected:text-ink"
            onClick={() => setGroupId(g.id)}
          >
            {g.name}
            <span className="numeric text-xs font-normal text-ink-4">{g.count}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1 py-2">
        {shownGroups.flatMap((g) =>
          [{ id: null, name: outsideCategories }, ...g.categories].map((c) => {
            const items = active.filter((p) => p.categoryGroupId === g.id && p.categoryId === c.id);
            if (items.length === 0) return null;
            return (
              <section key={c.id ?? g.id} aria-label={`${g.name} / ${c.name}`}>
                <SectionHeader as="h2" title={c.name} count={items.length} className="px-4 pt-2" />
                <List>
                  {items.map((p) => (
                    <li key={p.id}>
                      <ProductRow product={p} selected={p.id === selectedId} onPick={() => onPick(p.id)} />
                    </li>
                  ))}
                </List>
              </section>
            );
          }),
        )}
      </div>
    </section>
  );
}

function ProductRow({ product, selected, onPick }: { product: ProductSummary; selected: boolean; onPick(): void }) {
  const { latestPrice } = product;
  const verdict = latestPrice?.verdict;
  return (
    <ListRow asChild aria-current={selected || undefined} className="w-full items-center">
      <button type="button" onClick={onPick}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-ink wide:text-[13px]">{product.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-ink-3">
            {latestPrice ? (
              <>
                {verdict && verdict !== 'noReference' && (
                  <span className={cn('size-1.5 shrink-0 rounded-full', verdictTone[verdict].solid)}>
                    <span className="sr-only">{verdictLabels[verdict]}</span>
                  </span>
                )}
                <span className="truncate">
                  最近 <span className="numeric text-[13px] text-ink-2">{formatYuan(latestPrice.unitPrice)}</span>
                  {' · '}
                  <span className="numeric text-[13px]">{shortDate(latestPrice.date)}</span>
                </span>
              </>
            ) : (
              '暂无记录'
            )}
          </span>
        </span>
        {product.stockLine === null ? (
          <span className="shrink-0 text-xs text-ink-3">未设入手价</span>
        ) : (
          <span className="flex shrink-0 flex-col items-end">
            <PriceFigure cents={product.stockLine} />
            <span className="text-[11px] leading-3 text-ink-3">/ {perBase(product)}</span>
          </span>
        )}
      </button>
    </ListRow>
  );
}

function QuickPrice({
  layout,
  product,
  household,
  online,
  onSaved,
  onClear,
}: {
  layout: Layout;
  product: ProductSummary;
  household: Household;
  online: boolean;
  onSaved(): Promise<unknown>;
  onClear(): void;
}) {
  const id = useId();
  const { promotions } = household;
  const channels = household.channels.filter((c) => !c.archived);
  const productReferences = household.references.find((r) => r.productId === product.id);

  const [listPrice, setListPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [sizeAmount, setSizeAmount] = useState(String(product.baseSize));
  const [sizeUnitName, setSizeUnitName] = useState(product.pricingUnit.name);
  const [discounts, setDiscounts] = useState<DiscountDraft[]>([]);
  const [channelId, setChannelId] = useState(household.lastUsedChannel?.id ?? channels[0]?.id ?? '');
  const [purchased, setPurchased] = useState(false);
  const [date, setDate] = useState(today);
  // The tag follows the date until the member picks a promotion, or none, by hand.
  const [promotionId, setPromotionId] = useState(() => matchDate(today(), promotions)?.id ?? '');
  const [promotionPicked, setPromotionPicked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();

  const read = readPriceDraft(product, { listPrice, discounts, quantity, sizeAmount, sizeUnitName });
  const price: Price | string | null = 'input' in read ? preview(product, read.input) : null;
  const priced = price !== null && typeof price === 'object' ? price : null;

  const datePromotion = matchDate(date, promotions);
  const lastYearLowest =
    datePromotion && productReferences
      ? findLastYearPromotionLowest(date, datePromotion, productReferences.promotionLowests)
      : null;
  const references: RulerReferences = {
    lowest: productReferences?.lowestUnitPrice ?? null,
    stockLine: product.stockLine,
    lastYear: datePromotion && lastYearLowest !== null ? { name: datePromotion.name, lowest: lastYearLowest } : null,
  };
  const judgment: Judgment | null = priced
    ? judge({
        unitPrice: priced.unitPrice,
        stockLine: product.stockLine,
        lowestUnitPrice: references.lowest,
        lastYearPromotionLowest: lastYearLowest,
      })
    : null;

  // Sizes this product was recorded in, newest first, so a repeat purchase is one tap away.
  const sizeChoices = [
    ...new Map(
      [...(productReferences?.recentSizes ?? []), { amount: product.baseSize, unit: product.pricingUnit }].map((s) => [
        formatSize(s.amount, s.unit),
        { amount: String(Number(s.amount.toFixed(3))), unitName: s.unit.name },
      ]),
    ),
  ].slice(0, 5);

  const multiplied = multipliedQuantity(quantity);
  const updateDiscount = (key: number, change: Partial<DiscountDraft>) =>
    setDiscounts((all) => all.map((d) => (d.key === key ? { ...d, ...change } : d)));
  const discountTotal = 'input' in read ? read.input.discounts.reduce((sum, d) => sum + d.amount, 0) : 0;

  function changeDate(next: string) {
    setDate(next);
    if (!promotionPicked) setPromotionId(matchDate(next, promotions)?.id ?? '');
  }

  const saveLabel = online ? `存为${purchased ? '已购' : '仅记录'}` : '联网后保存';

  async function save() {
    if (pending) return;
    if (!online) return setError('离线中，联网后再存');
    if ('error' in read) return setError(read.error);
    if (!date) return setError('缺少日期');
    if (typeof price === 'string') return setError(price);
    if (!channelId) return setError('缺少渠道');
    setPending(true);
    const message = await attempt(async () => {
      await api.createPriceRecord({
        ...read.input,
        productId: product.id,
        date,
        channelId,
        purchased,
        promotionId: promotionId || null,
        note: '',
      });
      setListPrice('');
      setDiscounts([]);
      setSaved(`已${saveLabel}`);
      await onSaved();
    }, recordErrors);
    setError(message ?? undefined);
    setPending(false);
  }

  const header = (
    <section aria-label="商品" className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-xs text-ink-3">{placementLabel(household.groups, product)}</p>
        <h2 className="text-title-page font-semibold text-ink">{product.name}</h2>
        <p className="flex items-center gap-1.5 text-xs text-ink-3">
          每 {perBase(product)}
          <span aria-hidden>·</span>
          <Link
            href={productPath(product.id)}
            className="flex items-center text-ink-2 underline-offset-4 hover:underline"
          >
            详情
            <ChevronRight className="size-3.5" />
          </Link>
        </p>
      </div>
      <dl className="hidden divide-x divide-line rounded-md border border-line bg-surface wide:flex">
        {[
          { label: '入手价', value: product.stockLine, tone: 'target' as const },
          { label: '历史最低', value: references.lowest, tone: 'low' as const },
          { label: '最近', value: product.latestPrice?.unitPrice ?? null, tone: 'default' as const },
        ].map((m) => (
          <div key={m.label} className="flex min-w-20 flex-col gap-0.5 px-3 py-1.5">
            <dt className="text-[11px] text-ink-3">{m.label}</dt>
            <dd>
              {m.value === null ? (
                <span className="numeric text-num-sm text-ink-4">—</span>
              ) : (
                <PriceFigure cents={m.value} tone={m.tone} size="sm" />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );

  const entry = (
    <>
      <Panel asChild>
        <form
          aria-label="录入价格"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <PanelHeader
            as="h3"
            title="录入价格"
            actions={
              <Button type="button" variant="ghost" size="sm" onClick={onClear}>
                清空
              </Button>
            }
          />
          <PanelBody className="grid gap-4 wide:grid-cols-2">
            <Field label="原价" htmlFor={`${id}-list`}>
              <InputGroup className="h-10">
                <InputAddon>¥</InputAddon>
                <InputGroupInput
                  id={`${id}-list`}
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus={layout === 'wide'}
                  placeholder="0.00"
                  figure="lg"
                  value={listPrice}
                  onChange={(e) => {
                    setListPrice(e.target.value);
                    setSaved(undefined);
                  }}
                />
                <InputAddon>元</InputAddon>
              </InputGroup>
            </Field>
            <Field label="件数" htmlFor={`${id}-quantity`}>
              <InputGroup className="h-10">
                <InputGroupInput
                  id={`${id}-quantity`}
                  autoComplete="off"
                  placeholder="3×6"
                  figure="lg"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                <InputAddon>
                  {multiplied !== null && (
                    <>
                      共 <span className="numeric text-[15px] font-semibold text-ink">{multiplied}</span>{' '}
                    </>
                  )}
                  件
                </InputAddon>
              </InputGroup>
            </Field>
            <div className="flex flex-col gap-1.5 wide:col-span-2">
              <Label htmlFor={`${id}-size`}>规格</Label>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <InputGroup className="h-10 w-40">
                  <InputGroupInput
                    id={`${id}-size`}
                    inputMode="decimal"
                    autoComplete="off"
                    figure="lg"
                    value={sizeAmount}
                    onChange={(e) => setSizeAmount(e.target.value)}
                  />
                  {unitsLike(product.pricingUnit).length > 1 ? (
                    <InputAddon boxed className="p-0">
                      <select
                        aria-label="规格单位"
                        className="h-full bg-transparent px-2 text-ink-2 outline-none"
                        value={sizeUnitName}
                        onChange={(e) => setSizeUnitName(e.target.value)}
                      >
                        {unitsLike(product.pricingUnit).map((u) => (
                          <option key={u.name} value={u.name}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </InputAddon>
                  ) : (
                    <InputAddon boxed>{product.pricingUnit.name}</InputAddon>
                  )}
                </InputGroup>
                <div role="group" aria-label="常用规格" className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-ink-3">常用规格</span>
                  {sizeChoices.map(([label, s]) => (
                    <Chip
                      key={label}
                      aria-pressed={s.amount === sizeAmount && s.unitName === sizeUnitName}
                      className="numeric text-[13px]"
                      onClick={() => {
                        setSizeAmount(s.amount);
                        setSizeUnitName(s.unitName);
                      }}
                    >
                      {label}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 wide:col-span-2">
              {discounts.map((d, i) => (
                <div key={d.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)_auto] items-center gap-2">
                  <Input
                    aria-label={`优惠 ${i + 1} 名称`}
                    placeholder="优惠名称"
                    maxLength={50}
                    value={d.name}
                    onChange={(e) => updateDiscount(d.key, { name: e.target.value })}
                  />
                  <InputGroup>
                    <InputAddon className="text-record-low">−¥</InputAddon>
                    <InputGroupInput
                      aria-label={`优惠 ${i + 1} 金额`}
                      inputMode="decimal"
                      autoComplete="off"
                      autoFocus
                      placeholder="0.00"
                      figure="md"
                      value={d.amount}
                      onChange={(e) => updateDiscount(d.key, { amount: e.target.value })}
                    />
                  </InputGroup>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`移除优惠 ${i + 1}`}
                    onClick={() => setDiscounts((all) => all.filter((x) => x.key !== d.key))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2.5"
                  onClick={() => setDiscounts((all) => [...all, discountDraft()])}
                >
                  <Plus />
                  添加优惠
                </Button>
                {discountTotal > 0 && (
                  <span className="text-xs text-ink-3">
                    优惠合计{' '}
                    <span className="numeric text-[15px] font-semibold text-ink">{formatYuan(discountTotal)}</span>
                  </span>
                )}
              </div>
            </div>
          </PanelBody>
          {/* Lets the keyboard's return key save the price. */}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      </Panel>

      <Panel asChild>
        <section aria-label="保存选项">
          <PanelHeader as="h3" title="保存选项" />
          <PanelBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-2">渠道</span>
              {channels.length === 0 ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-ink-3">暂无渠道</span>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/channels">
                      <Plus />
                      新建渠道
                    </Link>
                  </Button>
                </div>
              ) : (
                <ChipGroup
                  aria-label="渠道"
                  options={channels.map((c) => ({ value: c.id, label: c.name }))}
                  value={channelId}
                  onValueChange={(next) => setChannelId(next)}
                />
              )}
            </div>
            <div className="grid gap-4 wide:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-2">购买情况</span>
                <SegmentedControl
                  aria-label="已购还是仅记录"
                  className="self-start"
                  options={[
                    { value: true, label: '已购' },
                    { value: false, label: '仅记录' },
                  ]}
                  value={purchased}
                  onValueChange={(next) => setPurchased(next)}
                />
              </div>
              <Field label="日期" htmlFor={`${id}-date`}>
                <Input
                  id={`${id}-date`}
                  type="date"
                  required
                  figure="sm"
                  value={date}
                  onChange={(e) => changeDate(e.target.value)}
                />
              </Field>
              <Field label="大促" htmlFor={`${id}-promotion`}>
                <NativeSelect
                  id={`${id}-promotion`}
                  className="w-full"
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
          </PanelBody>
        </section>
      </Panel>

      {error && <Alert>{error}</Alert>}
    </>
  );

  const savedStatus = saved && (
    <p
      role="status"
      className="flex items-center justify-between gap-3 rounded-md bg-ink px-3 py-2 text-sm text-background"
    >
      {saved}
      <Button variant="link" size="sm" className="text-background" asChild>
        <Link href={productPath(product.id)}>查看记录</Link>
      </Button>
    </p>
  );
  const offlineStatus = !online && (
    <p role="status" className="rounded-md bg-surface-hover px-3 py-2 text-sm text-ink-2">
      离线中：照常填写和判断，联网后才能保存。
    </p>
  );
  const details = priced &&
    'input' in read && [
      { label: '原价', value: formatYuan(read.input.listPrice) },
      ...(discountTotal > 0 ? [{ label: '优惠', value: `−${formatYuan(discountTotal)}` }] : []),
      {
        label: '总量',
        value: `${read.input.quantity} 件 × ${formatSize(read.input.size.amount, read.input.size.unit)}`,
      },
      {
        label: '入手价',
        value: product.stockLine === null ? '未设' : `${formatYuan(product.stockLine)} / ${perBase(product)}`,
        highlight: product.stockLine !== null,
      },
    ];
  const verdictOutput = (compact?: boolean) => (
    <VerdictDisplay
      compact={compact}
      verdict={judgment?.verdict ?? null}
      unitPrice={priced?.unitPrice ?? null}
      per={perBase(product)}
      gap={priced && <Gap judgment={judgment} netPrice={priced.netPrice} />}
      placeholder={
        !listPrice.trim() ? '未填原价' : typeof price === 'string' ? price : 'error' in read ? read.error : ''
      }
      details={details || undefined}
      className={compact ? 'flex-1 px-1' : undefined}
    />
  );
  const saveButton = (className?: string) => (
    <Button
      type="button"
      size="lg"
      disabled={!priced || !channelId || pending || !online}
      className={cn('shrink-0', className)}
      onClick={save}
    >
      {saveLabel}
    </Button>
  );
  const ruler = (
    <PriceRuler
      references={references}
      unitPrice={priced?.unitPrice ?? null}
      verdict={judgment?.verdict ?? null}
      per={perBase(product)}
    />
  );
  const saveMeta = [
    channels.find((c) => c.id === channelId)?.name,
    date,
    promotions.find((p) => p.id === promotionId)?.name,
  ].filter(Boolean);

  if (layout === 'wide') {
    return (
      <>
        <div className="flex min-w-0 flex-col gap-4 px-(--gutter) py-5">
          {header}
          {entry}
        </div>
        <section aria-label="判断结果" className={cn(stickyColumn, 'border-l border-line px-5 py-5')}>
          <div className="flex flex-col gap-5">
            <SectionHeader as="h2" title="判断结果" />
            {verdictOutput()}
            {ruler}
            <div className="flex flex-col gap-2">
              {saveButton('w-full')}
              {saveMeta.length > 0 && <p className="text-center text-xs text-ink-3">{saveMeta.join(' · ')}</p>}
            </div>
            {offlineStatus}
            {savedStatus}
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {header}
      <Panel>
        <PanelBody>{ruler}</PanelBody>
      </Panel>
      {entry}
      <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {offlineStatus}
        {savedStatus}
        <div className="flex items-stretch gap-1.5 rounded-md border border-line bg-surface p-1.5 shadow-overlay">
          {verdictOutput(true)}
          {saveButton('h-auto min-h-12 px-4')}
        </div>
      </div>
    </>
  );
}

function Gap({ judgment, netPrice }: { judgment: Judgment | null; netPrice: number }) {
  const gap = judgment?.stockLineGap ?? null;
  if (gap === null) {
    return (
      <>
        到手 {formatYuan(netPrice)}
        {judgment?.verdict === null && '，未设入手价'}
      </>
    );
  }
  return (
    <>
      {formatStockLineGap(gap)}，到手 {formatYuan(netPrice)}
    </>
  );
}
