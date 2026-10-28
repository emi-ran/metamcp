import { fileURLToPath } from "node:url";

import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../frontend/lib/trpc", () => ({
  vanillaTrpcClient: {
    frontend: {
      mcpServers: { get: { query: vi.fn() } },
      oauth: { get: { query: vi.fn() }, upsert: { mutate: vi.fn() } },
    },
  },
}));
vi.mock("../../../frontend/lib/env", () => ({
  getAppUrl: () => "https://metamcp.example.com",
}));

describe("DbOAuthClientProvider issuer lifecycle (mocked storage only)", () => {
  const issuer = "https://auth.example.com/";
  const serverUrl = "https://resource.example.com/mcp";
  const uuid = "00000000-0000-4000-8000-000000000001";
  let saved: Record<string, any>;
  // Runtime paths keep frontend files outside the backend's rootDir compilation.
  const providerPath = fileURLToPath(
    new URL("../../../frontend/lib/oauth-provider.ts", import.meta.url),
  );
  const trpcPath = fileURLToPath(
    new URL("../../../frontend/lib/trpc.ts", import.meta.url),
  );
  let createAuthProvider: any;
  let api: any;

  beforeEach(async () => {
    ({ createAuthProvider } = await import(providerPath));
    api = (await import(trpcPath)).vanillaTrpcClient.frontend;
    vi.clearAllMocks();
    saved = {};
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("window", { location: { href: "" } });
    vi.mocked(api.mcpServers.get.query).mockResolvedValue({
      success: true,
      data: {},
    } as never);
    vi.mocked(api.oauth.get.query).mockImplementation(
      async () => ({ success: true, data: saved }) as never,
    );
    vi.mocked(api.oauth.upsert.mutate).mockImplementation(
      async (input: Record<string, unknown>) => {
        saved = { ...saved, ...input };
        return { success: true, data: saved } as never;
      },
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns no legacy tokens, preserves fresh SDK stamps and supports SDK invalidation", async () => {
    saved = {
      client_information: { client_id: "legacy" },
      tokens: {
        access_token: "old",
        token_type: "Bearer",
        refresh_token: "old-refresh",
      },
    };
    const provider = createAuthProvider(uuid, serverUrl);
    await provider.saveDiscoveryState({ authorizationServerUrl: issuer });
    expect(await provider.tokens()).toBeUndefined();
    expect(await provider.clientInformation()).toBeUndefined();
    await provider.saveClientInformation({ client_id: "new", issuer });
    expect(saved.client_information.issuer).toBe(issuer);
    expect(await provider.tokens()).toBeUndefined();
    await provider.saveTokens({
      access_token: "fresh",
      token_type: "Bearer",
      issuer,
    });
    expect((await provider.tokens())?.issuer).toBe(issuer);
    await provider.invalidateCredentials("tokens");
    expect(await provider.tokens()).toBeUndefined();
    expect(saved.tokens.access_token).toBe("fresh"); // No DB delete/rebind.
  });

  it("throws actionable reauthorization for unbound pre-registration without swallowing it", async () => {
    saved = {
      client_information: {
        client_id: "legacy",
        client_secret: "fixture",
        pre_registered: true,
      },
    };
    const provider = createAuthProvider(uuid, serverUrl);
    await provider.saveDiscoveryState({ authorizationServerUrl: issuer });
    await expect(provider.clientInformation()).rejects.toThrow(
      "OAuth authorization required again",
    );
    expect(api.oauth.upsert.mutate).not.toHaveBeenCalled();
  });

  it("uses real SDK auth to replace an old DCR registration without replaying either old credential", async () => {
    saved = {
      client_information: {
        client_id: "old",
        client_secret: "old-secret",
        registration_source: "sdk",
        issuer: "https://previous.example.com",
      },
      tokens: {
        access_token: "old",
        refresh_token: "old-refresh",
        token_type: "Bearer",
        issuer: "https://previous.example.com",
      },
    };
    const requests: string[] = [];
    const fetchFn: typeof fetch = async (url, init) => {
      const target = String(url);
      requests.push(target);
      expect(String(init?.body ?? "")).not.toContain("old-secret");
      expect(String(init?.body ?? "")).not.toContain("old-refresh");
      const body = target.includes("oauth-protected-resource")
        ? { resource: serverUrl, authorization_servers: [issuer] }
        : target.endsWith("/register")
          ? {
              client_id: "fresh",
              issuer: "https://response-claim.invalid",
              redirect_uris: ["https://metamcp.example.com/fe-oauth/callback"],
            }
          : {
              issuer,
              authorization_endpoint: `${issuer}authorize`,
              token_endpoint: `${issuer}token`,
              registration_endpoint: `${issuer}register`,
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
            };
      return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
      });
    };
    const provider = createAuthProvider(uuid, serverUrl);
    expect(await auth(provider, { serverUrl, fetchFn })).toBe("REDIRECT");
    expect(saved.client_information).toMatchObject({
      client_id: "fresh",
      issuer,
    });
    expect(requests.some((url) => url.endsWith("/token"))).toBe(false);
    expect(
      (globalThis as unknown as { window: { location: { href: string } } })
        .window.location.href,
    ).toContain(`${issuer}authorize`);
  });

  it("does not fall back to sessionStorage when connection lookup throws", async () => {
    vi.mocked(api.mcpServers.get.query).mockRejectedValue(
      new Error("lookup unavailable"),
    );
    await expect(createAuthProvider(uuid, serverUrl).tokens()).rejects.toThrow(
      "lookup unavailable",
    );
  });

  it("keeps authorization pending across reload and SDK invalid-client registration even when ID is unchanged", async () => {
    saved = {
      client_information: {
        client_id: "same-id",
        issuer,
        registration_source: "sdk",
      },
      tokens: {
        access_token: "old",
        refresh_token: "old-refresh",
        token_type: "Bearer",
        issuer,
      },
    };
    const provider = createAuthProvider(uuid, serverUrl);
    await provider.saveDiscoveryState({ authorizationServerUrl: issuer });
    await provider.invalidateCredentials("all");
    await provider.saveDiscoveryState({ authorizationServerUrl: issuer });
    await provider.saveClientInformation({ client_id: "same-id", issuer });
    expect(saved.client_information.oauth_reauthorization_required).toBe(true);
    const reloaded = createAuthProvider(uuid, serverUrl);
    await reloaded.saveDiscoveryState({ authorizationServerUrl: issuer });
    expect(await reloaded.tokens()).toBeUndefined();
    await reloaded.saveTokens({
      access_token: "new",
      token_type: "Bearer",
      issuer,
    });
    expect(saved.client_information.oauth_reauthorization_required).toBe(false);
    expect((await reloaded.tokens())?.access_token).toBe("new");
  });

  it("rejects changed token endpoint before manually injecting access tokens", async () => {
    saved = {
      client_information: {
        client_id: "fixture",
        issuer,
        registration_source: "sdk",
        token_endpoint: `${issuer}old-token`,
      },
      tokens: {
        access_token: "fixture",
        refresh_token: "fixture",
        token_type: "Bearer",
        issuer,
      },
    };
    const provider = createAuthProvider(uuid, serverUrl);
    await provider.saveDiscoveryState({ authorizationServerUrl: issuer });
    await expect(provider.tokens()).rejects.toThrow(
      "OAuth authorization required again",
    );
    expect(api.oauth.upsert.mutate).not.toHaveBeenCalled();
  });

  it("lets real SDK auth refresh only matching credentials and overwrites a response issuer claim", async () => {
    saved = {
      client_information: {
        client_id: "fixture",
        issuer,
        registration_source: "sdk",
        token_endpoint: `${issuer}token`,
      },
      tokens: {
        access_token: "old",
        refresh_token: "same-issuer-refresh",
        token_type: "Bearer",
        issuer,
      },
    };
    let posts = 0;
    const fetchFn: typeof fetch = async (url, init) => {
      const target = String(url);
      const body = target.includes("oauth-protected-resource")
        ? { resource: serverUrl, authorization_servers: [issuer] }
        : target.endsWith("/token")
          ? (posts++,
            expect(String(init?.body)).toContain("same-issuer-refresh"),
            {
              access_token: "fresh",
              token_type: "Bearer",
              issuer: "https://untrusted-response.invalid",
            })
          : {
              issuer,
              authorization_endpoint: `${issuer}authorize`,
              token_endpoint: `${issuer}token`,
              response_types_supported: ["code"],
            };
      return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
      });
    };
    expect(
      await auth(createAuthProvider(uuid, serverUrl), { serverUrl, fetchFn }),
    ).toBe("AUTHORIZED");
    expect(posts).toBe(1);
    expect(saved.tokens).toMatchObject({ access_token: "fresh", issuer });
  });
});
