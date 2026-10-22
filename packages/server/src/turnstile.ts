export interface TurnstileVerifier {
  // Served to the browser, which renders the challenge with it.
  siteKey: string;
  verify(token: string, remoteIp: string | undefined): Promise<boolean>;
}
