import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { googleOAuthAdminConfigService } from "../google-oauth-admin-config.service";

export const GOOGLE_WORKSPACE_SERVER_NAME = "GoogleWorkspace";
export const GOOGLE_WORKSPACE_SERVER_UUID =
  "00000000-0000-4000-8000-000000000021";
export const GOOGLE_WORKSPACE_DEFAULT_TOOL_STATUS = "INACTIVE" as const;
export const MAX_GMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_GMAIL_FORWARD_SOURCE_BYTES = 100 * 1024;
export const MAX_GMAIL_FORWARD_METADATA_FIELD_BYTES = 1024;
export const GMAIL_FORWARD_TRUNCATION_MARKER = "\n[... source content truncated ...]";
export const MAX_DRIVE_DOWNLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_DRIVE_UPLOAD_BYTES = 10 * 1024 * 1024;

const GOOGLE_BASE_URL = "https://www.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

const scopes = {
  gmailRead: "https://www.googleapis.com/auth/gmail.readonly",
  gmailModify: "https://www.googleapis.com/auth/gmail.modify",
  gmailCompose: "https://www.googleapis.com/auth/gmail.compose",
  gmailSend: "https://www.googleapis.com/auth/gmail.send",
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
        format: "uuid",
        description:
          "Optional Google connection ID (UUID). Specify to route this request to a specific connected Google account. Defaults to the user's default account.",
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
  tool(
    "gmail_mark_read",
    "Remove UNREAD from one message. Active policy mapping and gmail.modify re-consent required.",
    { messageId: { type: "string" } },
    ["messageId"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_mark_unread",
    "Add UNREAD to one message. Active policy mapping and gmail.modify re-consent required.",
    { messageId: { type: "string" } },
    ["messageId"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_star",
    "Add STARRED to one message. Active policy mapping and gmail.modify re-consent required.",
    { messageId: { type: "string" } },
    ["messageId"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_unstar",
    "Remove STARRED from one message. Active policy mapping and gmail.modify re-consent required.",
    { messageId: { type: "string" } },
    ["messageId"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_archive",
    "Remove INBOX from one message without deleting it. Active policy mapping and gmail.modify re-consent required.",
    { messageId: { type: "string" } },
    ["messageId"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_unarchive",
    "Add INBOX back to one archived message. Active policy mapping and gmail.modify re-consent required.",
    { messageId: { type: "string" } },
    ["messageId"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_move_to_inbox",
    "Add INBOX to one message. Active policy mapping and gmail.modify re-consent required.",
    { messageId: { type: "string" } },
    ["messageId"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_trash",
    "Move one message to Trash. Reversible with gmail_untrash. Active policy mapping and gmail.modify re-consent required.",
    { messageId: { type: "string" } },
    ["messageId"],
    { write: true, destructive: true },
  ),
  tool(
    "gmail_untrash",
    "Restore one trashed message. Active policy mapping and gmail.modify re-consent required.",
    { messageId: { type: "string" } },
    ["messageId"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_report_spam",
    "Add SPAM to one message. Active policy mapping and gmail.modify re-consent required.",
    { messageId: { type: "string" } },
    ["messageId"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_remove_spam",
    "Remove SPAM from one message and add INBOX. Active policy mapping and gmail.modify re-consent required.",
    { messageId: { type: "string" } },
    ["messageId"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_add_labels",
    "Add 1-100 caller-supplied user label IDs to one message. Gmail system labels are rejected; use the dedicated organization tools for them. Active policy mapping and gmail.modify re-consent required.",
    { messageId: { type: "string" }, labelIds: stringArray(100) },
    ["messageId", "labelIds"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_remove_labels",
    "Remove 1-100 caller-supplied user label IDs from one message. Gmail system labels are rejected; use the dedicated organization tools for them. Active policy mapping and gmail.modify re-consent required.",
    { messageId: { type: "string" }, labelIds: stringArray(100) },
    ["messageId", "labelIds"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_trash_thread",
    "Move every message in one thread to Trash. Reversible with gmail_untrash_thread. Active policy mapping and gmail.modify re-consent required.",
    { threadId: { type: "string" } },
    ["threadId"],
    { write: true, destructive: true },
  ),
  tool(
    "gmail_untrash_thread",
    "Restore every message in one trashed thread. Active policy mapping and gmail.modify re-consent required.",
    { threadId: { type: "string" } },
    ["threadId"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_create_label",
    "Create a new user label in Gmail. Active policy mapping and gmail.modify re-consent required.",
    {
      name: { type: "string", description: "The display name of the label." },
      labelListVisibility: {
        type: "string",
        enum: ["labelShow", "labelShowIfUnread", "labelHide"],
        description: "The visibility of the label in the label list.",
      },
      messageListVisibility: {
        type: "string",
        enum: ["show", "hide"],
        description: "The visibility of the label in the message list.",
      },
      color: object({
        textColor: { type: "string" },
        backgroundColor: { type: "string" },
      }),
    },
    ["name"],
    { write: true },
  ),
  tool(
    "gmail_update_label",
    "Update an existing user label in Gmail. Active policy mapping and gmail.modify re-consent required.",
    {
      labelId: { type: "string", description: "The ID of the user label to update." },
      name: { type: "string", description: "The new display name of the label." },
      labelListVisibility: {
        type: "string",
        enum: ["labelShow", "labelShowIfUnread", "labelHide"],
        description: "The visibility of the label in the label list.",
      },
      messageListVisibility: {
        type: "string",
        enum: ["show", "hide"],
        description: "The visibility of the label in the message list.",
      },
      color: object({
        textColor: { type: "string" },
        backgroundColor: { type: "string" },
      }),
    },
    ["labelId"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_delete_label",
    "Permanently delete a user label in Gmail. Destructive operation. Active policy mapping and gmail.modify re-consent required.",
    {
      labelId: { type: "string", description: "The ID of the user label to delete." },
    },
    ["labelId"],
    { write: true, destructive: true },
  ),
  tool(
    "gmail_list_drafts",
    "List Gmail drafts with pagination and search query. Active policy mapping and gmail.compose re-consent required.",
    {
      query: { type: "string", description: "Optional query filter for drafts (same syntax as Gmail search)." },
      maxResults: { type: "integer", minimum: 1, maximum: 100 },
      pageToken: { type: "string" },
    },
  ),
  tool(
    "gmail_get_draft",
    "Get one Gmail draft by draft ID with parsed message MIME. Active policy mapping and gmail.compose re-consent required.",
    { draftId: { type: "string" } },
    ["draftId"],
  ),
  tool(
    "gmail_create_draft",
    "Create a new Gmail draft using structured fields. Active policy mapping and gmail.compose re-consent required.",
    {
      to: stringArray(100),
      cc: stringArray(100),
      bcc: stringArray(100),
      subject: { type: "string" },
      bodyText: { type: "string" },
      bodyHtml: { type: "string" },
      threadId: { type: "string" },
    },
    [],
    { write: true },
  ),
  tool(
    "gmail_update_draft",
    "Replace/update an existing Gmail draft by draft ID using structured fields. Active policy mapping and gmail.compose re-consent required.",
    {
      draftId: { type: "string" },
      to: stringArray(100),
      cc: stringArray(100),
      bcc: stringArray(100),
      subject: { type: "string" },
      bodyText: { type: "string" },
      bodyHtml: { type: "string" },
      threadId: { type: "string" },
    },
    ["draftId"],
    { write: true, idempotent: true },
  ),
  tool(
    "gmail_delete_draft",
    "Permanently delete a Gmail draft by draft ID. Destructive operation. Active policy mapping and gmail.compose re-consent required.",
    { draftId: { type: "string" } },
    ["draftId"],
    { write: true, destructive: true },
  ),
  tool(
    "gmail_send",
    "Send a new email using structured fields. Active policy mapping and gmail.send re-consent required.",
    {
      to: stringArray(100),
      cc: stringArray(100),
      bcc: stringArray(100),
      subject: { type: "string" },
      bodyText: { type: "string" },
      bodyHtml: { type: "string" },
    },
    ["to"],
    { write: true },
  ),
  tool(
    "gmail_reply",
    "Reply to a message sender using structured fields. Active policy mapping and gmail.send re-consent required.",
    {
      messageId: { type: "string" },
      bodyText: { type: "string" },
      bodyHtml: { type: "string" },
    },
    ["messageId"],
    { write: true },
  ),
  tool(
    "gmail_reply_all",
    "Reply to all recipients and original sender of a message. Active policy mapping and gmail.send re-consent required.",
    {
      messageId: { type: "string" },
      bodyText: { type: "string" },
      bodyHtml: { type: "string" },
    },
    ["messageId"],
    { write: true },
  ),
  tool(
    "gmail_forward",
    "Forward an existing message to explicit recipients. Active policy mapping and gmail.send re-consent required.",
    {
      messageId: { type: "string" },
      to: stringArray(100),
      cc: stringArray(100),
      bcc: stringArray(100),
      subject: { type: "string" },
      bodyText: { type: "string" },
      bodyHtml: { type: "string" },
    },
    ["messageId", "to"],
    { write: true },
  ),
  tool(
    "gmail_send_draft",
    "Send an existing Gmail draft by draft ID. Effectful non-idempotent operation. Active policy mapping and gmail.send re-consent required.",
    { draftId: { type: "string" } },
    ["draftId"],
    { write: true },
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

const GMAIL_SYSTEM_LABELS = new Set([
  "INBOX",
  "SPAM",
  "TRASH",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "SENT",
  "DRAFT",
  "CATEGORY_PERSONAL",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
  "CATEGORY_PROMOTIONS",
]);

function validateUserLabelIds(args: Record<string, unknown>): string[] {
  const labelIds = requiredStringArray(args, "labelIds", 100);
  if (labelIds.some((labelId) => GMAIL_SYSTEM_LABELS.has(labelId))) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      "labelIds must not contain Gmail system labels; use the dedicated organization tools instead",
    );
  }
  return labelIds;
}

const GMAIL_MESSAGE_MODIFY_ACTIONS: Record<
  string,
  { addLabelIds?: string[]; removeLabelIds?: string[] }
> = {
  gmail_mark_read: { removeLabelIds: ["UNREAD"] },
  gmail_mark_unread: { addLabelIds: ["UNREAD"] },
  gmail_star: { addLabelIds: ["STARRED"] },
  gmail_unstar: { removeLabelIds: ["STARRED"] },
  gmail_archive: { removeLabelIds: ["INBOX"] },
  gmail_unarchive: { addLabelIds: ["INBOX"] },
  gmail_move_to_inbox: { addLabelIds: ["INBOX"] },
  gmail_report_spam: { addLabelIds: ["SPAM"] },
  gmail_remove_spam: { removeLabelIds: ["SPAM"], addLabelIds: ["INBOX"] },
};

function validateUserLabelId(labelId: string): string {
  if (!labelId || typeof labelId !== "string") {
    throw new GoogleWorkspaceError("INVALID_ARGUMENT", "labelId is required");
  }
  if (GMAIL_SYSTEM_LABELS.has(labelId)) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      "labelId must not be a Gmail system label",
    );
  }
  return labelId;
}

function validateHeaderField(value: string, fieldName: string): string {
  if (/[\r\n]/.test(value)) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      `${fieldName} must not contain CR or LF characters`,
    );
  }
  return value;
}

function validateEmailList(values: string[], fieldName: string): string[] {
  for (const email of values) {
    if (typeof email !== "string" || email.length === 0) {
      throw new GoogleWorkspaceError(
        "INVALID_ARGUMENT",
        `${fieldName} must contain non-empty email strings`,
      );
    }
    validateHeaderField(email, fieldName);
  }
  return values;
}

const VALID_LABEL_LIST_VISIBILITY = new Set([
  "labelShow",
  "labelShowIfUnread",
  "labelHide",
]);
const VALID_MESSAGE_LIST_VISIBILITY = new Set(["show", "hide"]);

function validateLabelVisibility(
  value: unknown,
  fieldName: "labelListVisibility" | "messageListVisibility",
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new GoogleWorkspaceError("INVALID_ARGUMENT", `${fieldName} must be a string`);
  }
  const validSet =
    fieldName === "labelListVisibility"
      ? VALID_LABEL_LIST_VISIBILITY
      : VALID_MESSAGE_LIST_VISIBILITY;
  if (!validSet.has(value)) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      `Invalid ${fieldName} value. Allowed values: ${Array.from(validSet).join(", ")}`,
    );
  }
  return value;
}

function validateLabelColor(value: unknown): { textColor?: string; backgroundColor?: string } | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GoogleWorkspaceError("INVALID_ARGUMENT", "color must be an object");
  }
  const obj = value as Record<string, unknown>;
  const textColor = obj.textColor !== undefined ? requiredString(obj, "textColor") : undefined;
  const backgroundColor = obj.backgroundColor !== undefined ? requiredString(obj, "backgroundColor") : undefined;
  return { textColor, backgroundColor };
}

function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  if (match && match[1]) {
    return match[1].trim().toLowerCase();
  }
  return raw.trim().toLowerCase();
}

function parseEmailAddresses(raw: string): string[] {
  if (!raw || typeof raw !== "string") return [];
  const results: string[] = [];
  const parts = raw.split(/,\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      results.push(trimmed);
    }
  }
  return results;
}

function truncateUtf8(value: string, maxBytes: number, marker = ""): string {
  const buf = Buffer.from(value, "utf8");
  if (buf.length <= maxBytes) return value;
  const markerBuf = Buffer.from(marker, "utf8");
  const targetBytes = Math.max(0, maxBytes - markerBuf.length);

  let sliceLength = targetBytes;
  while (sliceLength > 0 && (buf[sliceLength] & 0xc0) === 0x80) {
    sliceLength -= 1;
  }
  return buf.subarray(0, sliceLength).toString("utf8") + marker;
}

function normalizeSubjectPrefix(prefix: "Re:" | "Fwd:", subject: string): string {
  const cleaned = subject.replace(/^(re|fwd):\s*/i, "").trim();
  return `${prefix} ${cleaned}`.trim();
}

function buildRfc2822Message(input: {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  inReplyTo?: string;
  references?: string;
  requireTo?: boolean;
}): string {
  const to = input.to ?? [];
  const cc = input.cc;
  const bcc = input.bcc;
  const subject = input.subject ?? "";
  const bodyText = input.bodyText;
  const bodyHtml = input.bodyHtml;

  if (input.requireTo && to.length === 0) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      "to is required and must contain at least one recipient",
    );
  }

  if (!bodyText && !bodyHtml) {
    throw new GoogleWorkspaceError(
      "INVALID_ARGUMENT",
      "At least one of bodyText or bodyHtml is required",
    );
  }

  if (to.length > 0) validateEmailList(to, "to");
  if (cc && cc.length > 0) validateEmailList(cc, "cc");
  if (bcc && bcc.length > 0) validateEmailList(bcc, "bcc");
  validateHeaderField(subject, "subject");
  if (input.inReplyTo) validateHeaderField(input.inReplyTo, "In-Reply-To");
  if (input.references) validateHeaderField(input.references, "References");

  const headers: string[] = [];
  if (to.length > 0) headers.push(`To: ${to.join(", ")}`);
  if (cc && cc.length > 0) headers.push(`Cc: ${cc.join(", ")}`);
  if (bcc && bcc.length > 0) headers.push(`Bcc: ${bcc.join(", ")}`);
  if (subject) headers.push(`Subject: ${subject}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headers.push(`References: ${input.references}`);
  headers.push("MIME-Version: 1.0");

  let mimeContent = "";
  if (bodyText !== undefined && bodyHtml !== undefined) {
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    mimeContent = [
      headers.join("\r\n"),
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      bodyText,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      bodyHtml,
      "",
      `--${boundary}--`,
    ].join("\r\n");
  } else if (bodyHtml !== undefined) {
    headers.push("Content-Type: text/html; charset=UTF-8");
    headers.push("Content-Transfer-Encoding: 7bit");
    mimeContent = [headers.join("\r\n"), "", bodyHtml].join("\r\n");
  } else {
    headers.push("Content-Type: text/plain; charset=UTF-8");
    headers.push("Content-Transfer-Encoding: 7bit");
    mimeContent = [headers.join("\r\n"), "", bodyText || ""].join("\r\n");
  }

  return Buffer.from(mimeContent, "utf8").toString("base64url");
}

function buildRfc2822Draft(args: Record<string, unknown>): string {
  const to = args.to !== undefined ? requiredStringArray(args, "to", 100) : [];
  const cc = args.cc !== undefined ? requiredStringArray(args, "cc", 100) : undefined;
  const bcc = args.bcc !== undefined ? requiredStringArray(args, "bcc", 100) : undefined;
  const subject = args.subject !== undefined ? requiredStringAllowEmpty(args, "subject") : "";
  const bodyText = typeof args.bodyText === "string" ? args.bodyText : undefined;
  const bodyHtml = typeof args.bodyHtml === "string" ? args.bodyHtml : undefined;

  return buildRfc2822Message({
    to,
    cc,
    bcc,
    subject,
    bodyText,
    bodyHtml,
    requireTo: false,
  });
}

function parseGmailDraft(draft: Record<string, unknown>) {
  const message =
    draft.message && typeof draft.message === "object"
      ? parseMimeMessage(draft.message as Record<string, unknown>)
      : undefined;
  return {
    id: typeof draft.id === "string" ? draft.id : undefined,
    ...(message ? { message } : {}),
  };
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
    if (
      toolName === "gmail_list_drafts" ||
      toolName === "gmail_get_draft" ||
      toolName === "gmail_create_draft" ||
      toolName === "gmail_update_draft" ||
      toolName === "gmail_delete_draft"
    ) {
      return { anyOf: [scopes.gmailCompose], guidance: '"gmail.compose"' };
    }
    if (
      toolName === "gmail_send" ||
      toolName === "gmail_reply" ||
      toolName === "gmail_reply_all" ||
      toolName === "gmail_forward" ||
      toolName === "gmail_send_draft"
    ) {
      return { anyOf: [scopes.gmailSend], guidance: '"gmail.send"' };
    }
    return isGoogleWorkspaceWriteTool(toolName)
      ? { anyOf: [scopes.gmailModify], guidance: '"gmail.modify"' }
      : { anyOf: [scopes.gmailRead], guidance: '"gmail.readonly"' };
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
    replyTo: headerMap["reply-to"] ?? "",
    date: headerMap.date ?? "",
    messageId: headerMap["message-id"] ?? "",
    references: headerMap.references ?? "",
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
    const credentials = await googleOAuthAdminConfigService.getCredentials();
    const clientId = credentials.clientId;
    const clientSecret = credentials.clientSecret;
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
    const gmailModifyAction = GMAIL_MESSAGE_MODIFY_ACTIONS[toolName];
    if (gmailModifyAction) {
      return json(
        `/gmail/v1/users/me/messages/${encodePath(requiredString(args, "messageId"))}/modify`,
        "POST",
        {
          ...(gmailModifyAction.addLabelIds
            ? { addLabelIds: gmailModifyAction.addLabelIds }
            : {}),
          ...(gmailModifyAction.removeLabelIds
            ? { removeLabelIds: gmailModifyAction.removeLabelIds }
            : {}),
        },
        false,
      );
    }
    if (toolName === "gmail_add_labels") {
      return json(
        `/gmail/v1/users/me/messages/${encodePath(requiredString(args, "messageId"))}/modify`,
        "POST",
        { addLabelIds: validateUserLabelIds(args) },
        false,
      );
    }
    if (toolName === "gmail_remove_labels") {
      return json(
        `/gmail/v1/users/me/messages/${encodePath(requiredString(args, "messageId"))}/modify`,
        "POST",
        { removeLabelIds: validateUserLabelIds(args) },
        false,
      );
    }
    if (toolName === "gmail_trash" || toolName === "gmail_untrash") {
      return json(
        `/gmail/v1/users/me/messages/${encodePath(requiredString(args, "messageId"))}/${toolName === "gmail_trash" ? "trash" : "untrash"}`,
        "POST",
        undefined,
        false,
      );
    }
    if (toolName === "gmail_trash_thread" || toolName === "gmail_untrash_thread") {
      return json(
        `/gmail/v1/users/me/threads/${encodePath(requiredString(args, "threadId"))}/${toolName === "gmail_trash_thread" ? "trash" : "untrash"}`,
        "POST",
        undefined,
        false,
      );
    }
    if (toolName === "gmail_create_label") {
      const name = requiredString(args, "name");
      const labelListVisibility = validateLabelVisibility(
        args.labelListVisibility,
        "labelListVisibility",
      );
      const messageListVisibility = validateLabelVisibility(
        args.messageListVisibility,
        "messageListVisibility",
      );
      const color = validateLabelColor(args.color);
      return json(
        "/gmail/v1/users/me/labels",
        "POST",
        {
          name,
          ...(labelListVisibility ? { labelListVisibility } : {}),
          ...(messageListVisibility ? { messageListVisibility } : {}),
          ...(color ? { color } : {}),
        },
        false,
      );
    }
    if (toolName === "gmail_update_label") {
      const labelId = validateUserLabelId(requiredString(args, "labelId"));
      const patchBody: Record<string, unknown> = {};
      if (args.name !== undefined) {
        patchBody.name = requiredString(args, "name");
      }
      if (args.labelListVisibility !== undefined) {
        patchBody.labelListVisibility = validateLabelVisibility(
          args.labelListVisibility,
          "labelListVisibility",
        );
      }
      if (args.messageListVisibility !== undefined) {
        patchBody.messageListVisibility = validateLabelVisibility(
          args.messageListVisibility,
          "messageListVisibility",
        );
      }
      if (args.color !== undefined) {
        patchBody.color = validateLabelColor(args.color);
      }
      if (Object.keys(patchBody).length === 0) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "At least one field to update must be provided",
        );
      }
      return json(
        `/gmail/v1/users/me/labels/${encodePath(labelId)}`,
        "PATCH",
        patchBody,
        false,
      );
    }
    if (toolName === "gmail_delete_label") {
      const labelId = validateUserLabelId(requiredString(args, "labelId"));
      return json(
        `/gmail/v1/users/me/labels/${encodePath(labelId)}`,
        "DELETE",
        undefined,
        false,
      );
    }
    if (toolName === "gmail_list_drafts") {
      const params = new URLSearchParams();
      if (typeof args.query === "string" && args.query.length > 0) {
        params.set("q", args.query);
      }
      const maxResults = optionalBoundedInteger(args, "maxResults", 100);
      if (maxResults !== undefined) {
        params.set("maxResults", String(maxResults));
      }
      if (typeof args.pageToken === "string") {
        params.set("pageToken", args.pageToken);
      }
      const queryStr = params.toString();
      const path = `/gmail/v1/users/me/drafts${queryStr ? `?${queryStr}` : ""}`;
      const result = (await json(path)) as Record<string, unknown>;
      return {
        drafts: Array.isArray(result.drafts)
          ? result.drafts.flatMap((draft) => {
              if (!draft || typeof draft !== "object") return [];
              const item = draft as Record<string, unknown>;
              return typeof item.id === "string"
                ? [
                    {
                      id: item.id,
                      ...(item.message && typeof item.message === "object"
                        ? {
                            message: {
                              id:
                                typeof (item.message as Record<string, unknown>).id === "string"
                                  ? (item.message as Record<string, unknown>).id
                                  : undefined,
                              threadId:
                                typeof (item.message as Record<string, unknown>).threadId === "string"
                                  ? (item.message as Record<string, unknown>).threadId
                                  : undefined,
                            },
                          }
                        : {}),
                    },
                  ]
                : [];
            })
          : [],
        ...(typeof result.nextPageToken === "string"
          ? { nextPageToken: result.nextPageToken }
          : {}),
      };
    }
    if (toolName === "gmail_get_draft") {
      const draft = (await json(
        `/gmail/v1/users/me/drafts/${encodePath(requiredString(args, "draftId"))}?format=full`,
      )) as Record<string, unknown>;
      return parseGmailDraft(draft);
    }
    if (toolName === "gmail_create_draft") {
      const raw = buildRfc2822Draft(args);
      const requestBody: { message: { raw: string; threadId?: string } } = {
        message: {
          raw,
          ...(typeof args.threadId === "string" ? { threadId: args.threadId } : {}),
        },
      };
      return json("/gmail/v1/users/me/drafts", "POST", requestBody, false);
    }
    if (toolName === "gmail_update_draft") {
      const draftId = requiredString(args, "draftId");
      const raw = buildRfc2822Draft(args);
      const requestBody: { id: string; message: { raw: string; threadId?: string } } = {
        id: draftId,
        message: {
          raw,
          ...(typeof args.threadId === "string" ? { threadId: args.threadId } : {}),
        },
      };
      return json(
        `/gmail/v1/users/me/drafts/${encodePath(draftId)}`,
        "PUT",
        requestBody,
        false,
      );
    }
    if (toolName === "gmail_delete_draft") {
      const draftId = requiredString(args, "draftId");
      return json(
        `/gmail/v1/users/me/drafts/${encodePath(draftId)}`,
        "DELETE",
        undefined,
        false,
      );
    }
    if (toolName === "gmail_send") {
      const raw = buildRfc2822Message({
        to: requiredStringArray(args, "to", 100),
        cc: args.cc !== undefined ? requiredStringArray(args, "cc", 100) : undefined,
        bcc: args.bcc !== undefined ? requiredStringArray(args, "bcc", 100) : undefined,
        subject: args.subject !== undefined ? requiredStringAllowEmpty(args, "subject") : "",
        bodyText: typeof args.bodyText === "string" ? args.bodyText : undefined,
        bodyHtml: typeof args.bodyHtml === "string" ? args.bodyHtml : undefined,
        requireTo: true,
      });
      return json(
        "/gmail/v1/users/me/messages/send",
        "POST",
        { raw },
        false,
      );
    }
    if (toolName === "gmail_reply" || toolName === "gmail_reply_all") {
      const messageId = requiredString(args, "messageId");
      const originalMessageRaw = (await json(
        `/gmail/v1/users/me/messages/${encodePath(messageId)}?format=full`,
      )) as Record<string, unknown>;
      const orig = parseMimeMessage(originalMessageRaw);

      let authEmail: string | undefined;
      try {
        const profile = (await json("/gmail/v1/users/me/profile")) as Record<string, unknown>;
        if (typeof profile.emailAddress === "string" && profile.emailAddress.length > 0) {
          authEmail = profile.emailAddress.trim().toLowerCase();
        }
      } catch {
        // Fallback if profile endpoint fails or is inaccessible
      }

      const replyToAddress = orig.replyTo && orig.replyTo.trim().length > 0 ? orig.replyTo : orig.from;
      if (!replyToAddress || replyToAddress.trim().length === 0) {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "Original message has no valid From or Reply-To recipient",
        );
      }

      let toRecipients: string[] = [];
      let ccRecipients: string[] | undefined = undefined;

      if (toolName === "gmail_reply") {
        toRecipients = parseEmailAddresses(replyToAddress);
      } else {
        // reply-all: deduplicate original sender + to + cc, excluding authenticated user
        const seenAddresses = new Set<string>();
        const candidateToList = [
          ...parseEmailAddresses(replyToAddress),
          ...parseEmailAddresses(orig.to),
        ];
        for (const item of candidateToList) {
          const email = extractEmailAddress(item);
          if (authEmail && email === authEmail) continue;
          if (!seenAddresses.has(email)) {
            seenAddresses.add(email);
            toRecipients.push(item);
          }
        }
        if (toRecipients.length === 0) {
          throw new GoogleWorkspaceError(
            "INVALID_ARGUMENT",
            "No valid recipients remain for reply-all after excluding authenticated sender",
          );
        }

        const candidateCcList = parseEmailAddresses(orig.cc);
        const deduplicatedCc: string[] = [];
        for (const item of candidateCcList) {
          const email = extractEmailAddress(item);
          if (authEmail && email === authEmail) continue;
          if (!seenAddresses.has(email)) {
            seenAddresses.add(email);
            deduplicatedCc.push(item);
          }
        }
        if (deduplicatedCc.length > 0) {
          ccRecipients = deduplicatedCc;
        }
      }

      const subject = normalizeSubjectPrefix("Re:", orig.subject);
      const inReplyTo = orig.messageId ? orig.messageId : undefined;
      const references = [orig.references, orig.messageId].filter(Boolean).join(" ").trim() || undefined;

      const raw = buildRfc2822Message({
        to: toRecipients,
        cc: ccRecipients,
        subject,
        bodyText: typeof args.bodyText === "string" ? args.bodyText : undefined,
        bodyHtml: typeof args.bodyHtml === "string" ? args.bodyHtml : undefined,
        inReplyTo,
        references,
        requireTo: true,
      });

      const requestBody: { raw: string; threadId?: string } = {
        raw,
        ...(orig.threadId ? { threadId: orig.threadId } : {}),
      };

      return json(
        "/gmail/v1/users/me/messages/send",
        "POST",
        requestBody,
        false,
      );
    }
    if (toolName === "gmail_forward") {
      const messageId = requiredString(args, "messageId");
      const originalMessageRaw = (await json(
        `/gmail/v1/users/me/messages/${encodePath(messageId)}?format=full`,
      )) as Record<string, unknown>;
      const orig = parseMimeMessage(originalMessageRaw);

      const to = requiredStringArray(args, "to", 100);
      const cc = args.cc !== undefined ? requiredStringArray(args, "cc", 100) : undefined;
      const bcc = args.bcc !== undefined ? requiredStringArray(args, "bcc", 100) : undefined;
      const subject =
        args.subject !== undefined
          ? requiredStringAllowEmpty(args, "subject")
          : normalizeSubjectPrefix("Fwd:", orig.subject);

      const callerBodyText = typeof args.bodyText === "string" ? args.bodyText : undefined;
      const callerBodyHtml = typeof args.bodyHtml === "string" ? args.bodyHtml : undefined;

      const origDate = truncateUtf8(
        orig.date || "Unknown",
        MAX_GMAIL_FORWARD_METADATA_FIELD_BYTES,
      );
      const origFrom = truncateUtf8(
        orig.from || "Unknown",
        MAX_GMAIL_FORWARD_METADATA_FIELD_BYTES,
      );
      const origSubject = truncateUtf8(
        orig.subject || "No Subject",
        MAX_GMAIL_FORWARD_METADATA_FIELD_BYTES,
      );
      const origTo = truncateUtf8(
        orig.to || "",
        MAX_GMAIL_FORWARD_METADATA_FIELD_BYTES,
      );
      const origText = truncateUtf8(
        orig.text || "",
        MAX_GMAIL_FORWARD_SOURCE_BYTES,
        GMAIL_FORWARD_TRUNCATION_MARKER,
      );

      const forwardedBlockLines = [
        "---------- Forwarded message ---------",
        `From: ${origFrom}`,
        `Date: ${origDate}`,
        `Subject: ${origSubject}`,
        ...(origTo ? [`To: ${origTo}`] : []),
        "",
        origText,
      ];
      const forwardedBlockText = forwardedBlockLines.join("\n");

      let bodyText: string;
      if (callerBodyText !== undefined) {
        bodyText = callerBodyText ? `${callerBodyText}\n\n${forwardedBlockText}` : forwardedBlockText;
      } else if (callerBodyHtml !== undefined) {
        bodyText = forwardedBlockText;
      } else {
        throw new GoogleWorkspaceError(
          "INVALID_ARGUMENT",
          "At least one of bodyText or bodyHtml is required",
        );
      }

      let bodyHtml: string | undefined = undefined;
      if (callerBodyHtml !== undefined) {
        const escapedOrigFrom = origFrom.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const escapedOrigDate = origDate.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const escapedOrigSubject = origSubject.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const escapedOrigTo = origTo.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const escapedOrigText = origText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

        const forwardedBlockHtml = `<div class="gmail_quote">---------- Forwarded message ---------<br><b>From:</b> ${escapedOrigFrom}<br><b>Date:</b> ${escapedOrigDate}<br><b>Subject:</b> ${escapedOrigSubject}<br>${escapedOrigTo ? `<b>To:</b> ${escapedOrigTo}<br>` : ""}<br>${escapedOrigText}</div>`;
        bodyHtml = callerBodyHtml ? `${callerBodyHtml}<br><br>${forwardedBlockHtml}` : forwardedBlockHtml;
      }

      const raw = buildRfc2822Message({
        to,
        cc,
        bcc,
        subject,
        bodyText,
        bodyHtml,
        references: orig.messageId || undefined,
        requireTo: true,
      });

      const requestBody: { raw: string; threadId?: string } = {
        raw,
        ...(orig.threadId ? { threadId: orig.threadId } : {}),
      };

      return json(
        "/gmail/v1/users/me/messages/send",
        "POST",
        requestBody,
        false,
      );
    }
    if (toolName === "gmail_send_draft") {
      const draftId = requiredString(args, "draftId");
      return json(
        "/gmail/v1/users/me/drafts/send",
        "POST",
        { id: draftId },
        false,
      );
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
