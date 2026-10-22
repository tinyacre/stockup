import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Database, Transaction } from './db';
import { emailCode, emailCodePurposes } from './db/schema';
import type { MailMessage, Mailer } from './mailer';

export { emailCodePurposes };
export type EmailCodePurpose = (typeof emailCodePurposes)[number];

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;
const SENDS_PER_HOUR = 5;
const HOUR_MS = 60 * 60_000;

export class EmailCodeThrottledError extends Error {
  override name = 'EmailCodeThrottledError';
  constructor(readonly retryAfterSeconds: number) {
    super(`email code throttled for ${retryAfterSeconds} s`);
  }
}

export class EmailCodeInvalidError extends Error {
  override name = 'EmailCodeInvalidError';
  constructor(readonly reason: 'invalid' | 'expired' | 'attempts_exceeded') {
    super(`email code ${reason}`);
  }
}

export interface EmailCodes {
  // Rate-limits and stores a new code. Mails it only when `deliver`, without waiting for the mail.
  send(email: string, purpose: EmailCodePurpose, options: { deliver: boolean }): Promise<void>;
  // Spends an attempt, checks the code, then runs `work` in a transaction that also uses the code up;
  // `work` throwing rolls that back, so the code stays usable (e.g. when the username is taken).
  redeem<T>(email: string, purpose: EmailCodePurpose, code: string, work: (tx: Transaction) => Promise<T>): Promise<T>;
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const titles: Record<EmailCodePurpose, string> = {
  register: '注册验证码',
  join: '加入家庭验证码',
  'password-reset': '找回密码验证码',
  'change-email': '更换邮箱验证码',
};

function codeMessage(to: string, purpose: EmailCodePurpose, code: string): MailMessage {
  const title = titles[purpose];
  const validity = `${CODE_TTL_MS / 60_000} 分钟内有效`;
  const footer = '如非本人操作，忽略此邮件即可';
  return {
    to,
    subject: `StockUp 验证码 ${code}`,
    text: `${title}\n\n${code}\n\n${validity}\n\n${footer}\n`,
    html: `<!doctype html>
<html lang="zh-CN"><body style="margin:0;padding:24px;background:#f4f4f2;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#1f2421">
<div style="max-width:480px;margin:0 auto;padding:28px;border-radius:12px;background:#ffffff">
<h1 style="margin:0;font-size:18px;line-height:26px">${title}</h1>
<div style="margin-top:16px;padding:18px 0;border-radius:12px;background:#f0f3f1;text-align:center;font-family:ui-monospace,SFMono-Regular,'SF Mono',Menlo,monospace;font-size:32px;line-height:40px;letter-spacing:.3em;font-weight:600">${code}</div>
<p style="margin:16px 0 0;color:#5f6d67">${validity}</p>
<div style="margin-top:28px;padding-top:16px;border-top:1px solid #e0e6e2;font-size:12px;line-height:18px;color:#5f6d67">${footer}</div>
</div></body></html>`,
  };
}

function newCode() {
  // 2^32 is not a multiple of a million, so values from the uneven top slice are drawn again.
  const limit = Math.floor(2 ** 32 / 1_000_000) * 1_000_000;
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  if (n! >= limit) return newCode();
  return String(n! % 1_000_000).padStart(6, '0');
}

export function createEmailCodes({ db, mailer, secret }: { db: Database; mailer: Mailer; secret: string }): EmailCodes {
  // Keyed with the server secret: six digits are a million guesses, which a plain hash in a leaked database would not survive.
  const hash = (email: string, purpose: EmailCodePurpose, code: string) =>
    createHmac('sha256', secret).update(`stockup/email-code|${purpose}|${email}|${code}`).digest('hex');

  const find = async (email: string, purpose: EmailCodePurpose) => {
    const [row] = await db
      .select()
      .from(emailCode)
      .where(and(eq(emailCode.email, email), eq(emailCode.purpose, purpose)));
    return row;
  };

  return {
    async send(rawEmail, purpose, { deliver }) {
      const email = normalizeEmail(rawEmail);
      const now = new Date();
      const hourAgo = new Date(now.getTime() - HOUR_MS);
      // A row whose last send left the window carries no limit any more.
      await db.delete(emailCode).where(lt(emailCode.sentAt, hourAgo));

      const prev = await find(email, purpose);
      const recentSends = (prev?.recentSends ?? []).filter((sent) => sent > hourAgo);
      const waits = [0];
      if (prev) waits.push(prev.sentAt.getTime() + RESEND_COOLDOWN_MS - now.getTime());
      if (recentSends.length >= SENDS_PER_HOUR) {
        waits.push(Math.min(...recentSends.map((sent) => sent.getTime())) + HOUR_MS - now.getTime());
      }
      const wait = Math.max(...waits);
      if (wait > 0) throw new EmailCodeThrottledError(Math.ceil(wait / 1000));

      const code = deliver ? newCode() : undefined;
      const next = {
        codeHash: code ? hash(email, purpose, code) : null,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        attempts: 0,
        sentAt: now,
        recentSends: [...recentSends, now],
      };
      // Matching on the previous send time makes a concurrent send for the same address lose instead of doubling up.
      const written = prev
        ? await db
            .update(emailCode)
            .set(next)
            .where(and(eq(emailCode.email, email), eq(emailCode.purpose, purpose), eq(emailCode.sentAt, prev.sentAt)))
            .returning({ email: emailCode.email })
        : await db
            .insert(emailCode)
            .values({ email, purpose, ...next })
            .onConflictDoNothing()
            .returning({ email: emailCode.email });
      if (written.length === 0) throw new EmailCodeThrottledError(RESEND_COOLDOWN_MS / 1000);

      // The response goes out before the mail, so it takes as long whether or not anything is mailed.
      if (code) void mailer.send(codeMessage(email, purpose, code)).catch((e) => console.error('Could not send email code', e));
    },

    async redeem(rawEmail, purpose, code, work) {
      const email = normalizeEmail(rawEmail);
      const row = await find(email, purpose);
      if (!row?.codeHash) throw new EmailCodeInvalidError('invalid');
      if (new Date() >= row.expiresAt) throw new EmailCodeInvalidError('expired');

      const current = and(eq(emailCode.email, email), eq(emailCode.purpose, purpose), eq(emailCode.sentAt, row.sentAt));
      // Counted in a statement of its own, so a wrong guess stays counted even though no transaction follows it.
      const spent = await db
        .update(emailCode)
        .set({ attempts: sql`${emailCode.attempts} + 1` })
        .where(and(current, lt(emailCode.attempts, MAX_ATTEMPTS)))
        .returning({ email: emailCode.email });
      if (spent.length === 0) {
        const latest = await find(email, purpose);
        const superseded = latest?.sentAt.getTime() !== row.sentAt.getTime();
        throw new EmailCodeInvalidError(superseded ? 'invalid' : 'attempts_exceeded');
      }

      const expected = Buffer.from(row.codeHash, 'hex');
      const given = Buffer.from(hash(email, purpose, code), 'hex');
      if (!timingSafeEqual(expected, given)) throw new EmailCodeInvalidError('invalid');

      return db.transaction(async (tx) => {
        // The send history stays, so redeeming a code does not reset the hourly limit.
        const used = await tx
          .update(emailCode)
          .set({ codeHash: null })
          .where(and(current, eq(emailCode.codeHash, row.codeHash!)))
          .returning({ email: emailCode.email });
        if (used.length === 0) throw new EmailCodeInvalidError('invalid');
        return work(tx);
      });
    },
  };
}
