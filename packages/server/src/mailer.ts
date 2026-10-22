import nodemailer from 'nodemailer';
import type { SmtpConfig } from './config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

const sendTimeoutMs = 15_000;

const tlsOptions = {
  // STARTTLS is required rather than opportunistic, so a server or proxy that drops it cannot downgrade the session.
  starttls: { secure: false, requireTLS: true },
  implicit: { secure: true },
  none: { secure: false, ignoreTLS: true },
};

export function smtpMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    ...tlsOptions[config.tls],
    auth: config.username ? { user: config.username, pass: config.password ?? '' } : undefined,
    tls: { servername: config.host, minVersion: 'TLSv1.2' },
    connectionTimeout: sendTimeoutMs,
    greetingTimeout: sendTimeoutMs,
    socketTimeout: sendTimeoutMs,
  });

  return {
    async send(message) {
      // The per-phase timeouts above leave a slow trickle unbounded, so the whole send gets a deadline too.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`SMTP send timed out after ${sendTimeoutMs} ms`)), sendTimeoutMs);
      });
      try {
        await Promise.race([transport.sendMail({ from: config.from, ...message }), deadline]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
