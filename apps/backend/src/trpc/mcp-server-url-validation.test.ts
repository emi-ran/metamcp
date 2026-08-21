import { describe, expect, it } from "vitest";

import { CreateMcpServerRequestSchema } from "@repo/zod-types";

const createStreamableHttpServer = (url: string) => ({
  name: "Context7",
  type: "STREAMABLE_HTTP" as const,
  url,
});

describe("MCP server HTTP URL validation", () => {
  it("accepts Context7's streamable HTTP endpoint", () => {
    expect(
      CreateMcpServerRequestSchema.safeParse(
        createStreamableHttpServer("https://mcp.context7.com/mcp"),
      ).success,
    ).toBe(true);
  });

  it("rejects non-HTTP protocols for streamable HTTP servers", () => {
    expect(
      CreateMcpServerRequestSchema.safeParse(
        createStreamableHttpServer("ftp://mcp.context7.com/mcp"),
      ).success,
    ).toBe(false);
  });
});
