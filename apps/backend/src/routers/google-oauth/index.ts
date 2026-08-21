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
  } catch (err) {
    logger.error("Failed to authenticate session:", err);
    return null;
  }
}

// 1. GET /api/oauth/google/status - get connection status
googleOAuthRouter.get("/api/oauth/google/status", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const status = await googleConnectionsRepository.getStatus(user.id);
    return res.json(status);
  } catch (error) {
    logger.error("Error fetching Google OAuth status:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// 2. GET /api/oauth/google/connect - initiate OAuth flow
googleOAuthRouter.get("/api/oauth/google/connect", async (req, res) => {
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
      forcePrompt: req.query.prompt === "consent",
    });

    if (req.query.json === "true") {
      return res.json({ url: authUrl });
    }

    return res.redirect(authUrl);
  } catch (error) {
    logger.error("Error initiating Google OAuth connect:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// 3. GET /api/oauth/google/reconnect - force consent/prompt reconnect
googleOAuthRouter.get("/api/oauth/google/reconnect", async (req, res) => {
  req.query.prompt = "consent";
  return res.redirect(
    `/api/oauth/google/connect?prompt=consent${req.query.json === "true" ? "&json=true" : ""}`,
  );
});

// 4. GET /api/oauth/google/callback - handle Google redirect
googleOAuthRouter.get("/api/oauth/google/callback", async (req, res) => {
  try {
    const { code, state, error: oauthError, error_description } = req.query;

    if (oauthError) {
      logger.error(
        `Google OAuth returned error: ${oauthError} - ${error_description}`,
      );
      return res.status(400).send(`Google OAuth error: ${oauthError}`);
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
  } catch (error) {
    logger.error("Error handling Google OAuth callback:", error);
    return res
      .status(500)
      .send("Internal server error during Google OAuth callback");
  }
});

// 5. POST /api/oauth/google/disconnect - remove user connection
googleOAuthRouter.post("/api/oauth/google/disconnect", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await googleConnectionsRepository.deleteByUserId(user.id);
    return res.json({ success: true });
  } catch (error) {
    logger.error("Error disconnecting Google connection:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default googleOAuthRouter;
