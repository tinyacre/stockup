import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { parseQuantity, type Discount, type Unit } from '@stockup/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, attempt, DeleteButton, describeError, fieldClass, RetryAlert } from '@/components/editing';
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
import { cn } from '@/lib/utils';

const uploadErrors = {
  unsupported_evidence_type: '截图只支持 PNG、JPEG、WebP 或 GIF 图片。',
  evidence_too_large: '截图不能超过 10 MB。',
};

const failures: Record<NonNullable<Recognition['error']>, string> = {
  recognition_unavailable: '还没有配置识别服务。',
  recognition_failed: '识别失败了。',
  recognition_interrupted: '识别被服务器重启打断了。',
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
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
      <h2 className="text-xl font-semibold">截图识别</h2>
      <p className="text-muted-foreground text-sm">上传一张订单页或商品页截图，识别出其中每件商品，生成识别草稿供你确认。</p>
      <div>
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
      </div>
      {!available && <Alert>还没有配置识别服务，暂时不能识别截图。</Alert>}
      {error && <Alert>{error}</Alert>}
    </div>
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
      setLoadError(describeError(error, { not_found: '找不到这次识别。' }));
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

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">截图识别</h2>
        <Button variant="outline" size="sm" onClick={onUploadAnother}>
          识别另一张
        </Button>
      </div>
      {loadError && <RetryAlert message={loadError} onRetry={load} />}
      {recognition && (
        <>
          <a
            href={api.recognitionScreenshotUrl(recognition.id)}
            target="_blank"
            rel="noreferrer"
            className="self-start"
          >
            <img
              src={api.recognitionScreenshotUrl(recognition.id)}
              alt="上传的截图"
              className="max-h-48 rounded border object-contain"
            />
          </a>
          {recognition.status === 'pending' && (
            <p role="status" className="text-muted-foreground text-sm">
              正在识别…
            </p>
          )}
          {recognition.status === 'failed' && (
            <ManualEntry
              message={`${failures[recognition.error!]}截图已保留，可以对照截图手动录入。`}
              onManualEntry={onManualEntry}
            />
          )}
          {confirmed ? (
            <Confirmed {...confirmed} onOpenProduct={onOpenProduct} />
          ) : recognition.confirmedAt ? (
            <p role="status" className="text-sm">
              这次识别已经确认入库。
            </p>
          ) : recognition.status === 'succeeded' &&
            (recognition.drafts.length === 0 ? (
              <ManualEntry message="截图中没有识别出商品，可以对照截图手动录入。" onManualEntry={onManualEntry} />
            ) : (
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
            ))}
        </>
      )}
    </div>
  );
}

function ManualEntry({ message, onManualEntry }: { message: string; onManualEntry(): void }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <Alert>{message}</Alert>
      <Button variant="outline" size="sm" onClick={onManualEntry}>
        手动录入
      </Button>
    </div>
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
    <section aria-label="识别草稿" className="flex flex-col gap-2">
      <h3 className="font-medium">识别草稿（{recognition.drafts.length} 条）</h3>
      {clues.length > 0 && <p className="text-muted-foreground text-sm">{clues.join(' · ')}</p>}
      {loadError && <RetryAlert message={loadError} onRetry={load} />}
      <ul className="flex flex-col gap-2">
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
      </ul>
      {orderTotal > 0 && (
        <p className="text-muted-foreground text-sm">
          {shared === null
            ? '有草稿还没有原价，填上后整单优惠会按原价比例分摊。'
            : shared === orderTotal
              ? `整单优惠 ${formatYuan(orderTotal)} 已按原价比例分摊到各条，可以在编辑中调整。`
              : `各条分摊合计 ${formatYuan(shared)}，与整单优惠 ${formatYuan(orderTotal)} 不一致。`}
        </p>
      )}
      {household && (
        <ConfirmForm
          recognition={recognition}
          channels={household.channels}
          onConfirmed={onConfirmed}
        />
      )}
    </section>
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
    <section aria-label="入库结果" className="flex flex-col gap-2">
      <p role="status" className="font-medium">
        已入库 {records.length} 条价格记录。
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {records.map((r) => (
          <li key={r.id}>
            <ProductLink id={r.productId} name={names.get(r.productId) ?? '商品'} onOpenProduct={onOpenProduct} />
            ：到手价 {formatYuan(r.netPrice)}
          </li>
        ))}
      </ul>
    </section>
  );
}

