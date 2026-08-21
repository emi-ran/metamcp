import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_WORKSPACE_TOOLS,
  GoogleWorkspaceClient,
  GoogleWorkspaceError,
  type GoogleConnectionStore,
  type GoogleHttpClient,
} from "./google-workspace";

const userConnection = {
  accessToken: "old-access",
  refreshToken: "refresh-token",
  expiresAt: new Date(Date.now() + 60_000),
  scopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
  ],
};

function fakeStore(): GoogleConnectionStore {
  return {
    getDecryptedTokens: vi.fn(async (userId: string) =>
      userId === "request-user" ? userConnection : null,
    ),
    upsertConnection: vi.fn(async () => undefined),
  };
}

function fakeHttp(responses: Response[]): GoogleHttpClient {
  return { fetch: vi.fn(async () => responses.shift() ?? new Response()) };
}

describe("Google Workspace catalog", () => {
  it("contains Gmail, Calendar, Drive, Docs, and Sheets tools", () => {
    expect(GOOGLE_WORKSPACE_TOOLS.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "gmail_list_messages",
        "calendar_create_event",
        "drive_share_file",
        "docs_update_document",
        "sheets_update_values",
      ]),
    );
  });
});

describe("GoogleWorkspaceClient", () => {
  it("uses only request user's Google connection", async () => {
    const store = fakeStore();
    const client = new GoogleWorkspaceClient({
      connections: store,
      http: fakeHttp([new Response(JSON.stringify({ files: [] }))]),
      sleep: vi.fn(),
    });

    await client.execute({
      userId: "request-user",
      toolName: "drive_list_files",
      arguments: {},
    });

    expect(store.getDecryptedTokens).toHaveBeenCalledWith("request-user");
    expect(store.getDecryptedTokens).not.toHaveBeenCalledWith(
      expect.stringMatching(/other|target/i),
    );
  });

  it("rejects missing authenticated user", async () => {
    const client = new GoogleWorkspaceClient({
      connections: fakeStore(),
      http: fakeHttp([]),
      sleep: vi.fn(),
    });

    await expect(
      client.execute({ userId: undefined, toolName: "gmail_list_messages", arguments: {} }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("parses Gmail MIME headers and excludes oversized attachments", async () => {
    const client = new GoogleWorkspaceClient({
      connections: fakeStore(),
      http: fakeHttp([
        new Response(
          JSON.stringify({
            id: "m1",
            payload: {
              headers: [
                { name: "Subject", value: "Hello" },
                { name: "From", value: "sender@example.test" },
              ],
              parts: [
                { mimeType: "text/plain", body: { data: "aGVsbG8" } },
                {
                  filename: "too-big.bin",
                  mimeType: "application/octet-stream",
                  body: { attachmentId: "a1", size: 30_000_000 },
                },
              ],
            },
          }),
        ),
      ]),
      sleep: vi.fn(),
    });

    const result = await client.execute({
      userId: "request-user",
      toolName: "gmail_get_message",
      arguments: { messageId: "m1" },
    });

    expect(result).toMatchObject({
      subject: "Hello",
      from: "sender@example.test",
      text: "hello",
      attachments: [{ filename: "too-big.bin", available: false }],
    });
  });

  it("requires timezone-bearing ISO timestamps before calendar writes", async () => {
    const client = new GoogleWorkspaceClient({
      connections: fakeStore(),
      http: fakeHttp([]),
      sleep: vi.fn(),
    });

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "calendar_create_event",
        allowWrites: true,
        arguments: { calendarId: "primary", start: "2026-08-21T10:00:00", end: "2026-08-21T11:00:00" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "calendar_update_event",
        allowWrites: true,
        arguments: {
          calendarId: "primary",
          eventId: "event-1",
          patch: { start: { dateTime: "2026-08-21T10:00:00" } },
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("retries transient Google responses with bounded backoff", async () => {
    const sleep = vi.fn(async () => undefined);
    const client = new GoogleWorkspaceClient({
      connections: {
        ...fakeStore(),
        getDecryptedTokens: vi.fn(async () => ({ ...userConnection, expiresAt: new Date(Date.now() + 60_000) })),
      },
      http: fakeHttp([
        new Response("busy", { status: 429, headers: { "Retry-After": "0" } }),
        new Response(JSON.stringify({ files: [] })),
      ]),
      sleep,
    });

    await client.execute({ userId: "request-user", toolName: "drive_list_files", arguments: {} });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("refreshes once for concurrent requests and persists rotated refresh token", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    const store = {
      ...fakeStore(),
      getDecryptedTokens: vi.fn(async () => ({ ...userConnection, expiresAt: new Date(Date.now() - 60_000) })),
    };
    const http = fakeHttp([
      new Response(JSON.stringify({ access_token: "new-access", refresh_token: "rotated", expires_in: 3600 })),
      new Response(JSON.stringify({ files: [] })),
      new Response(JSON.stringify({ files: [] })),
    ]);
    const client = new GoogleWorkspaceClient({ connections: store, http, sleep: vi.fn() });

    await Promise.all([
      client.execute({ userId: "request-user", toolName: "drive_list_files", arguments: {} }),
      client.execute({ userId: "request-user", toolName: "drive_list_files", arguments: {} }),
    ]);

    expect(http.fetch).toHaveBeenCalledTimes(3);
    expect(store.upsertConnection).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "request-user", refreshToken: "rotated", accessToken: "new-access" }),
    );
  });

  it("maps Google errors without leaking upstream response bodies", async () => {
    const client = new GoogleWorkspaceClient({
      connections: {
        ...fakeStore(),
        getDecryptedTokens: vi.fn(async () => ({ ...userConnection, expiresAt: new Date(Date.now() + 60_000) })),
      },
      http: fakeHttp([new Response("secret upstream detail", { status: 403 })]),
      sleep: vi.fn(),
    });

    await expect(
      client.execute({ userId: "request-user", toolName: "drive_list_files", arguments: {} }),
    ).rejects.toEqual(new GoogleWorkspaceError("FORBIDDEN", "Google access was denied"));
  });

  it("uses product API origins for Docs and Sheets", async () => {
    const http = fakeHttp([
      new Response(JSON.stringify({ documentId: "doc-1" })),
      new Response(JSON.stringify({ spreadsheetId: "sheet-1" })),
    ]);
    const client = new GoogleWorkspaceClient({
      connections: fakeStore(),
      http,
      sleep: vi.fn(),
    });

    await client.execute({ userId: "request-user", toolName: "docs_get_document", arguments: { documentId: "doc-1" } });
    await client.execute({ userId: "request-user", toolName: "sheets_get_spreadsheet", arguments: { spreadsheetId: "sheet-1" } });

    expect(http.fetch).toHaveBeenNthCalledWith(1, "https://docs.googleapis.com/v1/documents/doc-1", expect.any(Object));
    expect(http.fetch).toHaveBeenNthCalledWith(2, "https://sheets.googleapis.com/v4/spreadsheets/sheet-1?includeGridData=false", expect.any(Object));
  });
});
