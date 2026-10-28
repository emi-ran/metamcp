import {
  type ClientRequest,
  createServer,
  request,
  type RequestListener,
  type Server as HttpServer,
} from "node:http";
import type { AddressInfo } from "node:net";
import { deflateSync, gzipSync } from "node:zlib";

import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { executeToolWithMiddleware } from "../../routers/public-metamcp/openapi/tool-execution";
import type { ToolExecutionRequest } from "../../routers/public-metamcp/openapi/types";
import mcpProxy from "../mcp-proxy";
import { createMetaMcpClient } from "./client";
import { metaMcpServerPool } from "./metamcp-server-pool";
import {
  assertToolInputElements,
  MCP_MAX_REQUEST_BODY_BYTES,
  MCP_MAX_TOOL_INPUT_ELEMENTS,
  MCP_STREAMABLE_HTTP_OPTIONS,
  parseMcpJsonBody,
  parseMcpSseBody,
} from "./request-limits";

vi.mock("../../db/repositories", () => ({ oauthSessionsRepository: {} }));
vi.mock("../oauth-upstream/refresh-on-401", () => ({
  tryRefreshUpstreamTokens: vi.fn(),
}));
vi.mock("../oauth-upstream/retry-post-auth", () => ({
  recoverFromPostAuthRace: vi.fn(),
}));
vi.mock("./server-error-tracker", () => ({ serverErrorTracker: {} }));
vi.mock("./utils", () => ({ resolveEnvVariables: (env: unknown) => env }));
vi.mock("./metamcp-server-pool", () => ({
  metaMcpServerPool: { getOpenApiServer: vi.fn().mockResolvedValue({}) },
}));
vi.mock("../../routers/public-metamcp/openapi/handlers", () => ({
  createMiddlewareEnabledHandlers: () => ({
    handlerContext: {},
    callToolWithMiddleware: vi.fn().mockResolvedValue({ content: [] }),
  }),
}));

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function listen(handler: RequestListener) {
  const server: HttpServer = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};
const init = {
  jsonrpc: "2.0" as const,
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
};

async function httpHarness() {
  const tool = vi.fn().mockResolvedValue({ content: [] });
  const app = express();
  app.all("/mcp", async (req, res) => {
    // Stateless SDK transports are deliberately single-request instances.
    const transport = new StreamableHTTPServerTransport({
      ...MCP_STREAMABLE_HTTP_OPTIONS,
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = new Server(
      { name: "test", version: "1" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(CallToolRequestSchema, async (message) => {
      assertToolInputElements(message.params.arguments);
      return tool(message);
    });
    await server.connect(transport);
    try {
      await transport.handleRequest(req, res);
    } finally {
      await server.close();
    }
  });
  const url = `${await listen(app)}/mcp`;
  return { url, tool };
}

describe("patched SDK raw HTTP boundaries", () => {
  it("initializes normally and rejects malformed JSON", async () => {
    const { url } = await httpHarness();
    const ok = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(init),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      id: 1,
      result: { serverInfo: { name: "test" } },
    });
    const invalid = await fetch(url, { method: "POST", headers, body: "{" });
    expect(invalid.status).toBe(400);
  });

  it("rejects declared and streamed over-limit bodies with 413", async () => {
    const { url } = await httpHarness();
    const body = JSON.stringify({
      value: "x".repeat(MCP_MAX_REQUEST_BODY_BYTES),
    });
    const declared = await fetch(url, { method: "POST", headers, body });
    expect(declared.status).toBe(413);
    const streamedStatus = await new Promise<number>((resolve, reject) => {
      const req = request(
        url,
        {
          method: "POST",
          headers: { ...headers, "transfer-encoding": "chunked" },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.write(body.slice(0, 1024));
      req.end(body.slice(1024));
    });
    expect(streamedStatus).toBe(413);
  });

  it("accepts the byte ceiling, rejects 101 batches before dispatch, accepts 100", async () => {
    const { url, tool } = await httpHarness();
    const body = JSON.stringify(init);
    const exact = await fetch(url, {
      method: "POST",
      headers,
      body: body.padEnd(MCP_MAX_REQUEST_BODY_BYTES),
    });
    expect(exact.status).toBe(200);
    const batch = Array.from({ length: 100 }, (_, id) => ({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "test" },
    }));
    const accepted = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
    });
    expect(accepted.status).toBe(200);
    await accepted.text();
    expect(tool).toHaveBeenCalledTimes(100);
    tool.mockClear();
    const rejected = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify([...batch, batch[0]]),
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: { code: -32600 } });
    expect(tool).not.toHaveBeenCalled();
  });

  it("rejects excessive tool elements before the low-level handler executes", async () => {
    const { url, tool } = await httpHarness();
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "test",
          arguments: { items: Array(MCP_MAX_TOOL_INPUT_ELEMENTS).fill(0) },
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: 2,
      error: { code: -32602 },
    });
    expect(tool).not.toHaveBeenCalled();
  });
});

