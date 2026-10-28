// Match the SDK 1.32.x binding key: discovery's authorizationServerUrl, not
// an issuer claimed by a token/registration response. No implicit legacy bind.
export function oauthIssuersMatch(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  try {
    const x = new URL(a).href;
    const y = new URL(b).href;
    return x === y || `${x}/` === y || `${y}/` === x;
  } catch {
    return false;
  }
}

export class OAuthReauthorizationRequiredError extends Error {
  constructor() {
    super(
      "OAuth authorization required again for this connection: saved credentials " +
        "have no matching authorization-server issuer. Authorize this MCP connection " +
        "again; pre-registered clients must be configured with their original issuer.",
    );
    this.name = "OAuthReauthorizationRequiredError";
  }
}

export function assertOAuthIssuer(
  credentials: { issuer?: unknown } | null | undefined,
  issuer: unknown,
): void {
  if (!credentials || !oauthIssuersMatch(credentials.issuer, issuer)) {
    throw new OAuthReauthorizationRequiredError();
  }
}
