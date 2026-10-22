import { expect, type APIRequestContext } from '@playwright/test';

interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

// The e2e server keeps sent mail in memory; the code goes out after the response, so this polls for it.
export async function latestCode(request: APIRequestContext, email: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(async () => {
      const res = await request.get(`/__e2e/mail?to=${encodeURIComponent(email)}`);
      const { messages } = (await res.json()) as { messages: MailMessage[] };
      code = messages[0] && /\b(\d{6})\b/.exec(messages[0].text)?.[1];
      return code;
    }, { message: `a code mailed to ${email}` })
    .toBeTruthy();
  return code!;
}
