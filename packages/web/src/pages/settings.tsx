import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { List, ListCell, ListRow } from '@/components/ui/list';
import { NativeSelect } from '@/components/ui/native-select';
import { PageContent, PageHeader } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Alert, attempt, DeleteButton, describeError, ListSkeleton, RetryAlert } from '@/components/editing';
import { codeErrors, EmailCodeField } from '@/components/email-code-field';
import { useTurnstile } from '@/components/turnstile';
import {
  api,
  credentialProblem,
  type AuthorizedClient,
  type Me,
  type RecognitionCredential,
  type RecognitionProvider,
  type RecognizerProblem,
} from '@/lib/api';
import { useCapabilities } from '@/lib/capabilities';
import { clientHost, scopeDescriptions } from '@/lib/oauth';
import { queries, useRefresh } from '@/lib/queries';
import { applyTheme, themeLabels, themes, type Theme } from '@/lib/theme';

// The header shows the display name, the shell applies the theme and the email panel shows the address,
// so `onSessionChange` reloads the session.
export function SettingsPage({ me, onSessionChange }: { me: Me; onSessionChange(): void }) {
  const capabilities = useCapabilities();
  const recognizer = useQuery(queries.recognizer()).data;
  return (
    <PageContent className="grid items-stretch min-[1200px]:grid-cols-2">
      <PageHeader title="个人设置" />
      <ThemeSetting theme={me.user.theme} onChanged={onSessionChange} />
      <SettingsForm
        title="显示名称"
        submitLabel="保存名称"
        onSubmit={async (data) => {
          const message = await attempt(() => api.rename({ name: String(data.get('name')).trim() }));
          if (!message) onSessionChange();
          return message ? { error: message } : { done: '名称已保存' };
        }}
      >
        <TextField name="name" label="显示名称" defaultValue={me.user.name} maxLength={50} />
      </SettingsForm>
      <SettingsForm
        title="密码"
        description={`用户名 ${me.user.username}`}
        submitLabel="修改密码"
        onSubmit={async (data) => {
          const message = await attempt(
            () =>
              api.changePassword({
                currentPassword: String(data.get('currentPassword')),
                newPassword: String(data.get('newPassword')),
              }),
            { wrong_password: '当前密码错误' },
          );
          return message ? { error: message } : { done: '密码已修改', reset: true };
        }}
      >
        <TextField name="currentPassword" label="当前密码" type="password" autoComplete="current-password" />
        <TextField
          name="newPassword"
          label="新密码"
          type="password"
          autoComplete="new-password"
          minLength={8}
          hint="至少 8 位"
        />
      </SettingsForm>
      {capabilities?.email && <EmailSetting email={me.user.email} onChanged={onSessionChange} />}
      <SettingsForm
        title="登出所有设备"
        submitLabel="登出其他设备"
        onSubmit={async () => {
          const message = await attempt(() => api.signOutOthers());
          return message ? { error: message } : { done: '其他设备已登出' };
        }}
      />
      {recognizer?.householdAdmin && recognizer.householdCredentials && (
        <RecognitionKeySetting credential={recognizer.credential} />
      )}
      <AuthorizedClients />
    </PageContent>
  );
}

// Only sending the code is challenged: the change itself needs the session and that code.
function EmailSetting({ email, onChanged }: { email: string | null; onChanged(): void }) {
  const turnstile = useTurnstile();
  return (
    <SettingsForm
      title="邮箱"
      description={email ?? '未设置邮箱'}
      submitLabel="更换邮箱"
      onSubmit={async (data) => {
        const message = await attempt(
          () => api.changeEmail({ email: String(data.get('email')), code: String(data.get('code')) }),
          { ...codeErrors, email_taken: '邮箱已被其他账号使用' },
        );
        if (!message) onChanged();
        return message ? { error: message } : { done: '邮箱已更新', reset: true };
      }}
    >
      <EmailCodeField purpose="change-email" emailLabel="新邮箱" turnstile={turnstile} />
      {turnstile.widget}
    </SettingsForm>
  );
}

const providerLabels: Record<RecognitionProvider, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };

const credentialProblems: Record<RecognizerProblem, string> = {
  authentication_failed: '服务商不接受这个 API key',
  model_not_found: '服务商没有这个模型',
  unreachable: '连接不上服务商，请检查 Base URL',
  endpoint_not_public: 'Base URL 必须是公网上的 https 地址',
  provider_error: '服务商报错，请确认模型支持图片输入、账户余额充足',
};

