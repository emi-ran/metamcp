import { eq } from "drizzle-orm";

import {
  decryptGoogleToken,
  EncryptedTokenPayload,
  encryptGoogleToken,
} from "@/lib/crypto/google-token-crypto";

import { db } from "../index";
import { googleConnectionsTable } from "../schema";

export interface SaveGoogleTokensInput {
  userId: string;
  googleUserId?: string | null;
  email?: string | null;
  scopes: string[];
  accessToken: string;
  refreshToken?: string | null;
  expiresInSeconds?: number | null;
  keyVersion?: number;
}

export interface GoogleConnectionStatus {
  connected: boolean;
  email?: string | null;
  googleUserId?: string | null;
  scopes?: string[];
  expiresAt?: Date | null;
  updatedAt?: Date | null;
  revokedAt?: Date | null;
}

export class GoogleConnectionsRepository {
  async getByUserId(
    userId: string,
  ): Promise<typeof googleConnectionsTable.$inferSelect | null> {
    const result = await db
      .select()
      .from(googleConnectionsTable)
      .where(eq(googleConnectionsTable.user_id, userId))
      .limit(1);

    return result[0] || null;
  }

  async getDecryptedTokens(userId: string): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    scopes: string[];
    email: string | null;
  } | null> {
    const conn = await this.getByUserId(userId);
    if (!conn || conn.revoked_at) return null;

    const accessToken = decryptGoogleToken({
      encryptedData: conn.encrypted_access_token,
      iv: conn.access_token_iv,
      authTag: conn.access_token_auth_tag,
      keyVersion: conn.key_version,
    });

    let refreshToken: string | null = null;
    if (
      conn.encrypted_refresh_token &&
      conn.refresh_token_iv &&
      conn.refresh_token_auth_tag
    ) {
      refreshToken = decryptGoogleToken({
        encryptedData: conn.encrypted_refresh_token,
        iv: conn.refresh_token_iv,
        authTag: conn.refresh_token_auth_tag,
        keyVersion: conn.key_version,
      });
    }

    return {
      accessToken,
      refreshToken,
      expiresAt: conn.access_token_expires_at,
      scopes: conn.scopes,
      email: conn.email,
    };
  }

  async getStatus(userId: string): Promise<GoogleConnectionStatus> {
    const conn = await this.getByUserId(userId);
    if (!conn) {
      return { connected: false };
    }

    if (conn.revoked_at) {
      return { connected: false, revokedAt: conn.revoked_at };
    }

    return {
      connected: true,
      email: conn.email,
      googleUserId: conn.google_user_id,
      scopes: conn.scopes,
      expiresAt: conn.access_token_expires_at,
      updatedAt: conn.updated_at,
      revokedAt: conn.revoked_at,
    };
  }

  async upsertConnection(input: SaveGoogleTokensInput): Promise<void> {
    const keyVersion = input.keyVersion;
    const encAccess = encryptGoogleToken(input.accessToken, { keyVersion });

    let encRefresh: EncryptedTokenPayload | null = null;
    if (input.refreshToken) {
      encRefresh = encryptGoogleToken(input.refreshToken, { keyVersion });
    }

    const expiresAt = input.expiresInSeconds
      ? new Date(Date.now() + input.expiresInSeconds * 1000)
      : null;

    // Check existing to retain old refresh token if not returned on re-auth
    const existing = await this.getByUserId(input.userId);

    const valuesToInsert = {
      user_id: input.userId,
      google_user_id: input.googleUserId ?? existing?.google_user_id ?? null,
      email: input.email ?? existing?.email ?? null,
      scopes: input.scopes,
      encrypted_access_token: encAccess.encryptedData,
      access_token_iv: encAccess.iv,
      access_token_auth_tag: encAccess.authTag,
      encrypted_refresh_token:
        encRefresh?.encryptedData ?? existing?.encrypted_refresh_token ?? null,
      refresh_token_iv: encRefresh?.iv ?? existing?.refresh_token_iv ?? null,
      refresh_token_auth_tag:
        encRefresh?.authTag ?? existing?.refresh_token_auth_tag ?? null,
      key_version: encAccess.keyVersion,
      access_token_expires_at: expiresAt,
      revoked_at: null,
      updated_at: new Date(),
    };

    await db
      .insert(googleConnectionsTable)
      .values(valuesToInsert)
      .onConflictDoUpdate({
        target: googleConnectionsTable.user_id,
        set: valuesToInsert,
      });
  }

  async deleteByUserId(userId: string): Promise<void> {
    await db
      .delete(googleConnectionsTable)
      .where(eq(googleConnectionsTable.user_id, userId));
  }
}

export const googleConnectionsRepository = new GoogleConnectionsRepository();
