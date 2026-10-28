import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { OAuthReauthorizationRequiredError } from "@repo/zod-types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { boundOAuthContext } from "./issuer-binding";
import { refreshAccessToken } from "./token-exchange";

const issuer = "https://auth.example.com/";
const client = { client_id: "fixture", client_secret: "fixture-only", issuer };
const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });

describe("custom OAuth grant issuer binding", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([undefined, "https://other.example.com/"])(
    "blocks legacy/mismatched tokens (%s) before fetch",
    async (stamp) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await expect(
        boundOAuthContext("https://resource.example.com/mcp", client, {
          issuer: stamp,
        }),
      ).rejects.toBeInstanceOf(OAuthReauthorizationRequiredError);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("blocks an unbound registration even when tokens claim the selected issuer", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      boundOAuthContext(
        "https://resource.example.com/mcp",
        { client_id: "legacy" },
        { issuer },
      ),
    ).rejects.toBeInstanceOf(OAuthReauthorizationRequiredError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not rebind saved credentials to a newly advertised server", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        expect(init?.method ?? "GET").toBe("GET");
        expect(init?.body).toBeUndefined();
        return String(url).includes("oauth-protected-resource")
          ? json({
              resource: "https://resource.example.com/mcp",
              authorization_servers: ["https://other.example.com/"],
            })
          : new Response(null, { status: 404 });
      });
    await expect(
      boundOAuthContext("https://resource.example.com/mcp", client, { issuer }),
    ).rejects.toBeInstanceOf(OAuthReauthorizationRequiredError);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("matches discovery's URL, not the metadata issuer echo", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).includes("oauth-protected-resource")
        ? json({
            resource: "https://resource.example.com/mcp",
            authorization_servers: [issuer],
          })
        : json({
            issuer: "https://echo-not-used.example.com/",
            authorization_endpoint: `${issuer}authorize`,
            token_endpoint: `${issuer}token`,
            response_types_supported: ["code"],
          }),
    );
    expect(
      await boundOAuthContext("https://resource.example.com/mcp", client, {
        issuer,
      }),
    ).toMatchObject({ issuer, tokenEndpoint: `${issuer}token` });
  });

  it("rejects a changed token endpoint under the same issuer", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(null, { status: 404 }),
    );
    await expect(
      boundOAuthContext(
        issuer,
        { ...client, token_endpoint: `${issuer}old-token` },
        { issuer },
      ),
    ).rejects.toBeInstanceOf(OAuthReauthorizationRequiredError);
  });

  it("does not follow redirects on a credential-bearing token POST", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(init?.redirect).toBe("error");
      return json({ access_token: "fixture", token_type: "Bearer" });
    });
    await refreshAccessToken({
      tokenEndpoint: `${issuer}token`,
      refreshToken: "fixture",
      clientId: "fixture",
      authMethod: "none",
    });
  });

  it("refuses a persisted pending registration before refresh discovery or credential POST", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      boundOAuthContext(
        issuer,
        {
          ...client,
          oauth_reauthorization_required: true,
        },
        { issuer },
      ),
    ).rejects.toBeInstanceOf(OAuthReauthorizationRequiredError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not replay a secret or refresh body to an HTTP redirect target", async () => {
    let targetRequests = 0;
    let sourceRequests = 0;
    const target = createServer((_req, res) => {
      targetRequests++;
      res.end("{}");
    });
    const source = createServer((req, res) => {
      sourceRequests++;
      req.resume();
      res.writeHead(307, {
        Location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/token`,
      });
      res.end();
    });
    await new Promise<void>((resolve) =>
      target.listen(0, "127.0.0.1", resolve),
    );
    await new Promise<void>((resolve) =>
      source.listen(0, "127.0.0.1", resolve),
    );
    try {
      await expect(
        refreshAccessToken({
          tokenEndpoint: `http://127.0.0.1:${(source.address() as AddressInfo).port}/token`,
          refreshToken: "synthetic-refresh",
          clientId: "synthetic-client",
          clientSecret: "synthetic-secret",
          authMethod: "client_secret_post",
        }),
      ).rejects.toThrow();
      expect(sourceRequests).toBe(1);
      expect(targetRequests).toBe(0);
    } finally {
      source.closeAllConnections();
      target.closeAllConnections();
      await new Promise<void>((resolve) => source.close(() => resolve()));
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });
});
