import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServerCreateInput, McpServerUpdateInput } from "@repo/zod-types";

const insertValuesCalls: any[] = [];
const updateSetCalls: any[] = [];

vi.mock("../../index", () => {
  return {
    db: {
      insert: () => ({
        values: (values: any) => {
          insertValuesCalls.push(values);
          return {
            returning: async () => {
              const rows = Array.isArray(values) ? values : [values];
              return rows.map((r, i) => ({
                uuid: `mock-uuid-${i}`,
                created_at: new Date(),
                ...r,
              }));
            },
          };
        },
      }),
      update: () => ({
        set: (values: any) => {
          updateSetCalls.push(values);
          return {
            where: () => ({
              returning: async () => [
                {
                  uuid: "mock-uuid",
                  created_at: new Date(),
                  ...values,
                },
              ],
            }),
          };
        },
      }),
    },
  };
});

const { McpServersRepository } = await import("../mcp-servers.repo");

describe("McpServersRepository command normalization for PostgreSQL check constraint", () => {
  const repo = new McpServersRepository();

  beforeEach(() => {
    insertValuesCalls.length = 0;
    updateSetCalls.length = 0;
  });

  describe("create", () => {
    it("normalizes empty string command to null for STREAMABLE_HTTP servers", async () => {
      const input: McpServerCreateInput = {
        name: "test-streamable",
        type: "STREAMABLE_HTTP",
        url: "https://example.com/mcp",
        command: "",
        args: [],
        env: {},
        headers: {},
        forward_headers: {},
      };

      await repo.create(input);

      expect(insertValuesCalls).toHaveLength(1);
      expect(insertValuesCalls[0].command).toBeNull();
      expect(insertValuesCalls[0].url).toBe("https://example.com/mcp");
    });

    it("normalizes empty string command to null for SSE servers", async () => {
      const input: McpServerCreateInput = {
        name: "test-sse",
        type: "SSE",
        url: "https://example.com/sse",
        command: "",
        args: [],
        env: {},
        headers: {},
        forward_headers: {},
      };

      await repo.create(input);

      expect(insertValuesCalls).toHaveLength(1);
      expect(insertValuesCalls[0].command).toBeNull();
      expect(insertValuesCalls[0].url).toBe("https://example.com/sse");
    });

    it("normalizes empty string command to null for VIRTUAL servers", async () => {
      const input: McpServerCreateInput = {
        name: "test-virtual",
        type: "VIRTUAL",
        command: "",
        args: [],
        env: {},
        headers: {},
        forward_headers: {},
      };

      await repo.create(input);

      expect(insertValuesCalls).toHaveLength(1);
      expect(insertValuesCalls[0].command).toBeNull();
    });

    it("preserves command for STDIO servers", async () => {
      const input: McpServerCreateInput = {
        name: "test-stdio",
        type: "STDIO",
        command: "npx -y @modelcontextprotocol/server-memory",
        args: ["arg1"],
        env: { FOO: "BAR" },
        headers: {},
        forward_headers: {},
      };

      await repo.create(input);

      expect(insertValuesCalls).toHaveLength(1);
      expect(insertValuesCalls[0].command).toBe("npx -y @modelcontextprotocol/server-memory");
    });
  });

  describe("update", () => {
    it("normalizes empty string command to null for STREAMABLE_HTTP servers on update", async () => {
      const input: McpServerUpdateInput = {
        uuid: "00000000-0000-0000-0000-000000000001",
        name: "test-streamable-update",
        type: "STREAMABLE_HTTP",
        url: "https://example.com/mcp",
        command: "",
        forward_headers: {},
      };

      await repo.update(input);

      expect(updateSetCalls).toHaveLength(1);
      expect(updateSetCalls[0].command).toBeNull();
    });

    it("normalizes empty string command to null for SSE servers on update", async () => {
      const input: McpServerUpdateInput = {
        uuid: "00000000-0000-0000-0000-000000000001",
        name: "test-sse-update",
        type: "SSE",
        url: "https://example.com/sse",
        command: "",
        forward_headers: {},
      };

      await repo.update(input);

      expect(updateSetCalls).toHaveLength(1);
      expect(updateSetCalls[0].command).toBeNull();
    });

    it("preserves command for STDIO servers on update", async () => {
      const input: McpServerUpdateInput = {
        uuid: "00000000-0000-0000-0000-000000000001",
        name: "test-stdio-update",
        type: "STDIO",
        command: "node server.js",
        forward_headers: {},
      };

      await repo.update(input);

      expect(updateSetCalls).toHaveLength(1);
      expect(updateSetCalls[0].command).toBe("node server.js");
    });
  });

  describe("bulkCreate", () => {
    it("normalizes empty string command to null for multiple HTTP/SSE/VIRTUAL servers", async () => {
      const servers: McpServerCreateInput[] = [
        {
          name: "test-streamable-1",
          type: "STREAMABLE_HTTP",
          url: "https://example.com/mcp1",
          command: "",
          forward_headers: {},
        },
        {
          name: "test-sse-2",
          type: "SSE",
          url: "https://example.com/sse2",
          command: "",
          forward_headers: {},
        },
        {
          name: "test-stdio-3",
          type: "STDIO",
          command: "npx server",
          forward_headers: {},
        },
      ];

      await repo.bulkCreate(servers);

      expect(insertValuesCalls).toHaveLength(1);
      const passed = insertValuesCalls[0];
      expect(passed[0].command).toBeNull();
      expect(passed[1].command).toBeNull();
      expect(passed[2].command).toBe("npx server");
    });
  });
});
