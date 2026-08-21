import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const GOOGLE_WORKSPACE_SERVER_NAME = "GoogleWorkspace";
export const GOOGLE_WORKSPACE_SERVER_UUID =
  "00000000-0000-4000-8000-000000000021";
export const GOOGLE_WORKSPACE_DEFAULT_TOOL_STATUS = "INACTIVE" as const;
export const MAX_GMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DRIVE_DOWNLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_DRIVE_UPLOAD_BYTES = 10 * 1024 * 1024;

const GOOGLE_BASE_URL = "https://www.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

const scopes = {
  gmailRead: "https://www.googleapis.com/auth/gmail.readonly",
  calendarRead: "https://www.googleapis.com/auth/calendar.readonly",
  calendarWrite: "https://www.googleapis.com/auth/calendar.events",
  driveRead: "https://www.googleapis.com/auth/drive.readonly",
  driveWrite: "https://www.googleapis.com/auth/drive.file",
  docsRead: "https://www.googleapis.com/auth/documents.readonly",
  docsWrite: "https://www.googleapis.com/auth/documents",
  sheetsRead: "https://www.googleapis.com/auth/spreadsheets.readonly",
  sheetsWrite: "https://www.googleapis.com/auth/spreadsheets",
} as const;

const object = (
  properties: Record<string, object> = {},
  required?: string[],
) => ({
  type: "object" as const,
  properties,
  additionalProperties: false,
  ...(required?.length ? { required } : {}),
});

const stringArray = (maxItems?: number) => ({
  type: "array",
  items: { type: "string" },
  minItems: 1,
  ...(maxItems ? { maxItems } : {}),
});

const values = {
  type: "array",
  items: { type: "array", items: {} },
} as const;

function tool(
  name: string,
  description: string,
  properties: Record<string, object> = {},
  required?: string[],
  options: {
    write?: boolean;
    destructive?: boolean;
    idempotent?: boolean;
  } = {},
): Tool {
  const write = options.write === true;
  return {
    name,
    description,
    inputSchema: object({
      connectionId: {
        type: "string",
        description: "Optional Google connection ID. Defaults to user's default account.",
      },
      ...properties,
    }, required),
    annotations: {
      readOnlyHint: !write,
      destructiveHint: options.destructive === true,
      idempotentHint: options.idempotent === true,
      openWorldHint: true,
    },
  };
}

const calendarWriteTime = {
  start: { type: "string", description: "ISO timestamp with Z or UTC offset." },
  end: { type: "string", description: "ISO timestamp with Z or UTC offset." },
  timeZone: {
    type: "string",
    description: "Valid IANA timezone, for example Europe/Istanbul.",
  },
};

const notifyAttendees = {
  notifyAttendees: {
    type: "boolean",
    default: false,
    description: "Send attendee notifications. Defaults explicitly to false.",
  },
};

