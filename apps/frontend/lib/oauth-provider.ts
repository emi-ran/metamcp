import {
  discoverOAuthServerInfo,
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthMetadata,
  OAuthTokens,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  assertOAuthIssuer,
  OAuthClientInformationSchema,
  oauthIssuersMatch,
  OAuthReauthorizationRequiredError,
} from "@repo/zod-types";

import { getServerSpecificKey, SESSION_KEYS } from "./constants";
import { getAppUrl } from "./env";
import { vanillaTrpcClient } from "./trpc";

// base64url (RFC 4648 §5) encoding of a byte array. Uses btoa for the
// classic base64 step then trims/replaces to the url-safe variant. Browsers
// only — the SDK's `auth()` calls this from `state()` which runs in the
// browser path; no need for a Node fallback here.
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// OAuth client provider that works with a specific MCP server
class DbOAuthClientProvider implements OAuthClientProvider {
  private mcpServerUuid: string;
  protected serverUrl: string;
  private activeDiscovery?: OAuthDiscoveryState;
  private invalid = new Set<string>();

  constructor(mcpServerUuid: string, serverUrl: string) {
    this.mcpServerUuid = mcpServerUuid;
    this.serverUrl = serverUrl;
    // No sessionStorage access here: the constructor runs during Next.js SSR
    // for the MCP server detail page, where sessionStorage is undefined.
    // The SERVER_URL seed is deferred to ensureServerUrlStored(), called by
    // the OAuth-flow methods below, all of which are invoked client-side.
  }

  // Seeds SESSION_KEYS.SERVER_URL on first invocation in the browser. The
  // OAuth callback page reads this key to recover the upstream serverUrl, so
  // it must be set before redirectToAuthorization sends the user away. Safe
  // to call repeatedly; a no-op on the server.
  private ensureServerUrlStored() {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(SESSION_KEYS.SERVER_URL, this.serverUrl);
  }