describe("SSE and transport-only proxy boundaries", () => {
  it("bounds SSE parser, rejects batch arrays, and passes valid messages", async () => {
    const app = express();
    let transport: SSEServerTransport;
    const onmessage = vi.fn();
    app.get("/sse", async (_req, res) => {
      transport = new SSEServerTransport("/message", res);
      transport.onmessage = onmessage;
      await transport.start();
    });
    app.post("/message", parseMcpSseBody, (req, res) =>
      transport.handlePostMessage(req, res, req.body),
    );
    const base = await listen(app);
    const connection = await fetch(`${base}/sse`);
    if (!connection.body) throw new Error("Missing SSE response stream");
    const reader = connection.body.getReader();
    await reader.read();
    cleanup.push(async () => {
      await reader.cancel();
      await transport.close();
    });
    expect(
      (
        await fetch(`${base}/message`, {
          method: "POST",
          headers,
          body: JSON.stringify(init),
        })
      ).status,
    ).toBe(202);
    expect(onmessage).toHaveBeenCalledTimes(1);
    expect(
      (
        await fetch(`${base}/message`, {
          method: "POST",
          headers,
          body: JSON.stringify([init]),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${base}/message`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            value: "x".repeat(MCP_MAX_REQUEST_BODY_BYTES),
          }),
        })
      ).status,
    ).toBe(413);
    expect(onmessage).toHaveBeenCalledTimes(1);
  });

  it("rejects tool amplification before forwarding to HTTP or STDIO upstreams", async () => {
    const downstream: Transport = {
      start: vi.fn(),
      close: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const upstream: Transport = {
      start: vi.fn(),
      close: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
    };
    mcpProxy({ transportToClient: downstream, transportToServer: upstream });
    downstream.onmessage?.({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "test",
        arguments: { items: Array(MCP_MAX_TOOL_INPUT_ELEMENTS).fill(0) },
      },
    });
    expect(upstream.send).not.toHaveBeenCalled();
    expect(downstream.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 3,
        error: expect.objectContaining({ code: -32602 }),
      }),
    );
    downstream.onmessage?.({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "test", arguments: {} },
    });
    expect(upstream.send).toHaveBeenCalledTimes(1);
  });
});

describe("patched client headers and redirects", () => {
  it.each(["SSE", "STREAMABLE_HTTP"] as const)(
    "%s preserves auth/custom/protocol headers and blocks cross-origin redirects",
    async (type) => {
      const target = vi.fn();
      const other = await listen((_req, res) => {
        target();
        res.end();
      });
      const received: Array<Record<string, unknown>> = [];
      const base = await listen((req, res) => {
        received.push(req.headers);
        if (req.url === "/cross") {
          res.writeHead(307, { location: `${other}/capture` });
          res.end();
          return;
        }
        if (req.url === "/same") {
          res.writeHead(307, { location: "/ok" });
          res.end();
          return;
        }
        if (type === "SSE") {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write("event: endpoint\ndata: /messages\n\n");
        } else {
          res.writeHead(202);
          res.end();
        }
      });
      const make = (path: string) => {
        const { transport } = createMetaMcpClient({
          uuid: "test",
          name: "test",
          description: "",
          stderr: "pipe",
          created_at: "2026-10-25T00:00:00.000Z",
          status: "active",
          type,
          url: `${base}${path}`,
          bearerToken: "synthetic-token",
          headers: { "X-Api-Key": "synthetic-key" },
        });
        if (!transport) throw new Error("Missing client transport");
        cleanup.push(() => transport.close());
        return transport;
      };
      const same = make("/same");
      if (same instanceof SSEClientTransport) {
        same.setProtocolVersion("2025-03-26");
        await same.start();
      } else {
        const http = same as StreamableHTTPClientTransport;
        http.setProtocolVersion("2025-03-26");
        await http.start();
        await http.send(init);
      }
      expect(received.at(-1)).toMatchObject({
        authorization: "Bearer synthetic-token",
        "x-api-key": "synthetic-key",
        "mcp-protocol-version": "2025-03-26",
      });
      if (type === "SSE")
        expect(received.at(-1)?.accept).toBe("text/event-stream");
      const cross = make("/cross");
      if (cross instanceof SSEClientTransport)
        await expect(cross.start()).rejects.toThrow(/redirect/i);
      else {
        await cross.start();
        await expect(cross.send(init)).rejects.toThrow(/redirect/i);
      }
      expect(target).not.toHaveBeenCalled();
    },
  );
});

describe("patched body-parser compressed-body regression", () => {
  it("survives a gzip frame followed by trailing garbage", async () => {
    const app = express();
    app.use(express.json());
    app.post("/json", (_req, res) => res.json({ ok: true }));
    const base = await listen(app);
    const corrupt = Buffer.concat([
      gzipSync(Buffer.from('{"test":true}')),
      Buffer.from("trailing-garbage"),
    ]);
    const response = await fetch(`${base}/json`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      body: corrupt,
    });
    expect(response.status).toBe(400);
    const healthy = await fetch(`${base}/json`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(healthy.status).toBe(200);
  });

  it("finishes the HTTP body when the decompressor finishes before trailing bytes", async () => {
    // Compressed-body advisory regression: finish decoding first,
    // then deliver trailing bytes while downstream waits for HTTP completion.
    const first = Buffer.concat([
      deflateSync(Buffer.from('{"test":true}')),
      Buffer.from([0]),
    ]);
    const trailing = Buffer.alloc(1024);
    let client: ClientRequest;
    const parser = express.json();
    const app = express();
    app.post("/json", (req, res, next) => {
      parser(req, res, (error) => {
        if (error) return next(error);
        req.on("end", () => res.json(req.body));
        client.end(trailing);
      });
    });
    const base = await listen(app);
    const result = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        client = request(
          `${base}/json`,
          {
            method: "POST",
            agent: false,
            headers: {
              "content-type": "application/json",
              "content-encoding": "deflate",
              "content-length": first.length + trailing.length,
            },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("error", reject);
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
          },
        );
        client.setTimeout(2000, () =>
          client.destroy(new Error("Compressed request did not finish")),
        );
        client.on("error", reject);
        cleanup.push(async () => {
          client.destroy();
        });
        client.write(first);
      },
    );
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ test: true });
  });
});

describe("OpenAPI tool boundary", () => {
  it("rejects excessive arguments before acquiring a server and still dispatches small input", async () => {
    vi.mocked(metaMcpServerPool.getOpenApiServer).mockClear();
    const app = express();
    app.post("/tool", parseMcpSseBody, async (req, res) => {
      await executeToolWithMiddleware(
        {
          ...req,
          params: { tool_name: "test" },
          namespaceUuid: "synthetic",
        } as unknown as ToolExecutionRequest,
        res,
        req.body,
      );
    });
    const base = await listen(app);
    const excessive = await fetch(`${base}/tool`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        items: Array(MCP_MAX_TOOL_INPUT_ELEMENTS).fill(0),
      }),
    });
    expect(excessive.status).toBe(400);
    expect(metaMcpServerPool.getOpenApiServer).not.toHaveBeenCalled();
    const small = await fetch(`${base}/tool`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(small.status).toBe(200);
    expect(metaMcpServerPool.getOpenApiServer).toHaveBeenCalledTimes(1);
  });
});

describe("bounded JSON parser error responses", () => {
  it("returns a sanitized JSON 400 without dispatch or development stack leakage", async () => {
    const app = express();
    const handler = vi.fn();
    app.post("/json", parseMcpJsonBody, (_req, res) => {
      handler();
      res.json({ ok: true });
    });
    const base = await listen(app);
    const response = await fetch(`${base}/json`, {
      method: "POST",
      headers,
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Invalid request body" });
    expect(handler).not.toHaveBeenCalled();
    const healthy = await fetch(`${base}/json`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(healthy.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
