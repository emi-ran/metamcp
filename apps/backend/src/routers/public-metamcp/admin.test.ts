import express from "express";
import { describe, expect, it } from "vitest";
import adminRouter from "./admin";

describe("endpoint admin routes", () => {
  it("disables status and reset regardless of endpoint credentials", async () => {
    const app = express();
    app.use(adminRouter);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing address");
      const base = `http://127.0.0.1:${address.port}/endpoint/admin`;
      expect((await fetch(`${base}/error-status`)).status).toBe(410);
      expect(
        (
          await fetch(`${base}/reset-errors`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ serverUuid: "other" }),
          })
        ).status,
      ).toBe(410);
    } finally {
      server.close();
    }
  });
});
