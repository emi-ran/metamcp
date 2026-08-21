import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/index", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
  pool: {
    on: vi.fn(),
  },
}));

vi.mock("../db/index", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
  pool: {
    on: vi.fn(),
  },
}));

vi.mock("../db/repositories/config.repo", () => ({
  configRepo: {
    getConfig: vi.fn(),
    setConfig: vi.fn(),
    deleteConfig: vi.fn(),
  },
}));

import {
  type GoogleConfigStore,
  GoogleOAuthAdminConfigService,
  maskSecret,
} from "./google-oauth-admin-config.service";
import {
  decryptSecretString,
  encryptSecretString,
} from "./crypto/google-token-crypto";

describe("googleOAuthAdminConfigService", () => {
  const TEST_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  let mockStore: Map<string, { id: string; value: string; description?: string | null }>;
  let mockRepo: GoogleConfigStore;
  let getConfig: ReturnType<typeof vi.fn<GoogleConfigStore["getConfig"]>>;
  let setConfig: ReturnType<typeof vi.fn<GoogleConfigStore["setConfig"]>>;
  let deleteConfig: ReturnType<typeof vi.fn<GoogleConfigStore["deleteConfig"]>>;
  let service: GoogleOAuthAdminConfigService;

  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    mockStore = new Map();
    getConfig = vi.fn<GoogleConfigStore["getConfig"]>(async (id) => {
        return mockStore.get(id);
      });
    setConfig = vi.fn<GoogleConfigStore["setConfig"]>(async (id, value, description) => {
        mockStore.set(id, { id, value, description });
      });
    deleteConfig = vi.fn<GoogleConfigStore["deleteConfig"]>(async (id) => {
        mockStore.delete(id);
      });
    mockRepo = {
      getConfig,
      setConfig,
      deleteConfig,
    };

    service = new GoogleOAuthAdminConfigService(mockRepo);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("maskSecret", () => {
    it("masks secrets correctly with prefix, suffix and fixed asterisk mask", () => {
      expect(maskSecret("GOCSPX-1234567890abcdef")).toBe("GO************ef");
      expect(maskSecret("abcd")).toBe("****");
      expect(maskSecret("")).toBeNull();
      expect(maskSecret(null)).toBeNull();
      expect(maskSecret(undefined)).toBeNull();
    });
  });

  describe("encryption and storage at rest", () => {
    it("encrypts client secret at rest in config table and does not store plaintext", async () => {
      await service.setConfig({
        clientId: "my-client-id.apps.googleusercontent.com",
        clientSecret: "my-super-secret-key-12345",
      });

      expect(setConfig).toHaveBeenCalledWith(
        "GOOGLE_CLIENT_ID",
        "my-client-id.apps.googleusercontent.com",
        expect.any(String),
      );
      expect(setConfig).toHaveBeenCalledWith(
        "GOOGLE_CLIENT_SECRET",
        expect.stringContaining("encryptedData"),
        expect.any(String),
      );

      const storedClientId = mockStore.get("GOOGLE_CLIENT_ID");
      const storedSecret = mockStore.get("GOOGLE_CLIENT_SECRET");

      expect(storedClientId?.value).toBe("my-client-id.apps.googleusercontent.com");
      expect(storedSecret?.value).not.toBe("my-super-secret-key-12345");
      expect(storedSecret?.value).toContain("encryptedData");

      // Verify decrypts back with master key
      const decrypted = decryptSecretString(storedSecret!.value);
      expect(decrypted).toBe("my-super-secret-key-12345");
    });

    it("returns masked secret in getMaskedConfig without returning plaintext", async () => {
      mockStore.set("GOOGLE_CLIENT_ID", {
        id: "GOOGLE_CLIENT_ID",
        value: "my-client-id.apps.googleusercontent.com",
      });
      mockStore.set("GOOGLE_CLIENT_SECRET", {
        id: "GOOGLE_CLIENT_SECRET",
        value: encryptSecretString("my-super-secret-key-12345"),
      });

      const masked = await service.getMaskedConfig();
      expect(masked.configured).toBe(true);
      expect(masked.clientId).toBe("my-client-id.apps.googleusercontent.com");
      expect(masked.clientSecretMasked).not.toBe("my-super-secret-key-12345");
      expect(masked.clientSecretMasked).toContain("****");
      expect((masked as any).clientSecret).toBeUndefined();
    });

    it("falls back to process.env if DB config is not set", async () => {
      process.env.GOOGLE_CLIENT_ID = "env-client-id";
      process.env.GOOGLE_CLIENT_SECRET = "env-client-secret";

      const creds = await service.getCredentials();
      expect(creds.configured).toBe(true);
      expect(creds.clientId).toBe("env-client-id");
      expect(creds.clientSecret).toBe("env-client-secret");

      const masked = await service.getMaskedConfig();
      expect(masked.configured).toBe(true);
      expect(masked.clientId).toBe("env-client-id");
      expect(masked.clientSecretMasked).toContain("****");
    });

    it("reports unconfigured when credentials are missing", async () => {
      const creds = await service.getCredentials();
      expect(creds.configured).toBe(false);
      expect(creds.clientId).toBeNull();
      expect(creds.clientSecret).toBeNull();

      const masked = await service.getMaskedConfig();
      expect(masked.configured).toBe(false);
      expect(masked.clientId).toBeNull();
      expect(masked.clientSecretMasked).toBeNull();
    });
  });
});
