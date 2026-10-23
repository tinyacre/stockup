import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Folder, Pencil, Plus } from 'lucide-react';
import { GroupIconPicker } from '@/components/group-icon';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { List, ListCell, ListRow } from '@/components/ui/list';
import { NativeSelect } from '@/components/ui/native-select';
import { PageContent, PageHeader } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import {
  Alert,
  attempt,
  DeleteButton,
  EditableTitle,
  ListSkeleton,
  NameForm,
  nameTaken,
  report,
  RetryAlert,
} from '@/components/editing';
import { api, type CategoryGroup } from '@/lib/api';
import { outsideCategories } from '@/lib/catalog';
import { loadErrorOf, queries, useRefresh } from '@/lib/queries';

export function CategoriesPage() {
  const catalog = useQuery(queries.catalog());
  const groups = catalog.data;
  const loadError = loadErrorOf(catalog.error);
  const reload = useRefresh();
  const [creating, setCreating] = useState(false);

  return (
    <PageContent width="narrow">
      <PageHeader
        title="分类"
        actions={
          !creating && (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              新建大类
            </Button>
          )
        }
      />
      {loadError && <RetryAlert message={`加载失败：${loadError}`} onRetry={() => catalog.refetch()} />}
      {creating && (
        <Panel>
          <PanelHeader title="新建大类" />
          <PanelBody>
            <NameForm
              label="新大类名称"
              submitLabel="新建大类"
              autoFocus
              onCancel={() => setCreating(false)}
              onSubmit={async (name) => {
                const message = await attempt(async () => {
                  await api.createCategoryGroup({ name });
                  await reload();
                }, nameTaken);
                if (!message) {
                  setCreating(false);
                  toast.success(`已新建大类「${name}」`);
                }
                return message;
              }}
            />
          </PanelBody>
        </Panel>
      )}
      {!groups && !loadError && (
        <Panel>
          <ListSkeleton />
        </Panel>
      )}
      {groups?.length === 0 && !creating && (
        <Panel>
          <EmptyState title="暂无大类" icon={<Folder />} />
        </Panel>
      )}
      {groups?.map((group) => (
        <GroupPanel key={group.id} group={group} groups={groups} onChange={reload} />
      ))}
    </PageContent>
  );
}

function GroupPanel({
  group,
  groups,
  onChange,
}: {
  group: CategoryGroup;
  groups: CategoryGroup[];
  onChange(): Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const total = group.productCount + group.categories.reduce((sum, c) => sum + c.productCount, 0);

  return (
    <Panel asChild>
      <section role="group" aria-label={`大类 ${group.name}`}>
        {renaming ? (
          <PanelBody>
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
          </PanelBody>
        ) : (
          <PanelHeader
            title={group.name}
            count={`${total} 个商品`}
            leading={
              <GroupIconPicker
                name={group.name}
                icon={group.icon}
                onChange={(icon) =>
                  report(
                    attempt(async () => {
                      await api.updateCategoryGroup(group.id, { icon });
                      await onChange();
                    }),
                    icon ? `已更新「${group.name}」的图标` : `已移除「${group.name}」的图标`,
                  )
                }
              />
            }
            actions={
              <>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`在 ${group.name} 下新建品类`}
                  onClick={() => setAdding(true)}
                >
                  <Plus />
                  品类
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`重命名 ${group.name}`}
                  onClick={() => setRenaming(true)}
                >
                  <Pencil />
                </Button>
                <DeleteButton
                  label={`删除大类 ${group.name}`}
                  name={group.name}
                  onDelete={() =>
                    report(
                      attempt(
                        async () => {
                          await api.deleteCategoryGroup(group.id);
                          await onChange();
                        },
                        { not_empty: '大类下还有品类或商品，无法删除' },
                      ),
                      `已删除大类「${group.name}」`,
                    )
                  }
                />
              </>
            }
          />
        )}
        {adding && (
          <PanelBody className="border-b border-line">
            <NameForm
              label="新品类名称"
              submitLabel="新建品类"
              autoFocus
              onCancel={() => setAdding(false)}
              onSubmit={async (name) => {
                const message = await attempt(async () => {
                  await api.createCategory({ categoryGroupId: group.id, name });
                  await onChange();
                }, nameTaken);
                if (!message) toast.success(`已新建品类「${name}」`);
                return message;
              }}
            />
          </PanelBody>
        )}
        {group.categories.length === 0 && group.productCount === 0 && !adding && (
          <p className="px-4 py-3 text-sm text-ink-3">暂无品类</p>
        )}
        {(group.categories.length > 0 || group.productCount > 0) && (
          <List variant="ruled" aria-label={`${group.name} 的品类`}>
            {group.categories.map((category) => (
              <ListRow key={category.id} asChild>
                <li aria-label={category.name}>
                  <CategoryItem category={category} group={group} groups={groups} onChange={onChange} />
                </li>
              </ListRow>
            ))}
            {group.productCount > 0 && (
              <ListRow asChild className="text-sm text-ink-3">
                <li aria-label={outsideCategories}>
                  <ListCell lead>{outsideCategories}</ListCell>
                  <span className="numeric text-xs">{group.productCount} 个商品</span>
                </li>
              </ListRow>
            )}
          </List>
        )}
      </section>
    </Panel>
  );
}

function CategoryItem({
  category,
  group,
  groups,
  onChange,
}: {
  category: CategoryGroup['categories'][number];
  group: CategoryGroup;
  groups: CategoryGroup[];
  onChange(): Promise<void>;
}) {
  const [error, setError] = useState<string>();

  return (
    <EditableTitle
      as="h3"
      name={category.name}
      label="品类名称"
      onRename={(name) =>
        attempt(async () => {
          await api.updateCategory(category.id, { name });
          await onChange();
        }, nameTaken)
      }
      actions={
        <>
          <span className="numeric text-xs text-ink-3">{category.productCount} 个商品</span>
          <ListCell trail>
            <NativeSelect
              aria-label={`${category.name} 所属大类`}
              className="w-32"
              value={group.id}
              onChange={async (event) => {
                const target = groups.find((g) => g.id === event.target.value)!;
                const message = await attempt(async () => {
                  await api.updateCategory(category.id, {
                    categoryGroupId: target.id,
                  });
                  await onChange();
                });
                setError(message ?? undefined);
                if (!message) toast.success(`已将「${category.name}」移至「${target.name}」`);
              }}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </NativeSelect>
            <DeleteButton
              label={`删除品类 ${category.name}`}
              name={category.name}
              onDelete={() =>
                attempt(
                  async () => {
                    await api.deleteCategory(category.id);
                    await onChange();
                    toast.success(`已删除品类「${category.name}」`);
                  },
                  { not_empty: '品类下还有商品，无法删除' },
                )
              }
            />
          </ListCell>
          {error && <Alert className="basis-full">{error}</Alert>}
        </>
      }
    />
  );
}
