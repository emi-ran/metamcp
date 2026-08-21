import { describe, expect, it } from "vitest";

import {
  decryptGoogleToken,
  encryptGoogleToken,
  getGoogleTokenEncryptionKey,
} from "./google-token-crypto";

describe("Google Token Crypto", () => {
  const TEST_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 32 bytes hex = 64 chars

  it("encrypts and decrypts a token correctly with AES-256-GCM", () => {
    const plaintext =
      "ya29.a0AfH6SMD_sample_google_access_or_refresh_token_12345";
    const encrypted = encryptGoogleToken(plaintext, {
      key: TEST_KEY,
      keyVersion: 1,
    });

    expect(encrypted).toHaveProperty("encryptedData");
    expect(encrypted).toHaveProperty("iv");
    expect(encrypted).toHaveProperty("authTag");
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.encryptedData).not.toBe(plaintext);

    const decrypted = decryptGoogleToken(encrypted, { key: TEST_KEY });
    expect(decrypted).toBe(plaintext);
  });

  it("throws error if ciphertext or authTag is tampered with", () => {
    const plaintext = "secret-token";
    const encrypted = encryptGoogleToken(plaintext, {
      key: TEST_KEY,
      keyVersion: 1,
    });

    const tampered = {
      ...encrypted,
      authTag: "a".repeat(encrypted.authTag.length),
    };

    expect(() => decryptGoogleToken(tampered, { key: TEST_KEY })).toThrow();
  });

  it("fails if encryption key is missing or invalid length", () => {
    expect(() => getGoogleTokenEncryptionKey("")).toThrow();
    expect(() => getGoogleTokenEncryptionKey("short-key")).toThrow();
    expect(() => getGoogleTokenEncryptionKey(TEST_KEY)).not.toThrow();
  });
});
