import { configRepo } from "../db/repositories/config.repo";
import {
  decryptSecretString,
  encryptSecretString,
} from "./crypto/google-token-crypto";
import logger from "../utils/logger";

const GOOGLE_CLIENT_ID_CONFIG_KEY = "GOOGLE_CLIENT_ID";
const GOOGLE_CLIENT_SECRET_CONFIG_KEY = "GOOGLE_CLIENT_SECRET";

export interface GoogleOAuthConfigResult {
  clientId: string | null;
  clientSecret: string | null;
  configured: boolean;
}

export interface GoogleConfigStore {
  getConfig(key: string): Promise<{ id: string; value: string; description?: string | null } | undefined>;
  setConfig(key: string, value: string, description?: string): Promise<void>;
  deleteConfig(key: string): Promise<void>;
}

export function maskSecret(secret?: string | null): string | null {
  if (!secret || typeof secret !== "string") return null;
  if (secret.length <= 4) return "****";
  const start = secret.slice(0, 2);
  const end = secret.slice(-2);
  return `${start}${"*".repeat(Math.min(12, Math.max(4, secret.length - 4)))}${end}`;
}

export class GoogleOAuthAdminConfigService {
  private repo?: GoogleConfigStore;

  constructor(repo?: GoogleConfigStore) {
    this.repo = repo;
  }

  public setRepository(repo: GoogleConfigStore): void {
    this.repo = repo;
  }

  private getStore(): GoogleConfigStore {
    return this.repo ?? configRepo;
  }

  async getCredentials(): Promise<GoogleOAuthConfigResult> {
    const store = this.getStore();
    const dbClientId = await store.getConfig(
      GOOGLE_CLIENT_ID_CONFIG_KEY,
    );
    const dbEncryptedSecret = await store.getConfig(
      GOOGLE_CLIENT_SECRET_CONFIG_KEY,
    );

    let clientId: string | null = null;
    let clientSecret: string | null = null;

    if (dbClientId?.value) {
      clientId = dbClientId.value;
    } else if (process.env.GOOGLE_CLIENT_ID) {
      clientId = process.env.GOOGLE_CLIENT_ID;
    }

    if (dbEncryptedSecret?.value) {
      try {
        clientSecret = decryptSecretString(dbEncryptedSecret.value);
      } catch (err) {
        logger.error("Failed to decrypt Google client secret from config table", err);
      }
    } else if (process.env.GOOGLE_CLIENT_SECRET) {
      clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    }

    const configured = Boolean(clientId && clientSecret);
    return {
      clientId,
      clientSecret,
      configured,
    };
  }

  async getMaskedConfig(): Promise<{
    configured: boolean;
    clientId: string | null;
    clientSecretMasked: string | null;
  }> {
    const { clientId, clientSecret, configured } = await this.getCredentials();
    return {
      configured,
      clientId: clientId ?? null,
      clientSecretMasked: maskSecret(clientSecret),
    };
  }

  async setConfig(input: { clientId: string; clientSecret: string }): Promise<void> {
    const trimmedId = input.clientId.trim();
    const trimmedSecret = input.clientSecret.trim();

    if (!trimmedId) {
      throw new Error("Client ID cannot be empty");
    }
    if (!trimmedSecret) {
      throw new Error("Client Secret cannot be empty");
    }

    const store = this.getStore();
    // Save Client ID unencrypted in config table
    await store.setConfig(
      GOOGLE_CLIENT_ID_CONFIG_KEY,
      trimmedId,
      "Google OAuth 2.0 Client ID",
    );

    // Save Client Secret encrypted in config table using master token encryption key
    const encryptedSecret = encryptSecretString(trimmedSecret);
    await store.setConfig(
      GOOGLE_CLIENT_SECRET_CONFIG_KEY,
      encryptedSecret,
      "Encrypted Google OAuth 2.0 Client Secret",
    );
  }

  async deleteConfig(): Promise<void> {
    const store = this.getStore();
    await store.deleteConfig(GOOGLE_CLIENT_ID_CONFIG_KEY);
    await store.deleteConfig(GOOGLE_CLIENT_SECRET_CONFIG_KEY);
  }
}


export const googleOAuthAdminConfigService = new GoogleOAuthAdminConfigService();
