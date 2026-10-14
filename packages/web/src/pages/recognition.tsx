import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, attempt, describeError, RetryAlert } from '@/components/editing';
import { api, type Recognition, type RecognitionDraft } from '@/lib/api';
import { formatSize, formatYuan } from '@/lib/format';

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
          {recognition.status === 'succeeded' &&
            (recognition.drafts.length === 0 ? (
              <ManualEntry message="截图中没有识别出商品，可以对照截图手动录入。" onManualEntry={onManualEntry} />
            ) : (
              <Drafts recognition={recognition} onOpenProduct={onOpenProduct} />
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

function Drafts({ recognition, onOpenProduct }: { recognition: Recognition; onOpenProduct(id: string): void }) {
  const clues = [
    recognition.date && `日期 ${recognition.date}`,
    recognition.channel && `渠道 ${recognition.channel}`,
    ...recognition.orderDiscounts.map((d) => `整单优惠 ${d.name ? `${d.name} ` : ''}${formatYuan(d.amount)}`),
  ].filter(Boolean);
  return (
    <section aria-label="识别草稿" className="flex flex-col gap-2">
      <h3 className="font-medium">识别草稿（{recognition.drafts.length} 条）</h3>
      {clues.length > 0 && <p className="text-muted-foreground text-sm">{clues.join(' · ')}</p>}
      <ul className="flex flex-col gap-2">
        {recognition.drafts.map((draft) => (
          <DraftItem key={draft.id} draft={draft} onOpenProduct={onOpenProduct} />
        ))}
      </ul>
    </section>
  );
}

function DraftItem({ draft, onOpenProduct }: { draft: RecognitionDraft; onOpenProduct(id: string): void }) {
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
  ];
  return (
    <li aria-label={draft.name} className="flex flex-col gap-1 rounded-md border p-3">
      <span className="font-medium">{draft.name}</span>
      <span className="text-muted-foreground text-sm">{facts.join(' · ')}</span>
      <span className="text-sm">
        {draft.suggestedProduct ? (
          <>
            推荐商品：
            <a
              href={`/products/${encodeURIComponent(draft.suggestedProduct.id)}`}
              className="underline underline-offset-2"
              onClick={(event) => {
                event.preventDefault();
                onOpenProduct(draft.suggestedProduct!.id);
              }}
            >
              {draft.suggestedProduct.name}
            </a>
          </>
        ) : (
          <span className="text-muted-foreground">没有匹配的已有商品</span>
        )}
      </span>
    </li>
  );
}
