import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/repositories", () => ({
  configRepo: {
    getConfig: vi.fn(async () => undefined),
  },
}));

vi.mock("../../db/repositories/config.repo", () => ({
  configRepo: {
    getConfig: vi.fn(async () => undefined),
  },
}));

import {
  GOOGLE_WORKSPACE_DEFAULT_TOOL_STATUS,
  GOOGLE_WORKSPACE_SERVER_NAME,
  GOOGLE_WORKSPACE_TOOLS,
  type GoogleConnectionStore,
  type GoogleHttpClient,
  GoogleWorkspaceClient,
  GoogleWorkspaceError,
  MAX_DRIVE_DOWNLOAD_BYTES,
  MAX_GMAIL_ATTACHMENT_BYTES,
} from "./google-workspace";

const expectedToolNames = [
  "gmail_search",
  "gmail_get_message",
  "gmail_get_thread",
  "gmail_list_labels",
  "gmail_download_attachment",
  "gmail_mark_read",
  "gmail_mark_unread",
  "gmail_star",
  "gmail_unstar",
  "gmail_archive",
  "gmail_unarchive",
  "gmail_move_to_inbox",
  "gmail_trash",
  "gmail_untrash",
  "gmail_report_spam",
  "gmail_remove_spam",
  "gmail_add_labels",
  "gmail_remove_labels",
  "gmail_trash_thread",
  "gmail_untrash_thread",
  "gmail_create_label",
  "gmail_update_label",
  "gmail_delete_label",
  "gmail_list_drafts",
  "gmail_get_draft",
  "gmail_create_draft",
  "gmail_update_draft",
  "gmail_delete_draft",
  "calendar_list_calendars",
  "calendar_list_events",
  "calendar_get_event",
  "calendar_freebusy",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
  "drive_search",
  "drive_get_file",
  "drive_list_folder",
  "drive_download_file",
  "drive_upload_file",
  "drive_create_folder",
  "drive_share_file",
  "drive_delete_file",
  "docs_get",
  "docs_create",
  "docs_append",
  "docs_replace_text",
  "sheets_get",
  "sheets_batch_get",
  "sheets_update",
  "sheets_append",
  "sheets_create",
] as const;

const allScopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
];

const userConnection = {
  accessToken: "old-access",
  refreshToken: "refresh-token",
  expiresAt: new Date(Date.now() + 60_000),
  scopes: allScopes,
};

function fakeStore(scopes = allScopes): GoogleConnectionStore {
  return {
    getDecryptedTokens: vi.fn(async (userId: string, connectionId?: string) => {
      if (userId !== "request-user") return null;
      if (connectionId === "non-existent-or-other-user-connection-id") return null;
      return { ...userConnection, scopes };
    }),
    upsertConnection: vi.fn(async () => undefined),
  };
}

function fakeHttp(responses: Response[]): GoogleHttpClient {
  return { fetch: vi.fn(async () => responses.shift() ?? new Response()) };
}

function clientWith(responses: Response[], scopes = allScopes) {
  const http = fakeHttp(responses);
  return {
    http,
    client: new GoogleWorkspaceClient({
      connections: fakeStore(scopes),
      http,
      sleep: vi.fn(),
    }),
  };
}

describe("Google Workspace catalog", () => {
  it("contains only contract tool names under exact GoogleWorkspace prefix", () => {
    expect(GOOGLE_WORKSPACE_SERVER_NAME).toBe("GoogleWorkspace");
    expect(GOOGLE_WORKSPACE_DEFAULT_TOOL_STATUS).toBe("INACTIVE");
    expect(GOOGLE_WORKSPACE_TOOLS.map((tool) => tool.name)).toEqual(
      expectedToolNames,
    );
    expect(
      GOOGLE_WORKSPACE_TOOLS.map(
        (tool) => `${GOOGLE_WORKSPACE_SERVER_NAME}__${tool.name}`,
      ),
    ).toEqual(expectedToolNames.map((name) => `GoogleWorkspace__${name}`));
  });

  it("includes optional connectionId UUID property in every tool schema with additionalProperties: false", () => {
    for (const tool of GOOGLE_WORKSPACE_TOOLS) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.properties).toBeDefined();
      expect(tool.inputSchema.properties).toHaveProperty("connectionId");
      expect((tool.inputSchema.properties as any).connectionId).toMatchObject({
        type: "string",
        format: "uuid",
      });
      // connectionId must be optional, not in required
      if (tool.inputSchema.required) {
        expect(tool.inputSchema.required).not.toContain("connectionId");
      }
    }
  });

  it("marks every write, delete, and share tool as policy-gated", () => {
    const writeTools = GOOGLE_WORKSPACE_TOOLS.filter(
      (tool) => tool.annotations?.readOnlyHint === false,
    );
    expect(writeTools.map((tool) => tool.name)).toEqual([
      "gmail_mark_read",
      "gmail_mark_unread",
      "gmail_star",
      "gmail_unstar",
      "gmail_archive",
      "gmail_unarchive",
      "gmail_move_to_inbox",
      "gmail_trash",
      "gmail_untrash",
      "gmail_report_spam",
      "gmail_remove_spam",
      "gmail_add_labels",
      "gmail_remove_labels",
      "gmail_trash_thread",
      "gmail_untrash_thread",
      "gmail_create_label",
      "gmail_update_label",
      "gmail_delete_label",
      "gmail_create_draft",
      "gmail_update_draft",
      "gmail_delete_draft",
      "calendar_create_event",
      "calendar_update_event",
      "calendar_delete_event",
      "drive_upload_file",
      "drive_create_folder",
      "drive_share_file",
      "drive_delete_file",
      "docs_create",
      "docs_append",
      "docs_replace_text",
      "sheets_update",
      "sheets_append",
      "sheets_create",
    ]);
  });
});

