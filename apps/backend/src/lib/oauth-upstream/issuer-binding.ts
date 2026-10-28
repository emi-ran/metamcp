import { discoverOAuthServerInfo } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  assertOAuthIssuer,
  OAuthReauthorizationRequiredError,
} from "@repo/zod-types";

// Custom grants bypass SDK auth(). Reproduce its discovery binding check before
// sending any code, verifier, client secret or refresh token. Do not stamp old
// credentials from today's resource metadata or a token response.
export async function boundOAuthContext(
  serverUrl: string,
  client: Record<string, unknown> | null | undefined,
  tokens?: { issuer?: unknown } | null,
) {
  // Reject legacy credentials even before credential-free discovery.
  assertOAuthIssuer(client, client?.issuer);
  if (tokens !== undefined && client?.oauth_reauthorization_required) {
    throw new OAuthReauthorizationRequiredError();
  }
  if (tokens !== undefined) assertOAuthIssuer(tokens, client?.issuer);

  const info = await discoverOAuthServerInfo(serverUrl, {
    fetchFn: (url, init) => fetch(url, { ...init, redirect: "error" }),
  });
  const issuer = String(info.authorizationServerUrl);
  assertOAuthIssuer(client, issuer);
  if (tokens !== undefined) assertOAuthIssuer(tokens, issuer);

  const discovered = info.authorizationServerMetadata;
  const selectedEndpoint =
    discovered?.token_endpoint ?? new URL("/token", issuer).href;
  // A previously selected endpoint cannot silently change within one issuer.
  // Pre-registration's explicit endpoint is configuration, not discovery proof.
  if (
    !client?.pre_registered &&
    client?.token_endpoint &&
    client.token_endpoint !== selectedEndpoint
  ) {
    throw new OAuthReauthorizationRequiredError();
  }
  const tokenEndpoint =
    client?.pre_registered && typeof client.token_endpoint === "string"
      ? client.token_endpoint
      : selectedEndpoint;
  const endpoint = new URL(tokenEndpoint);
  if (
    !["https:", "http:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new OAuthReauthorizationRequiredError();
  }
  return { issuer, tokenEndpoint, discovered: discovered ?? null };
}