function describeCredentialError(error: unknown) {
  const problem = credentialProblem(error);
  return problem ? credentialProblems[problem] : describeError(error);
}

// The household admin's own provider and key, which the household recognizes with instead of the monthly quota.
function RecognitionKeySetting({ credential }: { credential: RecognitionCredential | null }) {
  const refresh = useRefresh();
  const [provider, setProvider] = useState<RecognitionProvider>(credential?.provider ?? 'anthropic');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(undefined);
    try {
      await api.saveRecognitionCredential({
        provider,
        apiKey: String(data.get('apiKey')).trim(),
        baseURL: String(data.get('baseURL')).trim(),
        model: String(data.get('model')).trim(),
      });
      form.reset();
      toast.success('API key 已保存');
      await refresh();
    } catch (failure) {
      setError(describeCredentialError(failure));
    }
    setPending(false);
  }

  return (
    <Panel asChild>
      <section aria-label="家庭识别 API key">
        <PanelHeader title="家庭识别 API key">
          <span className="text-xs text-ink-3">全家共用，不占每月识别次数</span>
        </PanelHeader>
        <PanelBody className="flex flex-col gap-4">
          {credential && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <dl aria-label="当前 API key" className="flex flex-1 flex-col gap-0.5 text-sm">
                <dt className="sr-only">服务商与模型</dt>
                <dd className="font-medium">
                  {providerLabels[credential.provider]} · {credential.model ?? '默认模型'}
                </dd>
                <dt className="sr-only">API key</dt>
                <dd className="font-mono text-ink-2">••••{credential.apiKeyLastFour}</dd>
                {credential.baseURL && (
                  <>
                    <dt className="sr-only">Base URL</dt>
                    <dd className="break-all text-xs text-ink-3">{credential.baseURL}</dd>
                  </>
                )}
              </dl>
              <DeleteButton
                label="删除 API key"
                title="删除家庭的 API key？"
                description="删除后家庭改用实例的每月识别次数。"
                onDelete={async () => {
                  const message = await attempt(() => api.deleteRecognitionCredential());
                  if (message) return message;
                  toast.success('API key 已删除');
                  await refresh();
                }}
              />
            </div>
          )}
          <form className="flex max-w-sm flex-col gap-4" onSubmit={handleSubmit}>
            <Field label="服务商" htmlFor="provider">
              <NativeSelect
                id="provider"
                value={provider}
                onChange={(event) => setProvider(event.currentTarget.value as RecognitionProvider)}
              >
                {Object.entries(providerLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="API key" htmlFor="apiKey">
              <Input
                id="apiKey"
                name="apiKey"
                type="password"
                autoComplete="off"
                required
                minLength={8}
                maxLength={500}
              />
            </Field>
            <Field
              label="Base URL"
              htmlFor="baseURL"
              hint={
                provider === 'openai'
                  ? '可填 OpenAI 兼容服务，如 https://openrouter.ai/api/v1；留空使用官方地址'
                  : '留空使用官方地址'
              }
            >
              <Input id="baseURL" name="baseURL" type="url" maxLength={500} />
            </Field>
            <Field label="模型" htmlFor="model" hint="留空使用默认模型；需支持图片输入">
              <Input id="model" name="model" maxLength={200} />
            </Field>
            <div>
              <Button type="submit" variant="outline" disabled={pending}>
                {pending ? '校验中…' : credential ? '替换 API key' : '保存 API key'}
              </Button>
            </div>
            {error && <Alert>{error}</Alert>}
          </form>
        </PanelBody>
      </section>
    </Panel>
  );
}

function ThemeSetting({ theme, onChanged }: { theme: Theme; onChanged(): void }) {
  const [shown, setShown] = useState(theme);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  // Applying a theme writes the copy a reload paints from, so it waits until the account holds the choice.
  async function choose(next: Theme) {
    if (saving || next === shown) return;
    setSaving(true);
    setError(undefined);
    const message = await attempt(() => api.setTheme(next));
    setSaving(false);
    if (message) {
      setError(message);
    } else {
      setShown(next);
      applyTheme(next);
      onChanged();
    }
  }

  return (
    <Panel asChild>
      <section aria-label="主题">
        <PanelHeader title="主题" />
        <PanelBody className="flex flex-col gap-3">
          <SegmentedControl
            aria-label="主题"
            className="self-start"
            options={themes.map((value) => ({ value, label: themeLabels[value] }))}
            value={shown}
            onValueChange={choose}
            aria-busy={saving}
          />
          {error && <Alert>{error}</Alert>}
        </PanelBody>
      </section>
    </Panel>
  );
}

