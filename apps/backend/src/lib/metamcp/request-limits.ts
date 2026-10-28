import type { StreamableHTTPServerTransportOptions } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import express from "express";

// Keep small JSON tool calls useful without retaining the SDK's 4 MiB default.
export const MCP_MAX_REQUEST_BODY_BYTES = 1024 * 1024;
export const MCP_MAX_TOOL_INPUT_ELEMENTS = 10_000;
// Keep the global parser skip aligned with Express's case-insensitive mounts.
export const isMcpTransportPath = (path: string): boolean =>
  /^\/(?:mcp-proxy|metamcp)(?:\/|$)/i.test(path);
export const MCP_STREAMABLE_HTTP_OPTIONS = {
  maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES,
} satisfies StreamableHTTPServerTransportOptions;

// Legacy SSE has no maxRequestBodySize option. Bound parsing before passing
// parsedBody to its transport, which would otherwise use its own 4 MiB reader.
const mcpJsonParser = express.json({
  limit: MCP_MAX_REQUEST_BODY_BYTES,
});

// Do not let Express's development error renderer expose parser stacks or
// request content. Preserve the parser's client-error status outside route try/catch.
export const parseMcpJsonBody: express.RequestHandler = (req, res, next) => {
  mcpJsonParser(req, res, (error?: unknown) => {
    if (!error) return next();
    const status = (error as { status?: unknown }).status;
    if (typeof status !== "number" || status < 400 || status >= 500) {
      return next(error);
    }
    res.status(status).json({
      error: status === 413 ? "Request body too large" : "Invalid request body",
    });
  });
};
export const parseMcpSseBody = parseMcpJsonBody;

/**
 * Match McpServer's maxToolInputElements semantics for our low-level Server and
 * transport-only proxy, neither of which exposes that high-level SDK option.
 * Count own object members and array entries, not string characters; stop early.
 */
export function assertToolInputElements(
  value: unknown,
  max = MCP_MAX_TOOL_INPUT_ELEMENTS,
): void {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      if (++count > max) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Tool arguments contain more than the maximum of ${max} elements`,
        );
      }
      const child = (node as Record<string, unknown>)[key];
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
}
