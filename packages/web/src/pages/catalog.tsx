import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Folder, Package, Pencil, Plus, Search, Tags, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VerdictBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, InputGroup, InputGroupInput } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { List, ListCell, ListHeader, ListRow } from '@/components/ui/list';
import { PriceFigure } from '@/components/ui/price-figure';
import { NativeSelect } from '@/components/ui/native-select';
import { PageContent, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, attempt, ConfirmButton, NameForm, nameTaken, report, RetryAlert, type Action } from '@/components/editing';
import { NewProductForm, NoteField, PlacementSelect } from '@/components/product-form';
import { api, type CategoryGroup, type Placement, type Product, type ProductSummary } from '@/lib/api';
import { loadErrorOf, queries, useRefresh } from '@/lib/queries';
import { outsideCategories, parsePlacementKey, placementKey, placementLabel, placementOf } from '@/lib/catalog';
import { formatSize } from '@/lib/format';
import { Link, productPath, useNavigate } from '@/lib/navigation';
import { useHistoryState } from '@/lib/history';
import { wideScreen } from '@/lib/layout';
import { useProductSearch } from '@/lib/search';
import { cn } from '@/lib/utils';

// A category, or the products a group holds outside its categories.
interface Shelf {
  key: string;
  placement: Placement;
  name: string;
  productCount: number;
  group: CategoryGroup;
  category?: CategoryGroup['categories'][number];
}

function shelvesOf(groups: CategoryGroup[]): Shelf[] {
  return groups.flatMap((group) => [
    {
      key: placementKey({ categoryGroupId: group.id }),
      placement: { categoryGroupId: group.id },
      name: outsideCategories,
      productCount: group.productCount,
      group,
    },
    ...group.categories.map((category) => ({
      key: placementKey({ categoryId: category.id }),
      placement: { categoryId: category.id },
      name: category.name,
      productCount: category.productCount,
      group,
      category,
    })),
  ]);
}

// A group lists its own shelf once it holds products there, or while it has no category to offer instead.
function showsGroupShelf(group: CategoryGroup) {
  return group.productCount > 0 || group.categories.length === 0;
}

export function CatalogPage() {
  const catalog = useQuery(queries.catalog());
  const groups = catalog.data;
  const loadError = loadErrorOf(catalog.error);
  const reload = useRefresh();
  const [selectedKey, setSelectedKey] = useHistoryState<string | undefined>('placement', undefined);
  const [query, setQuery] = useHistoryState('query', '');
  const [creating, setCreating] = useState(false);
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

  const selected = shelvesOf(groups ?? []).find((s) => s.key === selectedKey);
  const trimmed = query.trim();
  // New products go onto the selected shelf; an empty one offers 新建商品 in its own empty state instead.
  const canCreate = selected && !creating && (selected.productCount > 0 || trimmed);

  const header = (
    <PageHeader
      title="商品"
      actions={
        <>
          <InputGroup className="w-40 wide:w-72">
            <Search />
            <InputGroupInput
              ref={searchRef}
              type="search"
              aria-label="搜索商品"
              placeholder="搜索商品"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Kbd className="max-wide:hidden">/</Kbd>
          </InputGroup>
          {canCreate && (
            <Button
              onClick={() => {
                setQuery('');
                setCreating(true);
              }}
            >
              <Plus />
              新建商品
            </Button>
          )}
        </>
      }
    />
  );
  const loadAlert = loadError && (
    <RetryAlert message={`大类与品类加载失败：${loadError}`} onRetry={() => catalog.refetch()} />
  );

  if (!groups) {
    return (
      <>
        {header}
        <PageContent>{loadAlert || <CatalogSkeleton />}</PageContent>
      </>
    );
  }

  if (trimmed) {
    return (
      <>
        {header}
        <PageContent>
          {loadAlert}
          <section aria-label="搜索结果">
            <SearchResults query={trimmed} groups={groups} />
          </section>
        </PageContent>
      </>
    );
  }

  const showsDetail = Boolean(selected);
  return (
    <>
      {header}
      {loadAlert && <div className="px-4 pt-4 wide:px-(--gutter)">{loadAlert}</div>}
      <div className="wide:grid wide:min-h-[calc(100dvh-var(--page-bar-height))] wide:grid-cols-[16.5rem_minmax(0,1fr)]">
        <section
          aria-label="大类与品类"
          className={cn('flex flex-col bg-surface wide:border-r wide:border-line', showsDetail && 'max-wide:hidden')}
        >
          <CategoryTree
            groups={groups}
            selectedKey={selected?.key}
            onSelect={(key) => {
              setCreating(false);
              setSelectedKey(key);
            }}
            onChange={reload}
          />
        </section>
        <section aria-label="品类详情" className={cn('flex min-w-0 flex-col', !showsDetail && 'max-wide:hidden')}>
          {selected ? (
            <ShelfPanel
              key={selected.key}
              shelf={selected}
              groups={groups}
              creating={creating}
              onCreatingChange={setCreating}
              onBack={() => {
                setCreating(false);
                setSelectedKey(undefined);
              }}
              onChange={reload}
              onDeleted={() => {
                setSelectedKey(undefined);
                return reload();
              }}
            />
          ) : (
            <EmptyState title="未选择品类" icon={<Tags />} />
          )}
        </section>
      </div>
    </>
  );
}

function CatalogSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function SearchResults({ query, groups }: { query: string; groups: CategoryGroup[] }) {
  const { found, error } = useProductSearch(query);

  if (error) return <Alert>{`搜索失败：${error}`}</Alert>;
  if (!found) return null;
  // Results for an earlier query stay visible but dimmed and inert until the new ones arrive.
  const stale = found.query !== query;
  if (found.products.length === 0) {
    return (
      <div aria-busy={stale} className={cn(stale && 'opacity-50')}>
        <EmptyState title={`未找到「${found.query}」相关的商品`} icon={<Search />} />
      </div>
    );
  }
  return (
    <Panel>
      <List variant="ruled" aria-busy={stale} inert={stale} className={cn(stale && 'opacity-50')}>
        {found.products.map((product) => {
          const placement = placementLabel(groups, product);
          return (
            <li key={product.id} aria-label={product.name}>
              <ListRow className="py-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <ProductLink product={product} />
                  <span className="text-xs text-ink-3">
                    {placement && `${placement} · `}基准规格{' '}
                    {formatSize(product.baseSize, product.pricingUnit)}
                  </span>
                </div>
              </ListRow>
            </li>
          );
        })}
      </List>
    </Panel>
  );
}

function ProductLink({ product }: { product: Product }) {
  return (
    <Link
      href={productPath(product.id)}
      className="min-w-0 truncate text-[13px] font-medium text-ink underline-offset-4 hover:underline"
    >
      {product.name}
    </Link>
  );
}

function CategoryTree({
  groups,
  selectedKey,
  onSelect,
  onChange,
}: {
  groups: CategoryGroup[];
  selectedKey?: string;
  onSelect(key: string): void;
  onChange(): Promise<void>;
}) {
  const newGroup = (
    <NameForm
      label="新大类名称"
      submitLabel="新建大类"
      onSubmit={(name) =>
        attempt(async () => {
          await api.createCategoryGroup({ name });
          await onChange();
        }, nameTaken)
      }
    />
  );

  if (groups.length === 0) return <EmptyState title="暂无大类" icon={<Folder />} action={newGroup} />;
  return (
    <>
      <SectionHeader title="分类" className="px-4 pt-3" />
      <div className="flex flex-1 flex-col gap-1 pb-3">
        {groups.map((group) => (
          <GroupItem key={group.id} group={group} selectedKey={selectedKey} onSelect={onSelect} onChange={onChange} />
        ))}
      </div>
      <div className="border-t border-line px-3 py-3 wide:sticky wide:bottom-0 wide:bg-surface">{newGroup}</div>
    </>
  );
}

