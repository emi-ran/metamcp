import express from "express";
import http from "http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import metadataRouter from "./metadata";
import registrationRouter from "./registration";
import tokenRouter from "./token";

const mockClients = new Map<string, any>();
const mockAuthCodes = new Map<string, any>();
const mockAccessTokens = new Map<string, any>();

vi.mock("@/utils/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../db/repositories", () => ({
  oauthRepository: {
    upsertClient: vi.fn(async (client: any) => {
      mockClients.set(client.client_id, client);
    }),
    getClient: vi.fn(async (clientId: string) => {
      return mockClients.get(clientId) || null;
    }),
    setAuthCode: vi.fn(async (code: string, data: any) => {
      mockAuthCodes.set(code, data);
    }),
    getAuthCode: vi.fn(async (code: string) => {
      const data = mockAuthCodes.get(code);
      if (!data) return null;
      return {
        ...data,
        expires_at: new Date(data.expires_at),
      };
    }),
    deleteAuthCode: vi.fn(async (code: string) => {
      mockAuthCodes.delete(code);
    }),
    setAccessToken: vi.fn(async (token: string, data: any) => {
      mockAccessTokens.set(token, data);
    }),
    getAccessToken: vi.fn(async (token: string) => {
      const data = mockAccessTokens.get(token);
      if (!data) return null;
      return {
        ...data,
        expires_at: new Date(data.expires_at),
        created_at: new Date(),
      };
    }),
    deleteAccessToken: vi.fn(async (token: string) => {
      mockAccessTokens.delete(token);
    }),
    getByRefreshToken: vi.fn(async (refreshToken: string) => {
      for (const [accessToken, data] of mockAccessTokens.entries()) {
        if (data.refresh_token === refreshToken) {
          return {
            ...data,
            access_token: accessToken,
            expires_at: new Date(data.expires_at),
            refresh_token_expires_at: new Date(data.refresh_token_expires_at),
            created_at: new Date(),
          };
        }
      }
      return null;
    }),
  },
}));

describe("OAuth Contracts (Discovery, Dynamic Registration, Token Exchange)", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(metadataRouter);
    app.use(registrationRouter);
    app.use(tokenRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves OAuth protected resource discovery metadata", async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body).toHaveProperty("resource");
    expect(body).toHaveProperty("authorization_servers");
    expect(Array.isArray(body.authorization_servers)).toBe(true);
    expect(body.scopes_supported).toContain("admin");
    expect(body.bearer_methods_supported).toContain("header");
  });

  it("serves OAuth authorization server discovery metadata", async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body).toHaveProperty("issuer");
    expect(body).toHaveProperty("authorization_endpoint");
    expect(body).toHaveProperty("token_endpoint");
    expect(body).toHaveProperty("registration_endpoint");
    expect(body.response_types_supported).toContain("code");
    expect(body.grant_types_supported).toContain("authorization_code");
    expect(body.code_challenge_methods_supported).toContain("S256");
  });

  it("registers a dynamic client and enforces valid redirect URIs and defaults", async () => {
    const registerPayload = {
      client_name: "ChatGPT MCP Client",
      redirect_uris: ["https://chatgpt.com/api/aip/v1/oauth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };

    const res = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registerPayload),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;

    expect(body.client_id).toBeDefined();
    expect(body.client_name).toBe("ChatGPT MCP Client");
    expect(body.redirect_uris).toEqual([
      "https://chatgpt.com/api/aip/v1/oauth/callback",
    ]);
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(mockClients.has(body.client_id)).toBe(true);
  });

  it("exchanges authorization code with PKCE verification for access token", async () => {
    const clientId = "chatgpt-client-id";
    const redirectUri = "https://chatgpt.com/api/aip/v1/oauth/callback";
    mockClients.set(clientId, {
      client_id: clientId,
      client_secret: null,
      client_name: "ChatGPT MCP Client",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "admin",
    });

    const codeVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const crypto = await import("crypto");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    const code = "mcp_code_test_123";
    mockAuthCodes.set(code, {
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "admin",
      user_id: "test-user-1",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      expires_at: Date.now() + 600000,
    });

    const res = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.access_token).toBeDefined();
    expect(body.access_token).toMatch(/^mcp_token_/);
    expect(body.token_type).toBe("Bearer");
    expect(body.refresh_token).toBeDefined();
    expect(body.refresh_token).toMatch(/^mcp_refresh_/);
    expect(mockAuthCodes.has(code)).toBe(false);
  });

  it("rotates refresh token when refresh_token grant is used", async () => {
    const clientId = "chatgpt-client-id";
    const accessToken = "mcp_token_initial_123";
    const refreshToken = "mcp_refresh_initial_123";

    mockAccessTokens.set(accessToken, {
      client_id: clientId,
      user_id: "test-user-1",
      scope: "admin",
      refresh_token: refreshToken,
      expires_at: Date.now() + 3600000,
      refresh_token_expires_at: Date.now() + 7 * 86400000,
    });

    const res = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.access_token).toBeDefined();
    expect(body.access_token).not.toBe(accessToken);
    expect(body.refresh_token).toBeDefined();
    expect(body.refresh_token).not.toBe(refreshToken);
    expect(mockAccessTokens.has(accessToken)).toBe(false);
  });
});
