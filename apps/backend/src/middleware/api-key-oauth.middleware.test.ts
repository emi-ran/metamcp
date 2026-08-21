import express from "express";
import { describe, expect, it, vi } from "vitest";

import { DatabaseEndpoint } from "@repo/zod-types";

vi.mock("@/utils/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const { mockValidateApiKey } = vi.hoisted(() => ({
  mockValidateApiKey: vi.fn(),
}));

vi.mock("../db/repositories/api-keys.repo", () => {
  return {
    ApiKeysRepository: class {
      validateApiKey = mockValidateApiKey;
    },
  };
});

import {
  ApiKeyAuthenticatedRequest,
  authenticateApiKey,
} from "./api-key-oauth.middleware";

function createMockResponse() {
  const res: Partial<express.Response> & {
    _status?: number;
    _json?: unknown;
    _headers: Record<string, string>;
  } = {
    _headers: {},
    status: vi.fn(function (this: any, code: number) {
      this._status = code;
      return this;
    }),
    json: vi.fn(function (this: any, data: unknown) {
      this._json = data;
      return this;
    }),
    set: vi.fn(function (
      this: any,
      field: string | Record<string, string>,
      value?: string | string[],
    ) {
      if (typeof field === "string" && typeof value === "string") {
        this._headers[field.toLowerCase()] = value;
      }
      return this;
    }) as any,
  };
  return res as express.Response & typeof res;
}

describe("api-key-oauth.middleware", () => {
  const baseEndpoint: DatabaseEndpoint = {
    uuid: "endpoint-1",
    name: "test-endpoint",
    description: null,
    namespace_uuid: "namespace-1",
    enable_api_key_auth: true,
    enable_oauth: false,
    enable_max_rate: false,
    enable_client_max_rate: false,
    max_rate: null,
    max_rate_seconds: null,
    client_max_rate: null,
    client_max_rate_seconds: null,
    client_max_rate_strategy: null,
    client_max_rate_strategy_key: null,
    use_query_param_auth: false,
    enable_metamcp_admin_tools: false,
    created_at: new Date(),
    updated_at: new Date(),
    user_id: "user-owner-1",
  };

  it("OAuth-only endpoint rejects X-API-Key even with valid key and challenges OAuth", async () => {
    const oauthOnlyEndpoint: DatabaseEndpoint = {
      ...baseEndpoint,
      enable_api_key_auth: false,
      enable_oauth: true,
    };

    mockValidateApiKey.mockResolvedValue({
      valid: true,
      key_uuid: "key-1",
      user_id: "user-owner-1",
    });

    const req = {
      headers: {
        "x-api-key": "valid-api-key",
      },
      query: {},
      endpoint: oauthOnlyEndpoint,
      protocol: "http",
      get: () => "localhost:3000",
    } as unknown as ApiKeyAuthenticatedRequest;

    const res = createMockResponse();
    const next = vi.fn();

    await authenticateApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._headers["www-authenticate"]).toBeDefined();
    expect(res._headers["www-authenticate"]).toContain("Bearer realm=");
  });

  it("Personal API-key endpoint accepts valid X-API-Key and allows owner access", async () => {
    mockValidateApiKey.mockResolvedValue({
      valid: true,
      key_uuid: "key-1",
      user_id: "user-owner-1",
    });

    const req = {
      headers: {
        "x-api-key": "valid-api-key",
      },
      query: {},
      endpoint: baseEndpoint,
      protocol: "http",
      get: () => "localhost:3000",
    } as unknown as ApiKeyAuthenticatedRequest;

    const res = createMockResponse();
    const next = vi.fn();

    await authenticateApiKey(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.authMethod).toBe("api_key");
    expect(req.apiKeyUserId).toBe("user-owner-1");
  });

  it("Personal API-key endpoint rejects non-owner private endpoint access", async () => {
    mockValidateApiKey.mockResolvedValue({
      valid: true,
      key_uuid: "key-2",
      user_id: "other-user",
    });

    const req = {
      headers: {
        "x-api-key": "valid-other-key",
      },
      query: {},
      endpoint: baseEndpoint,
      protocol: "http",
      get: () => "localhost:3000",
    } as unknown as ApiKeyAuthenticatedRequest;

    const res = createMockResponse();
    const next = vi.fn();

    await authenticateApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
