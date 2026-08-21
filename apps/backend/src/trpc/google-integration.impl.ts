import {
  GoogleConnectUrlResponse,
  GoogleConnectionStatusResponse,
  GoogleDisconnectResponse,
  GoogleDisconnectRequest,
  GoogleConnectRequest,
  GoogleReconnectRequest,
  GoogleSetDefaultRequest,
} from "@repo/zod-types";

import {
  googleConnectionsRepository,
  googleOAuthStateRepository,
} from "../db/repositories";
import {
  buildGoogleAuthUrl,
  generateOAuthState,
  generatePkcePair,
  getPublicCallbackUrl,
  type GoogleWorkspaceScope,
  revokeGoogleToken,
} from "../routers/google-oauth/google-oauth-service";
import logger from "../utils/logger";

export function maskEmail(email?: string | null): string | null {
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return null;
  }
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) {
    return null;
  }
  if (localPart.length <= 2) {
    return `${localPart[0]}*@${domain}`;
  }
  const maskedLocal = `${localPart.slice(0, 2)}${"*".repeat(Math.max(1, localPart.length - 2))}`;
  return `${maskedLocal}@${domain}`;
}

async function createAuthUrl(
  userId: string,
  options: { forcePrompt: boolean; workspaceScopes: GoogleWorkspaceScope[] },
  targetConnectionId?: string,
): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("Google OAuth client ID not configured");
  }

  const redirectUri = getPublicCallbackUrl();
  if (targetConnectionId) {
    const target = await googleConnectionsRepository.getByIdForUser(
      userId,
      targetConnectionId,
    );
    if (!target) throw new Error("Google connection does not belong to user");
  }
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const state = generateOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await googleOAuthStateRepository.createState({
    state,
    user_id: userId,
    intent: options.forcePrompt ? "reconnect" : "connect",
    target_connection_id: targetConnectionId ?? null,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    expires_at: expiresAt,
  });

  return buildGoogleAuthUrl({
    clientId,
    redirectUri,
    state,
    codeChallenge,
    forcePrompt: options.forcePrompt,
    workspaceScopes: options.workspaceScopes,
  });
}

export const googleIntegrationImplementations = {
  getStatus: async (userId: string): Promise<GoogleConnectionStatusResponse> => {
    const rawStatuses = googleConnectionsRepository.getStatuses
      ? await googleConnectionsRepository.getStatuses(userId)
      : [await googleConnectionsRepository.getStatus(userId)];
    const statuses = rawStatuses.length
      ? rawStatuses
      : [await googleConnectionsRepository.getStatus(userId)];
    const defaultStatus = statuses.find((status) => status.isDefault) ?? statuses.find((status) => status.connected);
    return {
      connected: statuses.some((status) => status.connected),
      defaultConnectionId: defaultStatus?.id ?? null,
      connections: statuses.filter((status) => status.id).map((status) => ({
        id: status.id!,
        maskedEmail: maskEmail(status.email),
        scopes: status.scopes ?? [],
        isDefault: status.isDefault ?? false,
        expiresAt: status.expiresAt,
        updatedAt: status.updatedAt,
        revokedAt: status.revokedAt,
      })),
      maskedEmail: maskEmail(defaultStatus?.email),
      scopes: defaultStatus?.scopes,
      expiresAt: defaultStatus?.expiresAt,
      updatedAt: defaultStatus?.updatedAt,
      revokedAt: defaultStatus?.revokedAt,
    };
  },

  getConnectUrl: async (
    userId: string,
    input?: GoogleConnectRequest,
  ): Promise<GoogleConnectUrlResponse> => {
    const url = await createAuthUrl(userId, {
      forcePrompt: false,
      workspaceScopes: (input?.workspaceScopes ?? []) as GoogleWorkspaceScope[],
    });
    return { url };
  },

  reconnect: async (
      input: GoogleReconnectRequest,
    userId: string,
  ): Promise<GoogleConnectUrlResponse> => {
    const url = await createAuthUrl(userId, {
      forcePrompt: true,
      workspaceScopes: input.workspaceScopes as GoogleWorkspaceScope[],
    }, input.connectionId);
    return { url };
  },

  setDefault: async (input: GoogleSetDefaultRequest, userId: string) => {
    await googleConnectionsRepository.setDefaultForUser(userId, input.connectionId);
    return { success: true };
  },

  disconnect: async (userId: string, input?: GoogleDisconnectRequest): Promise<GoogleDisconnectResponse> => {
    let tokens: Awaited<
      ReturnType<typeof googleConnectionsRepository.getDecryptedTokens>
    > = null;
    try {
      tokens = await googleConnectionsRepository.getDecryptedTokens(userId, input?.connectionId);
    } catch {
      logger.error("Google OAuth disconnect could not decrypt local token");
    }
    if (tokens?.refreshToken) await revokeGoogleToken(tokens.refreshToken);
    else if (tokens?.accessToken) await revokeGoogleToken(tokens.accessToken);

    if (!input?.connectionId) {
      await googleConnectionsRepository.deleteByUserId(userId);
    } else if (googleConnectionsRepository.deleteByIdForUser) {
      await googleConnectionsRepository.deleteByIdForUser(userId, input?.connectionId);
    } else {
      await googleConnectionsRepository.deleteByUserId(userId);
    }
    return { success: true };
  },
};
