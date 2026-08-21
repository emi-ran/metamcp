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
  });

  it("returns 401 when accessing status without authentication", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/api/oauth/google/status`);
    expect(res.status).toBe(401);
  });

  it("returns status object when user is authenticated", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: "user-123", email: "user@test.com" },
    });

    const res = await fetch(`${baseUrl}/api/oauth/google/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ connected: false });
  });

  it("creates PKCE state and returns Google URL on /connect", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: "user-123", email: "user@test.com" },
    });

    const res = await fetch(`${baseUrl}/api/oauth/google/connect?json=true`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(body.url).toContain("client_id=google-client-id-123");
  });

  it("rejects callback with invalid or expired state", async () => {
    const res = await fetch(
      `${baseUrl}/api/oauth/google/callback?code=some-code&state=invalid-state`,
    );
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Invalid, expired, or already used OAuth state");
  });

  it("disconnects active user connection on POST /disconnect", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValue({
      user: { id: "user-123", email: "user@test.com" },
    });

    const res = await fetch(`${baseUrl}/api/oauth/google/disconnect`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });
});