const editErrors = {
  product_not_found: '这个商品已经不在了。',
  already_confirmed: '这次识别已经确认入库了。',
  not_found: '这条草稿已经不在了。',
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

  const size = draft.size
    ? formatSize(draft.size.amount, draft.size.unit)
    : draft.sizeText
      ? `规格未能解析（${draft.sizeText}）`
      : '规格未识别';
  const facts = [
    size,
    draft.quantity === null ? '件数未识别' : `${draft.quantity} 件`,
    draft.listPrice === null ? '原价未识别' : `原价 ${formatYuan(draft.listPrice)}`,
    ...draft.discounts.map((d) => `${d.name ? `${d.name} ` : '优惠 '}-${formatYuan(d.amount)}`),
    ...(recognition.orderDiscounts.length === 0
      ? []
      : [draft.orderDiscount === null ? '整单优惠未分摊' : `整单优惠分摊 -${formatYuan(draft.orderDiscount)}`]),
  ];

  return (
    <li aria-label={draft.name} className="flex flex-col gap-2 rounded-md border p-3">
      {mode === 'edit' ? (
        <DraftForm draft={draft} hasOrderDiscounts={recognition.orderDiscounts.length > 0} onSave={save} onCancel={() => setMode('view')} />
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
          <span className="text-muted-foreground text-sm">{facts.join(' · ')}</span>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {draft.suggestedProduct ? (
              <span>
                商品：
                <ProductLink id={draft.suggestedProduct.id} name={draft.suggestedProduct.name} onOpenProduct={onOpenProduct} />
              </span>
            ) : (
              <span className="text-muted-foreground">没有匹配的已有商品</span>
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
      {found && found.products.length === 0 && <p className="text-muted-foreground text-sm">没有找到相关的商品。</p>}
      {found && found.products.length > 0 && (
        <ul aria-label="搜索结果" className="flex flex-col">
          {found.products.map((p) => (
            <li key={p.id}>
              <button type="button" className="hover:bg-muted w-full rounded px-2 py-1.5 text-left text-sm" onClick={() => onPick(p.id)}>
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
    if (!name) return '请填写名称。';
    if (name !== draft.name) changes.name = name;

    const quantityText = String(data.get('quantity')).trim();
    const quantity = quantityText ? parseQuantity(quantityText) : null;
    if (quantityText && quantity === null) return '件数要写成正整数，如 18 或 3×6。';
    if (quantity !== draft.quantity) changes.quantity = quantity;

    const amountText = String(data.get('sizeAmount') ?? '').trim();
    const unit = units.find((u) => u.name === data.get('sizeUnit'));
    if (amountText && !(Number(amountText) > 0)) return '规格必须大于 0。';
    const size = amountText && unit ? { amount: Number(amountText), unit } : null;
    if (size?.amount !== draft.size?.amount || size?.unit.name !== draft.size?.unit.name) changes.size = size;

    const listPriceText = String(data.get('listPrice')).trim();
    const listPrice = listPriceText ? parseYuan(listPriceText) : null;
    if ((listPriceText && listPrice === null) || listPrice === 0) return '原价要写成大于 0 的金额，如 99.90。';
    if (listPrice !== draft.listPrice) changes.listPrice = listPrice;

    const lines: Discount[] = [];
    for (const d of discounts) {
      const amount = parseYuan(d.amount);
      if (!amount) return '优惠金额要大于 0，如 10.00。';
      lines.push(d.name.trim() ? { amount, name: d.name.trim() } : { amount });
    }
    if (JSON.stringify(lines) !== JSON.stringify(draft.discounts)) changes.discounts = lines;

    if (hasOrderDiscounts) {
      const shareText = String(data.get('orderDiscount')).trim();
      const share = parseYuan(shareText || '0');
      if (share === null) return '整单优惠分摊要写成金额，如 5.53。';
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
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-name`}>名称</Label>
        <Input id={`${id}-name`} name="name" required maxLength={100} defaultValue={draft.name} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-quantity`}>件数</Label>
          <Input id={`${id}-quantity`} name="quantity" autoComplete="off" defaultValue={draft.quantity ?? ''} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-list-price`}>原价（元）</Label>
          <Input id={`${id}-list-price`} name="listPrice" inputMode="decimal" autoComplete="off" defaultValue={yuanText(draft.listPrice)} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-size`}>规格</Label>
        {units.length === 0 ? (
          <p className="text-muted-foreground text-sm">先选择商品，再按它的计价单位填写规格。</p>
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
            <select
              aria-label="规格单位"
              name="sizeUnit"
              className={cn(fieldClass, 'h-9 w-auto')}
              defaultValue={draft.size?.unit.name ?? units[0]!.name}
            >
              {units.map((u) => (
                <option key={u.name} value={u.name}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {draft.sizeText && <p className="text-muted-foreground text-xs">截图上写的是「{draft.sizeText}」。</p>}
      </div>
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
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-share`}>整单优惠分摊（元）</Label>
          <Input
            id={`${id}-share`}
            name="orderDiscount"
            inputMode="decimal"
            autoComplete="off"
            className="max-w-32"
            defaultValue={yuanText(draft.orderDiscount)}
          />
          <p className="text-muted-foreground text-xs">改了原价会重新按比例分摊。</p>
        </div>
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
      draft_incomplete: `「${name}」还缺商品、规格、件数、原价或整单优惠分摊。`,
      incompatible_unit: `「${name}」的规格单位和商品的计价单位换算不了。`,
      invalid_price: `「${name}」的优惠不能超过原价。`,
      channel_not_found: '这个渠道已经不在了，请重新选择。',
      no_drafts: '没有可以入库的草稿。',
      already_confirmed: '这次识别已经确认入库了。',
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!channelId) return setError('请选择渠道。');
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
    <form aria-label="确认入库" className="flex flex-col gap-3 rounded-md border p-3" onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-date`}>日期</Label>
          <Input id={`${id}-date`} type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-channel`}>渠道</Label>
          <select
            id={`${id}-channel`}
            className={cn(fieldClass, 'h-9')}
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
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={purchased} onChange={(event) => setPurchased(event.target.checked)} />
        已购（不勾选则仅记录）
      </label>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" disabled={pending} className="self-start">
        确认入库 {recognition.drafts.length} 条
      </Button>
    </form>
  );
}