export const GOOGLE_WORKSPACE_TOOLS: Tool[] = [
  tool(
    "gmail_search",
    "Search Gmail and return message metadata (id, threadId, from, to, subject, date, snippet, labels).",
    {
      query: { type: "string" },
      maxResults: { type: "integer", minimum: 1, maximum: 100 },
      pageToken: { type: "string" },
    },
    ["query"],
  ),
  tool(
    "gmail_get_message",
    "Get one Gmail message with parsed MIME text and bounded attachment metadata.",
    { messageId: { type: "string" } },
    ["messageId"],
  ),
  tool(
    "gmail_get_thread",
    "Get one Gmail thread with each message parsed from MIME.",
    { threadId: { type: "string" } },
    ["threadId"],
  ),
  tool("gmail_list_labels", "List Gmail label metadata."),
  tool(
    "gmail_download_attachment",
    "Download a named Gmail attachment as base64, limited to 10 MiB.",
    {
      messageId: { type: "string" },
      attachmentId: { type: "string" },
    },
    ["messageId", "attachmentId"],
  ),
  tool("calendar_list_calendars", "List Google calendars."),
  tool(
    "calendar_list_events",
    "List events from one calendar.",
    {
      calendarId: { type: "string" },
      timeMin: { type: "string" },
      timeMax: { type: "string" },
      maxResults: { type: "integer", minimum: 1, maximum: 2500 },
      pageToken: { type: "string" },
    },
    ["calendarId"],
  ),
  tool(
    "calendar_get_event",
    "Get one calendar event.",
    { calendarId: { type: "string" }, eventId: { type: "string" } },
    ["calendarId", "eventId"],
  ),
  tool(
    "calendar_freebusy",
    "Query free/busy windows with offset timestamps and an IANA timezone.",
    {
      timeMin: calendarWriteTime.start,
      timeMax: calendarWriteTime.end,
      timeZone: calendarWriteTime.timeZone,
      calendarIds: stringArray(50),
    },
    ["timeMin", "timeMax", "timeZone", "calendarIds"],
  ),
  tool(
    "calendar_create_event",
    "Create an event. Active policy mapping and explicit write re-consent required.",
    {
      calendarId: { type: "string" },
      summary: { type: "string" },
      description: { type: "string" },
      location: { type: "string" },
      ...calendarWriteTime,
      attendees: {
        type: "array",
        items: object({ email: { type: "string" } }, ["email"]),
      },
      ...notifyAttendees,
    },
    ["calendarId", "start", "end", "timeZone"],
    { write: true },
  ),
  tool(
    "calendar_update_event",
    "PATCH only supplied event fields. Active policy mapping and explicit write re-consent required.",
    {
      calendarId: { type: "string" },
      eventId: { type: "string" },
      patch: { type: "object", minProperties: 1 },
      ...notifyAttendees,
    },
    ["calendarId", "eventId", "patch"],
    { write: true },
  ),
  tool(
    "calendar_delete_event",
    "Delete one event without attendee notifications by default. Active policy mapping required.",
    {
      calendarId: { type: "string" },
      eventId: { type: "string" },
      ...notifyAttendees,
    },
    ["calendarId", "eventId"],
    { write: true, destructive: true },
  ),
  tool(
    "drive_search",
    "Search Drive and return safe file metadata.",
    {
      query: { type: "string" },
      pageSize: { type: "integer", minimum: 1, maximum: 1000 },
      pageToken: { type: "string" },
    },
    ["query"],
  ),
  tool(
    "drive_get_file",
    "Get safe Drive file metadata.",
    { fileId: { type: "string" } },
    ["fileId"],
  ),
  tool(
    "drive_list_folder",
    "List safe metadata for files directly inside one Drive folder.",
    {
      folderId: { type: "string" },
      pageSize: { type: "integer", minimum: 1, maximum: 1000 },
      pageToken: { type: "string" },
    },
    ["folderId"],
  ),
  tool(
    "drive_download_file",
    "Download a non-Google-native Drive file as base64, limited to 10 MiB.",
    { fileId: { type: "string" } },
    ["fileId"],
  ),
  tool(
    "drive_upload_file",
    "Upload a file up to 10 MiB. Active policy mapping and drive.file re-consent required.",
    {
      name: { type: "string" },
      mimeType: { type: "string" },
      contentBase64: { type: "string" },
      parentId: { type: "string" },
    },
    ["name", "contentBase64"],
    { write: true },
  ),
  tool(
    "drive_create_folder",
    "Create a Drive folder. Active policy mapping and drive.file re-consent required.",
    { name: { type: "string" }, parentId: { type: "string" } },
    ["name"],
    { write: true },
  ),
  tool(
    "drive_share_file",
    "Create a Drive permission with notifications explicitly off by default. Active policy mapping required.",
    {
      fileId: { type: "string" },
      type: { type: "string", enum: ["user", "group", "domain", "anyone"] },
      role: { type: "string", enum: ["reader", "commenter", "writer"] },
      emailAddress: { type: "string" },
      domain: { type: "string" },
      notifyRecipient: { type: "boolean", default: false },
    },
    ["fileId", "type", "role"],
    { write: true },
  ),
  tool(
    "drive_delete_file",
    "Permanently delete one Drive file. Active policy mapping required.",
    { fileId: { type: "string" } },
    ["fileId"],
    { write: true, destructive: true },
  ),
  tool(
    "docs_get",
    "Get one Google document.",
    { documentId: { type: "string" } },
    ["documentId"],
  ),
  tool(
    "docs_create",
    "Create one Google document. Active policy mapping and documents re-consent required.",
    { title: { type: "string" } },
    ["title"],
    { write: true },
  ),
  tool(
    "docs_append",
    "Append plain text at document end. Active policy mapping required.",
    { documentId: { type: "string" }, text: { type: "string" } },
    ["documentId", "text"],
    { write: true },
  ),
  tool(
    "docs_replace_text",
    "Replace matching text throughout a document. Active policy mapping required.",
    {
      documentId: { type: "string" },
      find: { type: "string" },
      replace: { type: "string" },
      matchCase: { type: "boolean", default: false },
    },
    ["documentId", "find", "replace"],
    { write: true },
  ),
  tool(
    "sheets_get",
    "Get values from one spreadsheet range.",
    { spreadsheetId: { type: "string" }, range: { type: "string" } },
    ["spreadsheetId", "range"],
  ),
  tool(
    "sheets_batch_get",
    "Get values from multiple spreadsheet ranges in one request.",
    {
      spreadsheetId: { type: "string" },
      ranges: stringArray(100),
    },
    ["spreadsheetId", "ranges"],
  ),
  tool(
    "sheets_update",
    "Update one spreadsheet range. Active policy mapping required.",
    {
      spreadsheetId: { type: "string" },
      range: { type: "string" },
      values,
      valueInputOption: { type: "string", enum: ["RAW", "USER_ENTERED"] },
    },
    ["spreadsheetId", "range", "values"],
    { write: true, idempotent: true },
  ),
  tool(
    "sheets_append",
    "Append values to a spreadsheet range. Active policy mapping required.",
    {
      spreadsheetId: { type: "string" },
      range: { type: "string" },
      values,
      valueInputOption: { type: "string", enum: ["RAW", "USER_ENTERED"] },
    },
    ["spreadsheetId", "range", "values"],
    { write: true },
  ),
  tool(
    "sheets_create",
    "Create one spreadsheet. Active policy mapping and spreadsheets re-consent required.",
    { title: { type: "string" } },
    ["title"],
    { write: true },
  ),
];

const WRITE_METHODS = new Set(
  GOOGLE_WORKSPACE_TOOLS.filter(
    (workspaceTool) => workspaceTool.annotations?.readOnlyHint === false,
  ).map((workspaceTool) => workspaceTool.name),
);

