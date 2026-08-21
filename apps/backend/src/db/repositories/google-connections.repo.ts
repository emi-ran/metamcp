import { and, eq } from "drizzle-orm";

import {
  decryptGoogleToken,
  EncryptedTokenPayload,
  encryptGoogleToken,
} from "@/lib/crypto/google-token-crypto";

import { db } from "../index";
import { googleConnectionsTable } from "../schema";

export interface SaveGoogleTokensInput {
  userId: string;
  connectionId?: string | null;
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
  id?: string;
  isDefault?: boolean;
  email?: string | null;
  googleUserId?: string | null;
  scopes?: string[];
  expiresAt?: Date | null;
  updatedAt?: Date | null;
  revokedAt?: Date | null;
}

export class GoogleConnectionsRepository {
  async listByUserId(
    userId: string,
  ): Promise<(typeof googleConnectionsTable.$inferSelect)[]> {
    return db
      .select()
      .from(googleConnectionsTable)
      .where(eq(googleConnectionsTable.user_id, userId));
  }

  async getByIdForUser(
    userId: string,
    connectionId: string,
  ): Promise<typeof googleConnectionsTable.$inferSelect | null> {
    const result = await db
      .select()
      .from(googleConnectionsTable)
      .where(
        and(
          eq(googleConnectionsTable.user_id, userId),
          eq(googleConnectionsTable.uuid, connectionId),
        ),
      )
      .limit(1);
    return result[0] ?? null;
  }

  async getByUserId(
    userId: string,
  ): Promise<typeof googleConnectionsTable.$inferSelect | null> {
    const defaultResult = await db
      .select()
      .from(googleConnectionsTable)
      .where(
        and(
          eq(googleConnectionsTable.user_id, userId),
          eq(googleConnectionsTable.is_default, true),
        ),
      )
      .limit(1);
    if (defaultResult[0]) return defaultResult[0];
    const result = await db
      .select()
      .from(googleConnectionsTable)
      .where(eq(googleConnectionsTable.user_id, userId))
      .limit(1);
    return result[0] ?? null;
  }

  async getDecryptedTokens(userId: string, connectionId?: string): Promise<{
    connectionId: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    scopes: string[];
    email: string | null;
  } | null> {
    const conn = connectionId
      ? await this.getByIdForUser(userId, connectionId)
      : await this.getByUserId(userId);
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
      connectionId: conn.uuid,
      accessToken,
      refreshToken,
      expiresAt: conn.access_token_expires_at,
      scopes: conn.scopes,
      email: conn.email,
    };
  }

  async getStatus(userId: string): Promise<GoogleConnectionStatus> {
    const conn = await this.getByUserId(userId);
    return conn
      ? {
          connected: !conn.revoked_at,
          id: conn.uuid,
          isDefault: conn.is_default,
          email: conn.email,
          googleUserId: conn.google_user_id,
          scopes: conn.scopes,
          expiresAt: conn.access_token_expires_at,
          updatedAt: conn.updated_at,
          revokedAt: conn.revoked_at,
        }
      : { connected: false };
  }

  async getStatuses(userId: string): Promise<GoogleConnectionStatus[]> {
    const connections = await this.listByUserId(userId);
    return connections.map((conn) => ({
      connected: !conn.revoked_at,
      id: conn.uuid,
      isDefault: conn.is_default,
      email: conn.email,
      googleUserId: conn.google_user_id,
      scopes: conn.scopes,
      expiresAt: conn.access_token_expires_at,
      updatedAt: conn.updated_at,
      revokedAt: conn.revoked_at,
    }));
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
    const existing = input.connectionId
      ? await this.getByIdForUser(input.userId, input.connectionId)
      : input.email
        ? (
            await db
              .select()
              .from(googleConnectionsTable)
              .where(
                and(
                  eq(googleConnectionsTable.user_id, input.userId),
                  eq(googleConnectionsTable.email, input.email),
                ),
              )
              .limit(1)
          )[0] ?? null
        : null;
    if (input.connectionId && !existing) {
      throw new Error("Google connection does not belong to user");
    }
    const hasDefault =
      existing?.is_default ||
      (await db
        .select({ uuid: googleConnectionsTable.uuid })
        .from(googleConnectionsTable)
        .where(
          and(
            eq(googleConnectionsTable.user_id, input.userId),
            eq(googleConnectionsTable.is_default, true),
          ),
        )
        .limit(1)).length > 0;

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
      is_default: existing?.is_default ?? !hasDefault,
      updated_at: new Date(),
    };

    if (existing) {
      await db
        .update(googleConnectionsTable)
        .set(valuesToInsert)
        .where(eq(googleConnectionsTable.uuid, existing.uuid));
    } else {
      await db
        .insert(googleConnectionsTable)
        .values(valuesToInsert)
        .onConflictDoUpdate({
          target: googleConnectionsTable.uuid,
          set: valuesToInsert,
        });
    }
  }

  async deleteByUserId(userId: string): Promise<void> {
    await db
      .delete(googleConnectionsTable)
      .where(eq(googleConnectionsTable.user_id, userId));
  }

  async deleteByIdForUser(userId: string, connectionId?: string): Promise<void> {
    await db
      .delete(googleConnectionsTable)
      .where(
        connectionId
          ? and(
              eq(googleConnectionsTable.user_id, userId),
              eq(googleConnectionsTable.uuid, connectionId),
            )
          : eq(googleConnectionsTable.user_id, userId),
      );
    if (connectionId) {
      const remaining = await this.listByUserId(userId);
      if (remaining.length > 0 && !remaining.some((connection) => connection.is_default)) {
        await this.setDefaultForUser(userId, remaining[0].uuid);
      }
    }
  }

  async setDefaultForUser(userId: string, connectionId: string): Promise<void> {
    const connection = await this.getByIdForUser(userId, connectionId);
    if (!connection) throw new Error("Google connection does not belong to user");
    await db.transaction(async (tx) => {
      await tx
        .update(googleConnectionsTable)
        .set({ is_default: false })
        .where(eq(googleConnectionsTable.user_id, userId));
      await tx
        .update(googleConnectionsTable)
        .set({ is_default: true, updated_at: new Date() })
        .where(eq(googleConnectionsTable.uuid, connectionId));
    });
  }
}

export const googleConnectionsRepository = new GoogleConnectionsRepository();
