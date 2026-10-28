import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import {
  assertToolInputElements,
  isMcpTransportPath,
  MCP_MAX_TOOL_INPUT_ELEMENTS,
  MCP_STREAMABLE_HTTP_OPTIONS,
} from "./request-limits";

describe("MCP request limits", () => {
  it("aligns raw-body parser skip with case-insensitive Express mounts", () => {
    for (const path of [
      "/metamcp/test/mcp",
      "/MetaMcp/test/mcp",
      "/MCP-PROXY/server/mcp",
      "/metamcp",
      "/mcp-proxy",
    ]) {
      expect(isMcpTransportPath(path)).toBe(true);
    }
    for (const path of [
      "/metamcp-other/test",
      "/mcp-proxy-other",
      "/trpc",
      "/oauth/token",
    ]) {
      expect(isMcpTransportPath(path)).toBe(false);
    }
  });
  it("sets a finite byte ceiling on raw HTTP requests", () => {
    expect(MCP_STREAMABLE_HTTP_OPTIONS.maxRequestBodySize).toBe(1024 * 1024);
  });

  it("accepts exactly the element ceiling, counting keys and array entries", () => {
    expect(() =>
      assertToolInputElements({
        values: Array(MCP_MAX_TOOL_INPUT_ELEMENTS - 1).fill(null),
      }),
    ).not.toThrow();
  });

  it("rejects one extra element with the SDK InvalidParams error", () => {
    expect(() =>
      assertToolInputElements({
        values: Array(MCP_MAX_TOOL_INPUT_ELEMENTS).fill(0),
      }),
    ).toThrow(McpError);
  });

  it("counts nested object keys and arrays, but not string characters", () => {
    expect(() =>
      assertToolInputElements({ a: { b: [null, { c: true }] } }, 5),
    ).not.toThrow();
    expect(() =>
      assertToolInputElements({ a: { b: [null, { c: true }] } }, 4),
    ).toThrow(/maximum/);
    expect(() =>
      assertToolInputElements({ text: "x".repeat(100_000) }, 1),
    ).not.toThrow();
    expect(() => assertToolInputElements(undefined)).not.toThrow();
  });

  it("handles deep input iteratively without call-stack overflow", () => {
    let value: unknown = null;
    for (let i = 0; i < MCP_MAX_TOOL_INPUT_ELEMENTS + 1; i++)
      value = { next: value };
    expect(() => assertToolInputElements(value)).toThrow(/maximum/);
  });
});
