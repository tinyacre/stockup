import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Folder, Package, Pencil, Plus, Search, Tags, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VerdictBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, InputGroup, InputGroupInput } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { List, ListRow } from '@/components/ui/list';
import { NativeSelect } from '@/components/ui/native-select';
import { PageContent, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, attempt, describeError, NameForm, nameTaken, RetryAlert, type Action } from '@/components/editing';
import { NewProductForm, NoteField } from '@/components/product-form';
import { api, type CategoryGroup, type Product, type ProductSummary } from '@/lib/api';
import { formatSize, formatYuan } from '@/lib/format';
import { useHistoryState } from '@/lib/history';
import { useProductSearch } from '@/lib/search';
import { cn } from '@/lib/utils';

type PlacedCategory = CategoryGroup['categories'][number] & { group: CategoryGroup };

export function CatalogPage({ onOpenProduct }: { onOpenProduct(id: string): void }) {
  const [groups, setGroups] = useState<CategoryGroup[]>();
  const [loadError, setLoadError] = useState<string>();
  const [selectedId, setSelectedId] = useHistoryState<string | undefined>('categoryId', undefined);
  const [query, setQuery] = useHistoryState('query', '');
  const [creating, setCreating] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // A failed refresh keeps the last catalog on screen: the write that triggered it has already succeeded.
  const reload = useCallback(async () => {
    try {
      setGroups(await api.catalog());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

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

  const categories: PlacedCategory[] = (groups ?? []).flatMap((g) => g.categories.map((c) => ({ ...c, group: g })));
  const selected = categories.find((c) => c.id === selectedId);
  const trimmed = query.trim();
  // New products go into the selected category; an empty one offers 新建商品 in its own empty state instead.
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
  const loadAlert = loadError && <RetryAlert message={`大类与品类加载失败：${loadError}`} onRetry={reload} />;

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
            <SearchResults query={trimmed} categories={categories} onOpenProduct={onOpenProduct} />
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
            selectedId={selected?.id}
            onSelect={(id) => {
              setCreating(false);
              setSelectedId(id);
            }}
            onChange={reload}
          />
        </section>
        <section aria-label="品类详情" className={cn('flex min-w-0 flex-col', !showsDetail && 'max-wide:hidden')}>
          {selected ? (
            <CategoryPanel
              key={selected.id}
              category={selected}
              groups={groups}
              creating={creating}
              onCreatingChange={setCreating}
              onOpenProduct={onOpenProduct}
              onBack={() => {
                setCreating(false);
                setSelectedId(undefined);
              }}
              onChange={reload}
              onDeleted={() => {
                setSelectedId(undefined);
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

function SearchResults({
  query,
  categories,
  onOpenProduct,
}: {
  query: string;
  categories: PlacedCategory[];
  onOpenProduct(id: string): void;
}) {
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
          const category = categories.find((c) => c.id === product.categoryId);
          return (
            <li key={product.id} aria-label={product.name}>
              <ListRow className="py-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <ProductLink product={product} onOpenProduct={onOpenProduct} />
                  <span className="text-xs text-ink-3">
                    {category && `${category.group.name} / ${category.name} · `}基准规格{' '}
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

function ProductLink({ product, onOpenProduct }: { product: Product; onOpenProduct(id: string): void }) {
  return (
    <a
      href={`/products/${encodeURIComponent(product.id)}`}
      className="min-w-0 truncate text-[13px] font-medium text-ink underline-offset-4 hover:underline"
      onClick={(event) => {
        event.preventDefault();
        onOpenProduct(product.id);
      }}
    >
      {product.name}
    </a>
  );
}

// Destructive actions take a second click on the same control instead of a browser dialog.
function ConfirmDelete({ label, children, onDelete }: { label: string; children?: ReactNode; onDelete(): Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <Button
        variant="destructive"
        size="xs"
        autoFocus
        aria-label={`确认${label}`}
        onBlur={() => setConfirming(false)}
        onClick={async () => {
          setConfirming(false);
          await onDelete();
        }}
      >
        确认删除
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size={children ? 'sm' : 'icon-xs'}
      aria-label={label}
      onClick={() => setConfirming(true)}
    >
      <Trash2 />
      {children}
    </Button>
  );
}

function CategoryTree({
  groups,
  selectedId,
  onSelect,
  onChange,
}: {
  groups: CategoryGroup[];
  selectedId?: string;
  onSelect(id: string): void;
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
          <GroupItem key={group.id} group={group} selectedId={selectedId} onSelect={onSelect} onChange={onChange} />
        ))}
      </div>
      <div className="border-t border-line px-3 py-3 wide:sticky wide:bottom-0 wide:bg-surface">{newGroup}</div>
    </>
  );
}

function GroupItem({
  group,
  selectedId,
  onSelect,
  onChange,
}: {
  group: CategoryGroup;
  selectedId?: string;
  onSelect(id: string): void;
  onChange(): Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string>();
  const total = group.categories.reduce((sum, c) => sum + c.productCount, 0);

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
                <ConfirmDelete
                  label={`删除大类 ${group.name}`}
                  onDelete={async () =>
                    setError(
                      (await attempt(
                        async () => {
                          await api.deleteCategoryGroup(group.id);
                          await onChange();
                        },
                        { not_empty: '大类下还有品类' },
                      )) ?? undefined,
                    )
                  }
                />
              </span>
              <span className="numeric w-6 text-right text-xs">{total}</span>
            </ListRow>
          )}
        </li>
        {error && (
          <li>
            <Alert className="px-2 pb-1">{error}</Alert>
          </li>
        )}
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
                    onSelect(created.id);
                  }, nameTaken)
                }
              />
            </ListRow>
          </li>
        )}
        {group.categories.map((category) => (
          <li key={category.id}>
            <ListRow inset asChild aria-current={category.id === selectedId ? 'true' : undefined}>
              <button
                type="button"
                className={cn(
                  'h-8 w-full py-0 text-[13px] text-ink-2 aria-[current]:font-medium aria-[current]:text-ink',
                  category.productCount === 0 && 'text-ink-3',
                )}
                onClick={() => onSelect(category.id)}
              >
                <span className="min-w-0 flex-1 truncate">{category.name}</span>
                <span className="numeric text-xs text-ink-3">{category.productCount}</span>
              </button>
            </ListRow>
          </li>
        ))}
      </List>
    </div>
  );
}

