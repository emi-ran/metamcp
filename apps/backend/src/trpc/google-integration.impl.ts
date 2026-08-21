import {
  GoogleConnectUrlResponse,
  GoogleConnectionStatusResponse,
  GoogleDisconnectResponse,
  GoogleReconnectRequest,
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
): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("Google OAuth client ID not configured");
  }

  const redirectUri = getPublicCallbackUrl();
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const state = generateOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await googleOAuthStateRepository.createState({
    state,
    user_id: userId,
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
    const rawStatus = await googleConnectionsRepository.getStatus(userId);
    return {
      connected: rawStatus.connected,
      maskedEmail: maskEmail(rawStatus.email),
      scopes: rawStatus.scopes,
      expiresAt: rawStatus.expiresAt,
      updatedAt: rawStatus.updatedAt,
      revokedAt: rawStatus.revokedAt,
    };
  },

  getConnectUrl: async (userId: string): Promise<GoogleConnectUrlResponse> => {
    const url = await createAuthUrl(userId, {
      forcePrompt: false,
      workspaceScopes: [],
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
    });
    return { url };
  },

  disconnect: async (userId: string): Promise<GoogleDisconnectResponse> => {
    let tokens: Awaited<
      ReturnType<typeof googleConnectionsRepository.getDecryptedTokens>
    > = null;
    try {
      tokens = await googleConnectionsRepository.getDecryptedTokens(userId);
    } catch {
      logger.error("Google OAuth disconnect could not decrypt local token");
    }
    if (tokens?.refreshToken) await revokeGoogleToken(tokens.refreshToken);
    else if (tokens?.accessToken) await revokeGoogleToken(tokens.accessToken);

    await googleConnectionsRepository.deleteByUserId(userId);
    return { success: true };
  },
};
