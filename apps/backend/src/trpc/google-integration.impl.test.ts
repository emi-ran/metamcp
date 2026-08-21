import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  googleIntegrationImplementations,
  maskEmail,
} from "./google-integration.impl";

vi.mock("../db/repositories", () => {
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
          expiresAt: item.expiresAt,
          updatedAt: item.updatedAt,
          revokedAt: item.revokedAt,
        };
      }),
      getStatuses: vi.fn(async (userId: string) => {
        const item = store.get(userId);
        return item
          ? [{
              connected: true,
              id: "00000000-0000-4000-8000-000000000001",
              isDefault: true,
              email: item.email,
              scopes: item.scopes,
              expiresAt: item.expiresAt,
              updatedAt: item.updatedAt,
              revokedAt: item.revokedAt,
            }]
          : [];
      }),
      getByIdForUser: vi.fn(async () => ({ uuid: "connection-1" })),
      setDefaultForUser: vi.fn(async () => undefined),
      upsertConnection: vi.fn(async (input: any) => {
        store.set(input.userId, input);
      }),
      deleteByUserId: vi.fn(async (userId: string) => {
        store.delete(userId);
      }),
      deleteByIdForUser: vi.fn(async (userId: string) => {
        store.delete(userId);
      }),
      getDecryptedTokens: vi.fn(async (userId: string) => {
        const item = store.get(userId);
        if (!item) return null;
        return {
          accessToken: "mock-access-token",
          refreshToken: "mock-refresh-token",
          expiresAt: item.expiresAt,
          scopes: item.scopes,
          email: item.email,
        };
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
        return item;
      }),
    },
    configRepo: {
      getConfig: vi.fn(async () => undefined),
      setConfig: vi.fn(async () => undefined),
      deleteConfig: vi.fn(async () => undefined),
    },
  };
});

vi.mock("../db/repositories/config.repo", () => ({
  configRepo: {
    getConfig: vi.fn(async () => undefined),
    setConfig: vi.fn(async () => undefined),
    deleteConfig: vi.fn(async () => undefined),
  },
}));

describe("googleIntegrationImplementations", () => {
  beforeEach(() => {
    process.env.APP_URL = "http://localhost:12009";
    process.env.GOOGLE_CLIENT_ID = "google-client-id-xyz";
    process.env.GOOGLE_CLIENT_SECRET = "google-client-secret-xyz";
    vi.clearAllMocks();
  });

  describe("maskEmail", () => {
    it("masks email correctly for normal length emails", () => {
      expect(maskEmail("user@example.com")).toBe("us**@example.com");
      expect(maskEmail("alexander@domain.org")).toBe("al*******@domain.org");
    });

    it("masks email for short local parts", () => {
      expect(maskEmail("ab@example.com")).toBe("a*@example.com");
      expect(maskEmail("a@example.com")).toBe("a*@example.com");
    });

    it("returns null for invalid or nullish emails", () => {
      expect(maskEmail(null)).toBeNull();
      expect(maskEmail(undefined)).toBeNull();
      expect(maskEmail("invalid-email")).toBeNull();
    });
  });

  describe("getStatus", () => {
    it("returns disconnected status when user has no connection", async () => {
      const status = await googleIntegrationImplementations.getStatus("user-1");
      expect(status.connected).toBe(false);
      expect(status.maskedEmail).toBeNull();
    });

    it("returns masked email and granted scopes when connected without exposing raw email or googleUserId", async () => {
      const { googleConnectionsRepository } = await import("../db/repositories");
      (googleConnectionsRepository.getStatus as any).mockResolvedValueOnce({
        connected: true,
        email: "alice@company.com",
        googleUserId: "google-raw-sub-12345",
        scopes: [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/gmail.readonly",
        ],
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });

      const status = await googleIntegrationImplementations.getStatus("user-1");
      expect(status.connected).toBe(true);
      expect(status.maskedEmail).toBe("al***@company.com");
      expect(status).not.toHaveProperty("email");
      expect(status).not.toHaveProperty("googleUserId");
      expect((status as any).email).toBeUndefined();
      expect((status as any).googleUserId).toBeUndefined();
      expect(status.scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    });
  });

  describe("getConnectUrl", () => {
    it("generates safe oauth connect url with PKCE state", async () => {
      const res = await googleIntegrationImplementations.getConnectUrl("user-1");
      expect(res.url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
      expect(res.url).toContain("client_id=google-client-id-xyz");
      expect(res.url).toContain("code_challenge_method=S256");
      expect(res.url).toContain("gmail.readonly");
    });
  });

  it("lists account-specific status without exposing raw identity", async () => {
    const { googleConnectionsRepository } = await import("../db/repositories");
    (googleConnectionsRepository.getStatuses as any).mockResolvedValueOnce([
      {
        connected: true,
        id: "00000000-0000-4000-8000-000000000001",
        isDefault: true,
        email: "alice@company.com",
        scopes: ["gmail.readonly"],
      },
    ]);

    const status = await googleIntegrationImplementations.getStatus("user-1");
    expect(status.defaultConnectionId).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(status.connections[0]).toMatchObject({
      id: "00000000-0000-4000-8000-000000000001",
      maskedEmail: "al***@company.com",
      isDefault: true,
    });
    expect(status.connections[0]).not.toHaveProperty("email");
  });

  describe("reconnect", () => {
    it("generates url requesting explicit least-privilege scopes with forced consent", async () => {
      const res = await googleIntegrationImplementations.reconnect(
        {
          workspaceScopes: ["calendar.readonly", "drive.file"],
        },
        "user-1",
      );
      expect(res.url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
      expect(res.url).toContain("prompt=consent+select_account");
      expect(res.url).toContain("calendar.readonly");
      expect(res.url).toContain("drive.file");
    });

    it("binds reconnect state to requested connection", async () => {
      const { googleOAuthStateRepository } = await import("../db/repositories");
      await googleIntegrationImplementations.reconnect(
        {
          connectionId: "00000000-0000-4000-8000-000000000001",
          workspaceScopes: [],
        },
        "user-1",
      );
      expect(googleOAuthStateRepository.createState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          intent: "reconnect",
          target_connection_id: "00000000-0000-4000-8000-000000000001",
        }),
      );
    });
  });

  describe("disconnect", () => {
    it("revokes token and deletes connection repository entry", async () => {
      const { googleConnectionsRepository } = await import("../db/repositories");
      const res = await googleIntegrationImplementations.disconnect("user-1");
      expect(res.success).toBe(true);
      expect(googleConnectionsRepository.deleteByUserId).toHaveBeenCalledWith("user-1");
    });
  });
});