function AuthorizedClients() {
  const [clients, setClients] = useState<AuthorizedClient[]>();
  const [loadError, setLoadError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setClients(await api.authorizedClients());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <Panel asChild className="col-span-full">
      <section aria-label="已授权的应用">
        <PanelHeader title="已授权的应用" />
        {loadError && (
          <PanelBody>
            <RetryAlert message={`加载失败：${loadError}`} onRetry={reload} />
          </PanelBody>
        )}
        {!clients && !loadError && <ListSkeleton />}
        {clients?.length === 0 && <p className="px-(--panel-padding) py-4 text-sm text-ink-3">暂无授权的应用</p>}
        {clients && clients.length > 0 && (
          <List variant="ruled">
            {clients.map((client) => (
              <ListRow key={client.clientId} asChild className="py-2.5">
                <li>
                  <AuthorizedClientItem client={client} onRevoked={reload} />
                </li>
              </ListRow>
            ))}
          </List>
        )}
      </section>
    </Panel>
  );
}

function AuthorizedClientItem({ client, onRevoked }: { client: AuthorizedClient; onRevoked(): Promise<void> }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const host = clientHost(client.clientId);
  const scopes = client.scopes.filter((scope) => scope.startsWith('stockup:'));

  return (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1">
      <ListCell className="flex flex-1 flex-col">
        <span className="text-sm font-medium">{client.name ? `${client.name}（${host}）` : host}</span>
        <span className="text-xs text-ink-3">{new Date(client.authorizedAt).toLocaleDateString('zh-CN')} 授权</span>
        {scopes.length > 0 && (
          <span className="text-xs text-ink-3">
            {scopes.map((scope) => scopeDescriptions[scope] ?? scope).join('、')}
          </span>
        )}
      </ListCell>
      <ListCell trail>
        <Button
          variant="outline"
          size="xs"
          disabled={pending}
          aria-label={`撤销 ${client.name ?? host}`}
          onClick={async () => {
            setPending(true);
            const message = await attempt(() => api.revokeClient(client.clientId), {
              not_found: '授权已撤销',
            });
            setError(message ?? undefined);
            if (!message) await onRevoked();
            setPending(false);
          }}
        >
          撤销
        </Button>
      </ListCell>
      {error && <Alert className="basis-full">{error}</Alert>}
    </div>
  );
}

type Outcome = { error: string } | { done: string; reset?: boolean };

function SettingsForm({
  title,
  description,
  submitLabel,
  onSubmit,
  children,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  onSubmit(data: FormData): Promise<Outcome>;
  children?: ReactNode;
}) {
  const [outcome, setOutcome] = useState<Outcome>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setOutcome(undefined);
    const result = await onSubmit(new FormData(form));
    if ('reset' in result && result.reset) form.reset();
    if ('done' in result) toast.success(result.done);
    setOutcome(result);
    setPending(false);
  }

  return (
    <Panel asChild>
      <section aria-label={title}>
        <PanelHeader title={title}>
          {description && <span className="text-xs text-ink-3">{description}</span>}
        </PanelHeader>
        <PanelBody>
          <form className="flex max-w-sm flex-col gap-4" onSubmit={handleSubmit}>
            {children}
            <div>
              <Button type="submit" variant="outline" disabled={pending}>
                {submitLabel}
              </Button>
            </div>
            {outcome && 'error' in outcome && <Alert>{outcome.error}</Alert>}
          </form>
        </PanelBody>
      </section>
    </Panel>
  );
}

function TextField({
  name,
  label,
  hint,
  ...input
}: {
  name: string;
  label: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  maxLength?: number;
  minLength?: number;
}) {
  return (
    <Field label={label} htmlFor={name} hint={hint}>
      <Input id={name} name={name} required {...input} />
    </Field>
  );
}
