import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { parseQuantity, type Discount, type Unit } from '@stockup/domain';
import { ImageUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { List } from '@/components/ui/list';
import { NativeSelect } from '@/components/ui/native-select';
import { PageContent, PageHeader } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, attempt, DeleteButton, describeError, RetryAlert } from '@/components/editing';
import { NewProductForm } from '@/components/product-form';
import {
  api,
  ApiError,
  type CategoryGroup,
  type Channel,
  type DraftChanges,
  type PriceRecord,
  type Recognition,
  type RecognitionDraft,
} from '@/lib/api';
import { formatSize, formatYuan } from '@/lib/format';
import { parseYuan, today, unitsLike } from '@/lib/pricing';
import { useProductSearch } from '@/lib/search';

const uploadErrors = {
  unsupported_evidence_type: '截图仅支持 PNG、JPEG、WebP、GIF',
  evidence_too_large: '截图超过 10 MB',
};

const failures: Record<NonNullable<Recognition['error']>, string> = {
  recognition_unavailable: '识别服务未配置',
  recognition_failed: '识别失败',
  recognition_interrupted: '识别已中断',
};

const pollInterval = 1500;

export function RecognitionUploadPage({ onStarted }: { onStarted(id: string): void }) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  // Uploads stay open while the answer is outstanding: the server fails them cleanly if it has no recognizer.
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    api.recognizer().then(
      (r) => setAvailable(r.available),
      () => {},
    );
  }, []);
  const disabled = uploading || !available;

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    let started: Recognition | undefined;
    const message = await attempt(async () => {
      started = await api.startRecognition(file);
    }, uploadErrors);
    setUploading(false);
    setError(message ?? undefined);
    if (started) onStarted(started.id);
  }

  return (
    <PageContent width="narrow">
      <PageHeader title="识别" />
      <Panel
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!disabled) void upload(event.dataTransfer.files[0]);
        }}
      >
        <EmptyState
          icon={<ImageUp />}
          title="截图识别"
          className="py-16"
          action={
            <>
              <Button disabled={disabled} asChild>
                <label htmlFor={inputId}>{uploading ? '上传中…' : '上传截图'}</label>
              </Button>
              <input
                id={inputId}
                type="file"
                aria-label="上传截图"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                disabled={disabled}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  void upload(file);
                }}
              />
            </>
          }
        />
      </Panel>
      {!available && <Alert>识别服务未配置</Alert>}
      {error && <Alert>{error}</Alert>}
    </PageContent>
  );
}

export function RecognitionPage({
  recognitionId,
  onManualEntry,
  onOpenProduct,
  onUploadAnother,
}: {
  recognitionId: string;
  onManualEntry(): void;
  onOpenProduct(id: string): void;
  onUploadAnother(): void;
}) {
  const [recognition, setRecognition] = useState<Recognition>();
  const [loadError, setLoadError] = useState<string>();
  // Only the confirmation itself answers with the records; a later visit shows that it was confirmed.
  const [confirmed, setConfirmed] = useState<{ records: PriceRecord[]; names: Map<string, string> }>();

  const load = useCallback(async () => {
    try {
      setRecognition(await api.recognition(recognitionId));
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeError(error, { not_found: '识别不存在' }));
    }
  }, [recognitionId]);
  useEffect(() => {
    load();
  }, [load]);

  // A failed poll is retried on the same schedule, so a moment offline does not strand the page.
  const pending = recognition?.status === 'pending';
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(load, pollInterval);
    return () => clearTimeout(timer);
  }, [pending, loadError, recognition, load]);

  const reviewing = recognition?.status === 'succeeded' && !confirmed && !recognition.confirmedAt;

  return (
    <PageContent className="wide:grid wide:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] wide:items-start">
      <PageHeader
        title="识别"
        actions={
          <Button variant="outline" size="sm" onClick={onUploadAnother}>
            识别另一张
          </Button>
        }
      />
      {loadError && <RetryAlert message={loadError} onRetry={load} />}
      {!recognition && !loadError && <Skeleton className="h-64 w-full" />}
      {recognition && (
        <>
          <Panel className="wide:sticky wide:top-[calc(var(--page-bar-height)+1.5rem)]">
            <PanelBody className="flex justify-center">
              <a href={api.recognitionScreenshotUrl(recognition.id)} target="_blank" rel="noreferrer">
                <img
                  src={api.recognitionScreenshotUrl(recognition.id)}
                  alt="上传的截图"
                  className="max-h-[60vh] max-w-full rounded-md border border-line object-contain wide:max-h-[calc(100vh-12rem)]"
                />
              </a>
            </PanelBody>
          </Panel>
          <div className="flex min-w-0 flex-col gap-4">
            {recognition.status === 'pending' && (
              <p role="status" className="text-ink-3 text-sm">
                识别中…
              </p>
            )}
            {recognition.status === 'failed' && (
              <ManualEntry message={failures[recognition.error!]} onManualEntry={onManualEntry} />
            )}
            {confirmed ? (
              <Confirmed {...confirmed} onOpenProduct={onOpenProduct} />
            ) : recognition.confirmedAt ? (
              <p role="status" className="text-sm">
                已确认入库
              </p>
            ) : recognition.status === 'succeeded' &&
              (recognition.drafts.length === 0 ? (
                <ManualEntry message="未识别出商品" onManualEntry={onManualEntry} />
              ) : (
                reviewing && (
                  <Review
                    recognition={recognition}
                    onChange={setRecognition}
                    onOpenProduct={onOpenProduct}
                    onConfirmed={(records) => {
                      const names = new Map<string, string>(
                        recognition.drafts.flatMap((d) =>
                          d.suggestedProduct ? [[d.suggestedProduct.id, d.suggestedProduct.name] as const] : [],
                        ),
                      );
                      setConfirmed({ records, names });
                      load();
                    }}
                  />
                )
              ))}
          </div>
        </>
      )}
    </PageContent>
  );
}

