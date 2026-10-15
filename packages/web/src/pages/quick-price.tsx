import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, CirclePlus, Search, X } from 'lucide-react';
import { findLastYearPromotionLowest, judge, type Judgment, type Price } from '@stockup/domain';
import { Alert, attempt, describeError, RetryAlert } from '@/components/editing';
import { NewProductForm } from '@/components/product-form';
import { VerdictDisplay, verdictTone } from '@/components/verdict';
import { api, isFromCache, type CategoryGroup, type Channel, type PriceReferences, type Product, type Promotion } from '@/lib/api';
import { formatSize, formatStockLineGap, formatYuan } from '@/lib/format';
import { useHistoryState } from '@/lib/history';
import { useOnline } from '@/lib/online';
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
  type DiscountDraft,
} from '@/lib/pricing';
import { cn } from '@/lib/utils';

interface Household {
  groups: CategoryGroup[];
  products: Product[];
  channels: Channel[];
  promotions: Promotion[];
  lastUsedChannel: Channel | null;
  references: PriceReferences[];
}

const card = 'bg-card rounded-2xl shadow-[0_1px_2px_rgba(30,41,36,.04),0_0_0_1px_rgba(30,41,36,.04)]';
// Separates stacked rows inside a card, indented like the rows' content.
const rowRule =
  "relative [&:not(:first-child)]:before:bg-border [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-4 [&:not(:first-child)]:before:h-px [&:not(:first-child)]:before:content-['']";

type Layout = 'narrow' | 'wide';

function yuan(cents: number) {
  return (cents / 100).toFixed(2);
}

function perBase(product: Product) {
  return formatSize(product.baseSize, product.pricingUnit);
}

const staleRetryDelay = 3000;

const wideScreen = '(min-width: 900px)';

