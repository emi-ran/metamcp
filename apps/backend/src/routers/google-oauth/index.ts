import express from "express";

import { auth } from "@/auth";
import {
  googleConnectionsRepository,
  googleOAuthStateRepository,
} from "@/db/repositories";
import logger from "@/utils/logger";

import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  generateOAuthState,
  generatePkcePair,
  getPublicCallbackUrl,
  type GoogleWorkspaceScope,
  revokeGoogleToken,
} from "./google-oauth-service";

const googleOAuthRouter = express.Router();

// Helper to authenticate user session with better-auth
async function getAuthenticatedUser(req: express.Request) {
  try {
    const headers = new Headers();
    Object.entries(req.headers).forEach(([key, value]) => {
      if (value) {
        headers.set(key, Array.isArray(value) ? value[0] : value);
      }
    });

    const session = await auth.api.getSession({
      headers,
    });
    return session?.user ?? null;
  } catch {
    logger.error("Google OAuth session authentication failed");
    return null;
  }
}

function oauthError(message: string): Error {
  return new Error(message);
}

function parseWorkspaceScopes(value: unknown): GoogleWorkspaceScope[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some(
      (scope) =>
        scope !== "calendar.readonly" &&
        scope !== "calendar.events" &&
        scope !== "drive.readonly" &&
        scope !== "gmail.compose" &&
        scope !== "drive.file" &&
        scope !== "docs.readonly" &&
        scope !== "docs.write" &&
        scope !== "sheets.readonly" &&
        scope !== "sheets.write",
    )
  ) {
    throw oauthError("Invalid requested Google workspace scopes");
  }
  return value as GoogleWorkspaceScope[];
}

async function startGoogleConnect(
  req: express.Request,
  res: express.Response,
  options: { forcePrompt: boolean; workspaceScopes: GoogleWorkspaceScope[] },
) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res
        .status(500)
        .json({ error: "Google OAuth client ID not configured" });
    }

    const redirectUri = getPublicCallbackUrl();
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const state = generateOAuthState();

    // 10 minutes expiry for state
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Save pending state with user binding
    await googleOAuthStateRepository.createState({
      state,
      user_id: user.id,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      expires_at: expiresAt,
    });

    const authUrl = buildGoogleAuthUrl({
      clientId,
      redirectUri,
      state,
      codeChallenge,
      forcePrompt: options.forcePrompt,
      workspaceScopes: options.workspaceScopes,
    });

    if (req.query.json === "true") {
      return res.json({ url: authUrl });
    }

    return res.redirect(authUrl);
  } catch {
    logger.error("Google OAuth connect initiation failed");
    return res.status(500).json({ error: "Internal server error" });
  }
}

// GET /integrations/google/status - get connection status
googleOAuthRouter.get("/integrations/google/status", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    return res.json(await googleConnectionsRepository.getStatus(user.id));
  } catch {
    logger.error("Google OAuth status lookup failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Backward-compatible alias while clients move from prior core route.
googleOAuthRouter.get("/api/oauth/google/status", async (req, res) => {
  return res.redirect(307, "/integrations/google/status");
});

// GET /integrations/google/connect - initial least-privilege OAuth flow.
googleOAuthRouter.get("/integrations/google/connect", async (req, res) => {
  return startGoogleConnect(req, res, {
    forcePrompt: false,
    workspaceScopes: [],
  });
});

googleOAuthRouter.get("/api/oauth/google/connect", async (req, res) => {
  return res.redirect(307, "/integrations/google/connect");
});

googleOAuthRouter.get("/api/oauth/google/callback", async (req, res) => {
  return res.redirect(
    307,
    `/integrations/google/callback?${req.url.split("?")[1] ?? ""}`,
  );
});

// POST /integrations/google/reconnect - explicit re-consent for optional writes.
googleOAuthRouter.post("/integrations/google/reconnect", async (req, res) => {
  let workspaceScopes: GoogleWorkspaceScope[];
  try {
    workspaceScopes = parseWorkspaceScopes(req.body?.workspaceScopes);
  } catch {
    return res
      .status(400)
      .json({ error: "Invalid requested Google workspace scopes" });
  }
  return startGoogleConnect(req, res, { forcePrompt: true, workspaceScopes });
});

// GET /integrations/google/callback - handle Google redirect.
googleOAuthRouter.get("/integrations/google/callback", async (req, res) => {
  try {
    const { code, state, error: googleError } = req.query;

    if (googleError) {
      logger.error("Google OAuth authorization was denied or failed");
      return res.status(400).send("Google OAuth authorization failed");
    }

    if (
      !code ||
      typeof code !== "string" ||
      !state ||
      typeof state !== "string"
    ) {
      return res.status(400).send("Missing code or state parameter");
    }

    // Atomically consume state (one-time use, validates expiry)
    const stateRecord = await googleOAuthStateRepository.consumeState(state);
    if (!stateRecord) {
      return res
        .status(400)
        .send("Invalid, expired, or already used OAuth state");
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).send("Google OAuth credentials missing on server");
    }

    const tokenResponse = await exchangeGoogleCode({
      code,
      codeVerifier: stateRecord.code_verifier,
      redirectUri: stateRecord.redirect_uri,
      clientId,
      clientSecret,
    });

    // Optionally get user info from Google for identity metadata
    const userInfo = await fetchGoogleUserInfo(tokenResponse.access_token);

    const scopes = tokenResponse.scope ? tokenResponse.scope.split(" ") : [];

    // Save tokens encrypted
    await googleConnectionsRepository.upsertConnection({
      userId: stateRecord.user_id,
      googleUserId: userInfo?.id ?? null,
      email: userInfo?.email ?? null,
      scopes,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token ?? null,
      expiresInSeconds: tokenResponse.expires_in,
    });

    const appUrl = process.env.APP_URL || "/";
    return res.redirect(`${appUrl}`);
  } catch {
    logger.error("Google OAuth callback handling failed");
    return res
      .status(500)
      .send("Internal server error during Google OAuth callback");
  }
});

// POST /integrations/google/disconnect - revoke remote token best-effort, then delete local record.
googleOAuthRouter.post("/integrations/google/disconnect", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let tokens: Awaited<
      ReturnType<typeof googleConnectionsRepository.getDecryptedTokens>
    > = null;
    try {
      tokens = await googleConnectionsRepository.getDecryptedTokens(user.id);
    } catch {
      logger.error("Google OAuth disconnect could not decrypt local token");
    }
    if (tokens?.refreshToken) await revokeGoogleToken(tokens.refreshToken);
    else if (tokens?.accessToken) await revokeGoogleToken(tokens.accessToken);

    await googleConnectionsRepository.deleteByUserId(user.id);
    return res.json({ success: true });
  } catch {
    logger.error("Google OAuth disconnect failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

googleOAuthRouter.post("/api/oauth/google/disconnect", async (req, res) => {
  return res.redirect(307, "/integrations/google/disconnect");
});

export default googleOAuthRouter;
