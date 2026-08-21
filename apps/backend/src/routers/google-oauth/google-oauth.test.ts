import express from "express";
import http from "http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  generateOAuthState,
  generatePkcePair,
} from "./google-oauth-service";
import googleOAuthRouter from "./index";

const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

vi.mock("@/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock("@/db/repositories", () => {
  const store = new Map<string, any>();
  const states = new Map<string, any>();

  return {
    googleConnectionsRepository: {
      getStatus: vi.fn(async (userId: string) => {
        const item = store.get(userId);
        if (!item) return { connected: false };
        return {
          connected: true,
          email: item.email,
          googleUserId: item.googleUserId,
          scopes: item.scopes,
        };
      }),
      upsertConnection: vi.fn(async (input: any) => {
        store.set(input.userId, input);
      }),
      deleteByUserId: vi.fn(async (userId: string) => {
        store.delete(userId);
      }),
      getDecryptedTokens: vi.fn(async () => null),
    },
    googleOAuthStateRepository: {
      createState: vi.fn(async (input: any) => {
        states.set(input.state, input);
      }),
      consumeState: vi.fn(async (state: string) => {
        const item = states.get(state);
        if (!item) return null;
        states.delete(state);
        if (new Date(item.expires_at).getTime() < Date.now()) return null;
        return item;
      }),
    },
  };
});

