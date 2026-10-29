import type { Fetch } from '../../src/public-endpoint';

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export interface ProviderRequest {
  url: string;
  headers: Headers;
  body: Record<string, any>;
}

// Plays the provider's side of every call with `respond`, recording what each was sent.
export function recordingFetch(respond: () => Response | Promise<Response>) {
  const requests: ProviderRequest[] = [];
  const fetch: Fetch = async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return respond();
  };
  return { fetch, requests };
}

// A Messages API reply whose text is `text`.
export function anthropicMessage(text: string, stopReason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

// A Chat Completions reply whose only choice says `content`.
export function openaiCompletion(content: string | null, finishReason = 'stop', refusal: string | null = null) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-5-mini',
    choices: [{ index: 0, message: { role: 'assistant', content, refusal }, finish_reason: finishReason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}