  get redirectUrl() {
    return getAppUrl() + "/fe-oauth/callback";
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "MetaMCP",
      client_uri: "https://github.com/metatool-ai/metamcp",
    };
  }

  // Check if the server exists in the database
  private async serverExists() {
    const result = await vanillaTrpcClient.frontend.mcpServers.get.query({
      uuid: this.mcpServerUuid,
    });
    // A failed lookup is not permission to fall back to browser credentials.
    if (!result.success) throw new Error("Cannot load OAuth connection");
    return !!result.data;
  }

  private storageKey(key: string) {
    return getServerSpecificKey(key, `${this.mcpServerUuid}:${this.serverUrl}`);
  }

  private async loadCredentials() {
    if (await this.serverExists()) {
      const result = await vanillaTrpcClient.frontend.oauth.get.query({
        mcp_server_uuid: this.mcpServerUuid,
      });
      return result.success ? result.data : undefined;
    }
    const read = (key: string) => {
      const value = sessionStorage.getItem(this.storageKey(key));
      return value ? JSON.parse(value) : undefined;
    };
    // Old URL-only keys have no connection scope and are not reused.
    return {
      client_information: read(SESSION_KEYS.CLIENT_INFORMATION),
      tokens: read(SESSION_KEYS.TOKENS),
    };
  }

  private async persist(
    input: Parameters<typeof vanillaTrpcClient.frontend.oauth.upsert.mutate>[0],
  ) {
    if (await this.serverExists()) {
      const result =
        await vanillaTrpcClient.frontend.oauth.upsert.mutate(input);
      if (!result.success)
        throw new Error("Cannot persist OAuth connection credentials");
    }
  }

  async saveDiscoveryState(state: OAuthDiscoveryState) {
    // SDK-selected AS URL, not the token response issuer or an admin trust pin.
    this.activeDiscovery = state;
  }

  private async currentIssuer() {
    if (!this.activeDiscovery) {
      await this.saveDiscoveryState(
        await discoverOAuthServerInfo(this.serverUrl),
      );
    }
    const discovery = this.activeDiscovery;
    if (!discovery) throw new OAuthReauthorizationRequiredError();
    return discovery.authorizationServerUrl;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ) {
    // SDK retries use this provider instance. Suppress old credentials rather
    // than deleting/rebinding DB rows or affecting another connection/account.
    const scopes =
      scope === "all" ? ["client", "tokens", "verifier", "discovery"] : [scope];
    for (const item of scopes) this.invalid.add(item);
    if (scopes.includes("discovery")) this.activeDiscovery = undefined;
  }

  // During OAuth flow, we use sessionStorage for temporary data
  // After successful authentication, we'll save to the database
  async clientInformation() {
    if (this.invalid.has("client")) return undefined;
    const saved = (await this.loadCredentials())?.client_information;
    if (!saved || !saved.client_id) return undefined;
    const client = OAuthClientInformationSchema.parse(saved);
    const issuer = await this.currentIssuer();
    if (!oauthIssuersMatch(client.issuer, issuer)) {
      await this.invalidateCredentials("tokens");
      // Pre-registered credentials cannot silently become a different DCR client.
      if (
        client.pre_registered ||
        (client.registration_source !== "sdk" &&
          (client.token_endpoint || client.client_secret) &&
          !client.registration_client_uri &&
          !client.client_id_issued_at)
      ) {
        throw new OAuthReauthorizationRequiredError();
      }
      await this.invalidateCredentials("client");
      return undefined; // Fresh registration + interactive authorization via SDK.
    }
    if (
      client.registration_source === "sdk" &&
      client.token_endpoint &&
      client.token_endpoint !==
        (this.activeDiscovery?.authorizationServerMetadata?.token_endpoint ??
          new URL("/token", issuer).href)
    ) {
      throw new OAuthReauthorizationRequiredError();
    }
    return client;
  }

  async saveClientInformation(clientInformation: OAuthClientInformation) {
    this.ensureServerUrlStored();
    assertOAuthIssuer(clientInformation, await this.currentIssuer());
    const previous = (await this.loadCredentials())?.client_information;
    if (
      previous?.client_id !== clientInformation.client_id ||
      !oauthIssuersMatch(previous?.issuer, clientInformation.issuer)
    ) {
      await this.invalidateCredentials("tokens");
    }
    const saved = {
      ...clientInformation,
      registration_source: "sdk",
      oauth_reauthorization_required:
        this.invalid.has("client") ||
        previous?.oauth_reauthorization_required === true ||
        previous?.client_id !== clientInformation.client_id ||
        !oauthIssuersMatch(previous?.issuer, clientInformation.issuer),
      token_endpoint:
        this.activeDiscovery?.authorizationServerMetadata?.token_endpoint ??
        new URL("/token", String(await this.currentIssuer())).href,
    };
    await this.persist({
      mcp_server_uuid: this.mcpServerUuid,
      client_information: saved,
    });
    this.invalid.delete("client");
    sessionStorage.setItem(
      this.storageKey(SESSION_KEYS.CLIENT_INFORMATION),
      JSON.stringify(saved),
    );
  }

  async tokens() {
    if (this.invalid.has("tokens")) return undefined;
    const saved = await this.loadCredentials();
    if (
      !saved?.tokens ||
      saved.client_information?.oauth_reauthorization_required
    )
      return undefined;
    const issuer = await this.currentIssuer();
    if (
      !oauthIssuersMatch(saved.tokens.issuer, issuer) ||
      !oauthIssuersMatch(saved.client_information?.issuer, issuer)
    ) {
      await this.invalidateCredentials("tokens");
      return undefined; // No legacy refresh or manual access-token injection.
    }
    // Manual inspector headers bypass SDK auth(), so they need the client
    // endpoint/provenance guard too, not only the token's matching issuer.
    if (!(await this.clientInformation())) return undefined;
    return OAuthTokensSchema.parse(saved.tokens);
  }

  async reauthorizationRequired() {
    const saved = await this.loadCredentials();
    return Boolean(saved?.tokens || saved?.client_information?.client_id);
  }

  async saveTokens(tokens: OAuthTokens) {
    assertOAuthIssuer(tokens, await this.currentIssuer());
    const client = await this.clientInformation();
    if (!client) throw new OAuthReauthorizationRequiredError();
    const savedClient = { ...client, oauth_reauthorization_required: false };
    await this.persist({
      mcp_server_uuid: this.mcpServerUuid,
      tokens,
      client_information: savedClient,
    });
    sessionStorage.setItem(
      this.storageKey(SESSION_KEYS.CLIENT_INFORMATION),
      JSON.stringify(savedClient),
    );
    this.invalid.delete("tokens");
    // Save to session storage during OAuth flow
    const key = this.storageKey(SESSION_KEYS.TOKENS);
    sessionStorage.setItem(key, JSON.stringify(tokens));
  }

  redirectToAuthorization(authorizationUrl: URL) {
    this.ensureServerUrlStored();
    window.location.href = authorizationUrl.href;
  }

  // RFC 6749 §10.12 CSRF defence: generate a per-flow random `state`, persist
  // it server-side (`oauth_sessions.expected_state`), and return it for
  // inclusion in the upstream's /authorize URL. The SDK invokes this once
  // per authorize attempt (see `auth.js` in @modelcontextprotocol/sdk). On
  // the callback path the backend compares the echoed value to the
  // persisted one at `exchangeToken` and clears the column on success.
  //
  // The value never round-trips through sessionStorage because the backend
  // is the source of truth — the frontend only needs to forward what the
  // upstream echoed back, which arrives in the callback URL.
  async state(): Promise<string> {
    // 16 random bytes encoded as base64url → ~22 chars, well over the
    // ~128-bit-entropy bar in RFC 6749 §10.10.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const stateValue = base64UrlEncode(bytes);

    if (await this.serverExists()) {
      try {
        await vanillaTrpcClient.frontend.oauth.upsert.mutate({
          mcp_server_uuid: this.mcpServerUuid,
          expected_state: stateValue,
        });
      } catch (error) {
        // Best-effort. If the upsert fails the upstream redirect still
        // carries `stateValue`, but server-side validation will fall
        // through the back-compat NULL branch — the CSRF check degrades
        // to "skipped" rather than rejecting the flow. That is fail-open
        // for CSRF specifically; PKCE plus `resolveOwnedServerUrl`'s
        // ownership/SSRF guard still cover the practical attack surface.
        // Logged so monitoring can alert on a sustained persistence
        // failure, which would indicate the CSRF layer is silently off.
        console.error("Error persisting expected_state to database:", error);
      }
    }

    return stateValue;
  }

  async saveCodeVerifier(codeVerifier: string) {
    this.ensureServerUrlStored();
    this.invalid.delete("verifier");
    // Save to session storage during OAuth flow
    const key = getServerSpecificKey(
      SESSION_KEYS.CODE_VERIFIER,
      this.serverUrl,
    );
    sessionStorage.setItem(key, codeVerifier);

    // If server exists, also save to database
    if (await this.serverExists()) {
      try {
        await vanillaTrpcClient.frontend.oauth.upsert.mutate({
          mcp_server_uuid: this.mcpServerUuid,
          code_verifier: codeVerifier,
        });
      } catch (error) {
        console.error("Error saving code verifier to database:", error);
      }
    }
  }

  async codeVerifier() {
    if (this.invalid.has("verifier"))
      throw new OAuthReauthorizationRequiredError();
    // Check if server exists in the database
    const exists = await this.serverExists();

    if (exists) {
      // Get from database if server exists
      try {
        const result = await vanillaTrpcClient.frontend.oauth.get.query({
          mcp_server_uuid: this.mcpServerUuid,
        });
        if (result.success && result.data?.code_verifier) {
          return result.data.code_verifier;
        }
      } catch (error) {
        console.error("Error retrieving code verifier from database:", error);
      }
    }

    // Get from session storage during OAuth flow
    const key = getServerSpecificKey(
      SESSION_KEYS.CODE_VERIFIER,
      this.serverUrl,
    );
    const codeVerifier = sessionStorage.getItem(key);
    if (!codeVerifier) {
      throw new Error("No code verifier saved for session");
    }

    return codeVerifier;
  }

  clear() {
    this.activeDiscovery = undefined;
    this.invalid.clear();
    for (const key of [SESSION_KEYS.CLIENT_INFORMATION, SESSION_KEYS.TOKENS]) {
      sessionStorage.removeItem(this.storageKey(key));
    }
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.CODE_VERIFIER, this.serverUrl),
    );
  }
}