function GroupItem({
  group,
  selectedKey,
  onSelect,
  onChange,
}: {
  group: CategoryGroup;
  selectedKey?: string;
  onSelect(key: string): void;
  onChange(): Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const shelves = shelvesOf([group]).filter((s) => s.category || showsGroupShelf(group));
  const total = shelves.reduce((sum, s) => sum + s.productCount, 0);

  return (
    <div role="group" aria-label={`大类 ${group.name}`}>
      <List>
        <li>
          {renaming ? (
            <ListRow className="py-1 hover:bg-transparent">
              <NameForm
                label="大类名称"
                submitLabel="保存"
                defaultValue={group.name}
                autoFocus
                onCancel={() => setRenaming(false)}
                onSubmit={async (name) => {
                  const message = await attempt(async () => {
                    await api.updateCategoryGroup(group.id, { name });
                    await onChange();
                  }, nameTaken);
                  if (!message) setRenaming(false);
                  return message;
                }}
              />
            </ListRow>
          ) : (
            <ListRow className="group/row h-9 gap-1.5 py-0 text-ink-3">
              <Folder className="size-4 shrink-0" />
              <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{group.name}</h2>
              <span className="flex items-center wide:opacity-0 wide:group-focus-within/row:opacity-100 wide:group-hover/row:opacity-100">
                <Button variant="ghost" size="icon-xs" aria-label={`在 ${group.name} 下新建品类`} onClick={() => setAdding(true)}>
                  <Plus />
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label={`重命名 ${group.name}`} onClick={() => setRenaming(true)}>
                  <Pencil />
                </Button>
                <ConfirmButton
                  ariaLabel={`删除大类 ${group.name}`}
                  size="icon-xs"
                  title={`删除大类「${group.name}」？`}
                  description="删除后无法恢复。"
                  confirmLabel="删除"
                  blocked={
                    group.categories.length > 0 || group.productCount > 0
                      ? { title: `无法删除「${group.name}」`, reason: '大类下还有品类或商品，先把它们移走或删除。' }
                      : undefined
                  }
                  onConfirm={() =>
                    attempt(
                      async () => {
                        await api.deleteCategoryGroup(group.id);
                        await onChange();
                        toast.success(`已删除大类「${group.name}」`);
                      },
                      { not_empty: '大类下还有品类或商品，无法删除' },
                    )
                  }
                >
                  <Trash2 />
                </ConfirmButton>
              </span>
              <span className="numeric w-6 text-right text-xs">{total}</span>
            </ListRow>
          )}
        </li>
        {adding && (
          <li>
            <ListRow inset className="py-1 hover:bg-transparent">
              <NameForm
                label="新品类名称"
                submitLabel="新建品类"
                autoFocus
                onCancel={() => setAdding(false)}
                onSubmit={(name) =>
                  attempt(async () => {
                    const created = await api.createCategory({ categoryGroupId: group.id, name });
                    setAdding(false);
                    await onChange();
                    const key = placementKey({ categoryId: created.id });
                    // Wide screens show the category beside the tree. On a phone opening it would leave the tree,
                    // where the member may be adding more, so it is offered instead.
                    if (window.matchMedia(wideScreen).matches) onSelect(key);
                    else {
                      toast.success(`已新建品类「${created.name}」`, {
                        action: { label: '查看', onClick: () => onSelect(key) },
                      });
                    }
                  }, nameTaken)
                }
              />
            </ListRow>
          </li>
        )}
        {shelves.map((shelf) => (
          <li key={shelf.key}>
            <ListRow inset asChild aria-current={shelf.key === selectedKey ? 'true' : undefined}>
              <button
                type="button"
                className={cn(
                  'h-8 w-full py-0 text-[13px] text-ink-2 aria-[current]:font-medium aria-[current]:text-ink',
                  shelf.productCount === 0 && 'text-ink-3',
                )}
                onClick={() => onSelect(shelf.key)}
              >
                <span className="min-w-0 flex-1 truncate">{shelf.name}</span>
                <span className="numeric text-xs text-ink-3">{shelf.productCount}</span>
              </button>
            </ListRow>
          </li>
        ))}
      </List>
    </div>
  );
}

const priceColumns = 'grid grid-cols-3 gap-3';

const rowGrid =
  'wide:grid-cols-[minmax(0,1fr)_6rem_minmax(0,26rem)_4.5rem] wide:items-center wide:gap-x-4';

function ShelfPanel({
  shelf,
  groups,
  creating,
  onCreatingChange,
  onBack,
  onChange,
  onDeleted,
}: {
  shelf: Shelf;
  groups: CategoryGroup[];
  creating: boolean;
  onCreatingChange(creating: boolean): void;
  onBack(): void;
  onChange(): Promise<void>;
  onDeleted(): Promise<void>;
}) {
  const { key: shelfKey, category } = shelf;
  const shelfProducts = useQuery(queries.products(parsePlacementKey(shelfKey)));
  const products = shelfProducts.data;
  const loadError = loadErrorOf(shelfProducts.error);
  const [editingId, setEditingId] = useState<string>();
  const [renaming, setRenaming] = useState(false);
  const navigate = useNavigate();

  return (
    <PageContent className="gap-4">
      <Button variant="ghost" size="sm" className="-ml-2 self-start wide:hidden" onClick={onBack}>
        <ChevronLeft />
        {shelf.group.name}
      </Button>
      {renaming && category ? (
        <NameForm
          label="品类名称"
          submitLabel="保存"
          defaultValue={category.name}
          autoFocus
          onCancel={() => setRenaming(false)}
          onSubmit={async (name) => {
            const message = await attempt(async () => {
              await api.updateCategory(category.id, { name });
              await onChange();
            }, nameTaken);
            if (!message) setRenaming(false);
            return message;
          }}
        />
      ) : (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-xs text-ink-3 max-wide:hidden">
              {shelf.group.name}
              <ChevronRight className="size-3.5 text-ink-4" />
            </p>
            <h2 className="flex items-baseline gap-2.5 text-xl font-semibold text-ink">
              {shelf.name}
              <small className="text-[13px] font-normal tracking-normal text-ink-3">
                {shelf.productCount} 个商品
              </small>
            </h2>
          </div>
          {category && (
            <div className="flex flex-wrap items-center gap-2 wide:ml-auto">
              <label className="flex items-center gap-2 text-xs text-ink-3">
                所属大类
                <NativeSelect
                  className="w-36"
                  value={shelf.group.id}
                  onChange={(event) => {
                    const target = groups.find((g) => g.id === event.target.value)!;
                    report(
                      attempt(async () => {
                        await api.updateCategory(category.id, { categoryGroupId: target.id });
                        await onChange();
                      }),
                      `已移至「${target.name}」`,
                    );
                  }}
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <Button variant="outline" aria-label={`重命名 ${category.name}`} onClick={() => setRenaming(true)}>
                <Pencil />
                重命名
              </Button>
              <ConfirmButton
                ariaLabel={`删除品类 ${category.name}`}
                size="sm"
                title={`删除品类「${category.name}」？`}
                description="删除后无法恢复。"
                confirmLabel="删除"
                blocked={
                  category.productCount > 0
                    ? {
                        title: `无法删除「${category.name}」`,
                        reason: `品类下还有 ${category.productCount} 个商品，先把它们移到其他品类或删除。`,
                      }
                    : undefined
                }
                onConfirm={() =>
                  attempt(
                    async () => {
                      await api.deleteCategory(category.id);
                      await onDeleted();
                      toast.success(`已删除品类「${category.name}」`);
                    },
                    { not_empty: '品类下还有商品，无法删除' },
                  )
                }
              >
                <Trash2 />
                删除
              </ConfirmButton>
            </div>
          )}
        </div>
      )}
      {creating && (
        <NewProductForm
          placement={shelf.placement}
          className="max-w-160"
          onCancel={() => onCreatingChange(false)}
          onCreated={async (created) => {
            onCreatingChange(false);
            await onChange();
            toast.success(`已新建「${created.name}」`, {
              action: { label: '查看', onClick: () => navigate(productPath(created.id)) },
            });
          }}
        />
      )}
      {loadError && <RetryAlert message={`商品加载失败：${loadError}`} onRetry={() => shelfProducts.refetch()} />}
      {!products ? (
        !loadError && <CatalogSkeleton />
      ) : products.length === 0 ? (
        !creating && (
          <Panel className="flex-1">
            <EmptyState
              title="暂无商品"
              icon={<Package />}
              action={
                <Button onClick={() => onCreatingChange(true)}>
                  <Plus />
                  新建商品
                </Button>
              }
            />
          </Panel>
        )
      ) : (
        <Panel className="overflow-hidden">
          <List variant="ruled" aria-label="商品">
            <ListHeader className={cn('grid max-wide:hidden', rowGrid)}>
              <span>商品</span>
              <span>基准规格</span>
              <span className={priceColumns}>
                <ListCell figure>入手价</ListCell>
                <ListCell figure>历史最低单价</ListCell>
                <ListCell figure>最近单价</ListCell>
              </span>
            </ListHeader>
            {products.map((product) => (
              <li key={product.id} aria-label={product.name}>
                {editingId === product.id ? (
                  <div className="px-4 py-4">
                    <ProductEditor
                      product={product}
                      groups={groups}
                      onCancel={() => setEditingId(undefined)}
                      onSaved={async () => {
                        setEditingId(undefined);
                        await onChange();
                      }}
                    />
                  </div>
                ) : (
                  <ProductRow
                    product={product}
                    onEdit={() => setEditingId(product.id)}
                    onDelete={() =>
                      attempt(
                        async () => {
                          await api.deleteProduct(product.id);
                          await onChange();
                          toast.success(`已删除「${product.name}」`);
                        },
                        { not_empty: '商品已有价格记录，无法删除' },
                      )
                    }
                    onArchive={async () => {
                      const message = await attempt(async () => {
                        await api.updateProduct(product.id, { archived: true });
                        await onChange();
                      });
                      if (message) {
                        toast.error(message);
                        return;
                      }
                      toast.success(`已归档「${product.name}」`, {
                        action: {
                          label: '撤销',
                          onClick: () =>
                            report(
                              attempt(async () => {
                                await api.updateProduct(product.id, { archived: false });
                                await onChange();
                              }),
                              `已恢复「${product.name}」`,
                            ),
                        },
                      });
                    }}
                  />
                )}
              </li>
            ))}
          </List>
        </Panel>
      )}
      <ArchivedProducts shelfKey={shelfKey} />
    </PageContent>
  );
}

function ProductRow({
  product,
  onEdit,
  onDelete,
  onArchive,
}: {
  product: ProductSummary;
  onEdit(): void;
  onDelete: Action;
  onArchive(): Promise<void>;
}) {
  return (
    <ListRow className={cn('group/row grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 py-3', rowGrid)}>
      <div className="flex min-w-0 flex-col">
        <ProductLink product={product} />
        {product.note && <p className="truncate text-xs text-ink-3">{product.note}</p>}
      </div>
      <div className="col-span-2 text-xs text-ink-3 wide:col-span-1 wide:text-[13px] wide:text-ink-2">
        <span className="wide:sr-only">基准规格 </span>
        <span className="numeric text-num-sm text-ink wide:font-medium">{product.baseSize}</span>{' '}
        {product.pricingUnit.name}
      </div>
      <PriceSummary product={product} />
      <div className="col-start-2 row-start-1 flex items-center justify-end gap-0.5 wide:col-start-auto wide:row-start-auto wide:opacity-0 wide:group-focus-within/row:opacity-100 wide:group-hover/row:opacity-100">
        <Button variant="ghost" size="icon-xs" aria-label="编辑" onClick={onEdit}>
          <Pencil />
        </Button>
        <ConfirmButton
          ariaLabel={`删除 ${product.name}`}
          size="icon-xs"
          title={`删除「${product.name}」？`}
          description="删除后无法恢复。"
          confirmLabel="删除"
          blocked={
            product.latestPrice
              ? {
                  title: `无法删除「${product.name}」`,
                  reason: '商品已有价格记录，删除会丢掉这些历史。不再买的商品可以归档：历史保留，录入时不再列出。',
                  alternative: { label: '归档', run: onArchive },
                }
              : undefined
          }
          onConfirm={onDelete}
        >
          <Trash2 />
        </ConfirmButton>
      </div>
    </ListRow>
  );
}

// Unit prices sit side by side for browsing only: products in a category are never priced against each other.
function PriceSummary({ product }: { product: ProductSummary }) {
  const { stockLine, lowestUnitPrice, latestPrice } = product;
  const none = <span className="text-sm text-ink-4">暂无</span>;
  return (
    <dl aria-label="价格概览" className={cn('col-span-2 wide:col-span-1', priceColumns)}>
      <ListCell figure>
        <dt className="text-xs text-ink-3 wide:sr-only">入手价</dt>
        <dd>
          {stockLine === null ? (
            <span className="text-sm text-ink-4">未设置</span>
          ) : (
            <PriceFigure cents={stockLine} tone="target" />
          )}
        </dd>
      </ListCell>
      <ListCell figure>
        <dt className="text-xs text-ink-3 wide:sr-only">历史最低单价</dt>
        <dd>{lowestUnitPrice === null ? none : <PriceFigure cents={lowestUnitPrice} tone="low" />}</dd>
      </ListCell>
      <ListCell figure>
        <dt className="text-xs text-ink-3 wide:sr-only">最近单价</dt>
        <dd>
          {latestPrice === null ? (
            none
          ) : (
            <>
              <span className="inline-flex flex-wrap items-center gap-x-1.5">
                <PriceFigure cents={latestPrice.unitPrice} />{' '}
                {latestPrice.verdict && <VerdictBadge verdict={latestPrice.verdict} />}
              </span>{' '}
              <span className="numeric block text-xs text-ink-3">{latestPrice.date}</span>
            </>
          )}
        </dd>
      </ListCell>
    </dl>
  );
}

function ArchivedProducts({ shelfKey }: { shelfKey: string }) {
  const { data } = useQuery(queries.products(parsePlacementKey(shelfKey), { includeArchived: true }));
  const archived = data?.filter((p) => p.archived) ?? [];

  if (archived.length === 0) return null;
  return (
    <Panel asChild>
      <details className="group/archived">
        <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-4 text-xs font-medium text-ink-2 hover:bg-surface-subtle [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 text-ink-3 transition-transform group-open/archived:rotate-90" />
          已归档的商品（{archived.length}）
        </summary>
        {/* Archived products are restored from their own page. */}
        <List variant="ruled" aria-label="已归档的商品列表" className="border-t border-line">
          {archived.map((product) => (
            <li key={product.id} aria-label={product.name}>
              <ListRow className="min-h-10 opacity-70 group-data-[variant=ruled]/list:min-h-10">
                <ProductLink product={product} />
                <span className="ml-auto text-xs text-ink-3">
                  基准规格 {formatSize(product.baseSize, product.pricingUnit)}
                </span>
              </ListRow>
            </li>
          ))}
        </List>
      </details>
    </Panel>
  );
}

function ProductEditor({
  product,
  groups,
  onCancel,
  onSaved,
}: {
  product: Product;
  groups: CategoryGroup[];
  onCancel(): void;
  onSaved(): Promise<void>;
}) {
  const id = useId();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(
      (await attempt(async () => {
        await api.updateProduct(product.id, {
          name: String(data.get('name')),
          ...parsePlacementKey(String(data.get('placement'))),
          note: String(data.get('note')),
        });
        await onSaved();
      })) ?? undefined,
    );
    setPending(false);
  }

  return (
    <form aria-label={`编辑 ${product.name}`} className="flex max-w-160 flex-col gap-4" onSubmit={handleSubmit}>
      <div className="grid gap-3 wide:grid-cols-2">
        <Field label="商品名称" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} name="name" required maxLength={100} defaultValue={product.name} />
        </Field>
        <Field label="所属品类" htmlFor={`${id}-category`}>
          <PlacementSelect
            id={`${id}-category`}
            name="placement"
            className="w-full"
            defaultValue={placementKey(placementOf(product))}
            groups={groups}
          />
        </Field>
      </div>
      <p className="text-xs text-ink-3">
        计价单位 {product.pricingUnit.name} · 基准规格 {formatSize(product.baseSize, product.pricingUnit)}
      </p>
      <NoteField id={`${id}-note`} defaultValue={product.note} />
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