describe("GoogleWorkspaceClient", () => {
  it("uses only authenticated request user's connection", async () => {
    const store = fakeStore();
    const client = new GoogleWorkspaceClient({
      connections: store,
      http: fakeHttp([new Response(JSON.stringify({ files: [] }))]),
      sleep: vi.fn(),
    });

    await client.execute({
      userId: "request-user",
      toolName: "drive_search",
      arguments: { query: "name contains 'report'" },
    });

    expect(store.getDecryptedTokens).toHaveBeenCalledWith("request-user", undefined);
    expect(store.getDecryptedTokens).toHaveBeenCalledTimes(1);
  });

  it("passes connectionId when specified and routes to targeted connection", async () => {
    const store = fakeStore();
    const client = new GoogleWorkspaceClient({
      connections: store,
      http: fakeHttp([new Response(JSON.stringify({ files: [] }))]),
      sleep: vi.fn(),
    });

    const specificConnectionId = "11111111-2222-4333-8444-555555555555";
    await client.execute({
      userId: "request-user",
      toolName: "drive_search",
      arguments: { query: "name contains 'report'", connectionId: specificConnectionId },
      connectionId: specificConnectionId,
    });

    expect(store.getDecryptedTokens).toHaveBeenCalledWith("request-user", specificConnectionId);
    expect(store.getDecryptedTokens).toHaveBeenCalledTimes(1);
  });

  it("safely rejects when non-owner or invalid connectionId returns null from repository", async () => {
    const store = fakeStore();
    const client = new GoogleWorkspaceClient({
      connections: store,
      http: fakeHttp([]),
      sleep: vi.fn(),
    });

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "drive_search",
        arguments: { query: "name contains 'report'" },
        connectionId: "non-existent-or-other-user-connection-id",
      }),
    ).rejects.toMatchObject({ code: "NOT_CONNECTED" });
  });

  it("rejects missing authenticated user and inactive write policy", async () => {
    const { client } = clientWith([]);

    await expect(
      client.execute({
        userId: undefined,
        toolName: "gmail_search",
        arguments: { query: "from:test@example.test" },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "drive_delete_file",
        arguments: { fileId: "file-1" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns minimal required Gmail search metadata without message bodies", async () => {
    const { client, http } = clientWith([
      new Response(
        JSON.stringify({
          messages: [{ id: "m1", threadId: "t1" }],
          nextPageToken: "next",
          resultSizeEstimate: 25,
        }),
      ),
      new Response(
        JSON.stringify({
          id: "m1",
          threadId: "t1",
          snippet: "preview snippet",
          labelIds: ["INBOX", "UNREAD"],
          internalDate: "1787306400000",
          payload: {
            headers: [
              { name: "From", value: "sender@example.test" },
              { name: "To", value: "receiver@example.test" },
              { name: "Subject", value: "Test Subject" },
              { name: "Date", value: "Fri, 21 Aug 2026 12:00:00 +0000" },
            ],
            body: { data: "U2VjcmV0IGJvZHk=" },
          },
        }),
      ),
    ]);

    const result = await client.execute({
      userId: "request-user",
      toolName: "gmail_search",
      arguments: { query: "is:unread", maxResults: 5, pageToken: "page" },
    });

    expect(result).toEqual({
      messages: [
        {
          id: "m1",
          threadId: "t1",
          from: "sender@example.test",
          to: "receiver@example.test",
          subject: "Test Subject",
          date: "Fri, 21 Aug 2026 12:00:00 +0000",
          snippet: "preview snippet",
          labels: ["INBOX", "UNREAD"],
        },
      ],
      nextPageToken: "next",
    });

    // Ensure no message body / text / attachments leaked
    const msg = (result as { messages: Record<string, unknown>[] }).messages[0];
    expect(msg).not.toHaveProperty("text");
    expect(msg).not.toHaveProperty("body");
    expect(msg).not.toHaveProperty("attachments");
    expect(msg).not.toHaveProperty("payload");
    expect(msg).not.toHaveProperty("internalDate");

    const calls = (http.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);

    const listUrl = String(calls[0][0]);
    expect(listUrl).toContain("/gmail/v1/users/me/messages?");
    expect(listUrl).toContain("q=is%3Aunread");
    expect(listUrl).toContain("maxResults=5");
    expect(listUrl).toContain("pageToken=page");
    expect(listUrl).toContain(
      "fields=messages%28id%2CthreadId%29%2CnextPageToken",
    );

    const getUrl = String(calls[1][0]);
    expect(getUrl).toContain("/gmail/v1/users/me/messages/m1?");
    expect(getUrl).toContain("format=metadata");
    expect(getUrl).toContain("metadataHeaders=From");
    expect(getUrl).toContain("metadataHeaders=To");
    expect(getUrl).toContain("metadataHeaders=Subject");
    expect(getUrl).toContain("metadataHeaders=Date");
    expect(getUrl).toContain(
      "fields=id%2CthreadId%2Csnippet%2ClabelIds%2Cpayload%2Fheaders",
    );
  });

  it("parses nested Gmail MIME for messages and threads", async () => {
    const mimeMessage = {
      id: "m1",
      threadId: "t1",
      internalDate: "1787306400000",
      snippet: "preview",
      payload: {
        headers: [
          { name: "Subject", value: "Hello" },
          { name: "From", value: "sender@example.test" },
          { name: "To", value: "receiver@example.test" },
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [{ mimeType: "text/plain", body: { data: "aGVsbG8" } }],
          },
          {
            filename: "report.pdf",
            mimeType: "application/pdf",
            body: { attachmentId: "a1", size: 123 },
          },
        ],
      },
    };
    const { client } = clientWith([
      new Response(JSON.stringify(mimeMessage)),
      new Response(JSON.stringify({ id: "t1", messages: [mimeMessage] })),
    ]);

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_get_message",
        arguments: { messageId: "m1" },
      }),
    ).resolves.toMatchObject({
      id: "m1",
      threadId: "t1",
      subject: "Hello",
      from: "sender@example.test",
      text: "hello",
      attachments: [
        {
          filename: "report.pdf",
          attachmentId: "a1",
          available: true,
        },
      ],
    });
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_get_thread",
        arguments: { threadId: "t1" },
      }),
    ).resolves.toMatchObject({
      id: "t1",
      messages: [{ id: "m1", subject: "Hello", text: "hello" }],
    });
  });

  it("enforces declared and decoded Gmail attachment limits", async () => {
    const oversizedData = Buffer.alloc(MAX_GMAIL_ATTACHMENT_BYTES + 1).toString(
      "base64url",
    );
    const { client } = clientWith([
      new Response(
        JSON.stringify({ data: "YQ", size: MAX_GMAIL_ATTACHMENT_BYTES + 1 }),
      ),
      new Response(JSON.stringify({ data: oversizedData, size: 1 })),
      new Response(JSON.stringify({ data: "c2FmZQ", size: 4 })),
    ]);

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_download_attachment",
        arguments: { messageId: "m1", attachmentId: "a1" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_download_attachment",
        arguments: { messageId: "m1", attachmentId: "a2" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_download_attachment",
        arguments: { messageId: "m1", attachmentId: "a3" },
      }),
    ).resolves.toEqual({ size: 4, dataBase64: "c2FmZQ==" });
  });

  it("annotates Phase 1 Gmail organization tools as writes with accurate safety hints", () => {
    const annotations = Object.fromEntries(
      GOOGLE_WORKSPACE_TOOLS.map((tool) => [tool.name, tool.annotations]),
    );
    for (const name of [
      "gmail_mark_read",
      "gmail_mark_unread",
      "gmail_star",
      "gmail_unstar",
      "gmail_archive",
      "gmail_unarchive",
      "gmail_move_to_inbox",
      "gmail_untrash",
      "gmail_report_spam",
      "gmail_remove_spam",
      "gmail_add_labels",
      "gmail_remove_labels",
      "gmail_untrash_thread",
    ]) {
      expect(annotations[name]).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      });
    }
    expect(annotations.gmail_trash).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(annotations.gmail_trash_thread).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
  });

  it("maps Phase 1 message modify actions to exact endpoints, methods, and payloads", async () => {
    const { client, http } = clientWith(
      [
        new Response(JSON.stringify({ id: "m1" })),
        new Response(JSON.stringify({ id: "m1" })),
        new Response(JSON.stringify({ id: "m1" })),
        new Response(JSON.stringify({ id: "m1" })),
        new Response(JSON.stringify({ id: "m1" })),
        new Response(JSON.stringify({ id: "m1" })),
      ],
      [...allScopes, "https://www.googleapis.com/auth/gmail.modify"],
    );

    await client.execute({
      userId: "request-user",
      toolName: "gmail_mark_read",
      allowWrites: true,
      arguments: { messageId: "m1" },
    });
    await client.execute({
      userId: "request-user",
      toolName: "gmail_mark_unread",
      allowWrites: true,
      arguments: { messageId: "m1" },
    });
    await client.execute({
      userId: "request-user",
      toolName: "gmail_star",
      allowWrites: true,
      arguments: { messageId: "m1" },
    });
    await client.execute({
      userId: "request-user",
      toolName: "gmail_archive",
      allowWrites: true,
      arguments: { messageId: "m1" },
    });
    await client.execute({
      userId: "request-user",
      toolName: "gmail_remove_spam",
      allowWrites: true,
      arguments: { messageId: "m1" },
    });
    await client.execute({
      userId: "request-user",
      toolName: "gmail_add_labels",
      allowWrites: true,
      arguments: { messageId: "m1", labelIds: ["Label_1", "Label_2"] },
    });

    const calls = (http.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(6);
    const expected = [
      {
        url: "https://www.googleapis.com/gmail/v1/users/me/messages/m1/modify",
        body: { removeLabelIds: ["UNREAD"] },
      },
      {
        url: "https://www.googleapis.com/gmail/v1/users/me/messages/m1/modify",
        body: { addLabelIds: ["UNREAD"] },
      },
      {
        url: "https://www.googleapis.com/gmail/v1/users/me/messages/m1/modify",
        body: { addLabelIds: ["STARRED"] },
      },
      {
        url: "https://www.googleapis.com/gmail/v1/users/me/messages/m1/modify",
        body: { removeLabelIds: ["INBOX"] },
      },
      {
        url: "https://www.googleapis.com/gmail/v1/users/me/messages/m1/modify",
        body: { removeLabelIds: ["SPAM"], addLabelIds: ["INBOX"] },
      },
      {
        url: "https://www.googleapis.com/gmail/v1/users/me/messages/m1/modify",
        body: { addLabelIds: ["Label_1", "Label_2"] },
      },
    ];
    calls.forEach(([url, init], index) => {
      expect(String(url)).toBe(expected[index].url);
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual(expected[index].body);
      // Gmail modify payloads may only use addLabelIds/removeLabelIds.
      expect(Object.keys(JSON.parse(String(init.body))).sort()).toEqual(
        Object.keys(expected[index].body).sort(),
      );
    });
  });

  it("maps remove_labels and trash/untrash for messages and threads to exact endpoints", async () => {
    const { client, http } = clientWith(
      [
        new Response(JSON.stringify({ id: "m1" })),
        new Response(JSON.stringify({ id: "m1" })),
        new Response(JSON.stringify({ id: "m1" })),
        new Response(JSON.stringify({ id: "t1" })),
        new Response(JSON.stringify({ id: "t1" })),
      ],
      [...allScopes, "https://www.googleapis.com/auth/gmail.modify"],
    );

    await client.execute({
      userId: "request-user",
      toolName: "gmail_remove_labels",
      allowWrites: true,
      arguments: { messageId: "m1", labelIds: ["Label_9"] },
    });
    await client.execute({
      userId: "request-user",
      toolName: "gmail_trash",
      allowWrites: true,
      arguments: { messageId: "m1" },
    });
    await client.execute({
      userId: "request-user",
      toolName: "gmail_untrash",
      allowWrites: true,
      arguments: { messageId: "m1" },
    });
    await client.execute({
      userId: "request-user",
      toolName: "gmail_trash_thread",
      allowWrites: true,
      arguments: { threadId: "t1" },
    });
    await client.execute({
      userId: "request-user",
      toolName: "gmail_untrash_thread",
      allowWrites: true,
      arguments: { threadId: "t1" },
    });

    const calls = (http.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map(([url]) => String(url))).toEqual([
      "https://www.googleapis.com/gmail/v1/users/me/messages/m1/modify",
      "https://www.googleapis.com/gmail/v1/users/me/messages/m1/trash",
      "https://www.googleapis.com/gmail/v1/users/me/messages/m1/untrash",
      "https://www.googleapis.com/gmail/v1/users/me/threads/t1/trash",
      "https://www.googleapis.com/gmail/v1/users/me/threads/t1/untrash",
    ]);
    expect(calls.every(([, init]) => init.method === "POST")).toBe(true);
    expect(JSON.parse(String(calls[0][1].body))).toEqual({
      removeLabelIds: ["Label_9"],
    });
    // Trash/untrash endpoints carry no JSON body.
    expect(calls[1][1].body).toBeUndefined();
    expect(calls[3][1].body).toBeUndefined();
  });

  it("rejects gmail.modify-only tools with exact re-consent guidance under gmail.readonly", async () => {
    const { client } = clientWith(
      [],
      ["https://www.googleapis.com/auth/gmail.readonly"],
    );

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_mark_read",
        allowWrites: true,
        arguments: { messageId: "m1" },
      }),
    ).rejects.toEqual(
      new GoogleWorkspaceError(
        "FORBIDDEN",
        'Google connection lacks required scope. Reconnect and explicitly select "gmail.modify".',
      ),
    );
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_trash_thread",
        allowWrites: true,
        arguments: { threadId: "t1" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps existing Gmail reads working with only gmail.readonly", async () => {
    const { client } = clientWith(
      [
        new Response(JSON.stringify({ labels: [{ id: "INBOX", name: "Inbox" }] })),
        new Response(
          JSON.stringify({
            id: "m1",
            threadId: "t1",
            payload: { headers: [] },
          }),
        ),
      ],
      ["https://www.googleapis.com/auth/gmail.readonly"],
    );

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_list_labels",
        arguments: {},
      }),
    ).resolves.toEqual({ labels: [{ id: "INBOX", name: "Inbox" }] });
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_get_message",
        arguments: { messageId: "m1" },
      }),
    ).resolves.toMatchObject({ id: "m1", threadId: "t1" });
  });

  it("rejects missing IDs and invalid or system label arrays before any Google call", async () => {
    const { client, http } = clientWith(
      [],
      [...allScopes, "https://www.googleapis.com/auth/gmail.modify"],
    );
    const hundredLabels = Array.from({ length: 100 }, (_, i) => `Label_${i}`);
    const tooManyLabels = [...hundredLabels, "Label_100"];

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_mark_read",
        allowWrites: true,
        arguments: {},
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_trash_thread",
        allowWrites: true,
        arguments: {},
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_add_labels",
        allowWrites: true,
        arguments: { messageId: "m1", labelIds: [] },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_add_labels",
        allowWrites: true,
        arguments: { messageId: "m1", labelIds: tooManyLabels },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_remove_labels",
        allowWrites: true,
        arguments: { messageId: "m1", labelIds: ["Label_1", 42] },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_add_labels",
        allowWrites: true,
        arguments: { messageId: "m1", labelIds: ["Label_1", "INBOX"] },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_remove_labels",
        allowWrites: true,
        arguments: { messageId: "m1", labelIds: ["CATEGORY_PROMOTIONS"] },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it("maps Phase 2 label management tools to exact endpoints, methods, and payloads", async () => {
    const { client, http } = clientWith(
      [
        new Response(JSON.stringify({ id: "Label_Custom", name: "Custom" })),
        new Response(JSON.stringify({ id: "Label_Custom", name: "Custom Renamed" })),
        new Response(null, { status: 204 }),
      ],
      [...allScopes, "https://www.googleapis.com/auth/gmail.modify"],
    );

    await client.execute({
      userId: "request-user",
      toolName: "gmail_create_label",
      allowWrites: true,
      arguments: {
        name: "Custom",
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
        color: { textColor: "#ffffff", backgroundColor: "#000000" },
      },
    });
    await client.execute({
      userId: "request-user",
      toolName: "gmail_update_label",
      allowWrites: true,
      arguments: {
        labelId: "Label_Custom",
        name: "Custom Renamed",
      },
    });
    await client.execute({
      userId: "request-user",
      toolName: "gmail_delete_label",
      allowWrites: true,
      arguments: {
        labelId: "Label_Custom",
      },
    });

    const calls = (http.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(3);

    expect(calls[0][0]).toBe("https://www.googleapis.com/gmail/v1/users/me/labels");
    expect(calls[0][1].method).toBe("POST");
    expect(JSON.parse(String(calls[0][1].body))).toEqual({
      name: "Custom",
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
      color: { textColor: "#ffffff", backgroundColor: "#000000" },
    });

    expect(calls[1][0]).toBe("https://www.googleapis.com/gmail/v1/users/me/labels/Label_Custom");
    expect(calls[1][1].method).toBe("PATCH");
    expect(JSON.parse(String(calls[1][1].body))).toEqual({
      name: "Custom Renamed",
    });

    expect(calls[2][0]).toBe("https://www.googleapis.com/gmail/v1/users/me/labels/Label_Custom");
    expect(calls[2][1].method).toBe("DELETE");
    expect(calls[2][1].body).toBeUndefined();
  });

  it("rejects system labels and empty patch in label management tools", async () => {
    const { client } = clientWith(
      [],
      [...allScopes, "https://www.googleapis.com/auth/gmail.modify"],
    );

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_update_label",
        allowWrites: true,
        arguments: { labelId: "INBOX", name: "New Inbox" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_delete_label",
        allowWrites: true,
        arguments: { labelId: "SPAM" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_update_label",
        allowWrites: true,
        arguments: { labelId: "Label_Custom" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("rejects invalid label visibility values and ensures zero HTTP calls", async () => {
    const { client, http } = clientWith(
      [],
      [...allScopes, "https://www.googleapis.com/auth/gmail.modify"],
    );

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_create_label",
        allowWrites: true,
        arguments: {
          name: "Test",
          labelListVisibility: "invalidVisibility",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_create_label",
        allowWrites: true,
        arguments: {
          name: "Test",
          messageListVisibility: "invalidVisibility",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_update_label",
        allowWrites: true,
        arguments: {
          labelId: "Label_123",
          labelListVisibility: "show", // Valid for messageListVisibility, not labelListVisibility
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_update_label",
        allowWrites: true,
        arguments: {
          labelId: "Label_123",
          messageListVisibility: "labelShow", // Valid for labelListVisibility, not messageListVisibility
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    expect(http.fetch).not.toHaveBeenCalled();
  });

  it("maps Phase 2 draft lifecycle tools to exact endpoints, methods, and payloads", async () => {
    const { client, http } = clientWith(
      [
        new Response(JSON.stringify({ drafts: [{ id: "d1", message: { id: "m1", threadId: "t1" } }], nextPageToken: "token2" })),
        new Response(JSON.stringify({ id: "d1", message: { id: "m1", threadId: "t1", payload: { headers: [{ name: "Subject", value: "Test" }], body: { size: 0 } } } })),
        new Response(JSON.stringify({ id: "d2", message: { id: "m2", threadId: "t2" } })),
        new Response(JSON.stringify({ id: "d2", message: { id: "m2", threadId: "t2" } })),
        new Response(null, { status: 204 }),
      ],
      [...allScopes, "https://www.googleapis.com/auth/gmail.compose"],
    );

    const listRes = await client.execute({
      userId: "request-user",
      toolName: "gmail_list_drafts",
      arguments: { query: "subject:Test", maxResults: 10 },
    });
    expect(listRes).toEqual({
      drafts: [{ id: "d1", message: { id: "m1", threadId: "t1" } }],
      nextPageToken: "token2",
    });

    const getRes = await client.execute({
      userId: "request-user",
      toolName: "gmail_get_draft",
      arguments: { draftId: "d1" },
    });
    expect(getRes).toMatchObject({ id: "d1", message: { id: "m1", threadId: "t1", subject: "Test" } });

    await client.execute({
      userId: "request-user",
      toolName: "gmail_create_draft",
      allowWrites: true,
      arguments: {
        to: ["alice@example.test"],
        subject: "Hello",
        bodyText: "Simple body",
      },
    });

    await client.execute({
      userId: "request-user",
      toolName: "gmail_update_draft",
      allowWrites: true,
      arguments: {
        draftId: "d2",
        to: ["bob@example.test"],
        subject: "Updated",
        bodyHtml: "<p>HTML body</p>",
      },
    });

    await client.execute({
      userId: "request-user",
      toolName: "gmail_delete_draft",
      allowWrites: true,
      arguments: { draftId: "d2" },
    });

    const calls = (http.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(5);

    expect(calls[0][0]).toBe("https://www.googleapis.com/gmail/v1/users/me/drafts?q=subject%3ATest&maxResults=10");
    expect(calls[1][0]).toBe("https://www.googleapis.com/gmail/v1/users/me/drafts/d1?format=full");

    expect(calls[2][0]).toBe("https://www.googleapis.com/gmail/v1/users/me/drafts");
    expect(calls[2][1].method).toBe("POST");
    const createBody = JSON.parse(String(calls[2][1].body));
    expect(createBody.message.raw).toBeDefined();
    const decodedCreated = Buffer.from(createBody.message.raw, "base64url").toString("utf8");
    expect(decodedCreated).toContain("To: alice@example.test");
    expect(decodedCreated).toContain("Subject: Hello");
    expect(decodedCreated).toContain("Simple body");

    expect(calls[3][0]).toBe("https://www.googleapis.com/gmail/v1/users/me/drafts/d2");
    expect(calls[3][1].method).toBe("PUT");
    const updateBody = JSON.parse(String(calls[3][1].body));
    expect(updateBody.id).toBe("d2");
    const decodedUpdated = Buffer.from(updateBody.message.raw, "base64url").toString("utf8");
    expect(decodedUpdated).toContain("To: bob@example.test");
    expect(decodedUpdated).toContain("<p>HTML body</p>");

    expect(calls[4][0]).toBe("https://www.googleapis.com/gmail/v1/users/me/drafts/d2");
    expect(calls[4][1].method).toBe("DELETE");
  });

  it("rejects draft inputs with CRLF header injection and missing body", async () => {
    const { client } = clientWith(
      [],
      [...allScopes, "https://www.googleapis.com/auth/gmail.compose"],
    );

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_create_draft",
        allowWrites: true,
        arguments: {
          to: ["alice@example.test\r\nBcc: evil@example.test"],
          subject: "Hi",
          bodyText: "Text",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_create_draft",
        allowWrites: true,
        arguments: {
          to: ["alice@example.test"],
          subject: "Hi\nInjected-Header: 123",
          bodyText: "Text",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_create_draft",
        allowWrites: true,
        arguments: {
          to: ["alice@example.test"],
          subject: "Hi",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("enforces exact gmail.compose scope for draft read and write tools", async () => {
    const { client } = clientWith(
      [],
      ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.modify"],
    );

    for (const toolName of [
      "gmail_list_drafts",
      "gmail_get_draft",
      "gmail_create_draft",
      "gmail_update_draft",
      "gmail_delete_draft",
    ]) {
      await expect(
        client.execute({
          userId: "request-user",
          toolName,
          allowWrites: true,
          arguments: { draftId: "d1", to: ["a@b.c"], bodyText: "test" },
        }),
      ).rejects.toEqual(
        new GoogleWorkspaceError(
          "FORBIDDEN",
          'Google connection lacks required scope. Reconnect and explicitly select "gmail.compose".',
        ),
      );
    }
  });

  it("annotates Phase 2 tools accurately for destructive and idempotent hints", () => {
    const annotations = Object.fromEntries(
      GOOGLE_WORKSPACE_TOOLS.map((tool) => [tool.name, tool.annotations]),
    );

    expect(annotations.gmail_create_label).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(annotations.gmail_update_label).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(annotations.gmail_delete_label).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(annotations.gmail_list_drafts).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(annotations.gmail_get_draft).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(annotations.gmail_create_draft).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(annotations.gmail_update_draft).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(annotations.gmail_delete_draft).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
  });

  it("maps calendar freebusy with timezone and calendar IDs", async () => {
    const { client, http } = clientWith([
      new Response(JSON.stringify({ calendars: {} })),
    ]);

    await client.execute({
      userId: "request-user",
      toolName: "calendar_freebusy",
      arguments: {
        timeMin: "2026-08-21T10:00:00Z",
        timeMax: "2026-08-21T15:00:00+03:00",
        timeZone: "Europe/Istanbul",
        calendarIds: ["primary", "team@example.test"],
      },
    });

    const [url, init] = (http.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      timeMin: "2026-08-21T10:00:00Z",
      timeMax: "2026-08-21T15:00:00+03:00",
      timeZone: "Europe/Istanbul",
      items: [{ id: "primary" }, { id: "team@example.test" }],
    });
  });

  it("requires offset timestamps and valid IANA timezone for calendar writes", async () => {
    const { client } = clientWith([]);
    const base = {
      calendarId: "primary",
      summary: "Meeting",
      start: "2026-08-21T10:00:00Z",
      end: "2026-08-21T11:00:00+03:00",
    };

    for (const arguments_ of [
      { ...base, start: "2026-08-21T10:00:00", timeZone: "Europe/Istanbul" },
      { ...base, timeZone: "UTC+3" },
      { ...base },
    ]) {
      await expect(
        client.execute({
          userId: "request-user",
          toolName: "calendar_create_event",
          allowWrites: true,
          arguments: arguments_,
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
  });

  it("uses PATCH and explicitly suppresses attendee notifications by default", async () => {
    const { client, http } = clientWith([
      new Response(JSON.stringify({ id: "event-1" })),
      new Response(JSON.stringify({ id: "event-1" })),
    ]);

    await client.execute({
      userId: "request-user",
      toolName: "calendar_create_event",
      allowWrites: true,
      arguments: {
        calendarId: "primary",
        summary: "Meeting",
        start: "2026-08-21T10:00:00Z",
        end: "2026-08-21T14:00:00+03:00",
        timeZone: "Europe/Istanbul",
        attendees: [{ email: "guest@example.test" }],
      },
    });
    await client.execute({
      userId: "request-user",
      toolName: "calendar_update_event",
      allowWrites: true,
      arguments: {
        calendarId: "primary",
        eventId: "event-1",
        patch: { summary: "Renamed" },
      },
    });

    const [createUrl, createInit] = (http.fetch as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    const [updateUrl, updateInit] = (http.fetch as ReturnType<typeof vi.fn>)
      .mock.calls[1];
    expect(createUrl).toContain("sendUpdates=none");
    expect(createInit.method).toBe("POST");
    expect(updateUrl).toContain("sendUpdates=none");
    expect(updateInit.method).toBe("PATCH");
    expect(JSON.parse(String(updateInit.body))).toEqual({ summary: "Renamed" });
  });

  it("checks Drive metadata before download and returns bounded base64 content", async () => {
    const { client, http } = clientWith([
      new Response(
        JSON.stringify({
          id: "file-1",
          name: "safe.txt",
          mimeType: "text/plain",
          size: "4",
          owners: [{ emailAddress: "must-not-escape@example.test" }],
        }),
      ),
      new Response(Buffer.from("safe"), {
        headers: { "Content-Type": "text/plain", "Content-Length": "4" },
      }),
    ]);

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "drive_download_file",
        arguments: { fileId: "file-1" },
      }),
    ).resolves.toEqual({
      file: {
        id: "file-1",
        name: "safe.txt",
        mimeType: "text/plain",
        size: "4",
      },
      size: 4,
      dataBase64: Buffer.from("safe").toString("base64"),
    });
    expect(http.fetch).toHaveBeenCalledTimes(2);
  });

  it("blocks oversized Drive downloads before fetching content", async () => {
    const { client, http } = clientWith([
      new Response(
        JSON.stringify({
          id: "file-1",
          name: "large.bin",
          mimeType: "application/octet-stream",
          size: String(MAX_DRIVE_DOWNLOAD_BYTES + 1),
        }),
      ),
    ]);

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "drive_download_file",
        arguments: { fileId: "file-1" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(http.fetch).toHaveBeenCalledTimes(1);
  });

  it("maps Docs append and replace text to constrained batchUpdate requests", async () => {
    const { client, http } = clientWith([
      new Response(JSON.stringify({ replies: [] })),
      new Response(JSON.stringify({ replies: [] })),
    ]);

    await client.execute({
      userId: "request-user",
      toolName: "docs_append",
      allowWrites: true,
      arguments: { documentId: "doc-1", text: "new text" },
    });
    await client.execute({
      userId: "request-user",
      toolName: "docs_replace_text",
      allowWrites: true,
      arguments: {
        documentId: "doc-1",
        find: "old",
        replace: "new",
        matchCase: true,
      },
    });

    expect(
      JSON.parse(
        String((http.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body),
      ),
    ).toEqual({
      requests: [
        {
          insertText: {
            endOfSegmentLocation: {},
            text: "new text",
          },
        },
      ],
    });
    expect(
      JSON.parse(
        String((http.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body),
      ),
    ).toEqual({
      requests: [
        {
          replaceAllText: {
            containsText: { text: "old", matchCase: true },
            replaceText: "new",
          },
        },
      ],
    });
  });

  it("allows Docs replacement with empty text", async () => {
    const { client, http } = clientWith([
      new Response(JSON.stringify({ replies: [] })),
    ]);

    await client.execute({
      userId: "request-user",
      toolName: "docs_replace_text",
      allowWrites: true,
      arguments: {
        documentId: "doc-1",
        find: "remove me",
        replace: "",
      },
    });

    expect(
      JSON.parse(
        String((http.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body),
      ),
    ).toMatchObject({
      requests: [{ replaceAllText: { replaceText: "" } }],
    });
  });

  it("maps Sheets batch_get ranges as repeated query parameters", async () => {
    const { client, http } = clientWith([
      new Response(
        JSON.stringify({ spreadsheetId: "sheet-1", valueRanges: [] }),
      ),
    ]);

    await client.execute({
      userId: "request-user",
      toolName: "sheets_batch_get",
      arguments: {
        spreadsheetId: "sheet-1",
        ranges: ["Sheet 1!A1:B2", "Data!C:C"],
      },
    });

    const url = new URL(
      String((http.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]),
    );
    expect(url.pathname).toBe("/v4/spreadsheets/sheet-1/values:batchGet");
    expect(url.searchParams.getAll("ranges")).toEqual([
      "Sheet 1!A1:B2",
      "Data!C:C",
    ]);
  });

  it("routes every remaining read tool to its bounded product endpoint", async () => {
    const { client, http } = clientWith([
      new Response(JSON.stringify({ items: [] })),
      new Response(JSON.stringify({ items: [] })),
      new Response(JSON.stringify({ id: "event-1" })),
      new Response(
        JSON.stringify({ id: "file-1", name: "file.txt", owners: ["hidden"] }),
      ),
      new Response(JSON.stringify({ files: [] })),
      new Response(JSON.stringify({ documentId: "doc-1" })),
      new Response(JSON.stringify({ range: "Sheet1!A1", values: [["ok"]] })),
    ]);

    const calls = [
      client.execute({
        userId: "request-user",
        toolName: "calendar_list_calendars",
        arguments: {},
      }),
      client.execute({
        userId: "request-user",
        toolName: "calendar_list_events",
        arguments: {
          calendarId: "primary",
          timeMin: "2026-08-21T10:00:00Z",
          timeMax: "2026-08-21T11:00:00Z",
        },
      }),
      client.execute({
        userId: "request-user",
        toolName: "calendar_get_event",
        arguments: { calendarId: "primary", eventId: "event-1" },
      }),
      client.execute({
        userId: "request-user",
        toolName: "drive_get_file",
        arguments: { fileId: "file-1" },
      }),
      client.execute({
        userId: "request-user",
        toolName: "drive_list_folder",
        arguments: { folderId: "folder'1" },
      }),
      client.execute({
        userId: "request-user",
        toolName: "docs_get",
        arguments: { documentId: "doc-1" },
      }),
      client.execute({
        userId: "request-user",
        toolName: "sheets_get",
        arguments: { spreadsheetId: "sheet-1", range: "Sheet1!A1" },
      }),
    ];
    const results = await Promise.all(calls);

    expect(results[3]).toEqual({ id: "file-1", name: "file.txt" });
    const urls = (http.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      ([url]) => String(url),
    );
    expect(urls).toEqual([
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      expect.stringContaining("/calendar/v3/calendars/primary/events?"),
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/event-1",
      expect.stringContaining("/drive/v3/files/file-1?fields="),
      expect.stringContaining("/drive/v3/files?"),
      "https://docs.googleapis.com/v1/documents/doc-1",
      "https://sheets.googleapis.com/v4/spreadsheets/sheet-1/values/Sheet1!A1",
    ]);
    expect(new URL(urls[4]).searchParams.get("q")).toBe(
      "'folder\\'1' in parents and trashed = false",
    );
  });

  it("routes every remaining write tool with active policy and safe defaults", async () => {
    const { client, http } = clientWith([
      new Response(null, { status: 204 }),
      new Response(JSON.stringify({ id: "upload-1", name: "upload.txt" })),
      new Response(
        JSON.stringify({
          id: "folder-1",
          name: "Folder",
          mimeType: "application/vnd.google-apps.folder",
        }),
      ),
      new Response(JSON.stringify({ id: "permission-1" })),
      new Response(null, { status: 204 }),
      new Response(JSON.stringify({ documentId: "doc-1" })),
      new Response(JSON.stringify({ updatedCells: 1 })),
      new Response(JSON.stringify({ updates: { updatedCells: 1 } })),
      new Response(JSON.stringify({ spreadsheetId: "sheet-2" })),
    ]);

    await client.execute({
      userId: "request-user",
      toolName: "calendar_delete_event",
      allowWrites: true,
      arguments: { calendarId: "primary", eventId: "event-1" },
    });
    await client.execute({
      userId: "request-user",
      toolName: "drive_upload_file",
      allowWrites: true,
      arguments: {
        name: "upload.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("raw content").toString("base64"),
        parentId: "folder-1",
      },
    });
    await client.execute({
      userId: "request-user",
      toolName: "drive_create_folder",
      allowWrites: true,
      arguments: { name: "Folder", parentId: "root" },
    });
    await client.execute({
      userId: "request-user",
      toolName: "drive_share_file",
      allowWrites: true,
      arguments: {
        fileId: "file-1",
        type: "user",
        role: "reader",
        emailAddress: "reader@example.test",
      },
    });
    await client.execute({
      userId: "request-user",
      toolName: "drive_delete_file",
      allowWrites: true,
      arguments: { fileId: "file-1" },
    });
    await client.execute({
      userId: "request-user",
      toolName: "docs_create",
      allowWrites: true,
      arguments: { title: "Document" },
    });
    await client.execute({
      userId: "request-user",
      toolName: "sheets_update",
      allowWrites: true,
      arguments: {
        spreadsheetId: "sheet-1",
        range: "A1",
        values: [["updated"]],
        valueInputOption: "RAW",
      },
    });
    await client.execute({
      userId: "request-user",
      toolName: "sheets_append",
      allowWrites: true,
      arguments: {
        spreadsheetId: "sheet-1",
        range: "A:A",
        values: [["appended"]],
      },
    });
    await client.execute({
      userId: "request-user",
      toolName: "sheets_create",
      allowWrites: true,
      arguments: { title: "Spreadsheet" },
    });

    const requests = (http.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(requests[0][0]).toContain("sendUpdates=none");
    expect(requests[0][1].method).toBe("DELETE");
    expect(requests[1][0]).toContain("uploadType=multipart");
    expect(
      Buffer.from(requests[1][1].body).includes(Buffer.from("raw content")),
    ).toBe(true);
    expect(requests[3][0]).toContain("sendNotificationEmail=false");
    expect(requests[4][1].method).toBe("DELETE");
    expect(requests[5][0]).toBe("https://docs.googleapis.com/v1/documents");
    expect(requests[6][1].method).toBe("PUT");
    expect(requests[6][0]).toContain("valueInputOption=RAW");
    expect(requests[7][0]).toContain(":append?valueInputOption=USER_ENTERED");
    expect(requests[8][0]).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets",
    );
  });

  it("rejects malformed attendee and Sheets row structures before writes", async () => {
    const { client, http } = clientWith([]);

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "calendar_create_event",
        allowWrites: true,
        arguments: {
          calendarId: "primary",
          start: "2026-08-21T10:00:00Z",
          end: "2026-08-21T11:00:00Z",
          timeZone: "Europe/Istanbul",
          attendees: [{ displayName: "No email" }],
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "sheets_update",
        allowWrites: true,
        arguments: {
          spreadsheetId: "sheet-1",
          range: "A1",
          values: ["not-a-row"],
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid pagination and upload media type before Google calls", async () => {
    const { client, http } = clientWith([]);

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_search",
        arguments: { query: "is:unread", maxResults: 101 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      client.execute({
        userId: "request-user",
        toolName: "drive_upload_file",
        allowWrites: true,
        arguments: {
          name: "unsafe.txt",
          mimeType: "text/plain\r\nX-Injected: true",
          contentBase64: "YQ==",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it("gives exact reconnect guidance when required scope is missing", async () => {
    const { client } = clientWith(
      [],
      ["https://www.googleapis.com/auth/gmail.readonly"],
    );

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "sheets_get",
        arguments: { spreadsheetId: "sheet-1", range: "A1" },
      }),
    ).rejects.toEqual(
      new GoogleWorkspaceError(
        "FORBIDDEN",
        'Google connection lacks required scope. Reconnect and explicitly select "spreadsheets.readonly" (or "spreadsheets").',
      ),
    );
  });

  it("retries transient reads with bounded backoff", async () => {
    const sleep = vi.fn(async () => undefined);
    const http = fakeHttp([
      new Response("busy", { status: 429, headers: { "Retry-After": "0" } }),
      new Response(JSON.stringify({ files: [] })),
    ]);
    const client = new GoogleWorkspaceClient({
      connections: fakeStore(),
      http,
      sleep,
    });

    await client.execute({
      userId: "request-user",
      toolName: "drive_search",
      arguments: { query: "trashed = false" },
    });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(http.fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes once for concurrent requests and persists token rotation", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    const store = {
      ...fakeStore(),
      getDecryptedTokens: vi.fn(async () => ({
        ...userConnection,
        expiresAt: new Date(Date.now() - 60_000),
      })),
    };
    const http = fakeHttp([
      new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "rotated",
          expires_in: 3600,
        }),
      ),
      new Response(JSON.stringify({ labels: [] })),
      new Response(JSON.stringify({ labels: [] })),
    ]);
    const client = new GoogleWorkspaceClient({
      connections: store,
      http,
      sleep: vi.fn(),
    });

    await Promise.all([
      client.execute({
        userId: "request-user",
        toolName: "gmail_list_labels",
        arguments: {},
      }),
      client.execute({
        userId: "request-user",
        toolName: "gmail_list_labels",
        arguments: {},
      }),
    ]);

    expect(http.fetch).toHaveBeenCalledTimes(3);
    expect(store.upsertConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "request-user",
        refreshToken: "rotated",
        accessToken: "new-access",
      }),
    );
  });

  it("maps scope denial without leaking Google response content", async () => {
    const { client } = clientWith([
      new Response("secret upstream detail", { status: 403 }),
    ]);

    await expect(
      client.execute({
        userId: "request-user",
        toolName: "gmail_list_labels",
        arguments: {},
      }),
    ).rejects.toEqual(
      new GoogleWorkspaceError(
        "FORBIDDEN",
        "Google denied access. Reconnect and re-consent to required scope if it was not granted.",
      ),
    );
  });
});
