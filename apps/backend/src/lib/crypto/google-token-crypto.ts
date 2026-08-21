import crypto from "crypto";

export interface EncryptedTokenPayload {
  encryptedData: string; // hex
  iv: string; // hex
  authTag: string; // hex
  keyVersion: number;
}

type GoogleTokenKeyConfig = Record<string, string>;

function getGoogleTokenKeyConfig(): GoogleTokenKeyConfig | null {
  const rawConfig = process.env.GOOGLE_TOKEN_ENCRYPTION_KEYS;
  if (!rawConfig) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEYS must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEYS must be a version-to-key map",
    );
  }

  return parsed as GoogleTokenKeyConfig;
}

export function getGoogleTokenActiveKeyVersion(): number {
  const keys = getGoogleTokenKeyConfig();
  if (!keys) return 1;

  const rawVersion = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_VERSION;
  const keyVersion = Number(rawVersion);
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY_VERSION must identify a configured key",
    );
  }
  if (!keys[String(keyVersion)]) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY_VERSION is not configured");
  }
  return keyVersion;
}

export function getGoogleTokenEncryptionKey(envKey?: string): Buffer {
  const rawKey = envKey ?? process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY environment variable is required",
    );
  }

  // Support 64-char hex string (32 bytes) or raw 32-character string
  if (rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }

  const buf = Buffer.from(rawKey, "utf8");
  if (buf.length !== 32) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY must be exactly 32 bytes (or 64 hex characters)",
    );
  }
  return buf;
}

function resolveGoogleTokenEncryptionKey(keyVersion: number): Buffer {
  const keys = getGoogleTokenKeyConfig();
  if (!keys) {
    if (keyVersion !== 1) {
      throw new Error(
        `Google token encryption key version ${keyVersion} is not configured`,
      );
    }
    return getGoogleTokenEncryptionKey();
  }

  const key = keys[String(keyVersion)];
  if (!key) {
    throw new Error(
      `Google token encryption key version ${keyVersion} is not configured`,
    );
  }
  return getGoogleTokenEncryptionKey(key);
}

export function encryptGoogleToken(
  plaintext: string,
  options?: { key?: string | Buffer; keyVersion?: number },
): EncryptedTokenPayload {
  const keyVersion = options?.keyVersion ?? getGoogleTokenActiveKeyVersion();
  const keyBuf =
    options?.key instanceof Buffer
      ? options.key
      : typeof options?.key === "string"
        ? getGoogleTokenEncryptionKey(options.key)
        : resolveGoogleTokenEncryptionKey(keyVersion);
  const iv = crypto.randomBytes(12); // Standard 12-byte IV for AES-GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return {
    encryptedData: encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    keyVersion,
  };
}

export function decryptGoogleToken(
  payload: EncryptedTokenPayload,
  options?: { key?: string | Buffer },
): string {
  const keyBuf =
    options?.key instanceof Buffer
      ? options.key
      : typeof options?.key === "string"
        ? getGoogleTokenEncryptionKey(options.key)
        : resolveGoogleTokenEncryptionKey(payload.keyVersion);

  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, iv);

  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(payload.encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function serializeEncryptedPayload(payload: EncryptedTokenPayload): string {
  return JSON.stringify(payload);
}

export function deserializeEncryptedPayload(serialized: string): EncryptedTokenPayload {
  const parsed = JSON.parse(serialized);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.encryptedData !== "string" ||
    typeof parsed.iv !== "string" ||
    typeof parsed.authTag !== "string" ||
    typeof parsed.keyVersion !== "number"
  ) {
    throw new Error("Invalid encrypted payload format");
  }
  return parsed as EncryptedTokenPayload;
}

export function encryptSecretString(
  plaintext: string,
  options?: { key?: string | Buffer; keyVersion?: number },
): string {
  const payload = encryptGoogleToken(plaintext, options);
  return serializeEncryptedPayload(payload);
}

export function decryptSecretString(
  serialized: string,
  options?: { key?: string | Buffer },
): string {
  const payload = deserializeEncryptedPayload(serialized);
  return decryptGoogleToken(payload, options);
}
