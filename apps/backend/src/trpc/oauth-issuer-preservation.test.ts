import {
  assertOAuthIssuer,
  GetOAuthSessionResponseSchema,
  OAuthSessionCreateInputSchema,
  OAuthSessionUpdateInputSchema,
  ServerParametersSchema,
  UpsertOAuthSessionRequestSchema,
  UpsertOAuthSessionResponseSchema,
} from "@repo/zod-types";
import { describe, expect, it } from "vitest";

import { OAuthSessionsSerializer } from "../db/serializers/oauth-sessions.serializer";

describe("OAuth issuer persistence contract", () => {
  const uuid = "00000000-0000-4000-8000-000000000001";
  const issuer = "https://auth.example.com/";
  const tokens = {
    access_token: "fixture",
    token_type: "Bearer",
    refresh_token: "fixture",
    issuer,
  };
  const client = { client_id: "fixture", client_secret: "fixture", issuer };

  it("preserves SDK stamps through input, repository schemas, serializer, get and upsert output", () => {
    const input = UpsertOAuthSessionRequestSchema.parse({
      mcp_server_uuid: uuid,
      tokens,
      client_information: client,
    });
    expect(input.tokens?.issuer).toBe(issuer);
    for (const schema of [
      OAuthSessionCreateInputSchema,
      OAuthSessionUpdateInputSchema,
    ]) {
      expect(schema.parse(input).tokens?.issuer).toBe(issuer);
    }
    const serialized = OAuthSessionsSerializer.serializeOAuthSession({
      uuid,
      mcp_server_uuid: uuid,
      tokens,
      client_information: client,
      code_verifier: null,
      created_at: new Date(0),
      updated_at: new Date(0),
    });
    for (const schema of [
      GetOAuthSessionResponseSchema,
      UpsertOAuthSessionResponseSchema,
    ]) {
      const output = schema.parse({
        success: true,
        data: serialized,
        message: "fixture",
      });
      if (output.success) {
        expect(output.data.tokens?.issuer).toBe(issuer);
        expect(output.data.client_information?.issuer).toBe(issuer);
      }
    }
    const params = ServerParametersSchema.parse({
      uuid,
      name: "fixture",
      description: "",
      created_at: "",
      status: "",
      oauth_tokens: tokens,
    });
    expect(params.oauth_tokens?.issuer).toBe(issuer);
  });

  it("accepts old wire shapes but never implicitly binds legacy credentials", () => {
    const legacy = { access_token: "fixture", token_type: "Bearer" };
    expect(
      UpsertOAuthSessionRequestSchema.parse({
        mcp_server_uuid: uuid,
        tokens: legacy,
      }).tokens,
    ).toEqual(legacy);
    expect(() =>
      assertOAuthIssuer({ ...legacy, issuer: undefined }, issuer),
    ).toThrow("OAuth authorization required again");
    expect(() =>
      assertOAuthIssuer({ issuer: "https://other.example.com" }, issuer),
    ).toThrow();
    expect(() =>
      assertOAuthIssuer({ issuer: "https://AUTH.example.com:443" }, issuer),
    ).not.toThrow();
  });
});
