import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ChevronLeft, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Alert,
  attempt,
  DeleteButton,
  describeError,
  EditableTitle,
  fieldClass,
  NameForm,
  nameTaken,
  RetryAlert,
  type Action,
} from '@/components/editing';
import { NewProductForm, NoteField } from '@/components/product-form';
import { api, type CategoryGroup, type Product } from '@/lib/api';
import { formatSize } from '@/lib/format';
import { useHistoryState } from '@/lib/history';
import { useProductSearch } from '@/lib/search';
import { cn } from '@/lib/utils';

export function CatalogPage({ onOpenProduct }: { onOpenProduct(id: string): void }) {
  const [groups, setGroups] = useState<CategoryGroup[]>();
  const [loadError, setLoadError] = useState<string>();
  const [selectedId, setSelectedId] = useHistoryState<string | undefined>('categoryId', undefined);
  const [query, setQuery] = useHistoryState('query', '');

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

  const loadAlert = loadError && <RetryAlert message={`大类与品类加载失败：${loadError}`} onRetry={reload} />;
  if (!groups) return loadAlert ? <div className="p-4">{loadAlert}</div> : null;

  const categories = groups.flatMap((g) => g.categories.map((c) => ({ ...c, group: g })));
  const selected = categories.find((c) => c.id === selectedId);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 min-[900px]:grid-cols-[20rem_1fr]">
      <label className="relative min-[900px]:col-span-2">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          type="search"
          aria-label="搜索商品"
          placeholder="搜索商品：名称或拼音首字母，如 dbcz"
          className="pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {loadAlert && <div className="min-[900px]:col-span-2">{loadAlert}</div>}
      {query.trim() ? (
        <section aria-label="搜索结果" className="min-[900px]:col-span-2">
          <SearchResults query={query.trim()} categories={categories} onOpenProduct={onOpenProduct} />
        </section>
      ) : (
        <>
          <section aria-label="大类与品类" className={cn(selected && 'hidden min-[900px]:block')}>
            <CategoryTree groups={groups} selectedId={selected?.id} onSelect={setSelectedId} onChange={reload} />
          </section>
          <section aria-label="品类详情" className={cn(!selected && 'hidden min-[900px]:block')}>
            {selected ? (
              <CategoryPanel
                key={selected.id}
                category={selected}
                groups={groups}
                onOpenProduct={onOpenProduct}
                onBack={() => setSelectedId(undefined)}
                onChange={reload}
                onDeleted={() => {
                  setSelectedId(undefined);
                  return reload();
                }}
              />
            ) : (
              <p className="text-muted-foreground py-12 text-center text-sm">选择一个品类查看其中的商品。</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SearchResults({
  query,
  categories,
  onOpenProduct,
}: {
  query: string;
  categories: { id: string; name: string; group: CategoryGroup }[];
  onOpenProduct(id: string): void;
}) {
  const { found, error } = useProductSearch(query);

  if (error) return <Alert>{`搜索失败：${error}`}</Alert>;
  if (!found) return null;
  // Results for an earlier query stay visible but dimmed and inert until the new ones arrive.
  const stale = found.query !== query;
  if (found.products.length === 0) {
    return (
      <p aria-busy={stale} className={cn('text-muted-foreground py-12 text-center text-sm', stale && 'opacity-50')}>
        没有找到「{found.query}」相关的商品。
      </p>
    );
  }
  return (
    <ul aria-busy={stale} inert={stale} className={cn('flex flex-col gap-2', stale && 'opacity-50')}>
      {found.products.map((product) => {
        const category = categories.find((c) => c.id === product.categoryId);
        return (
          <li key={product.id} aria-label={product.name} className="rounded-lg border p-3">
            <a
              href={`/products/${encodeURIComponent(product.id)}`}
              className="font-medium underline-offset-4 hover:underline"
              onClick={(event) => {
                event.preventDefault();
                onOpenProduct(product.id);
              }}
            >
              {product.name}
            </a>
            <p className="text-muted-foreground text-sm">
              {category && `${category.group.name} / ${category.name} · `}基准规格{' '}
              {formatSize(product.baseSize, product.pricingUnit)}
            </p>
          </li>
        );
      })}
    </ul>
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
  return (
    <div className="flex flex-col gap-6">
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
      {groups.length === 0 && <p className="text-muted-foreground text-sm">还没有大类，比如「宠物」「生活用品」。</p>}
      {groups.map((group) => (
        <GroupItem key={group.id} group={group} selectedId={selectedId} onSelect={onSelect} onChange={onChange} />
      ))}
    </div>
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

  return (
    <div role="group" aria-label={`大类 ${group.name}`} className="flex flex-col gap-2">
      <EditableTitle
        as="h2"
        className="text-sm font-semibold"
        name={group.name}
        label="大类名称"
        onRename={(name) =>
          attempt(async () => {
            await api.updateCategoryGroup(group.id, { name });
            await onChange();
          }, nameTaken)
        }
        actions={
          <>
            <Button variant="ghost" size="icon-xs" aria-label={`在 ${group.name} 下新建品类`} onClick={() => setAdding(true)}>
              <Plus />
            </Button>
            <DeleteButton
              label={`删除大类 ${group.name}`}
              onDelete={() =>
                attempt(
                  async () => {
                    await api.deleteCategoryGroup(group.id);
                    await onChange();
                  },
                  { not_empty: '大类下还有品类，请先删除或移走这些品类。' },
                )
              }
            />
          </>
        }
      />
      {adding && (
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
      )}
      <ul className="flex flex-col">
        {group.categories.map((category) => (
          <li key={category.id}>
            <button
              type="button"
              aria-current={category.id === selectedId ? 'true' : undefined}
              className="hover:bg-accent aria-[current]:bg-accent flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm"
              onClick={() => onSelect(category.id)}
            >
              <span>{category.name}</span>
              <span className="text-muted-foreground text-xs">{category.productCount}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CategoryPanel({
  category,
  groups,
  onOpenProduct,
  onBack,
  onChange,
  onDeleted,
}: {
  category: { id: string; name: string; group: CategoryGroup };
  groups: CategoryGroup[];
  onOpenProduct(id: string): void;
  onBack(): void;
  onChange(): Promise<void>;
  onDeleted(): Promise<void>;
}) {
  const [products, setProducts] = useState<Product[]>();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [moveError, setMoveError] = useState<string>();
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

  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" className="self-start min-[900px]:hidden" onClick={onBack}>
        <ChevronLeft />
        {category.group.name}
      </Button>
      <EditableTitle
        as="h2"
        className="text-xl font-semibold"
        name={category.name}
        label="品类名称"
        onRename={(name) =>
          attempt(async () => {
            await api.updateCategory(category.id, { name });
            await onChange();
          }, nameTaken)
        }
        actions={
          <DeleteButton
            label={`删除品类 ${category.name}`}
            onDelete={() =>
              attempt(
                async () => {
                  await api.deleteCategory(category.id);
                  await onDeleted();
                },
                { not_empty: '品类下还有商品，请先删除或移走这些商品。' },
              )
            }
          />
        }
      />
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground shrink-0">所属大类</span>
        <select
          className={cn(fieldClass, 'h-8 max-w-60')}
          value={category.group.id}
          onChange={async (event) => {
            const categoryGroupId = event.target.value;
            setMoveError(
              (await attempt(async () => {
                await api.updateCategory(category.id, { categoryGroupId });
                await onChange();
              })) ?? undefined,
            );
          }}
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      {moveError && <Alert>{moveError}</Alert>}

      <div className="flex items-center justify-between">
        <h3 className="font-medium">商品</h3>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            新建商品
          </Button>
        )}
      </div>
      {creating && (
        <NewProductForm
          categoryId={category.id}
          onCancel={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await refresh();
          }}
        />
      )}
      {loadError && <RetryAlert message={`商品加载失败：${loadError}`} onRetry={reload} />}
      {products?.length === 0 && !creating && (
        <p className="text-muted-foreground text-sm">这个品类下还没有商品。</p>
      )}
      <ul className="flex flex-col gap-2">
        {products?.map((product) => (
          <li key={product.id} aria-label={product.name} className="rounded-lg border p-3">
            {editingId === product.id ? (
              <ProductEditor
                product={product}
                groups={groups}
                onCancel={() => setEditingId(undefined)}
                onSaved={async () => {
                  setEditingId(undefined);
                  await refresh();
                }}
              />
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a
                    href={`/products/${encodeURIComponent(product.id)}`}
                    className="font-medium underline-offset-4 hover:underline"
                    onClick={(event) => {
                      event.preventDefault();
                      onOpenProduct(product.id);
                    }}
                  >
                    {product.name}
                  </a>
                  <p className="text-muted-foreground text-sm">
                    基准规格 {formatSize(product.baseSize, product.pricingUnit)}
                  </p>
                  {product.note && <p className="text-muted-foreground mt-1 text-sm whitespace-pre-wrap">{product.note}</p>}
                </div>
                <Button variant="outline" size="sm" onClick={() => setEditingId(product.id)}>
                  编辑
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function run(action: Action) {
    setPending(true);
    setError((await action()) ?? undefined);
    setPending(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(() =>
      attempt(async () => {
        await api.updateProduct(product.id, {
          name: String(data.get('name')),
          categoryId: String(data.get('categoryId')),
          note: String(data.get('note')),
        });
        await onSaved();
      }),
    );
  }

  return (
    <form aria-label={`编辑 ${product.name}`} className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-name`}>商品名称</Label>
        <Input id={`${id}-name`} name="name" required maxLength={100} defaultValue={product.name} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-category`}>所属品类</Label>
        <select id={`${id}-category`} name="categoryId" className={cn(fieldClass, 'h-9')} defaultValue={product.categoryId}>
          {groups.map((g) => (
            <optgroup key={g.id} label={g.name}>
              {g.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <p className="text-muted-foreground text-sm">
        计价单位 {product.pricingUnit.name} · 基准规格 {formatSize(product.baseSize, product.pricingUnit)}
      </p>
      <NoteField id={`${id}-note`} defaultValue={product.note} />
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          保存
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button
          type="button"
          variant={confirmingDelete ? 'destructive' : 'ghost'}
          className="ml-auto"
          disabled={pending}
          onBlur={() => setConfirmingDelete(false)}
          onClick={() => {
            if (!confirmingDelete) return setConfirmingDelete(true);
            run(() =>
              attempt(async () => {
                await api.deleteProduct(product.id);
                await onSaved();
              }, { not_empty: '商品还有价格记录，请先删除这些记录。' }),
            );
          }}
        >
          {confirmingDelete ? '确认删除商品' : '删除商品'}
        </Button>
      </div>
    </form>
  );
}
