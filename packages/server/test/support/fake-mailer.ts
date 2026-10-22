import type { MailMessage, Mailer } from '../../src/mailer';

// Stands in for SMTP with an in-memory inbox; mail is sent after the response, so readers wait for it.
export interface FakeMailer extends Mailer {
  messages: MailMessage[];
  // Waits up to 2 s for the newest unread message to `to`, marks it read, and returns its 6-digit code.
  codeFor(to: string): Promise<string>;
  // Resolves after `ms` (default 200) and throws if any message reached `to`.
  expectNoMailTo(to: string, ms?: number): Promise<void>;
}

export function fakeMailer(): FakeMailer {
  const read = new WeakSet<MailMessage>();
  const to = (address: string) => (m: MailMessage) => m.to === address.toLowerCase();

  const fake: FakeMailer = {
    messages: [],
    async send(message) {
      fake.messages.push(message);
    },
    async codeFor(address) {
      // Tests freeze Date with setSystemTime, so the wait is timed on the monotonic clock.
      const deadline = performance.now() + 2_000;
      for (;;) {
        const message = fake.messages.filter(to(address)).at(-1);
        if (message && !read.has(message)) {
          read.add(message);
          const code = /\b(\d{6})\b/.exec(message.text)?.[1];
          if (!code) throw new Error(`no code in the message to ${address}`);
          return code;
        }
        if (performance.now() > deadline) throw new Error(`no unread message to ${address}`);
        await Bun.sleep(10);
      }
    },
    async expectNoMailTo(address, ms = 200) {
      await Bun.sleep(ms);
      const count = fake.messages.filter(to(address)).length;
      if (count > 0) throw new Error(`${count} message(s) reached ${address}`);
    },
  };
  return fake;
}
