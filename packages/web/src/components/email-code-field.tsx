import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { describeError } from '@/components/editing';
import { turnstileErrors, type TurnstileChallenge } from '@/components/turnstile';
import { api, ApiError, type EmailCodePurpose } from '@/lib/api';

const RESEND_SECONDS = 60;

// Wording for the code errors that the submitting page gets back.
export const codeErrors = {
  code_invalid: '验证码错误',
  code_expired: '验证码已过期，请重新获取',
  code_attempts_exceeded: '验证码尝试次数过多，请重新获取',
};

// The email and code inputs of a form, named `email` and `code`, with a button that mails the code and then
// counts down until another may be sent. The surrounding form reads both values on submit, and renders the
// Turnstile widget whose token the send spends.
export function EmailCodeField({
  purpose,
  invitationId,
  emailLabel = '邮箱',
  messages,
  turnstile,
}: {
  purpose: EmailCodePurpose;
  invitationId?: string;
  emailLabel?: string;
  // Wording for errors specific to the purpose, keyed by error code.
  messages?: Record<string, string>;
  turnstile: TurnstileChallenge;
}) {
  const id = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const [wait, setWait] = useState(0);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function send() {
    const input = emailRef.current!;
    if (!input.reportValidity()) return;
    setSending(true);
    setError(undefined);
    try {
      await api.sendEmailCode({ email: input.value, purpose, invitationId }, turnstile.token);
      setSent(true);
      setWait(RESEND_SECONDS);
    } catch (error) {
      const retryAfter = error instanceof ApiError ? (error.payload as { retryAfter?: number } | null)?.retryAfter : undefined;
      if (retryAfter) {
        setWait(retryAfter);
        setError(`发送太频繁，请 ${retryAfter} 秒后再试`);
      } else {
        setError(
          describeError(error, {
            signup_closed: '注册未开放',
            email_unavailable: '暂不支持发送邮件',
            ...turnstileErrors,
            ...messages,
          }),
        );
      }
    } finally {
      setSending(false);
      turnstile.spend();
    }
  }

  return (
    <>
      <Field label={emailLabel} htmlFor={`${id}-email`}>
        <div className="flex gap-2">
          <Input
            ref={emailRef}
            id={`${id}-email`}
            name="email"
            type="email"
            autoComplete="email"
            required
            onChange={() => setError(undefined)}
          />
          <Button type="button" variant="outline" disabled={sending || wait > 0 || !turnstile.ready} onClick={send}>
            {wait > 0 ? `${wait} 秒后重发` : sent ? '重新发送' : '发送验证码'}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : (
          sent && (
            <p role="status" className="text-xs text-ink-3">
              验证码已发送，10 分钟内有效
            </p>
          )
        )}
      </Field>
      <Field label="验证码" htmlFor={`${id}-code`}>
        <Input
          id={`${id}-code`}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          title="6 位数字"
          required
        />
      </Field>
    </>
  );
}
