import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Google Connections & OAuth State Repositories", () => {
  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = TEST_KEY;
  });

  describe("GoogleOAuthStateRepository", () => {
    it("creates, consumes (one-time), and checks expiry", async () => {
      const stateMap = new Map<string, any>();
      const mockDb = {
        insert: () => ({
          values: async (data: any) => {
            stateMap.set(data.state, data);
          },
        }),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                const item = stateMap.get("test-state");
                return item ? [item] : [];
              },
            }),
          }),
        }),
        delete: () => ({
          where: async () => {
            stateMap.delete("test-state");
          },
        }),
      };

      vi.doMock("../../index", () => ({ db: mockDb }));
      const { GoogleOAuthStateRepository } =
        await import("../google-oauth-state.repo");
      const repo = new GoogleOAuthStateRepository();

      await repo.createState({
        state: "test-state",
        user_id: "user-1",
        code_verifier: "verifier-1",
        redirect_uri: "http://localhost/callback",
        expires_at: new Date(Date.now() + 60000),
      });

      expect(stateMap.has("test-state")).toBe(true);

      const consumed = await repo.consumeState("test-state");
      expect(consumed?.code_verifier).toBe("verifier-1");
      expect(stateMap.has("test-state")).toBe(false); // One-time use: deleted
    });
  });

  describe("GoogleConnectionsRepository", () => {
    it("encrypts tokens upon upsert and decrypts correctly without storing plaintext", async () => {
      let storedRecord: any = null;

      const mockDb = {
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: async ({ set }: any) => {
              storedRecord = { ...set };
            },
          }),
        }),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => (storedRecord ? [storedRecord] : []),
            }),
          }),
        }),
        delete: () => ({
          where: async () => {
            storedRecord = null;
          },
        }),
      };

      vi.doMock("../../index", () => ({ db: mockDb }));
      const { GoogleConnectionsRepository } =
        await import("../google-connections.repo");
      const repo = new GoogleConnectionsRepository();

      const rawAccessToken = "ya29.sample-google-access-token";
      const rawRefreshToken = "1//sample-google-refresh-token";

      await repo.upsertConnection({
        userId: "user-42",
        googleUserId: "g-42",
        email: "test@gmail.com",
        scopes: ["openid", "email"],
        accessToken: rawAccessToken,
        refreshToken: rawRefreshToken,
        expiresInSeconds: 3600,
        keyVersion: 1,
      });

      // Stored record must NOT contain raw tokens in plaintext
      expect(storedRecord.encrypted_access_token).not.toBe(rawAccessToken);
      expect(storedRecord.encrypted_refresh_token).not.toBe(rawRefreshToken);
      expect(storedRecord.access_token_iv).toBeDefined();
      expect(storedRecord.access_token_auth_tag).toBeDefined();
      expect(storedRecord.key_version).toBe(1);

      // Decryption retrieves original plaintexts
      const decrypted = await repo.getDecryptedTokens("user-42");
      expect(decrypted).not.toBeNull();
      expect(decrypted?.accessToken).toBe(rawAccessToken);
      expect(decrypted?.refreshToken).toBe(rawRefreshToken);
      expect(decrypted?.email).toBe("test@gmail.com");

      // Status check does not leak tokens
      const status = await repo.getStatus("user-42");
      expect(status.connected).toBe(true);
      expect(status.email).toBe("test@gmail.com");
      expect((status as any).accessToken).toBeUndefined();
      expect((status as any).encrypted_access_token).toBeUndefined();
    });
  });
});
