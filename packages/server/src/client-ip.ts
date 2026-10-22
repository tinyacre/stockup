// The header is trusted only because the operator names it, which they do when their proxy overwrites it.
export function clientIp(headers: Headers, header: string | undefined): string | undefined {
  if (!header) return undefined;
  return headers.get(header)?.trim() || undefined;
}
