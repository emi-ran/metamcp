import { describe, expect, it, vi } from "vitest";
const data = vi.hoisted(() => ({
  servers: [] as { uuid: string; name: string }[],
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ innerJoin: () => ({ where: async () => data.servers }) }),
    }),
  },
}));
vi.mock("../utils", () => ({
  sanitizeName: (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, ""),
}));
import { resolveNamespaceServer } from "./tool-identity";

describe("namespace server identity", () => {
  it("resolves normalized names only when unique", async () => {
    data.servers = [{ uuid: "one", name: "My Server" }];
    expect(await resolveNamespaceServer("MyServer", "namespace-a")).toEqual(
      data.servers[0],
    );
    data.servers.push({ uuid: "two", name: "MyServer" });
    expect(await resolveNamespaceServer("MyServer", "namespace-a")).toBeNull();
    expect(await resolveNamespaceServer("missing", "namespace-a")).toBeNull();
  });
});
