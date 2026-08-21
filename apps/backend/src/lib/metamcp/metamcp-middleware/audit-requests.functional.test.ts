import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

import { GoogleWorkspaceError } from "@/lib/google-workspace/google-workspace";

vi.mock("@/db/repositories/mcp-request-audit-logs.repo", () => ({
  mcpRequestAuditLogsRepository: {
    create: vi.fn(),
  },
}));

vi.mock("@/db/repositories", () => ({
  configRepo: {
    getConfig: vi.fn(async () => undefined),
  },
}));

vi.mock("../../db/repositories/config.repo", () => ({
  configRepo: {
    getConfig: vi.fn(async () => undefined),
  },
}));

vi.mock("@/db/repositories/config.repo", () => ({
  configRepo: {
    getConfig: vi.fn(async () => undefined),
  },
}));

import { createAuditCallToolMiddleware } from "./audit-requests.functional";
import { MetaMCPHandlerContext } from "./functional-middleware";

const baseRequest: CallToolRequest = {
  method: "tools/call",
  params: {
    name: "audit_test__echo",
    arguments: { message: "sensitive input" },
  },
};

const googleRequest: CallToolRequest = {
  method: "tools/call",
  params: {
    name: "GoogleWorkspace__gmail_get_message",
    arguments: { messageId: "secret-msg-id-123" },
  },
};

const baseContext: MetaMCPHandlerContext = {
  endpointName: "audit-endpoint",
  namespaceUuid: "namespace-uuid",
  sessionId: "session-id",
  auth: {
    method: "api_key",
    apiKeyUuid: "api-key-uuid",
    apiKeyUserId: "user-id",
  },
};

describe("createAuditCallToolMiddleware", () => {
  it("records successful tool calls without arguments or response payload", async () => {
    const createAuditLog = vi.fn().mockResolvedValue(undefined);
    const middleware = createAuditCallToolMiddleware({
      createAuditLog,
      resolveToolIdentity: vi.fn().mockResolvedValue({
        mcpServerUuid: "server-uuid",
        mcpServerName: "audit_test",
      }),
    });

    const handler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "sensitive response" }],
    });

    await middleware(handler)(baseRequest, baseContext);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointName: "audit-endpoint",
        namespaceUuid: "namespace-uuid",
        sessionId: "session-id",
        authMethod: "api_key",
        apiKeyUuid: "api-key-uuid",
        apiKeyUserId: "user-id",
        mcpServerUuid: "server-uuid",
        mcpServerName: "audit_test",
        toolName: "audit_test__echo",
        status: "SUCCESS",
      }),
    );
    expect(createAuditLog.mock.calls[0]?.[0]).not.toHaveProperty("arguments");
    expect(createAuditLog.mock.calls[0]?.[0]).not.toHaveProperty("response");
  });

  it("records tool responses marked as errors", async () => {
    const createAuditLog = vi.fn().mockResolvedValue(undefined);
    const middleware = createAuditCallToolMiddleware({ createAuditLog });

    const handler = vi.fn().mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "Access denied" }],
    });

    await middleware(handler)(baseRequest, baseContext);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ERROR",
        errorMessage: "Access denied",
      }),
    );
  });

  it("records thrown tool call errors and rethrows", async () => {
    const createAuditLog = vi.fn().mockResolvedValue(undefined);
    const middleware = createAuditCallToolMiddleware({ createAuditLog });
    const handler = vi.fn().mockRejectedValue(new Error("Tool failed"));

    await expect(middleware(handler)(baseRequest, baseContext)).rejects.toThrow(
      "Tool failed",
    );

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ERROR",
        errorMessage: "Tool failed",
      }),
    );
  });

  it("records calls denied by inner middleware", async () => {
    const createAuditLog = vi.fn().mockResolvedValue(undefined);
    const auditMiddleware = createAuditCallToolMiddleware({ createAuditLog });
    const deniedHandler = vi.fn().mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "Denied before handler" }],
    });
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "not called" }],
    });

    await auditMiddleware(deniedHandler)(baseRequest, baseContext);

    expect(handler).not.toHaveBeenCalled();
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ERROR",
        errorMessage: "Denied before handler",
      }),
    );
  });

  it("sanitizes Google Workspace error messages to error code only and never stores raw error text or tokens", async () => {
    const createAuditLog = vi.fn().mockResolvedValue(undefined);
    const middleware = createAuditCallToolMiddleware({ createAuditLog });
    const sensitiveError = new GoogleWorkspaceError(
      "FORBIDDEN",
      "OAuth token ya29.secret_token_123 failed for user@example.com with query secret",
    );
    const handler = vi.fn().mockRejectedValue(sensitiveError);

    await expect(
      middleware(handler)(googleRequest, {
        ...baseContext,
        auth: {
          method: "oauth",
          oauthUserId: "oauth-user-456",
        },
      }),
    ).rejects.toThrow(sensitiveError);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointName: "audit-endpoint",
        namespaceUuid: "namespace-uuid",
        sessionId: "session-id",
        authMethod: "oauth",
        oauthUserId: "oauth-user-456",
        toolName: "GoogleWorkspace__gmail_get_message",
        status: "ERROR",
        errorMessage: "FORBIDDEN",
      }),
    );
    const callArg = createAuditLog.mock.calls[0]?.[0];
    expect(callArg?.errorMessage).not.toContain("ya29.");
    expect(callArg?.errorMessage).not.toContain("user@example.com");
    expect(callArg).not.toHaveProperty("arguments");
    expect(callArg).not.toHaveProperty("content");
  });

  it("sanitizes Google Workspace error response content to generic code", async () => {
    const createAuditLog = vi.fn().mockResolvedValue(undefined);
    const middleware = createAuditCallToolMiddleware({ createAuditLog });
    const handler = vi.fn().mockResolvedValue({
      isError: true,
      content: [
        {
          type: "text",
          text: "Google Workspace raw response with private doc contents: confidential",
        },
      ],
    });

    await middleware(handler)(googleRequest, baseContext);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ERROR",
        errorMessage: "TOOL_ERROR",
      }),
    );
  });
});