const rowGrid =
  'wide:grid-cols-[minmax(0,1fr)_6rem_minmax(0,26rem)_4.5rem] wide:items-center wide:gap-x-4';

function CategoryPanel({
  category,
  groups,
  creating,
  onCreatingChange,
  onOpenProduct,
  onBack,
  onChange,
  onDeleted,
}: {
  category: PlacedCategory;
  groups: CategoryGroup[];
  creating: boolean;
  onCreatingChange(creating: boolean): void;
  onOpenProduct(id: string): void;
  onBack(): void;
  onChange(): Promise<void>;
  onDeleted(): Promise<void>;
}) {
  const [products, setProducts] = useState<ProductSummary[]>();
  const [editingId, setEditingId] = useState<string>();
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string>();
  const [loadError, setLoadError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setProducts(await api.products(category.id));
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, [category.id]);
  useEffect(() => {
    reload();
  }, [reload]);

  // The category tree shows product counts, so it refreshes alongside the product list.
  const refresh = async () => {
    await Promise.all([reload(), onChange()]);
  };
  const run = async (action: Action) => setError((await action()) ?? undefined);

  return (
    <PageContent className="gap-4">
      <Button variant="ghost" size="sm" className="-ml-2 self-start wide:hidden" onClick={onBack}>
        <ChevronLeft />
        {category.group.name}
      </Button>
      {renaming ? (
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
              {category.group.name}
              <ChevronRight className="size-3.5 text-ink-4" />
            </p>
            <h2 className="flex items-baseline gap-2.5 text-xl font-semibold text-ink">
              {category.name}
              <small className="text-[13px] font-normal tracking-normal text-ink-3">
                {category.productCount} 个商品
              </small>
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 wide:ml-auto">
            <label className="flex items-center gap-2 text-xs text-ink-3">
              所属大类
              <NativeSelect
                className="w-36"
                value={category.group.id}
                onChange={(event) => {
                  const categoryGroupId = event.target.value;
                  run(() =>
                    attempt(async () => {
                      await api.updateCategory(category.id, { categoryGroupId });
                      await onChange();
                    }),
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
            <ConfirmDelete
              label={`删除品类 ${category.name}`}
              onDelete={() =>
                run(() =>
                  attempt(
                    async () => {
                      await api.deleteCategory(category.id);
                      await onDeleted();
                    },
                    { not_empty: '品类下还有商品' },
                  ),
                )
              }
            >
              删除
            </ConfirmDelete>
          </div>
        </div>
      )}
      {error && <Alert>{error}</Alert>}

      {creating && (
        <NewProductForm
          categoryId={category.id}
          className="max-w-160"
          onCancel={() => onCreatingChange(false)}
          onCreated={async () => {
            onCreatingChange(false);
            await refresh();
          }}
        />
      )}
      {loadError && <RetryAlert message={`商品加载失败：${loadError}`} onRetry={reload} />}
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
            {/* The column heads share the rows' list, so they take the same theme padding. */}
            <li aria-hidden className="max-wide:hidden">
              <ListRow className={cn('grid min-h-9! bg-surface-subtle py-0! text-[11px] font-medium tracking-[.02em] text-ink-3 hover:bg-surface-subtle!', rowGrid)}>
                <span>商品</span>
                <span>基准规格</span>
                <span className="grid grid-cols-3 gap-3">
                  <span>入手价</span>
                  <span>历史最低单价</span>
                  <span>最近单价</span>
                </span>
              </ListRow>
            </li>
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
                        await refresh();
                      }}
                    />
                  </div>
                ) : (
                  <ProductRow
                    product={product}
                    onOpenProduct={onOpenProduct}
                    onEdit={() => setEditingId(product.id)}
                    onDelete={() =>
                      attempt(
                        async () => {
                          await api.deleteProduct(product.id);
                          await refresh();
                        },
                        { not_empty: '商品还有价格记录' },
                      )
                    }
                  />
                )}
              </li>
            ))}
          </List>
        </Panel>
      )}
      <ArchivedProducts categoryId={category.id} onOpenProduct={onOpenProduct} />
    </PageContent>
  );
}