function useWideScreen() {
  const [wide, setWide] = useState(() => window.matchMedia(wideScreen).matches);
  useEffect(() => {
    const media = window.matchMedia(wideScreen);
    const onChange = () => setWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return wide;
}

export function QuickPricePage({ onOpenProduct }: { onOpenProduct(id: string): void }) {
  const wide = useWideScreen();
  const online = useOnline();
  const [household, setHousehold] = useState<Household>();
  const [loadError, setLoadError] = useState<string>();
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

  const reload = useCallback(async () => {
    try {
      const fetched = await Promise.all([
        api.catalog(),
        api.products(),
        api.channels(),
        api.promotions(),
        api.lastUsedChannel(),
        api.priceReferences(),
      ]);
      const [groups, products, channels, promotions, lastUsed, references] = fetched;
      setHousehold({ groups, products, channels, promotions, lastUsedChannel: lastUsed.channel, references });
      setLoadError(undefined);
      return fetched.some(isFromCache);
    } catch (error) {
      setLoadError(describeError(error));
      return false;
    }
  }, []);

  // Offline, the service worker answers from its cache. The network can still be down for a moment after
  // the device reports it is back, so cached data is read again until a fresh answer arrives.
  const mounted = useRef(true);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const refresh = useCallback(async () => {
    clearTimeout(retry.current);
    const fromCache = await reload();
    clearTimeout(retry.current);
    if (mounted.current && fromCache && navigator.onLine) retry.current = setTimeout(refresh, staleRetryDelay);
  }, [reload]);
  useEffect(() => {
    mounted.current = true;
    refresh();
    window.addEventListener('online', refresh);
    return () => {
      mounted.current = false;
      clearTimeout(retry.current);
      window.removeEventListener('online', refresh);
    };
  }, [refresh]);

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
  const choose = (results: Product[]) => {
    if (results[0]) pick(results[0].id);
    else create(trimmed);
  };

  useEffect(() => {
    if (!choosing || !found) return;
    setChoosing(false);
    choose(found);
  }, [found, choosing]);

  const search = (
    <label className={cn(card, 'flex h-12 items-center gap-2.5 rounded-[14px] px-4')}>
      <Search className="text-muted-foreground size-[18px] shrink-0" />
      <input
        ref={searchRef}
        type="search"
        aria-label="搜索商品"
        aria-keyshortcuts="/"
        placeholder={product ? '换一个商品' : '搜商品，拼音首字母也行'}
        className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-base outline-none [&::-webkit-search-cancel-button]:hidden"
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
      {query && (
        <button
          type="button"
          aria-label="清空搜索"
          className="bg-border text-muted-foreground flex size-5 items-center justify-center rounded-full"
          onClick={() => changeQuery('')}
        >
          <X className="size-3" />
        </button>
      )}
    </label>
  );
  const results = trimmed && household && found && (
    <SearchResults
      query={trimmed}
      products={found}
      groups={household.groups}
      onPick={pick}
      onCreate={create}
    />
  );
  const list = household && (
    <ProductList groups={household.groups} products={household.products} selectedId={product?.id} onPick={pick} />
  );
  const newProduct = household && creating !== undefined && (
    <NewProductForm
      key={creating}
      groups={household.groups}
      defaultName={creating}
      className={cn(card, 'border-0 p-4')}
      onCancel={() => setCreating(undefined)}
      onCreated={async (created) => {
        await refresh();
        pick(created.id);
      }}
    />
  );
  const loadAlert = loadError && <RetryAlert message={`加载失败：${loadError}`} onRetry={reload} />;
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
        onOpenProduct={() => onOpenProduct(product.id)}
      />
    );

  // Both layouts keep the search box and QuickPrice at the same place in the tree, so crossing the
  // breakpoint, like rotating a tablet, keeps the search and the price being entered.
  return (
    <div
      className={cn(
        wide
          ? 'mx-auto grid max-w-7xl grid-cols-[17rem_minmax(0,1fr)_21rem] items-start gap-5 px-5 py-4'
          : 'mx-auto flex max-w-md flex-col gap-3 px-4 pt-3',
        !wide && (product && !newProduct ? 'pb-36' : 'pb-8'),
      )}
    >
      <div
        className={
          wide
            ? 'sticky top-4 flex max-h-[calc(100svh-2rem)] flex-col gap-3 overflow-y-auto'
            : 'bg-background sticky top-0 z-10 -mx-4 flex flex-col gap-2 px-4 pt-1 pb-2'
        }
      >
        {search}
        {wide && loadAlert}
        {wide ? results || list : results}
      </div>
      {!wide && loadAlert}
      {newProduct ? (
        <div className="flex flex-col">{newProduct}</div>
      ) : product ? (
        quickPrice(wide ? 'wide' : 'narrow')
      ) : wide ? (
        household && (
          <p className="text-muted-foreground col-span-2 py-16 text-center text-sm">从左侧选一个商品开始算价，按 / 搜索。</p>
        )
      ) : (
        !trimmed && list
      )}
    </div>
  );
}

function categoryLabel(groups: CategoryGroup[], categoryId: string) {
  for (const group of groups) {
    const category = group.categories.find((c) => c.id === categoryId);
    if (category) return `${group.name} / ${category.name}`;
  }
  return '';
}

function SearchResults({
  query,
  products,
  groups,
  onPick,
  onCreate,
}: {
  query: string;
  products: Product[];
  groups: CategoryGroup[];
  onPick(id: string): void;
  onCreate(name: string): void;
}) {
  return (
    <section aria-label="搜索结果" className={cn(card, 'overflow-hidden')}>
      {products.length === 0 ? (
        <div className="flex flex-col items-start gap-1.5 px-4 py-3.5">
          <p className="text-muted-foreground text-[15px]">没有找到「{query}」相关的商品。</p>
          <button type="button" className="flex h-9 items-center gap-2 text-[15px]" onClick={() => onCreate(query)}>
            <CirclePlus className="text-muted-foreground size-4" />
            <span className="decoration-primary underline decoration-2 underline-offset-[5px]">新建「{query}」</span>
          </button>
        </div>
      ) : (
        <ul>
          {products.map((p, i) => (
            <li key={p.id} className={rowRule}>
              <button
                type="button"
                className={cn(
                  'active:bg-muted hover:bg-muted/60 flex w-full items-baseline justify-between gap-3 px-4 py-3.5 text-left',
                  i === 0 && 'min-[900px]:bg-muted/60',
                )}
                onClick={() => onPick(p.id)}
              >
                <span className="text-base">{p.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{categoryLabel(groups, p.categoryId)}</span>
              </button>
            </li>
          ))}
        </ul>
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
  products: Product[];
  selectedId: string | undefined;
  onPick(id: string): void;
}) {
  const [groupId, setGroupId] = useHistoryState<string | undefined>('quickPriceGroupId', undefined);
  const active = products.filter((p) => !p.archived);
  if (active.length === 0) {
    return <p className="text-muted-foreground px-1 py-8 text-center text-sm">还没有商品，搜索商品名就能新建。</p>;
  }
  const shownGroups = groups.filter(
    (g) => g.categories.some((c) => active.some((p) => p.categoryId === c.id)) && (!groupId || g.id === groupId),
  );

  return (
    <section aria-label="商品列表" className="flex flex-col gap-3">
      <div role="tablist" aria-label="大类" className="-mx-4 flex shrink-0 gap-5 overflow-x-auto px-5 min-[900px]:mx-0 min-[900px]:px-1">
        {[{ id: undefined, name: '全部' }, ...groups].map((g) => (
          <button
            key={g.id ?? ''}
            type="button"
            role="tab"
            aria-selected={groupId === g.id}
            className={cn(
              'relative h-8 shrink-0 text-[15px]',
              groupId === g.id ? 'font-semibold' : 'text-muted-foreground',
            )}
            onClick={() => setGroupId(g.id)}
          >
            {g.name}
            {groupId === g.id && <span className="bg-primary absolute inset-x-0 -bottom-0.5 h-[3px] rounded-full" />}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-6">
        {shownGroups.flatMap((g) =>
          g.categories.map((c) => {
            const items = active.filter((p) => p.categoryId === c.id);
            if (items.length === 0) return null;
            return (
              <section key={c.id} aria-label={`${g.name} / ${c.name}`}>
                <h2 className="text-muted-foreground mb-2 flex items-baseline gap-1.5 px-1 text-[13px] font-medium">
                  {c.name}
                  <span className="font-normal tabular-nums">{items.length}</span>
                </h2>
                <ul className={cn(card, 'overflow-hidden')}>
                  {items.map((p) => (
                    <li key={p.id} className={rowRule}>
                      <button
                        type="button"
                        aria-current={p.id === selectedId || undefined}
                        className="active:bg-muted aria-[current]:bg-muted flex w-full items-center gap-3 px-4 py-3.5 text-left"
                        onClick={() => onPick(p.id)}
                      >
                        <span className="min-w-0 flex-1 truncate text-base">{p.name}</span>
                        <span className="shrink-0 text-right">
                          {p.stockLine === null ? (
                            <span className="text-muted-foreground block text-sm leading-6">未设</span>
                          ) : (
                            <span className="numeric block text-[22px] leading-6 font-semibold">
                              {yuan(p.stockLine)}
                            </span>
                          )}
                          <span className="text-muted-foreground block text-[11px] leading-4">
                            入手价 / {perBase(p)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          }),
        )}
      </div>
    </section>
  );
}

interface References {
  lowest: number | null;
  stockLine: number | null;
  lastYear: { name: string; lowest: number } | null;
}

// The scale spans the references only, so an outlying price is pinned to an edge instead of squashing them.
function PriceRuler({ references, unitPrice, verdictClass }: {
  references: References;
  unitPrice: number | null;
  verdictClass: string;
}) {
  const marks = [
    references.lowest !== null && { label: '历史最低', value: references.lowest, dot: 'bg-record-low' },
    references.stockLine !== null && { label: '入手价', value: references.stockLine, dot: 'bg-stock-up' },
    references.lastYear && { label: `去年${references.lastYear.name}`, value: references.lastYear.lowest, dot: 'bg-foreground/60' },
  ].filter((m) => m !== false && m !== null);
  if (marks.length === 0) {
    return <p className="text-muted-foreground text-[13px] leading-5">还没有价格记录。这次的价格保存后，会成为第一条参考。</p>;
  }

  const values = marks.map((m) => m.value);
  const low = Math.min(...values) * 0.8;
  const high = Math.max(...values) * 1.25;
  const at = (v: number) => Math.min(100, Math.max(0, ((v - low) / (high - low)) * 100));
  // Widest first, so a narrower zone stays visible on top of a wider one.
  const zones = [
    references.stockLine !== null && { value: references.stockLine, className: 'bg-stock-up-zone' },
    references.lowest !== null && { value: references.lowest, className: 'bg-record-low-zone' },
  ]
    .filter((z) => z !== false)
    .sort((a, b) => b.value - a.value);
  const overflow = unitPrice === null ? 0 : unitPrice > high ? 1 : unitPrice < low ? -1 : 0;

  return (
    <div>
      <div className="relative mx-3 h-[50px] select-none" aria-hidden>
        <div className="bg-border absolute inset-x-0 top-9 h-1 rounded-full" />
        {zones.map((z) => (
          <div key={z.className} className={cn('absolute top-9 left-0 h-1 rounded-full', z.className)} style={{ width: `${at(z.value)}%` }} />
        ))}
        {marks.map((m) => (
          <div
            key={m.label}
            className={cn('absolute top-8 h-3 w-0.5 -translate-x-1/2 rounded-full', m.dot)}
            style={{ left: `${at(m.value)}%` }}
          />
        ))}
        {unitPrice !== null && (
          <div
            className={cn(
              'absolute top-0 flex flex-col',
              overflow > 0 ? '-translate-x-full items-end' : overflow < 0 ? 'items-start' : '-translate-x-1/2 items-center',
            )}
            style={{ left: `${at(unitPrice)}%` }}
          >
            <div className={cn('numeric rounded-full px-2 py-[5px] text-base leading-none font-semibold whitespace-nowrap text-white', verdictClass)}>
              {overflow < 0 && '‹ '}
              {yuan(unitPrice)}
              {overflow > 0 && ' ›'}
            </div>
            <div className={cn('h-2.5 w-0.5', verdictClass)} />
          </div>
        )}
      </div>
      <ul aria-label="参考单价" className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {marks.map((m) => (
          <li key={m.label} className="flex items-center gap-1.5">
            <span className={cn('size-1.5 rounded-full', m.dot)} />
            {m.label}
            <span className="text-foreground text-[13px] font-medium tabular-nums">{yuan(m.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className={cn(rowRule, 'flex min-h-[60px] items-center gap-3 px-4')}>
      <label htmlFor={htmlFor} className="text-muted-foreground w-12 shrink-0 text-[15px]">
        {label}
      </label>
      <span className="flex flex-1 items-baseline justify-end gap-1.5">{children}</span>
      {hint}
    </div>
  );
}

const bigInput =
  'numeric w-full min-w-0 bg-transparent text-right text-[28px] font-semibold outline-none placeholder:text-border';

function QuickPrice({
  layout,
  product,
  household,
  online,
  onSaved,
  onOpenProduct,
}: {
  layout: Layout;
  product: Product;
  household: Household;
  online: boolean;
  onSaved(): Promise<unknown>;
  onOpenProduct(): void;
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
  const references: References = {
    lowest: productReferences?.lowestUnitPrice ?? null,
    stockLine: product.stockLine,
    lastYear: datePromotion && lastYearLowest !== null ? { name: datePromotion.name, lowest: lastYearLowest } : null,
  };
  const judgment: Judgment | null =
    priced
      ? judge({
          unitPrice: priced.unitPrice,
          stockLine: product.stockLine,
          lowestUnitPrice: references.lowest,
          lastYearPromotionLowest: lastYearLowest,
        })
      : null;
  const tone = judgment?.verdict ? verdictTone[judgment.verdict] : null;

  // Sizes this product was recorded in, newest first, so a repeat purchase is one tap away.
  const sizeChoices = [
    ...new Map(
      [...(productReferences?.recentSizes ?? []), { amount: product.baseSize, unit: product.pricingUnit }].map(
        (s) => [formatSize(s.amount, s.unit), { amount: String(Number(s.amount.toFixed(3))), unitName: s.unit.name }],
      ),
    ),
  ].slice(0, 5);

  const multiplied = multipliedQuantity(quantity);
  const updateDiscount = (key: number, change: Partial<DiscountDraft>) =>
    setDiscounts((all) => all.map((d) => (d.key === key ? { ...d, ...change } : d)));

  function changeDate(next: string) {
    setDate(next);
    if (!promotionPicked) setPromotionId(matchDate(next, promotions)?.id ?? '');
  }

  const saveLabel = online ? `存为${purchased ? '已购' : '仅记录'}` : '联网后保存';

  async function save() {
    if (pending) return;
    if (!online) return setError('离线时不能保存，联网后再存，填好的内容会留着。');
    if ('error' in read) return setError(read.error);
    if (!date) return setError('请选择日期。');
    if (typeof price === 'string') return setError(price);
    if (!channelId) return setError('请选择渠道。');
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

  const heading = (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-[22px] leading-7 font-semibold tracking-[0.01em]">{product.name}</h2>
      <button type="button" className="text-muted-foreground flex shrink-0 items-center text-xs" onClick={onOpenProduct}>
        每 {perBase(product)} · 详情
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
  const ruler = (
    <PriceRuler references={references} unitPrice={priced?.unitPrice ?? null} verdictClass={tone?.solid ?? 'bg-skip'} />
  );

  const entry = (
    <>
      <form
        aria-label="快速算价"
        className={cn(card, 'overflow-hidden')}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="原价" htmlFor={`${id}-list`}>
          <input
            id={`${id}-list`}
            inputMode="decimal"
            autoComplete="off"
            autoFocus={layout === 'wide'}
            placeholder="0.00"
            className={bigInput}
            value={listPrice}
            onChange={(e) => {
              setListPrice(e.target.value);
              setSaved(undefined);
            }}
          />
          <span className="text-muted-foreground text-sm">元</span>
        </Field>
        <Field
          label="件数"
          htmlFor={`${id}-quantity`}
          hint={multiplied !== null && <span className="text-muted-foreground text-[13px] whitespace-nowrap tabular-nums">共 {multiplied}</span>}
        >
          <input
            id={`${id}-quantity`}
            autoComplete="off"
            placeholder="3×6"
            className={bigInput}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <span className="text-muted-foreground text-sm">件</span>
        </Field>
        <Field label="规格" htmlFor={`${id}-size`}>
          <input
            id={`${id}-size`}
            inputMode="decimal"
            autoComplete="off"
            className={bigInput}
            value={sizeAmount}
            onChange={(e) => setSizeAmount(e.target.value)}
          />
          {unitsLike(product.pricingUnit).length > 1 ? (
            <select
              aria-label="规格单位"
              className="text-muted-foreground bg-transparent text-sm"
              value={sizeUnitName}
              onChange={(e) => setSizeUnitName(e.target.value)}
            >
              {unitsLike(product.pricingUnit).map((u) => (
                <option key={u.name} value={u.name}>
                  {u.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-muted-foreground text-sm">{product.pricingUnit.name}</span>
          )}
        </Field>
        <div role="group" aria-label="常用规格" className="-mt-1 flex gap-2 overflow-x-auto px-4 pb-3">
          {sizeChoices.map(([label, s]) => {
            const on = s.amount === sizeAmount && s.unitName === sizeUnitName;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                className={cn(
                  'h-8 shrink-0 rounded-full px-3.5 text-sm tabular-nums',
                  on ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
                )}
                onClick={() => {
                  setSizeAmount(s.amount);
                  setSizeUnitName(s.unitName);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {discounts.map((d, i) => (
          <div key={d.key} className={cn(rowRule, 'flex min-h-[60px] items-center gap-3 px-4')}>
            <input
              aria-label={`优惠 ${i + 1} 名称`}
              placeholder="优惠"
              maxLength={50}
              className="text-muted-foreground w-24 shrink-0 bg-transparent text-[15px] outline-none"
              value={d.name}
              onChange={(e) => updateDiscount(d.key, { name: e.target.value })}
            />
            <span className="flex flex-1 items-baseline justify-end gap-1">
              <span className="numeric text-record-low text-2xl">−</span>
              <input
                aria-label={`优惠 ${i + 1} 金额`}
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                placeholder="0"
                className={cn(bigInput, 'text-record-low placeholder:text-record-low-zone w-auto')}
                style={{ width: `${Math.max(1, d.amount.length) + 0.5}ch` }}
                value={d.amount}
                onChange={(e) => updateDiscount(d.key, { amount: e.target.value })}
              />
              <span className="text-muted-foreground text-sm">元</span>
            </span>
            <button
              type="button"
              aria-label={`移除优惠 ${i + 1}`}
              className="bg-muted text-muted-foreground flex size-6 items-center justify-center rounded-full"
              onClick={() => setDiscounts((all) => all.filter((x) => x.key !== d.key))}
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <div className={rowRule}>
          <button
            type="button"
            className="text-muted-foreground flex h-[52px] w-full items-center gap-2 px-4 text-[15px]"
            onClick={() => setDiscounts((all) => [...all, discountDraft()])}
          >
            <CirclePlus className="size-4" />
            <span className="decoration-primary underline decoration-2 underline-offset-[5px]">加一项优惠</span>
          </button>
        </div>
        {/* Lets the keyboard's return key save the price. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>

      <section aria-label="保存选项" className={cn(card, 'flex flex-col gap-3.5 px-4 py-3.5')}>
        <div role="radiogroup" aria-label="渠道" className="-mx-1 flex gap-2 overflow-x-auto px-1">
          {channels.length === 0 && <span className="text-muted-foreground text-sm">先在「渠道」页添加渠道</span>}
          {channels.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={channelId === c.id}
              className={cn(
                'h-9 shrink-0 rounded-full px-4 text-sm',
                channelId === c.id ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
              )}
              onClick={() => setChannelId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <div role="radiogroup" aria-label="已购还是仅记录" className="bg-muted flex rounded-full p-[3px]">
            {[false, true].map((value) => (
              <button
                key={String(value)}
                type="button"
                role="radio"
                aria-checked={purchased === value}
                className={cn(
                  'h-8 rounded-full px-4 text-sm',
                  purchased === value
                    ? 'bg-card font-medium shadow-[0_1px_3px_rgba(30,41,36,.12)]'
                    : 'text-muted-foreground',
                )}
                onClick={() => setPurchased(value)}
              >
                {value ? '已购' : '仅记录'}
              </button>
            ))}
          </div>
          <input
            type="date"
            aria-label="日期"
            required
            className="text-muted-foreground bg-transparent text-[15px] tabular-nums"
            value={date}
            onChange={(e) => changeDate(e.target.value)}
          />
        </div>
        <label className="text-muted-foreground flex items-center justify-between gap-3 text-sm">
          大促
          <select
            className="text-foreground bg-transparent text-right"
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
        </label>
      </section>

      {error && <Alert>{error}</Alert>}
    </>
  );

  const savedStatus = saved && (
    <p role="status" className="bg-foreground text-background flex items-center justify-between rounded-xl px-4 py-2.5 text-sm">
      {saved}
      <button type="button" className="decoration-primary underline decoration-2 underline-offset-4" onClick={onOpenProduct}>
        查看记录
      </button>
    </p>
  );
  const offlineStatus = !online && (
    <p role="status" className="bg-muted text-muted-foreground rounded-xl px-4 py-2.5 text-sm">
      离线中：照常算价，联网后才能保存。
    </p>
  );
  const verdictOutput = (compact?: boolean) => (
    <VerdictDisplay
      compact={compact}
      verdict={judgment?.verdict ?? null}
      unitPrice={priced?.unitPrice ?? null}
      per={perBase(product)}
      gap={priced && <Gap judgment={judgment} netPrice={priced.netPrice} />}
      placeholder={typeof price === 'string' ? price : '填好原价、件数和规格'}
      className={compact ? 'flex-1 px-1' : undefined}
    />
  );
  const saveButton = (className?: string) => (
    <button
      type="button"
      disabled={!priced || !channelId || pending || !online}
      className={cn(
        'bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground shrink-0 rounded-[14px] px-4 text-[15px] font-semibold',
        className,
      )}
      onClick={save}
    >
      {saveLabel}
    </button>
  );

  if (layout === 'wide') {
    return (
      <>
        <div className="flex min-w-0 flex-col gap-3">
          <section aria-label="商品" className={cn(card, 'p-4')}>
            {heading}
          </section>
          {entry}
        </div>
        <section aria-label="算价结果" className={cn(card, 'sticky top-4 flex flex-col gap-4 p-4')}>
          {ruler}
          {verdictOutput()}
          {saveButton('h-12')}
          {offlineStatus}
          {savedStatus}
        </section>
      </>
    );
  }

  return (
    <>
      <section aria-label="商品" className={cn(card, 'p-4')}>
        {heading}
        <div className="mt-3">{ruler}</div>
      </section>
      {entry}
      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-md flex-col gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {offlineStatus}
        {savedStatus}
        <div className="bg-card flex items-stretch gap-1 rounded-[20px] p-1.5 shadow-[0_12px_32px_-8px_rgba(30,41,36,.28),0_0_0_1px_rgba(30,41,36,.05)]">
          {verdictOutput(true)}
          {saveButton()}
        </div>
      </div>
    </>
  );
}

function Gap({ judgment, netPrice }: { judgment: Judgment | null; netPrice: number }) {
  const gap = judgment?.stockLineGap ?? null;
  if (gap === null) {
    return <>到手 {formatYuan(netPrice)}{judgment?.verdict === null && '，未设入手价'}</>;
  }
  return (
    <>
      <span className={cn(gap < 0 && 'text-stock-up')}>{formatStockLineGap(gap)}</span>，到手 {formatYuan(netPrice)}
    </>
  );
}