describe("Google OAuth Core & Routes", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(googleOAuthRouter);

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

  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    process.env.APP_URL = "http://localhost:12009";
    process.env.GOOGLE_CLIENT_ID = "google-client-id-123";
    process.env.GOOGLE_CLIENT_SECRET = "google-client-secret-456";
    vi.clearAllMocks();
  });

  it("generates valid PKCE pair and OAuth state", () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    expect(codeVerifier).toBeTruthy();
    expect(codeChallenge).toBeTruthy();
    expect(codeChallenge).not.toBe(codeVerifier);

    const state = generateOAuthState();
    expect(state).toHaveLength(43); // 32 bytes base64url length
  });

  it("builds auth URL with offline access and PKCE parameters", () => {
    const authUrl = buildGoogleAuthUrl({
      clientId: "my-client-id",
      redirectUri: "http://localhost:12009/api/oauth/google/callback",
      state: "test-state",
      codeChallenge: "test-challenge",
    });

    const parsed = new URL(authUrl);
    expect(parsed.origin).toBe("https://accounts.google.com");
    expect(parsed.searchParams.get("client_id")).toBe("my-client-id");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("code_challenge")).toBe("test-challenge");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/gmail.readonly",
    );
    expect(parsed.searchParams.get("scope")).not.toContain(
      "https://www.googleapis.com/auth/gmail.modify",
    );
    expect(parsed.searchParams.get("scope")).not.toContain(
      "https://www.googleapis.com/auth/calendar",
    );
  });

  it("supports exact least-privilege scope selection names without escalation", () => {
    const readAuthUrl = buildGoogleAuthUrl({
      clientId: "my-client-id",
      redirectUri: "http://localhost:12009/integrations/google/callback",
      state: "test-state",
      codeChallenge: "test-challenge",
      workspaceScopes: [
        "gmail.readonly",
        "calendar.readonly",
        "drive.readonly",
        "documents.readonly",
        "spreadsheets.readonly",
      ],
    });
    const readScopes = new URL(readAuthUrl).searchParams
      .get("scope")
      ?.split(" ");
    expect(readScopes).toEqual(
      expect.arrayContaining([
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ]),
    );
    expect(readScopes).not.toContain("https://www.googleapis.com/auth/drive");
    expect(readScopes).not.toContain(
      "https://www.googleapis.com/auth/calendar",
    );

    expect(() =>
      buildGoogleAuthUrl({
        clientId: "my-client-id",
        redirectUri: "http://localhost:12009/integrations/google/callback",
        state: "test-state",
        codeChallenge: "test-challenge",
        workspaceScopes: ["calendar.events"],
      }),
    ).toThrow("forced re-consent");

    const authUrl = buildGoogleAuthUrl({
      clientId: "my-client-id",
      redirectUri: "http://localhost:12009/integrations/google/callback",
      state: "test-state",
      codeChallenge: "test-challenge",
      workspaceScopes: [
        "calendar.events",
        "drive.file",
        "documents",
        "spreadsheets",
      ],
      forcePrompt: true,
    });
    expect(new URL(authUrl).searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/calendar.events",
    );
    expect(new URL(authUrl).searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/drive.file",
    );
    expect(new URL(authUrl).searchParams.get("scope")).not.toContain(
      "https://www.googleapis.com/auth/drive ",
    );
  });

  it("returns 401 when accessing status without authentication", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/integrations/google/status`);
    expect(res.status).toBe(401);
  });

  it("returns status object when user is authenticated", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: "user-123", email: "user@test.com" },
    });

    const res = await fetch(`${baseUrl}/integrations/google/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ connected: false });
  });

  it("creates PKCE state and returns Google URL on /connect", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: "user-123", email: "user@test.com" },
    });

    const res = await fetch(`${baseUrl}/integrations/google/connect?json=true`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(body.url).toContain("client_id=google-client-id-123");
  });

  it("rejects callback with invalid or expired state", async () => {
    const res = await fetch(
      `${baseUrl}/integrations/google/callback?code=some-code&state=invalid-state`,
    );
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Invalid, expired, or already used OAuth state");
  });

  it("disconnects active user connection on required POST route", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: "user-123", email: "user@test.com" },
    });

    const res = await fetch(`${baseUrl}/integrations/google/disconnect`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });

  it("deletes local credentials when Google revoke fails", async () => {
    const { auth } = await import("@/auth");
    const { googleConnectionsRepository } = await import("@/db/repositories");
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: "user-123", email: "user@test.com" },
    });
    (googleConnectionsRepository.getDecryptedTokens as any).mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
    const realFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        if (String(input) === "https://oauth2.googleapis.com/revoke") {
          throw new Error("network unavailable");
        }
        return realFetch(input, init);
      });

    const res = await fetch(`${baseUrl}/integrations/google/disconnect`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(googleConnectionsRepository.deleteByUserId).toHaveBeenCalledWith(
      "user-123",
    );
    fetchSpy.mockRestore();
  });

  it("starts forced re-consent only through POST /integrations/google/reconnect", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: "user-123", email: "user@test.com" },
    });

    const res = await fetch(`${baseUrl}/integrations/google/reconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceScopes: ["calendar.events"] }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    const url = new URL(location ?? "");
    expect(url.searchParams.get("prompt")).toContain("consent");
    expect(url.searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/calendar.events",
    );
  });

  it("validates reconnect scope names and accepts every contract scope", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: "user-123", email: "user@test.com" },
    });

    const invalid = await fetch(`${baseUrl}/integrations/google/reconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceScopes: ["docs.write"] }),
      redirect: "manual",
    });
    expect(invalid.status).toBe(400);

    const valid = await fetch(
      `${baseUrl}/integrations/google/reconnect?json=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceScopes: [
            "gmail.readonly",
            "calendar.readonly",
            "calendar.events",
            "drive.readonly",
            "drive.file",
            "documents.readonly",
            "documents",
            "spreadsheets.readonly",
            "spreadsheets",
          ],
        }),
      },
    );
    expect(valid.status).toBe(200);
    const body = (await valid.json()) as { url: string };
    const selectedScopes = new URL(body.url).searchParams
      .get("scope")
      ?.split(" ");
    expect(selectedScopes).toEqual(
      expect.arrayContaining([
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/spreadsheets",
      ]),
    );
  });

  it("does not include token exchange error content in thrown errors", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"error_description":"token-value-must-not-leak"}', {
        status: 400,
      }),
    );

    await expect(
      exchangeGoogleCode({
        code: "authorization-code",
        codeVerifier: "code-verifier",
        redirectUri: "http://localhost/integrations/google/callback",
        clientId: "client-id",
        clientSecret: "client-secret",
      }),
    ).rejects.toThrow("Google token exchange failed with status 400");
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });
});
