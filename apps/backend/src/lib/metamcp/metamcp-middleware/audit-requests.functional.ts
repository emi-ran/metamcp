import {
  GOOGLE_WORKSPACE_SERVER_NAME,
  GoogleWorkspaceError,
  isGoogleWorkspaceToolName,
} from "@/lib/google-workspace/google-workspace";
import { parseToolName } from "@/lib/metamcp/tool-name-parser";
import { mcpRequestAuditLogsRepository } from "@/db/repositories/mcp-request-audit-logs.repo";

import { CallToolHandler, CallToolMiddleware } from "./functional-middleware";

export interface AuditToolIdentity {
  mcpServerUuid?: string;
  mcpServerName?: string;
}

export interface AuditCallToolMiddlewareOptions {
  resolveToolIdentity?: (
    toolName: string,
    namespaceUuid: string,
  ) => Promise<AuditToolIdentity>;
  createAuditLog?: typeof mcpRequestAuditLogsRepository.create;
}

function isGoogleCall(toolName: string): boolean {
  const parsed = parseToolName(toolName);
  if (!parsed) {
    return false;
  }
  return (
    parsed.serverName === GOOGLE_WORKSPACE_SERVER_NAME &&
    isGoogleWorkspaceToolName(parsed.originalToolName)
  );
}

function getSafeErrorMessage(error: unknown, isGoogle: boolean): string {
  if (isGoogle) {
    if (error instanceof GoogleWorkspaceError) {
      return error.code;
    }
    return "INTERNAL_ERROR";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getSafeResponseErrorMessage(
  responseContent: string | undefined,
  isGoogle: boolean,
): string | undefined {
  if (!responseContent) {
    return undefined;
  }

  if (isGoogle) {
    return "TOOL_ERROR";
  }

  return responseContent;
}

async function resolveSafely(
  options: AuditCallToolMiddlewareOptions,
  toolName: string,
  namespaceUuid: string,
): Promise<AuditToolIdentity> {
  if (!options.resolveToolIdentity) {
    return {};
  }

  try {
    return await options.resolveToolIdentity(toolName, namespaceUuid);
  } catch {
    return {};
  }
}

export function createAuditCallToolMiddleware(
  options: AuditCallToolMiddlewareOptions = {},
): CallToolMiddleware {
  const createAuditLog =
    options.createAuditLog?.bind(mcpRequestAuditLogsRepository) ??
    mcpRequestAuditLogsRepository.create.bind(mcpRequestAuditLogsRepository);

  return (handler: CallToolHandler): CallToolHandler => {
    return async (request, context) => {
      const startTime = performance.now();
      const isGoogle = isGoogleCall(request.params.name);

      try {
        const response = await handler(request, context);
        const durationMs = Math.round(performance.now() - startTime);
        const toolIdentity = await resolveSafely(
          options,
          request.params.name,
          context.namespaceUuid,
        );

        void createAuditLog({
          endpointName: context.endpointName,
          namespaceUuid: context.namespaceUuid,
          sessionId: context.sessionId,
          authMethod: context.auth?.method || "none",
          apiKeyUuid: context.auth?.apiKeyUuid,
          apiKeyUserId: context.auth?.apiKeyUserId,
          oauthUserId: context.auth?.oauthUserId,
          mcpServerUuid: toolIdentity.mcpServerUuid,
          mcpServerName: toolIdentity.mcpServerName,
          toolName: request.params.name,
          status: response.isError ? "ERROR" : "SUCCESS",
          durationMs,
          errorMessage:
            response.isError && response.content?.[0]?.type === "text"
              ? getSafeResponseErrorMessage(response.content[0].text, isGoogle)
              : undefined,
        });

        return response;
      } catch (error) {
        const durationMs = Math.round(performance.now() - startTime);
        const toolIdentity = await resolveSafely(
          options,
          request.params.name,
          context.namespaceUuid,
        );

        void createAuditLog({
          endpointName: context.endpointName,
          namespaceUuid: context.namespaceUuid,
          sessionId: context.sessionId,
          authMethod: context.auth?.method || "none",
          apiKeyUuid: context.auth?.apiKeyUuid,
          apiKeyUserId: context.auth?.apiKeyUserId,
          oauthUserId: context.auth?.oauthUserId,
          mcpServerUuid: toolIdentity.mcpServerUuid,
          mcpServerName: toolIdentity.mcpServerName,
          toolName: request.params.name,
          status: "ERROR",
          durationMs,
          errorMessage: getSafeErrorMessage(error, isGoogle),
        });

        throw error;
      }
    };
  };
}
