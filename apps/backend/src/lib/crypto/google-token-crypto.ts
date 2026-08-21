import crypto from "crypto";

export interface EncryptedTokenPayload {
  encryptedData: string; // hex
  iv: string; // hex
  authTag: string; // hex
  keyVersion: number;
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

export function encryptGoogleToken(
  plaintext: string,
  options?: { key?: string | Buffer; keyVersion?: number },
): EncryptedTokenPayload {
  const keyBuf =
    options?.key instanceof Buffer
      ? options.key
      : typeof options?.key === "string"
        ? getGoogleTokenEncryptionKey(options.key)
        : getGoogleTokenEncryptionKey();

  const keyVersion = options?.keyVersion ?? 1;
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
        : getGoogleTokenEncryptionKey();

  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, iv);

  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(payload.encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
