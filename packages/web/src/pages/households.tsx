import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, attempt, describeError, RetryAlert } from '@/components/editing';
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
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <div>
        <h2 className="text-xl font-semibold">家庭</h2>
        <p className="text-muted-foreground text-sm">
          这个 StockUp 上的所有家庭，数据彼此隔离。新家庭会带上预设的大促，由你指定的管理员邀请家人加入。
        </p>
      </div>
      {loadError && <RetryAlert message={`家庭加载失败：${loadError}`} onRetry={reload} />}
      <NewHouseholdForm onCreated={reload} />
      {households && (
        <ul aria-label="所有家庭" className="flex flex-col gap-2">
          {households.map((household) => (
            <li key={household.id} className="flex justify-between rounded-lg border px-3 py-2">
              <span>{household.name}</span>
              <span className="text-muted-foreground text-sm">{household.memberCount} 位成员</span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
      { username_taken: '这个用户名已经被使用，请换一个。' },
    );
    setError(message ?? undefined);
    setPending(false);
  }

  return (
    <form aria-label="新建家庭" className="flex flex-col gap-3 rounded-lg border p-3" onSubmit={handleSubmit}>
      {fields.map(({ name, label, hint, ...input }) => (
        <div key={name} className="flex flex-col gap-2">
          <Label htmlFor={name}>{label}</Label>
          <Input id={name} name={name} required {...input} />
          {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
        </div>
      ))}
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          新建家庭
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
    </form>
  );
}
