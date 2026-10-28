import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  server: null as null | { uuid: string; name: string },
  status: null as null | string,
  fail: false,
}));
vi.mock("./tool-identity", () => ({
  resolveNamespaceServer: vi.fn(async () => {
    if (state.fail) throw new Error("database unavailable");
    return state.server;
  }),
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("../../../db/index", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => {
            if (state.fail) throw new Error("database unavailable");
            return state.status ? [{ status: state.status }] : [];
          },
        }),
      }),
    }),
  },
}));

import {
  createFilterCallToolMiddleware,
  createFilterListToolsMiddleware,
} from "./filter-tools.functional";

const context = {
  namespaceUuid: "ns",
  sessionId: "session",
  endpointName: "endpoint",
};
const callRequest = {
  method: "tools/call" as const,
  params: { name: "server__tool" },
};
const listRequest = { method: "tools/list" as const };
const tool = { name: "server__tool", inputSchema: { type: "object" as const } };

describe("namespace tool authorization", () => {
  beforeEach(() => {
    state.server = { uuid: "server-1", name: "server" };
    state.status = "ACTIVE";
    state.fail = false;
  });
  it.each(["INACTIVE", null])(
    "denies list and call for %s mapping",
    async (status) => {
      state.status = status;
      const call = vi.fn(async () => ({ content: [] }));
      const result = await createFilterCallToolMiddleware({
        cacheEnabled: false,
      })(call)(callRequest, context);
      const list = await createFilterListToolsMiddleware({
        cacheEnabled: false,
      })(async () => ({ tools: [tool] }))(listRequest, context);
      expect(result.isError).toBe(true);
      expect(call).not.toHaveBeenCalled();
      expect(list.tools).toEqual([]);
    },
  );
  it("allows an active mapped tool", async () => {
    const call = vi.fn(async () => ({ content: [] }));
    await createFilterCallToolMiddleware({ cacheEnabled: false })(call)(
      callRequest,
      context,
    );
    expect(call).toHaveBeenCalledOnce();
  });
  it("denies missing or ambiguous server and lookup errors", async () => {
    const call = vi.fn(async () => ({ content: [] }));
    const handler = createFilterCallToolMiddleware({ cacheEnabled: false })(
      call,
    );
    state.server = null;
    expect((await handler(callRequest, context)).isError).toBe(true);
    state.fail = true;
    expect((await handler(callRequest, context)).isError).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });
});