function ManualEntry({ message, onManualEntry }: { message: string; onManualEntry(): void }) {
  return (
    <Panel>
      <EmptyState
        title={message}
        action={
          <Button variant="outline" size="sm" onClick={onManualEntry}>
            手动录入
          </Button>
        }
      />
    </Panel>
  );
}

function yuanText(cents: number | null) {
  return cents === null ? '' : (cents / 100).toFixed(2);
}

function sum(discounts: readonly Discount[]) {
  return discounts.reduce((total, d) => total + d.amount, 0);
}

function ProductLink({ id, name, onOpenProduct }: { id: string; name: string; onOpenProduct(id: string): void }) {
  return (
    <a
      href={`/products/${encodeURIComponent(id)}`}
      className="underline underline-offset-2"
      onClick={(event) => {
        event.preventDefault();
        onOpenProduct(id);
      }}
    >
      {name}
    </a>
  );
}

function Review({
  recognition,
  onChange,
  onOpenProduct,
  onConfirmed,
}: {
  recognition: Recognition;
  onChange(recognition: Recognition): void;
  onOpenProduct(id: string): void;
  onConfirmed(records: PriceRecord[]): void;
}) {
  const [household, setHousehold] = useState<{ groups: CategoryGroup[]; channels: Channel[] }>();
  const [loadError, setLoadError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [groups, channels] = await Promise.all([api.catalog(), api.channels()]);
      setHousehold({ groups, channels: channels.filter((c) => !c.archived) });
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const orderTotal = sum(recognition.orderDiscounts);
  const shares = recognition.drafts.map((d) => d.orderDiscount);
  const shared = shares.every((s) => s !== null) ? shares.reduce<number>((total, s) => total + s!, 0) : null;
  const clues = [
    recognition.date && `日期 ${recognition.date}`,
    recognition.channel && `渠道 ${recognition.channel}`,
    ...recognition.orderDiscounts.map((d) => `整单优惠 ${d.name ? `${d.name} ` : ''}${formatYuan(d.amount)}`),
  ].filter(Boolean);

  return (
    <>
      <Panel asChild>
        <section aria-label="识别草稿">
          <PanelHeader title="识别草稿" count={recognition.drafts.length} />
          {clues.length > 0 && <p className="text-ink-3 px-4 pt-3 text-sm price-tag:px-0">{clues.join(' · ')}</p>}
          {loadError && (
            <div className="px-4 pt-3 price-tag:px-0">
              <RetryAlert message={loadError} onRetry={load} />
            </div>
          )}
          <List variant="ruled">
            {recognition.drafts.map((draft) => (
              <DraftItem
                key={draft.id}
                recognition={recognition}
                draft={draft}
                groups={household?.groups}
                onChange={onChange}
                onOpenProduct={onOpenProduct}
              />
            ))}
          </List>
          {orderTotal > 0 && (
            <p className="text-ink-3 border-t border-line px-4 py-3 text-sm price-tag:px-0">
              {shared === null
                ? '部分草稿缺原价，整单优惠未分摊'
                : shared === orderTotal
                  ? `整单优惠 ${formatYuan(orderTotal)} 已按原价比例分摊`
                  : `分摊合计 ${formatYuan(shared)}，与整单优惠 ${formatYuan(orderTotal)} 不一致`}
            </p>
          )}
        </section>
      </Panel>
      {household && (
        <ConfirmForm recognition={recognition} channels={household.channels} onConfirmed={onConfirmed} />
      )}
    </>
  );
}

function Confirmed({
  records,
  names,
  onOpenProduct,
}: {
  records: PriceRecord[];
  names: Map<string, string>;
  onOpenProduct(id: string): void;
}) {
  return (
    <Panel asChild>
      <section aria-label="入库结果">
        <PanelHeader title="入库结果" count={records.length} />
        <p role="status" className="px-4 pt-3 font-medium price-tag:px-0">
          已入库 {records.length} 条
        </p>
        <List variant="ruled">
          {records.map((r) => (
            <li key={r.id} className="flex items-baseline gap-3 px-4 py-3 text-sm price-tag:px-0">
              <ProductLink id={r.productId} name={names.get(r.productId) ?? '商品'} onOpenProduct={onOpenProduct} />
              <span className="text-ink-3 ml-auto">到手价 {formatYuan(r.netPrice)}</span>
            </li>
          ))}
        </List>
      </section>
    </Panel>
  );
}

const editErrors = {
  product_not_found: '商品不存在',
  already_confirmed: '已确认入库',
  not_found: '草稿不存在',
};

function DraftItem({
  recognition,
  draft,
  groups,
  onChange,
  onOpenProduct,
}: {
  recognition: Recognition;
  draft: RecognitionDraft;
  groups: CategoryGroup[] | undefined;
  onChange(recognition: Recognition): void;
  onOpenProduct(id: string): void;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'pick'>('view');
  const [error, setError] = useState<string>();

  async function save(changes: DraftChanges) {
    const message = await attempt(async () => onChange(await api.editDraft(recognition.id, draft.id, changes)), editErrors);
    setError(message ?? undefined);
    if (!message) setMode('view');
  }

  const hasOrderDiscounts = recognition.orderDiscounts.length > 0;
  const facts = [
    draft.size && formatSize(draft.size.amount, draft.size.unit),
    draft.quantity !== null && `${draft.quantity} 件`,
    draft.listPrice !== null && `原价 ${formatYuan(draft.listPrice)}`,
    ...draft.discounts.map((d) => `${d.name ? `${d.name} ` : '优惠 '}-${formatYuan(d.amount)}`),
    hasOrderDiscounts && draft.orderDiscount !== null && `整单优惠分摊 -${formatYuan(draft.orderDiscount)}`,
  ].filter(Boolean);
  const missing = [
    !draft.size && (draft.sizeText ? `规格无法解析（${draft.sizeText}）` : '规格未识别'),
    draft.quantity === null && '件数未识别',
    draft.listPrice === null && '原价未识别',
    hasOrderDiscounts && draft.orderDiscount === null && '整单优惠未分摊',
  ].filter(Boolean);

  return (
    <li aria-label={draft.name} className="flex flex-col gap-2 px-4 py-3 price-tag:px-0">
      {mode === 'edit' ? (
        <DraftForm draft={draft} hasOrderDiscounts={hasOrderDiscounts} onSave={save} onCancel={() => setMode('view')} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-auto font-medium">{draft.name}</span>
            <Button variant="ghost" size="xs" onClick={() => setMode('edit')}>
              编辑
            </Button>
            <DeleteButton
              label={`删除 ${draft.name}`}
              onDelete={() =>
                attempt(async () => onChange(await api.deleteDraft(recognition.id, draft.id)), editErrors)
              }
            />
          </div>
          {facts.length > 0 && <span className="text-ink-3 text-sm">{facts.join(' · ')}</span>}
          {missing.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {missing.map((text) => (
                <Badge key={String(text)} tone="gold">
                  {text}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {draft.suggestedProduct ? (
              <ProductLink id={draft.suggestedProduct.id} name={draft.suggestedProduct.name} onOpenProduct={onOpenProduct} />
            ) : (
              <Badge tone="outline">未匹配商品</Badge>
            )}
            <Button variant="outline" size="xs" onClick={() => setMode(mode === 'pick' ? 'view' : 'pick')}>
              {draft.suggestedProduct ? '更换商品' : '选择商品'}
            </Button>
          </div>
          {mode === 'pick' && (
            <ProductPicker
              draft={draft}
              groups={groups}
              onPick={(productId) => save({ productId })}
              onCancel={() => setMode('view')}
            />
          )}
        </>
      )}
      {error && <Alert>{error}</Alert>}
    </li>
  );
}

function ProductPicker({
  draft,
  groups,
  onPick,
  onCancel,
}: {
  draft: RecognitionDraft;
  groups: CategoryGroup[] | undefined;
  onPick(productId: string): Promise<void>;
  onCancel(): void;
}) {
  const [query, setQuery] = useState(draft.name);
  const [creating, setCreating] = useState(false);
  const { found, error } = useProductSearch(query.trim());

  if (creating && groups) {
    return (
      <NewProductForm
        groups={groups}
        defaultName={draft.name}
        onCancel={() => setCreating(false)}
        onCreated={(product) => onPick(product.id)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Input aria-label="搜索商品" value={query} onChange={(event) => setQuery(event.target.value)} />
      {error && <Alert>{error}</Alert>}
      {found && found.products.length === 0 && <p className="text-ink-3 text-sm">暂无结果</p>}
      {found && found.products.length > 0 && (
        <ul aria-label="搜索结果" className="flex flex-col">
          {found.products.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="hover:bg-surface-hover w-full rounded-md px-2 py-1.5 text-left text-sm"
                onClick={() => onPick(p.id)}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={!groups} onClick={() => setCreating(true)}>
          新建商品
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

// Sends only what the member changed, since a new list price shares the order discounts out again.
function DraftForm({
  draft,
  hasOrderDiscounts,
  onSave,
  onCancel,
}: {
  draft: RecognitionDraft;
  hasOrderDiscounts: boolean;
  onSave(changes: DraftChanges): Promise<void>;
  onCancel(): void;
}) {
  const id = useId();
  const units: Unit[] = draft.suggestedProduct ? unitsLike(draft.suggestedProduct.pricingUnit) : [];
  if (draft.size && !units.some((u) => u.name === draft.size!.unit.name)) units.push(draft.size.unit);
  const [discounts, setDiscounts] = useState(
    draft.discounts.map((d) => ({ name: d.name ?? '', amount: yuanText(d.amount) })),
  );
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  function read(data: FormData): DraftChanges | string {
    const changes: DraftChanges = {};
    const name = String(data.get('name')).trim();
    if (!name) return '名称不能为空';
    if (name !== draft.name) changes.name = name;

    const quantityText = String(data.get('quantity')).trim();
    const quantity = quantityText ? parseQuantity(quantityText) : null;
    if (quantityText && quantity === null) return '件数应为正整数';
    if (quantity !== draft.quantity) changes.quantity = quantity;

    const amountText = String(data.get('sizeAmount') ?? '').trim();
    const unit = units.find((u) => u.name === data.get('sizeUnit'));
    if (amountText && !(Number(amountText) > 0)) return '规格应大于 0';
    const size = amountText && unit ? { amount: Number(amountText), unit } : null;
    if (size?.amount !== draft.size?.amount || size?.unit.name !== draft.size?.unit.name) changes.size = size;

    const listPriceText = String(data.get('listPrice')).trim();
    const listPrice = listPriceText ? parseYuan(listPriceText) : null;
    if ((listPriceText && listPrice === null) || listPrice === 0) return '原价应大于 0';
    if (listPrice !== draft.listPrice) changes.listPrice = listPrice;

    const lines: Discount[] = [];
    for (const d of discounts) {
      const amount = parseYuan(d.amount);
      if (!amount) return '优惠金额应大于 0';
      lines.push(d.name.trim() ? { amount, name: d.name.trim() } : { amount });
    }
    if (JSON.stringify(lines) !== JSON.stringify(draft.discounts)) changes.discounts = lines;

    if (hasOrderDiscounts) {
      const shareText = String(data.get('orderDiscount')).trim();
      const share = parseYuan(shareText || '0');
      if (share === null) return '分摊金额无效';
      if (share !== (draft.orderDiscount ?? 0)) changes.orderDiscount = share;
    }
    return changes;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes = read(new FormData(event.currentTarget));
    if (typeof changes === 'string') return setError(changes);
    if (Object.keys(changes).length === 0) return onCancel();
    setPending(true);
    await onSave(changes);
    setPending(false);
  }

  return (
    <form aria-label={`编辑 ${draft.name}`} className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <Field label="名称" htmlFor={`${id}-name`}>
        <Input id={`${id}-name`} name="name" required maxLength={100} defaultValue={draft.name} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="件数" htmlFor={`${id}-quantity`}>
          <Input id={`${id}-quantity`} name="quantity" autoComplete="off" defaultValue={draft.quantity ?? ''} />
        </Field>
        <Field label="原价（元）" htmlFor={`${id}-list-price`}>
          <Input id={`${id}-list-price`} name="listPrice" inputMode="decimal" autoComplete="off" defaultValue={yuanText(draft.listPrice)} />
        </Field>
      </div>
      <Field label="规格" htmlFor={`${id}-size`} hint={draft.sizeText ? `截图原文：${draft.sizeText}` : undefined}>
        {units.length === 0 ? (
          <p className="text-ink-3 text-sm">未选择商品</p>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              id={`${id}-size`}
              name="sizeAmount"
              inputMode="decimal"
              autoComplete="off"
              className="max-w-32"
              defaultValue={draft.size?.amount ?? ''}
            />
            <NativeSelect aria-label="规格单位" name="sizeUnit" defaultValue={draft.size?.unit.name ?? units[0]!.name}>
              {units.map((u) => (
                <option key={u.name} value={u.name}>
                  {u.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">本行优惠</legend>
        {discounts.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              aria-label={`优惠 ${i + 1} 名称`}
              placeholder="名称"
              maxLength={50}
              value={d.name}
              onChange={(event) => setDiscounts(discounts.map((x, j) => (j === i ? { ...x, name: event.target.value } : x)))}
            />
            <Input
              aria-label={`优惠 ${i + 1} 金额`}
              placeholder="金额"
              inputMode="decimal"
              className="max-w-28"
              value={d.amount}
              onChange={(event) => setDiscounts(discounts.map((x, j) => (j === i ? { ...x, amount: event.target.value } : x)))}
            />
            <Button type="button" variant="ghost" size="xs" onClick={() => setDiscounts(discounts.filter((_, j) => j !== i))}>
              移除
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="self-start"
          onClick={() => setDiscounts([...discounts, { name: '', amount: '' }])}
        >
          添加优惠
        </Button>
      </fieldset>
      {hasOrderDiscounts && (
        <Field label="整单优惠分摊（元）" htmlFor={`${id}-share`} hint="修改原价后重新分摊">
          <Input
            id={`${id}-share`}
            name="orderDiscount"
            inputMode="decimal"
            autoComplete="off"
            className="max-w-32"
            defaultValue={yuanText(draft.orderDiscount)}
          />
        </Field>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          保存
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

function ConfirmForm({
  recognition,
  channels,
  onConfirmed,
}: {
  recognition: Recognition;
  channels: Channel[];
  onConfirmed(records: PriceRecord[]): void;
}) {
  const id = useId();
  const [date, setDate] = useState(recognition.date ?? today());
  const [channelId, setChannelId] = useState(channels.find((c) => c.name === recognition.channel)?.id ?? '');
  const [purchased, setPurchased] = useState(true);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  function describe(error: unknown) {
    const draftId = error instanceof ApiError ? (error.payload as { draftId?: string } | null)?.draftId : undefined;
    const name = recognition.drafts.find((d) => d.id === draftId)?.name;
    return describeError(error, {
      draft_incomplete: `「${name}」信息不完整`,
      incompatible_unit: `「${name}」规格单位与计价单位不匹配`,
      invalid_price: `「${name}」优惠超过原价`,
      channel_not_found: '渠道不存在',
      no_drafts: '暂无可入库的草稿',
      already_confirmed: '已确认入库',
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!channelId) return setError('未选择渠道');
    setPending(true);
    try {
      const { priceRecords } = await api.confirmRecognition(recognition.id, { date, channelId, purchased });
      onConfirmed(priceRecords);
    } catch (e) {
      setError(describe(e));
      setPending(false);
    }
  }

  return (
    <Panel asChild>
      <form aria-label="确认入库" onSubmit={handleSubmit}>
        <PanelBody className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="日期" htmlFor={`${id}-date`}>
              <Input id={`${id}-date`} type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label="渠道" htmlFor={`${id}-channel`}>
              <NativeSelect
                id={`${id}-channel`}
                className="w-full"
                value={channelId}
                onChange={(event) => setChannelId(event.target.value)}
              >
                <option value="" disabled>
                  选择渠道
                </option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
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
          {error && <Alert>{error}</Alert>}
          <Button type="submit" size="lg" disabled={pending} className="self-start">
            确认入库 {recognition.drafts.length} 条
          </Button>
        </PanelBody>
      </form>
    </Panel>
  );
}