// Debug version that overrides redirect URL and allows saving server OAuth metadata
export class DebugDbOAuthClientProvider extends DbOAuthClientProvider {
  get redirectUrl(): string {
    return getAppUrl() + "/fe-oauth/callback/debug";
  }

  saveServerMetadata(metadata: OAuthMetadata) {
    const key = getServerSpecificKey(
      SESSION_KEYS.SERVER_METADATA,
      this.serverUrl,
    );
    sessionStorage.setItem(key, JSON.stringify(metadata));
  }

  getServerMetadata(): OAuthMetadata | null {
    const key = getServerSpecificKey(
      SESSION_KEYS.SERVER_METADATA,
      this.serverUrl,
    );
    const metadata = sessionStorage.getItem(key);
    if (!metadata) {
      return null;
    }
    return JSON.parse(metadata);
  }

  clear() {
    super.clear();
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.SERVER_METADATA, this.serverUrl),
    );
  }
}

// Factory function to create an OAuth provider for a specific MCP server
export function createAuthProvider(
  mcpServerUuid: string,
  serverUrl: string,
): DbOAuthClientProvider {
  return new DbOAuthClientProvider(mcpServerUuid, serverUrl);
}

// Factory function to create a debug OAuth provider for a specific MCP server
export function createDebugAuthProvider(
  mcpServerUuid: string,
  serverUrl: string,
): DebugDbOAuthClientProvider {
  return new DebugDbOAuthClientProvider(mcpServerUuid, serverUrl);
}
