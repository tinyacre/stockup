import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { List, ListRow } from '@/components/ui/list';
import { PageContent, PageHeader } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Alert, attempt, describeError, ListSkeleton, listPageClass, RetryAlert } from '@/components/editing';
import { api, type Household } from '@/lib/api';

const fields = [
  { name: 'householdName', label: '家庭名称', maxLength: 50 },
  { name: 'name', label: '管理员显示名称', maxLength: 50 },
  { name: 'username', label: '管理员用户名', autoComplete: 'off', hint: '3–30 位字母、数字、下划线或点' },
  { name: 'password', label: '管理员初始密码', type: 'password', autoComplete: 'new-password', hint: '至少 8 位' },
];

export function HouseholdsPage() {
  const [households, setHouseholds] = useState<Household[]>();
  const [loadError, setLoadError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setHouseholds(await api.households());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <PageContent className={listPageClass}>
      <PageHeader title="家庭" />
      {loadError && <RetryAlert message={`加载失败：${loadError}`} onRetry={reload} />}
      <NewHouseholdForm onCreated={reload} />
      <Panel>
        <PanelHeader title="全部家庭" count={households?.length} />
        {!households && <ListSkeleton />}
        {households?.length === 0 && <EmptyState title="暂无家庭" />}
        {households && households.length > 0 && (
          <List variant="ruled" aria-label="所有家庭">
            {households.map((household) => (
              <ListRow key={household.id} asChild className="justify-between py-2 text-sm">
                <li>
                  <span className="font-medium">{household.name}</span>
                  <span className="text-ink-3">{household.memberCount} 位成员</span>
                </li>
              </ListRow>
            ))}
          </List>
        )}
      </Panel>
    </PageContent>
  );
}

function NewHouseholdForm({ onCreated }: { onCreated(): Promise<void> }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name));
    setPending(true);
    const message = await attempt(
      async () => {
        await api.createHousehold({
          householdName: value('householdName').trim(),
          admin: { name: value('name').trim(), username: value('username'), password: value('password') },
        });
        form.reset();
        await onCreated();
      },
      { username_taken: '用户名已被使用' },
    );
    setError(message ?? undefined);
    setPending(false);
  }

  return (
    <Panel asChild>
      <form aria-label="新建家庭" onSubmit={handleSubmit}>
        <PanelHeader title="新建家庭" />
        <PanelBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map(({ name, label, hint, ...input }) => (
              <Field key={name} label={label} htmlFor={name} hint={hint}>
                <Input id={name} name={name} required {...input} />
              </Field>
            ))}
          </div>
          {error && <Alert>{error}</Alert>}
          <div>
            <Button type="submit" variant="outline" disabled={pending}>
              新建家庭
            </Button>
          </div>
        </PanelBody>
      </form>
    </Panel>
  );
}