function ProductRow({
  product,
  onOpenProduct,
  onEdit,
  onDelete,
}: {
  product: ProductSummary;
  onOpenProduct(id: string): void;
  onEdit(): void;
  onDelete: Action;
}) {
  const [error, setError] = useState<string>();
  return (
    <ListRow className={cn('group/row grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 py-3', rowGrid)}>
      <div className="flex min-w-0 flex-col">
        <ProductLink product={product} onOpenProduct={onOpenProduct} />
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
        <ConfirmDelete label={`删除 ${product.name}`} onDelete={async () => setError((await onDelete()) ?? undefined)} />
      </div>
      {error && <Alert className="col-span-full">{error}</Alert>}
    </ListRow>
  );
}

// Unit prices sit side by side for browsing only: products in a category are never priced against each other.
function PriceSummary({ product }: { product: ProductSummary }) {
  const { stockLine, lowestUnitPrice, latestPrice } = product;
  const none = <span className="text-sm text-ink-4">暂无</span>;
  return (
    <dl aria-label="价格概览" className="col-span-2 grid grid-cols-3 gap-3 wide:col-span-1">
      <div className="min-w-0">
        <dt className="text-xs text-ink-3 wide:sr-only">入手价</dt>
        <dd>
          {stockLine === null ? <span className="text-sm text-ink-4">未设置</span> : <Figure cents={stockLine} />}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-ink-3 wide:sr-only">历史最低单价</dt>
        <dd className="text-ink-2">{lowestUnitPrice === null ? none : <Figure cents={lowestUnitPrice} />}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-ink-3 wide:sr-only">最近单价</dt>
        <dd>
          {latestPrice === null ? (
            none
          ) : (
            <>
              <span className="flex flex-wrap items-center gap-x-1.5">
                <Figure cents={latestPrice.unitPrice} />{' '}
                {latestPrice.verdict && <VerdictBadge verdict={latestPrice.verdict} />}
              </span>{' '}
              <span className="numeric block text-xs text-ink-3">{latestPrice.date}</span>
            </>
          )}
        </dd>
      </div>
    </dl>
  );
}

function Figure({ cents }: { cents: number }) {
  return <span className="numeric text-num-md font-medium">{formatYuan(cents)}</span>;
}

function ArchivedProducts({ categoryId, onOpenProduct }: { categoryId: string; onOpenProduct(id: string): void }) {
  const [archived, setArchived] = useState<Product[]>([]);
  useEffect(() => {
    api.products(categoryId, { includeArchived: true }).then(
      (products) => setArchived(products.filter((p) => p.archived)),
      () => setArchived([]),
    );
  }, [categoryId]);

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
                <ProductLink product={product} onOpenProduct={onOpenProduct} />
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
          categoryId: String(data.get('categoryId')),
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
          <NativeSelect id={`${id}-category`} name="categoryId" className="w-full" defaultValue={product.categoryId}>
            {groups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
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
