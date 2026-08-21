import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../db/repositories", () => ({
  namespacesRepository: {
    findByUuid: vi.fn(),
  },
  namespaceMappingsRepository: {
    bulkUpdateToolStatusByNamespace: vi.fn(),
  },
  mcpServersRepository: {
    findByUuid: vi.fn(),
  },
  toolsRepository: {
    findByUuid: vi.fn(),
  },
}));

vi.mock("../lib/metamcp/metamcp-middleware/tool-overrides.functional", () => ({
  clearOverrideCache: vi.fn(),
  mapOverrideNameToOriginal: vi.fn(),
}));

vi.mock("../lib/metamcp/metamcp-server-pool", () => ({
  metaMcpServerPool: {
    releaseNamespace: vi.fn(),
    invalidateIdleServer: vi.fn().mockResolvedValue(undefined),
    invalidateOpenApiSessions: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  BulkUpdateNamespaceToolStatusRequestSchema,
  BulkUpdateNamespaceToolStatusResponseSchema,
  ToolStatusEnum,
} from "@repo/zod-types";

import { namespacesImplementations } from "./namespaces.impl";
import {
  namespaceMappingsRepository,
  namespacesRepository,
} from "../db/repositories";
import { metaMcpServerPool } from "../lib/metamcp/metamcp-server-pool";

describe("Bulk update namespace tool status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates request and response schemas", () => {
    const validRequest = {
      namespaceUuid: "123e4567-e89b-12d3-a456-426614174000",
      status: ToolStatusEnum.enum.ACTIVE,
    };
    const parsedRequest =
      BulkUpdateNamespaceToolStatusRequestSchema.safeParse(validRequest);
    expect(parsedRequest.success).toBe(true);

    const invalidRequest = {
      namespaceUuid: "invalid-uuid",
      status: "INVALID_STATUS",
    };
    const parsedInvalid =
      BulkUpdateNamespaceToolStatusRequestSchema.safeParse(invalidRequest);
    expect(parsedInvalid.success).toBe(false);

    const validResponse = {
      success: true,
      message: "Updated status to ACTIVE for 5 tools",
      updatedCount: 5,
    };
    const parsedResponse =
      BulkUpdateNamespaceToolStatusResponseSchema.safeParse(validResponse);
    expect(parsedResponse.success).toBe(true);
  });

  it("returns error if namespace not found", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValueOnce(
      undefined,
    );

    const result = await namespacesImplementations.bulkUpdateToolStatus(
      {
        namespaceUuid: "123e4567-e89b-12d3-a456-426614174000",
        status: ToolStatusEnum.enum.INACTIVE,
      },
      "user-1",
    );

    expect(result).toEqual({
      success: false,
      message: "Namespace not found",
    });
  });

  it("returns error if user does not own namespace", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValueOnce({
      uuid: "123e4567-e89b-12d3-a456-426614174000",
      name: "Test Namespace",
      description: null,
      created_at: new Date(),
      updated_at: new Date(),
      user_id: "other-user",
    });

    const result = await namespacesImplementations.bulkUpdateToolStatus(
      {
        namespaceUuid: "123e4567-e89b-12d3-a456-426614174000",
        status: ToolStatusEnum.enum.ACTIVE,
      },
      "user-1",
    );

    expect(result).toEqual({
      success: false,
      message:
        "Access denied: You can only update tool status for namespaces you own",
    });
  });

  it("successfully updates all tools in namespace for owner", async () => {
    vi.mocked(namespacesRepository.findByUuid).mockResolvedValueOnce({
      uuid: "123e4567-e89b-12d3-a456-426614174000",
      name: "Test Namespace",
      description: null,
      created_at: new Date(),
      updated_at: new Date(),
      user_id: "user-1",
    });

    vi.mocked(
      namespaceMappingsRepository.bulkUpdateToolStatusByNamespace,
    ).mockResolvedValueOnce([
      {
        uuid: "mapping-1",
        namespace_uuid: "123e4567-e89b-12d3-a456-426614174000",
        tool_uuid: "tool-1",
        mcp_server_uuid: "server-1",
        status: "ACTIVE",
        override_name: null,
        override_title: null,
        override_description: null,
        override_annotations: null,
        created_at: new Date(),
      },
      {
        uuid: "mapping-2",
        namespace_uuid: "123e4567-e89b-12d3-a456-426614174000",
        tool_uuid: "tool-2",
        mcp_server_uuid: "server-1",
        status: "ACTIVE",
        override_name: null,
        override_title: null,
        override_description: null,
        override_annotations: null,
        created_at: new Date(),
      },
    ]);

    const result = await namespacesImplementations.bulkUpdateToolStatus(
      {
        namespaceUuid: "123e4567-e89b-12d3-a456-426614174000",
        status: ToolStatusEnum.enum.ACTIVE,
      },
      "user-1",
    );

    expect(result).toEqual({
      success: true,
      message: "Updated status to ACTIVE for 2 tools",
      updatedCount: 2,
    });
    expect(
      namespaceMappingsRepository.bulkUpdateToolStatusByNamespace,
    ).toHaveBeenCalledWith(
      "123e4567-e89b-12d3-a456-426614174000",
      "ACTIVE",
    );
    expect(metaMcpServerPool.invalidateIdleServer).toHaveBeenCalledWith(
      "123e4567-e89b-12d3-a456-426614174000",
    );
    expect(metaMcpServerPool.invalidateOpenApiSessions).toHaveBeenCalledWith([
      "123e4567-e89b-12d3-a456-426614174000",
    ]);
  });
});