export type GoogleHttpClient = {
  fetch(input: string, init?: RequestInit): Promise<Response>;
};
export type GoogleConnection = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
  email?: string | null;
};
export type GoogleConnectionStore = {
  getDecryptedTokens(userId: string, connectionId?: string): Promise<GoogleConnection | null>;
  upsertConnection(input: {
    userId: string;
    scopes: string[];
    accessToken: string;
    refreshToken?: string | null;
    expiresInSeconds?: number | null;
    email?: string | null;
  }): Promise<void>;
};
export type GoogleWorkspaceExecution = {
  userId?: string;
  toolName: string;
  arguments: Record<string, unknown>;
  allowWrites?: boolean;
  connectionId?: string;
};

export class GoogleWorkspaceError extends Error {
  constructor(
    public readonly code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "INVALID_ARGUMENT"
      | "NOT_CONNECTED"
      | "CONFIGURATION"
      | "UPSTREAM",
    message: string,
  ) {
    super(message);
  }
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new GoogleWorkspaceError("INVALID_ARGUMENT", `${key} is required`);
  }
  return value;
}

function requiredStringAllowEmpty(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new GoogleWorkspaceError("INVALID_ARGUMENT", `${key} is required`);
  }
  return value;
}

function requiredObject(
  args: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = args[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      `${key} must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

function requiredStringArray(
  args: Record<string, unknown>,
  key: string,
  maxItems: number,
): string[] {
  const value = args[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maxItems ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      `${key} must contain 1 to ${maxItems} strings`,
    );
  }
  return value as string[];
}

function optionalBoundedInteger(
  args: Record<string, unknown>,
  key: string,
  maximum: number,
): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > maximum
  ) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      `${key} must be an integer from 1 to ${maximum}`,
    );
  }
  return value as number;
}

function offsetTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) && !Number.isNaN(Date.parse(value))
  );
}

function ianaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function validateTimeRange(
  start: string,
  end: string,
  timeZone: unknown,
): asserts timeZone is string {
  if (!offsetTimestamp(start) || !offsetTimestamp(end)) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      "Calendar timestamps must include Z or a UTC offset",
    );
  }
  if (!ianaTimezone(timeZone)) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      "Calendar timeZone must be a valid IANA timezone",
    );
  }
  if (Date.parse(end) <= Date.parse(start)) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      "Calendar end must be after start",
    );
  }
}

function validateAttendees(value: unknown): void {
  if (
    value !== undefined &&
    (!Array.isArray(value) ||
      value.some(
        (attendee) =>
          !attendee ||
          typeof attendee !== "object" ||
          Array.isArray(attendee) ||
          typeof (attendee as Record<string, unknown>).email !== "string" ||
          (attendee as Record<string, unknown>).email === "",
      ))
  ) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      "attendees must contain objects with an email",
    );
  }
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function decodeBase64(value: string, key: string): Buffer {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      `${key} must be valid base64`,
    );
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const data = Buffer.from(normalized, "base64");
  if (
    data.toString("base64").replace(/=+$/, "") !== normalized.replace(/=+$/, "")
  ) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      `${key} must be valid base64`,
    );
  }
  return data;
}

type ScopeRequirement = { anyOf: string[]; guidance: string };

function requiredScope(toolName: string): ScopeRequirement {
  if (toolName.startsWith("gmail_")) {
    return { anyOf: [scopes.gmailRead], guidance: '"gmail.readonly"' };
  }
  if (toolName.startsWith("calendar_")) {
    return isGoogleWorkspaceWriteTool(toolName)
      ? { anyOf: [scopes.calendarWrite], guidance: '"calendar.events"' }
      : {
          anyOf: [scopes.calendarRead, scopes.calendarWrite],
          guidance: '"calendar.readonly" (or "calendar.events")',
        };
  }
  if (toolName.startsWith("drive_")) {
    return isGoogleWorkspaceWriteTool(toolName)
      ? { anyOf: [scopes.driveWrite], guidance: '"drive.file"' }
      : {
          anyOf: [scopes.driveRead, scopes.driveWrite],
          guidance: '"drive.readonly" (or "drive.file")',
        };
  }
  if (toolName.startsWith("docs_")) {
    return isGoogleWorkspaceWriteTool(toolName)
      ? { anyOf: [scopes.docsWrite], guidance: '"documents"' }
      : {
          anyOf: [scopes.docsRead, scopes.docsWrite],
          guidance: '"documents.readonly" (or "documents")',
        };
  }
  return isGoogleWorkspaceWriteTool(toolName)
    ? { anyOf: [scopes.sheetsWrite], guidance: '"spreadsheets"' }
    : {
        anyOf: [scopes.sheetsRead, scopes.sheetsWrite],
        guidance: '"spreadsheets.readonly" (or "spreadsheets")',
      };
}

export function isGoogleWorkspaceToolName(name: string): boolean {
  return GOOGLE_WORKSPACE_TOOLS.some(
    (workspaceTool) => workspaceTool.name === name,
  );
}

export function isGoogleWorkspaceWriteTool(name: string): boolean {
  return WRITE_METHODS.has(name);
}

type GmailPart = {
  mimeType?: unknown;
  filename?: unknown;
  headers?: unknown;
  body?: { data?: unknown; attachmentId?: unknown; size?: unknown };
  parts?: unknown;
};

function parseGmailSearchMetadata(message: Record<string, unknown>) {
  const payload =
    message.payload && typeof message.payload === "object"
      ? (message.payload as GmailPart)
      : {};
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  const headerMap = Object.fromEntries(
    headers.flatMap((header) => {
      if (!header || typeof header !== "object") return [];
      const { name, value } = header as { name?: unknown; value?: unknown };
      return typeof name === "string" && typeof value === "string"
        ? [[name.toLowerCase(), value]]
        : [];
    }),
  );
  const labels = Array.isArray(message.labelIds)
    ? message.labelIds.filter(
        (label): label is string => typeof label === "string",
      )
    : [];

  return {
    id: typeof message.id === "string" ? message.id : undefined,
    threadId:
      typeof message.threadId === "string" ? message.threadId : undefined,
    from: headerMap.from ?? "",
    to: headerMap.to ?? "",
    subject: headerMap.subject ?? "",
    date: headerMap.date ?? "",
    snippet: typeof message.snippet === "string" ? message.snippet : undefined,
    labels,
  };
}

function parseMimeMessage(message: Record<string, unknown>) {
  const payload =
    message.payload && typeof message.payload === "object"
      ? (message.payload as GmailPart)
      : {};
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  const headerMap = Object.fromEntries(
    headers.flatMap((header) => {
      if (!header || typeof header !== "object") return [];
      const { name, value } = header as { name?: unknown; value?: unknown };
      return typeof name === "string" && typeof value === "string"
        ? [[name.toLowerCase(), value]]
        : [];
    }),
  );
  const plainText: string[] = [];
  const htmlText: string[] = [];
  const attachments: Array<Record<string, unknown>> = [];

  const visit = (part: GmailPart) => {
    const mimeType = typeof part.mimeType === "string" ? part.mimeType : "";
    const filename = typeof part.filename === "string" ? part.filename : "";
    const size = typeof part.body?.size === "number" ? part.body.size : 0;
    if (typeof part.body?.data === "string") {
      const decoded = decodeBase64(part.body.data, "Gmail MIME body").toString(
        "utf8",
      );
      if (mimeType === "text/plain") plainText.push(decoded);
      else if (mimeType === "text/html") htmlText.push(decoded);
    }
    if (filename || typeof part.body?.attachmentId === "string") {
      attachments.push({
        filename: filename || "attachment",
        mimeType,
        size,
        ...(typeof part.body?.attachmentId === "string"
          ? { attachmentId: part.body.attachmentId }
          : {}),
        available: size <= MAX_GMAIL_ATTACHMENT_BYTES,
      });
    }
    if (Array.isArray(part.parts)) {
      part.parts.forEach((child) => {
        if (child && typeof child === "object") visit(child as GmailPart);
      });
    }
  };
  visit(payload);

  return {
    id: typeof message.id === "string" ? message.id : undefined,
    threadId:
      typeof message.threadId === "string" ? message.threadId : undefined,
    internalDate:
      typeof message.internalDate === "string"
        ? message.internalDate
        : undefined,
    snippet: typeof message.snippet === "string" ? message.snippet : undefined,
    subject: headerMap.subject ?? "",
    from: headerMap.from ?? "",
    to: headerMap.to ?? "",
    cc: headerMap.cc ?? "",
    date: headerMap.date ?? "",
    messageId: headerMap["message-id"] ?? "",
    text: (plainText.length ? plainText : htmlText).join("\n"),
    attachments,
  };
}

type SafeDriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
};

const DRIVE_FILE_FIELDS =
  "id,name,mimeType,modifiedTime,createdTime,size,webViewLink,parents,trashed";

function safeDriveFile(file: Record<string, unknown>): SafeDriveFile {
  const result: SafeDriveFile = {};
  for (const key of [
    "id",
    "name",
    "mimeType",
    "modifiedTime",
    "createdTime",
    "size",
    "webViewLink",
  ] as const) {
    if (typeof file[key] === "string") result[key] = file[key] as string;
  }
  if (
    Array.isArray(file.parents) &&
    file.parents.every((parent) => typeof parent === "string")
  ) {
    result.parents = file.parents as string[];
  }
  if (typeof file.trashed === "boolean") result.trashed = file.trashed;
  return result;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export class GoogleWorkspaceClient {
  private readonly refreshFlights = new Map<
    string,
    Promise<GoogleConnection>
  >();
  private readonly http: GoogleHttpClient;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly dependencies: {
      connections: GoogleConnectionStore;
      http?: GoogleHttpClient;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.http = dependencies.http ?? { fetch };
    this.sleep =
      dependencies.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async execute(input: GoogleWorkspaceExecution): Promise<unknown> {
    if (!input.userId) {
      throw new GoogleWorkspaceError(
        "UNAUTHENTICATED",
        "Authenticated request user is required",
      );
    }
    if (!isGoogleWorkspaceToolName(input.toolName)) {
      throw new GoogleWorkspaceError(
        "INVALID_ARGUMENT",
        "Unknown Google Workspace tool",
      );
    }
    if (isGoogleWorkspaceWriteTool(input.toolName) && !input.allowWrites) {
      throw new GoogleWorkspaceError(
        "FORBIDDEN",
        "Google Workspace write requires an active namespace tool mapping",
      );
    }
    const connection = await this.getConnection(input.userId, input.connectionId);
    const requirement = requiredScope(input.toolName);
    if (
      !requirement.anyOf.some((required) =>
        connection.scopes.includes(required),
      )
    ) {
      throw new GoogleWorkspaceError(
        "FORBIDDEN",
        `Google connection lacks required scope. Reconnect and explicitly select ${requirement.guidance}.`,
      );
    }
    return this.dispatch(
      input.toolName,
      input.arguments,
      connection.accessToken,
    );
  }

  private async getConnection(userId: string, connectionId?: string): Promise<GoogleConnection> {
    const connection =
      await this.dependencies.connections.getDecryptedTokens(userId, connectionId);
    if (!connection) {
      throw new GoogleWorkspaceError(
        "NOT_CONNECTED",
        "No Google connection for authenticated user. Connect Google and consent to the required least-privilege scopes.",
      );
    }
    if (
      !connection.expiresAt ||
      connection.expiresAt.getTime() > Date.now() + 30_000
    ) {
      return connection;
    }
    if (!connection.refreshToken) {
      throw new GoogleWorkspaceError(
        "NOT_CONNECTED",
        "Google connection expired. Reconnect and re-consent to the required scopes.",
      );
    }
    const flightKey = `${userId}:${connectionId ?? "default"}`;
    let flight = this.refreshFlights.get(flightKey);
    if (!flight) {
      flight = this.refresh(userId, connection).finally(() =>
        this.refreshFlights.delete(flightKey),
      );
      this.refreshFlights.set(flightKey, flight);
    }
    return flight;
  }

  private async refresh(
    userId: string,
    connection: GoogleConnection,
  ): Promise<GoogleConnection> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new GoogleWorkspaceError(
        "CONFIGURATION",
        "Google OAuth credentials are not configured",
      );
    }
    if (!connection.refreshToken) {
      throw new GoogleWorkspaceError(
        "NOT_CONNECTED",
        "Google connection expired. Reconnect and re-consent to the required scopes.",
      );
    }
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    });
    const response = await this.http.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new GoogleWorkspaceError(
        response.status === 400 || response.status === 401
          ? "NOT_CONNECTED"
          : "UPSTREAM",
        response.status === 400 || response.status === 401
          ? "Google connection expired. Reconnect and re-consent to the required scopes."
          : "Google token refresh failed",
      );
    }
    const token = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!token.access_token) {
      throw new GoogleWorkspaceError(
        "UPSTREAM",
        "Google token refresh returned no access token",
      );
    }
    const refreshToken = token.refresh_token ?? connection.refreshToken;
    await this.dependencies.connections.upsertConnection({
      userId,
      scopes: connection.scopes,
      email: connection.email,
      accessToken: token.access_token,
      refreshToken,
      expiresInSeconds: token.expires_in ?? 3600,
    });
    return {
      ...connection,
      accessToken: token.access_token,
      refreshToken,
      expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000),
    };
  }

  private async requestResponse(
    path: string,
    token: string,
    init: RequestInit = {},
    safeRetry = init.method === undefined || init.method === "GET",
  ): Promise<Response> {
    const method = init.method ?? "GET";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const url = path.startsWith("https://")
        ? path
        : `${GOOGLE_BASE_URL}${path}`;
      const response = await this.http.fetch(url, {
        ...init,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
      });
      if (response.ok) return response;
      if (safeRetry && TRANSIENT_STATUS.has(response.status) && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await this.sleep(
          Number.isFinite(retryAfter)
            ? Math.max(0, retryAfter * 1000)
            : 100 * 2 ** attempt,
        );
        continue;
      }
      if (response.status === 401) {
        throw new GoogleWorkspaceError(
          "NOT_CONNECTED",
          "Google connection expired. Reconnect and re-consent to the required scopes.",
        );
      }
      if (response.status === 403) {
        throw new GoogleWorkspaceError(
          "FORBIDDEN",
          "Google denied access. Reconnect and re-consent to required scope if it was not granted.",
        );
      }
      if (response.status === 404) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "Google resource was not found",
        );
      }
      throw new GoogleWorkspaceError("UPSTREAM", "Google API request failed");
    }
    throw new GoogleWorkspaceError("UPSTREAM", "Google API request failed");
  }

  private async readBounded(
    response: Response,
    maxBytes: number,
    errorMessage: string,
  ): Promise<Buffer> {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new GoogleWorkspaceError("INVALID_ARGUMENT", errorMessage);
    }
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new GoogleWorkspaceError("INVALID_ARGUMENT", errorMessage);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  }

  private async requestJson(
    path: string,
    token: string,
    init: RequestInit = {},
    safeRetry?: boolean,
    maxResponseBytes?: number,
  ): Promise<unknown> {
    const response = await this.requestResponse(path, token, init, safeRetry);
    if (response.status === 204) return { success: true };
    try {
      if (maxResponseBytes) {
        const bytes = await this.readBounded(
          response,
          maxResponseBytes,
          "Google response exceeds safe download limit",
        );
        return JSON.parse(bytes.toString("utf8"));
      }
      return await response.json();
    } catch (error) {
      if (error instanceof GoogleWorkspaceError) throw error;
      throw new GoogleWorkspaceError(
        "UPSTREAM",
        "Google API returned an invalid response",
      );
    }
  }

  private async dispatch(
    toolName: string,
    args: Record<string, unknown>,
    token: string,
  ): Promise<unknown> {
    const json = (
      path: string,
      method?: string,
      body?: unknown,
      safeRetry?: boolean,
      maxResponseBytes?: number,
    ) =>
      this.requestJson(
        path,
        token,
        {
          ...(method ? { method } : {}),
          ...(body === undefined
            ? {}
            : {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }),
        },
        safeRetry,
        maxResponseBytes,
      );

    if (toolName === "gmail_search") {
      const params = new URLSearchParams({
        q: requiredString(args, "query"),
        fields: "messages(id,threadId),nextPageToken",
      });
      const maxResults = optionalBoundedInteger(args, "maxResults", 100);
      if (maxResults !== undefined) {
        params.set("maxResults", String(maxResults));
      }
      if (typeof args.pageToken === "string") {
        params.set("pageToken", args.pageToken);
      }
      const result = (await json(
        `/gmail/v1/users/me/messages?${params}`,
      )) as Record<string, unknown>;
      const rawMessages = Array.isArray(result.messages)
        ? result.messages.flatMap((message) => {
            if (!message || typeof message !== "object") return [];
            const item = message as Record<string, unknown>;
            return typeof item.id === "string" ? [item.id] : [];
          })
        : [];
      const messages = await Promise.all(
        rawMessages.map(async (messageId) => {
          const detailParams = new URLSearchParams({
            format: "metadata",
            fields: "id,threadId,snippet,labelIds,payload/headers",
          });
          detailParams.append("metadataHeaders", "From");
          detailParams.append("metadataHeaders", "To");
          detailParams.append("metadataHeaders", "Subject");
          detailParams.append("metadataHeaders", "Date");
          const detail = (await json(
            `/gmail/v1/users/me/messages/${encodePath(messageId)}?${detailParams}`,
          )) as Record<string, unknown>;
          return parseGmailSearchMetadata(detail);
        }),
      );
      return {
        messages,
        ...(typeof result.nextPageToken === "string"
          ? { nextPageToken: result.nextPageToken }
          : {}),
      };
    }
    if (toolName === "gmail_get_message") {
      const message = (await json(
        `/gmail/v1/users/me/messages/${encodePath(requiredString(args, "messageId"))}?format=full`,
      )) as Record<string, unknown>;
      return parseMimeMessage(message);
    }
    if (toolName === "gmail_get_thread") {
      const thread = (await json(
        `/gmail/v1/users/me/threads/${encodePath(requiredString(args, "threadId"))}?format=full`,
      )) as Record<string, unknown>;
      return {
        id: typeof thread.id === "string" ? thread.id : undefined,
        messages: Array.isArray(thread.messages)
          ? thread.messages.flatMap((message) =>
              message && typeof message === "object"
                ? [parseMimeMessage(message as Record<string, unknown>)]
                : [],
            )
          : [],
      };
    }
    if (toolName === "gmail_list_labels") {
      const result = (await json("/gmail/v1/users/me/labels")) as Record<
        string,
        unknown
      >;
      return {
        labels: Array.isArray(result.labels)
          ? result.labels.flatMap((label) => {
              if (!label || typeof label !== "object") return [];
              const item = label as Record<string, unknown>;
              if (
                typeof item.id !== "string" ||
                typeof item.name !== "string"
              ) {
                return [];
              }
              return [
                {
                  id: item.id,
                  name: item.name,
                  ...(typeof item.type === "string" ? { type: item.type } : {}),
                },
              ];
            })
          : [],
      };
    }
    if (toolName === "gmail_download_attachment") {
      const result = (await json(
        `/gmail/v1/users/me/messages/${encodePath(requiredString(args, "messageId"))}/attachments/${encodePath(requiredString(args, "attachmentId"))}`,
        undefined,
        undefined,
        undefined,
        Math.ceil((MAX_GMAIL_ATTACHMENT_BYTES * 4) / 3) + 1024,
      )) as { data?: unknown; size?: unknown };
      const declaredSize =
        typeof result.size === "number" ? result.size : undefined;
      if (
        declaredSize !== undefined &&
        declaredSize > MAX_GMAIL_ATTACHMENT_BYTES
      ) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "Gmail attachment exceeds 10 MiB limit",
        );
      }
      if (typeof result.data !== "string") {
        throw new GoogleWorkspaceError(
          "UPSTREAM",
          "Gmail attachment response contained no data",
        );
      }
      const data = decodeBase64(result.data, "Gmail attachment data");
      if (data.byteLength > MAX_GMAIL_ATTACHMENT_BYTES) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "Gmail attachment exceeds 10 MiB limit",
        );
      }
      return {
        size: data.byteLength,
        dataBase64: data.toString("base64"),
      };
    }
    if (toolName === "calendar_list_calendars") {
      return json("/calendar/v3/users/me/calendarList");
    }
    if (toolName === "calendar_list_events") {
      const params = new URLSearchParams();
      for (const key of ["timeMin", "timeMax"] as const) {
        if (args[key] !== undefined) {
          if (typeof args[key] !== "string" || !offsetTimestamp(args[key])) {
            throw new GoogleWorkspaceError(
              "INVALID_ARGUMENT",
              `${key} must include Z or a UTC offset`,
            );
          }
          params.set(key, args[key]);
        }
      }
      const maxResults = optionalBoundedInteger(args, "maxResults", 2500);
      if (maxResults !== undefined) {
        params.set("maxResults", String(maxResults));
      }
      if (typeof args.pageToken === "string") {
        params.set("pageToken", args.pageToken);
      }
      return json(
        `/calendar/v3/calendars/${encodePath(requiredString(args, "calendarId"))}/events?${params}`,
      );
    }
    if (toolName === "calendar_get_event") {
      return json(
        `/calendar/v3/calendars/${encodePath(requiredString(args, "calendarId"))}/events/${encodePath(requiredString(args, "eventId"))}`,
      );
    }
    if (toolName === "calendar_freebusy") {
      const timeMin = requiredString(args, "timeMin");
      const timeMax = requiredString(args, "timeMax");
      validateTimeRange(timeMin, timeMax, args.timeZone);
      return json(
        "/calendar/v3/freeBusy",
        "POST",
        {
          timeMin,
          timeMax,
          timeZone: args.timeZone,
          items: requiredStringArray(args, "calendarIds", 50).map((id) => ({
            id,
          })),
        },
        true,
      );
    }
    if (toolName === "calendar_create_event") {
      const start = requiredString(args, "start");
      const end = requiredString(args, "end");
      validateTimeRange(start, end, args.timeZone);
      const body: Record<string, unknown> = {
        start: { dateTime: start, timeZone: args.timeZone },
        end: { dateTime: end, timeZone: args.timeZone },
      };
      for (const key of ["summary", "description", "location"] as const) {
        if (typeof args[key] === "string") body[key] = args[key];
      }
      validateAttendees(args.attendees);
      if (Array.isArray(args.attendees)) body.attendees = args.attendees;
      return json(
        `/calendar/v3/calendars/${encodePath(requiredString(args, "calendarId"))}/events?sendUpdates=${args.notifyAttendees === true ? "all" : "none"}`,
        "POST",
        body,
        false,
      );
    }
    if (toolName === "calendar_update_event") {
      const patch = requiredObject(args, "patch");
      const allowed = new Set([
        "summary",
        "description",
        "location",
        "status",
        "visibility",
        "transparency",
        "attendees",
        "start",
        "end",
        "recurrence",
      ]);
      if (
        Object.keys(patch).length === 0 ||
        Object.keys(patch).some((key) => !allowed.has(key))
      ) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "patch must contain only supported event fields",
        );
      }
      validateAttendees(patch.attendees);
      for (const boundary of ["start", "end"] as const) {
        if (patch[boundary] !== undefined) {
          const value = requiredObject(patch, boundary);
          const dateTime = requiredString(value, "dateTime");
          if (!offsetTimestamp(dateTime)) {
            throw new GoogleWorkspaceError(
              "INVALID_ARGUMENT",
              `Calendar ${boundary}.dateTime must include Z or a UTC offset`,
            );
          }
          if (!ianaTimezone(value.timeZone)) {
            throw new GoogleWorkspaceError(
              "INVALID_ARGUMENT",
              `Calendar ${boundary}.timeZone must be a valid IANA timezone`,
            );
          }
        }
      }
      return json(
        `/calendar/v3/calendars/${encodePath(requiredString(args, "calendarId"))}/events/${encodePath(requiredString(args, "eventId"))}?sendUpdates=${args.notifyAttendees === true ? "all" : "none"}`,
        "PATCH",
        patch,
        false,
      );
    }
    if (toolName === "calendar_delete_event") {
      return json(
        `/calendar/v3/calendars/${encodePath(requiredString(args, "calendarId"))}/events/${encodePath(requiredString(args, "eventId"))}?sendUpdates=${args.notifyAttendees === true ? "all" : "none"}`,
        "DELETE",
        undefined,
        false,
      );
    }
    if (toolName === "drive_search" || toolName === "drive_list_folder") {
      const params = new URLSearchParams({
        fields: `files(${DRIVE_FILE_FIELDS}),nextPageToken`,
      });
      params.set(
        "q",
        toolName === "drive_search"
          ? requiredString(args, "query")
          : `'${escapeDriveQuery(requiredString(args, "folderId"))}' in parents and trashed = false`,
      );
      const pageSize = optionalBoundedInteger(args, "pageSize", 1000);
      if (pageSize !== undefined) {
        params.set("pageSize", String(pageSize));
      }
      if (typeof args.pageToken === "string") {
        params.set("pageToken", args.pageToken);
      }
      const result = (await json(`/drive/v3/files?${params}`)) as Record<
        string,
        unknown
      >;
      return {
        files: Array.isArray(result.files)
          ? result.files.flatMap((file) =>
              file && typeof file === "object"
                ? [safeDriveFile(file as Record<string, unknown>)]
                : [],
            )
          : [],
        ...(typeof result.nextPageToken === "string"
          ? { nextPageToken: result.nextPageToken }
          : {}),
      };
    }
    if (toolName === "drive_get_file") {
      const file = (await json(
        `/drive/v3/files/${encodePath(requiredString(args, "fileId"))}?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`,
      )) as Record<string, unknown>;
      return safeDriveFile(file);
    }
    if (toolName === "drive_download_file") {
      const file = (await json(
        `/drive/v3/files/${encodePath(requiredString(args, "fileId"))}?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`,
      )) as Record<string, unknown>;
      const safeFile = safeDriveFile(file);
      if (safeFile.mimeType?.startsWith("application/vnd.google-apps.")) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "Google-native files cannot be downloaded with this tool",
        );
      }
      const declaredSize = Number(safeFile.size);
      if (
        Number.isFinite(declaredSize) &&
        declaredSize > MAX_DRIVE_DOWNLOAD_BYTES
      ) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "Drive file exceeds 10 MiB download limit",
        );
      }
      const response = await this.requestResponse(
        `/drive/v3/files/${encodePath(requiredString(args, "fileId"))}?alt=media`,
        token,
      );
      const data = await this.readBounded(
        response,
        MAX_DRIVE_DOWNLOAD_BYTES,
        "Drive file exceeds 10 MiB download limit",
      );
      return {
        file: safeFile,
        size: data.byteLength,
        dataBase64: data.toString("base64"),
      };
    }
    if (toolName === "drive_upload_file") {
      const name = requiredString(args, "name");
      const data = decodeBase64(
        requiredString(args, "contentBase64"),
        "contentBase64",
      );
      if (data.byteLength > MAX_DRIVE_UPLOAD_BYTES) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "Drive upload exceeds 10 MiB limit",
        );
      }
      const mimeType =
        typeof args.mimeType === "string"
          ? args.mimeType
          : "application/octet-stream";
      if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(mimeType)) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "mimeType must be a valid media type",
        );
      }
      const boundary = "metamcp-drive-upload-boundary";
      const metadata = {
        name,
        ...(typeof args.parentId === "string"
          ? { parents: [args.parentId] }
          : {}),
      };
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
        ),
        data,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const response = await this.requestJson(
        `/upload/drive/v3/files?uploadType=multipart&fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`,
        token,
        {
          method: "POST",
          headers: {
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body,
        },
        false,
      );
      return safeDriveFile(response as Record<string, unknown>);
    }
    if (toolName === "drive_create_folder") {
      const response = (await json(
        `/drive/v3/files?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`,
        "POST",
        {
          name: requiredString(args, "name"),
          mimeType: "application/vnd.google-apps.folder",
          ...(typeof args.parentId === "string"
            ? { parents: [args.parentId] }
            : {}),
        },
        false,
      )) as Record<string, unknown>;
      return safeDriveFile(response);
    }
    if (toolName === "drive_share_file") {
      const type = requiredString(args, "type");
      const role = requiredString(args, "role");
      if (!["user", "group", "domain", "anyone"].includes(type)) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "Invalid share type",
        );
      }
      if (!["reader", "commenter", "writer"].includes(role)) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "Invalid share role",
        );
      }
      if (
        (type === "user" || type === "group") &&
        (typeof args.emailAddress !== "string" ||
          args.emailAddress.length === 0)
      ) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "emailAddress is required for user or group shares",
        );
      }
      if (
        type === "domain" &&
        (typeof args.domain !== "string" || args.domain.length === 0)
      ) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "domain is required for domain shares",
        );
      }
      return json(
        `/drive/v3/files/${encodePath(requiredString(args, "fileId"))}/permissions?sendNotificationEmail=${args.notifyRecipient === true ? "true" : "false"}`,
        "POST",
        {
          type,
          role,
          ...(typeof args.emailAddress === "string"
            ? { emailAddress: args.emailAddress }
            : {}),
          ...(typeof args.domain === "string" ? { domain: args.domain } : {}),
        },
        false,
      );
    }
    if (toolName === "drive_delete_file") {
      return json(
        `/drive/v3/files/${encodePath(requiredString(args, "fileId"))}`,
        "DELETE",
        undefined,
        false,
      );
    }
    if (toolName === "docs_get") {
      return json(
        `https://docs.googleapis.com/v1/documents/${encodePath(requiredString(args, "documentId"))}`,
      );
    }
    if (toolName === "docs_create") {
      return json(
        "https://docs.googleapis.com/v1/documents",
        "POST",
        { title: requiredString(args, "title") },
        false,
      );
    }
    if (toolName === "docs_append") {
      return json(
        `https://docs.googleapis.com/v1/documents/${encodePath(requiredString(args, "documentId"))}:batchUpdate`,
        "POST",
        {
          requests: [
            {
              insertText: {
                endOfSegmentLocation: {},
                text: requiredString(args, "text"),
              },
            },
          ],
        },
        false,
      );
    }
    if (toolName === "docs_replace_text") {
      return json(
        `https://docs.googleapis.com/v1/documents/${encodePath(requiredString(args, "documentId"))}:batchUpdate`,
        "POST",
        {
          requests: [
            {
              replaceAllText: {
                containsText: {
                  text: requiredString(args, "find"),
                  matchCase: args.matchCase === true,
                },
                replaceText: requiredStringAllowEmpty(args, "replace"),
              },
            },
          ],
        },
        false,
      );
    }
    if (toolName === "sheets_get") {
      return json(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodePath(requiredString(args, "spreadsheetId"))}/values/${encodePath(requiredString(args, "range"))}`,
      );
    }
    if (toolName === "sheets_batch_get") {
      const params = new URLSearchParams();
      for (const range of requiredStringArray(args, "ranges", 100)) {
        params.append("ranges", range);
      }
      return json(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodePath(requiredString(args, "spreadsheetId"))}/values:batchGet?${params}`,
      );
    }
    if (toolName === "sheets_update" || toolName === "sheets_append") {
      if (
        !Array.isArray(args.values) ||
        args.values.some((row) => !Array.isArray(row))
      ) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "values must be an array of rows",
        );
      }
      const valueInputOption =
        args.valueInputOption === "RAW" ? "RAW" : "USER_ENTERED";
      const spreadsheetId = encodePath(requiredString(args, "spreadsheetId"));
      const range = encodePath(requiredString(args, "range"));
      return toolName === "sheets_update"
        ? json(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=${valueInputOption}`,
            "PUT",
            { values: args.values },
            false,
          )
        : json(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=${valueInputOption}`,
            "POST",
            { values: args.values },
            false,
          );
    }
    if (toolName === "sheets_create") {
      return json(
        "https://sheets.googleapis.com/v4/spreadsheets",
        "POST",
        { properties: { title: requiredString(args, "title") } },
        false,
      );
    }
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      "Unknown Google Workspace tool",
    );
  }
}
