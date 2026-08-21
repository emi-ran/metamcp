import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const GOOGLE_WORKSPACE_SERVER_NAME = "GoogleWorkspace";
export const GOOGLE_WORKSPACE_SERVER_UUID = "00000000-0000-4000-8000-000000000021";
export const MAX_GMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const GOOGLE_BASE_URL = "https://www.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const WRITE_METHODS = new Set(["calendar_create_event", "calendar_update_event", "calendar_delete_event", "drive_create_folder", "drive_upload_file", "drive_update_file", "drive_delete_file", "drive_share_file", "docs_create_document", "docs_update_document", "sheets_create_spreadsheet", "sheets_update_values", "sheets_append_values"]);

const scope = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  calendarRead: "https://www.googleapis.com/auth/calendar.readonly",
  calendarWrite: "https://www.googleapis.com/auth/calendar.events",
  driveRead: "https://www.googleapis.com/auth/drive.readonly",
  driveWrite: "https://www.googleapis.com/auth/drive",
  docsRead: "https://www.googleapis.com/auth/documents.readonly",
  docsWrite: "https://www.googleapis.com/auth/documents",
  sheetsRead: "https://www.googleapis.com/auth/spreadsheets.readonly",
  sheetsWrite: "https://www.googleapis.com/auth/spreadsheets",
} as const;

const object = (properties: Record<string, object> = {}, required?: string[]) => ({
  type: "object" as const,
  properties,
  ...(required?.length ? { required } : {}),
});

export const GOOGLE_WORKSPACE_TOOLS: Tool[] = [
  { name: "gmail_list_messages", description: "List Gmail messages. Read-only.", inputSchema: object({ query: { type: "string" }, maxResults: { type: "integer", minimum: 1, maximum: 100 } }) },
  { name: "gmail_get_message", description: "Get Gmail message with parsed MIME text and safe attachment metadata. Read-only.", inputSchema: object({ messageId: { type: "string" } }, ["messageId"]) },
  { name: "gmail_get_attachment", description: "Get Gmail attachment when it is at most 10 MiB. Read-only.", inputSchema: object({ messageId: { type: "string" }, attachmentId: { type: "string" } }, ["messageId", "attachmentId"]) },
  { name: "gmail_search_messages", description: "Search Gmail messages. Read-only.", inputSchema: object({ query: { type: "string" }, maxResults: { type: "integer", minimum: 1, maximum: 100 } }, ["query"]) },
  { name: "calendar_list_calendars", description: "List Google calendars.", inputSchema: object() },
  { name: "calendar_list_events", description: "List calendar events.", inputSchema: object({ calendarId: { type: "string" }, timeMin: { type: "string" }, timeMax: { type: "string" }, maxResults: { type: "integer", minimum: 1, maximum: 2500 } }, ["calendarId"]) },
  { name: "calendar_get_event", description: "Get calendar event.", inputSchema: object({ calendarId: { type: "string" }, eventId: { type: "string" } }, ["calendarId", "eventId"]) },
  { name: "calendar_create_event", description: "Create calendar event. Requires active mapping.", inputSchema: object({ calendarId: { type: "string" }, summary: { type: "string" }, description: { type: "string" }, start: { type: "string" }, end: { type: "string" }, timeZone: { type: "string" } }, ["calendarId", "start", "end"]) },
  { name: "calendar_update_event", description: "Patch calendar event explicitly. Requires active mapping.", inputSchema: object({ calendarId: { type: "string" }, eventId: { type: "string" }, patch: { type: "object" } }, ["calendarId", "eventId", "patch"]) },
  { name: "calendar_delete_event", description: "Delete calendar event. Requires active mapping.", inputSchema: object({ calendarId: { type: "string" }, eventId: { type: "string" } }, ["calendarId", "eventId"]) },
  { name: "drive_list_files", description: "List Drive files.", inputSchema: object({ query: { type: "string" }, pageSize: { type: "integer", minimum: 1, maximum: 1000 } }) },
  { name: "drive_get_file", description: "Get Drive file metadata.", inputSchema: object({ fileId: { type: "string" } }, ["fileId"]) },
  { name: "drive_download_file", description: "Download Drive file content metadata. Does not return oversized content.", inputSchema: object({ fileId: { type: "string" } }, ["fileId"]) },
  { name: "drive_create_folder", description: "Create Drive folder. Requires active mapping.", inputSchema: object({ name: { type: "string" }, parentId: { type: "string" } }, ["name"]) },
  { name: "drive_upload_file", description: "Upload small Drive file. Requires active mapping.", inputSchema: object({ name: { type: "string" }, mimeType: { type: "string" }, contentBase64: { type: "string" }, parentId: { type: "string" } }, ["name", "contentBase64"]) },
  { name: "drive_update_file", description: "Patch Drive metadata. Requires active mapping.", inputSchema: object({ fileId: { type: "string" }, patch: { type: "object" } }, ["fileId", "patch"]) },
  { name: "drive_delete_file", description: "Delete Drive file. Requires active mapping.", inputSchema: object({ fileId: { type: "string" } }, ["fileId"]) },
  { name: "drive_share_file", description: "Share Drive file. Requires active mapping.", inputSchema: object({ fileId: { type: "string" }, emailAddress: { type: "string" }, role: { type: "string", enum: ["reader", "commenter", "writer"] }, type: { type: "string", enum: ["user", "group", "domain", "anyone"] } }, ["fileId", "role", "type"]) },
  { name: "docs_get_document", description: "Get Google document.", inputSchema: object({ documentId: { type: "string" } }, ["documentId"]) },
  { name: "docs_create_document", description: "Create Google document. Requires active mapping.", inputSchema: object({ title: { type: "string" } }, ["title"]) },
  { name: "docs_update_document", description: "Batch update Google document. Requires active mapping.", inputSchema: object({ documentId: { type: "string" }, requests: { type: "array", items: { type: "object" } } }, ["documentId", "requests"]) },
  { name: "sheets_get_spreadsheet", description: "Get Google spreadsheet.", inputSchema: object({ spreadsheetId: { type: "string" }, includeGridData: { type: "boolean" } }, ["spreadsheetId"]) },
  { name: "sheets_get_values", description: "Get spreadsheet values.", inputSchema: object({ spreadsheetId: { type: "string" }, range: { type: "string" } }, ["spreadsheetId", "range"]) },
  { name: "sheets_create_spreadsheet", description: "Create spreadsheet. Requires active mapping.", inputSchema: object({ title: { type: "string" } }, ["title"]) },
  { name: "sheets_update_values", description: "Update spreadsheet values. Requires active mapping.", inputSchema: object({ spreadsheetId: { type: "string" }, range: { type: "string" }, values: { type: "array", items: { type: "array" } }, valueInputOption: { type: "string", enum: ["RAW", "USER_ENTERED"] } }, ["spreadsheetId", "range", "values"]) },
  { name: "sheets_append_values", description: "Append spreadsheet values. Requires active mapping.", inputSchema: object({ spreadsheetId: { type: "string" }, range: { type: "string" }, values: { type: "array", items: { type: "array" } }, valueInputOption: { type: "string", enum: ["RAW", "USER_ENTERED"] } }, ["spreadsheetId", "range", "values"]) },
];

export type GoogleHttpClient = { fetch(input: string, init?: RequestInit): Promise<Response> };
export type GoogleConnection = { accessToken: string; refreshToken: string | null; expiresAt: Date | null; scopes: string[]; email?: string | null };
export type GoogleConnectionStore = {
  getDecryptedTokens(userId: string): Promise<GoogleConnection | null>;
  upsertConnection(input: { userId: string; scopes: string[]; accessToken: string; refreshToken?: string | null; expiresInSeconds?: number | null; email?: string | null }): Promise<void>;
};
export type GoogleWorkspaceExecution = { userId?: string; toolName: string; arguments: Record<string, unknown>; allowWrites?: boolean };

export class GoogleWorkspaceError extends Error {
  constructor(public readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_ARGUMENT" | "NOT_CONNECTED" | "CONFIGURATION" | "UPSTREAM", message: string) {
    super(message);
  }
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new GoogleWorkspaceError("INVALID_ARGUMENT", `${key} is required`);
  return value;
}

function requiresTimezone(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}

function encodePath(value: string) { return encodeURIComponent(value); }
function encodeBase64Url(value: string): Buffer { return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64"); }
function requiredScope(toolName: string): string {
  if (toolName.startsWith("gmail_")) return scope.gmail;
  if (toolName.startsWith("calendar_")) return isGoogleWorkspaceWriteTool(toolName) ? scope.calendarWrite : scope.calendarRead;
  if (toolName.startsWith("docs_")) return isGoogleWorkspaceWriteTool(toolName) ? scope.docsWrite : scope.docsRead;
  if (toolName.startsWith("sheets_")) return isGoogleWorkspaceWriteTool(toolName) ? scope.sheetsWrite : scope.sheetsRead;
  return isGoogleWorkspaceWriteTool(toolName) ? scope.driveWrite : scope.driveRead;
}

export function isGoogleWorkspaceToolName(name: string): boolean { return GOOGLE_WORKSPACE_TOOLS.some((tool) => tool.name === name); }
export function isGoogleWorkspaceWriteTool(name: string): boolean { return WRITE_METHODS.has(name); }

function extractMime(payload: Record<string, unknown>) {
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  const headerMap = Object.fromEntries(headers.flatMap((header) => {
    if (!header || typeof header !== "object") return [];
    const { name, value } = header as { name?: unknown; value?: unknown };
    return typeof name === "string" && typeof value === "string" ? [[name.toLowerCase(), value]] : [];
  }));
  const text: string[] = [];
  const attachments: Array<Record<string, unknown>> = [];
  const visit = (part: Record<string, unknown>) => {
    const body = part.body as { data?: unknown; attachmentId?: unknown; size?: unknown } | undefined;
    const mimeType = typeof part.mimeType === "string" ? part.mimeType : "";
    const filename = typeof part.filename === "string" ? part.filename : "";
    const size = typeof body?.size === "number" ? body.size : 0;
    if (mimeType.startsWith("text/") && typeof body?.data === "string") text.push(encodeBase64Url(body.data).toString("utf8"));
    if (filename || body?.attachmentId) attachments.push({ filename: filename || "attachment", mimeType, size, attachmentId: body?.attachmentId, available: size <= MAX_GMAIL_ATTACHMENT_BYTES });
    if (Array.isArray(part.parts)) part.parts.forEach((child) => { if (child && typeof child === "object") visit(child as Record<string, unknown>); });
  };
  visit(payload);
  return { subject: headerMap.subject ?? "", from: headerMap.from ?? "", to: headerMap.to ?? "", date: headerMap.date ?? "", text: text.join("\n"), attachments };
}

export class GoogleWorkspaceClient {
  private readonly refreshFlights = new Map<string, Promise<GoogleConnection>>();
  private readonly http: GoogleHttpClient;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly dependencies: { connections: GoogleConnectionStore; http?: GoogleHttpClient; sleep?: (ms: number) => Promise<void> }) {
    this.http = dependencies.http ?? { fetch };
    this.sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async execute(input: GoogleWorkspaceExecution): Promise<unknown> {
    if (!input.userId) throw new GoogleWorkspaceError("UNAUTHENTICATED", "Authenticated request user is required");
    if (!isGoogleWorkspaceToolName(input.toolName)) throw new GoogleWorkspaceError("INVALID_ARGUMENT", "Unknown Google Workspace tool");
    if (isGoogleWorkspaceWriteTool(input.toolName) && !input.allowWrites) throw new GoogleWorkspaceError("FORBIDDEN", "Google Workspace write requires an active namespace tool mapping");
    const connection = await this.getConnection(input.userId);
    if (!this.hasScope(connection.scopes, requiredScope(input.toolName))) throw new GoogleWorkspaceError("FORBIDDEN", "Google connection lacks required scope");
    return this.dispatch(input.toolName, input.arguments, connection.accessToken);
  }

  private async getConnection(userId: string): Promise<GoogleConnection> {
    const connection = await this.dependencies.connections.getDecryptedTokens(userId);
    if (!connection) throw new GoogleWorkspaceError("NOT_CONNECTED", "No Google connection for authenticated user");
    if (!connection.expiresAt || connection.expiresAt.getTime() > Date.now() + 30_000) return connection;
    if (!connection.refreshToken) throw new GoogleWorkspaceError("NOT_CONNECTED", "Google connection expired; reconnect required");
    let flight = this.refreshFlights.get(userId);
    if (!flight) {
      flight = this.refresh(userId, connection).finally(() => this.refreshFlights.delete(userId));
      this.refreshFlights.set(userId, flight);
    }
    return flight;
  }

  private hasScope(scopes: string[], required: string): boolean {
    if (scopes.includes(required)) return true;
    // Write grants cover matching read endpoints.
    return (
      (required === scope.driveRead && scopes.includes(scope.driveWrite)) ||
      (required === scope.docsRead && scopes.includes(scope.docsWrite)) ||
      (required === scope.sheetsRead && scopes.includes(scope.sheetsWrite)) ||
      (required === scope.calendarRead && scopes.includes(scope.calendarWrite))
    );
  }

  private async refresh(userId: string, connection: GoogleConnection): Promise<GoogleConnection> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new GoogleWorkspaceError("CONFIGURATION", "Google OAuth credentials are not configured");
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: connection.refreshToken!, grant_type: "refresh_token" });
    const response = await this.http.fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    if (!response.ok) throw new GoogleWorkspaceError(response.status === 400 || response.status === 401 ? "NOT_CONNECTED" : "UPSTREAM", response.status === 400 || response.status === 401 ? "Google connection expired; reconnect required" : "Google token refresh failed");
    const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!token.access_token) throw new GoogleWorkspaceError("UPSTREAM", "Google token refresh returned no access token");
    const refreshToken = token.refresh_token ?? connection.refreshToken;
    await this.dependencies.connections.upsertConnection({ userId, scopes: connection.scopes, email: connection.email, accessToken: token.access_token, refreshToken, expiresInSeconds: token.expires_in ?? 3600 });
    return { ...connection, accessToken: token.access_token, refreshToken, expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000) };
  }

  private async request(path: string, token: string, init: RequestInit = {}, safeRetry = init.method === undefined || init.method === "GET"): Promise<unknown> {
    const method = init.method ?? "GET";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const url = path.startsWith("https://") ? path : `${GOOGLE_BASE_URL}${path}`;
      const response = await this.http.fetch(url, { ...init, method, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
      if (response.ok) return response.status === 204 ? { success: true } : response.json();
      if (safeRetry && TRANSIENT_STATUS.has(response.status) && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await this.sleep(Number.isFinite(retryAfter) ? Math.max(0, retryAfter * 1000) : 100 * 2 ** attempt);
        continue;
      }
      if (response.status === 401) throw new GoogleWorkspaceError("NOT_CONNECTED", "Google connection expired; reconnect required");
      if (response.status === 403) throw new GoogleWorkspaceError("FORBIDDEN", "Google access was denied");
      if (response.status === 404) throw new GoogleWorkspaceError("INVALID_ARGUMENT", "Google resource was not found");
      throw new GoogleWorkspaceError("UPSTREAM", "Google API request failed");
    }
    throw new GoogleWorkspaceError("UPSTREAM", "Google API request failed");
  }

  private async dispatch(tool: string, args: Record<string, unknown>, token: string): Promise<unknown> {
    const json = (path: string, method?: string, body?: unknown, safeRetry?: boolean) => this.request(path, token, { ...(method ? { method } : {}), ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }, safeRetry);
    if (tool === "gmail_list_messages" || tool === "gmail_search_messages") { const params = new URLSearchParams(); const query = args.query; if (typeof query === "string") params.set("q", query); if (typeof args.maxResults === "number") params.set("maxResults", String(args.maxResults)); return json(`/gmail/v1/users/me/messages?${params}`); }
    if (tool === "gmail_get_message") { const message = await json(`/gmail/v1/users/me/messages/${encodePath(requiredString(args, "messageId"))}?format=full`) as { id?: string; payload?: Record<string, unknown> }; return { id: message.id, ...extractMime(message.payload ?? {}) }; }
    if (tool === "gmail_get_attachment") { const result = await json(`/gmail/v1/users/me/messages/${encodePath(requiredString(args, "messageId"))}/attachments/${encodePath(requiredString(args, "attachmentId"))}`) as { data?: string; size?: number }; const size = result.size ?? 0; if (size > MAX_GMAIL_ATTACHMENT_BYTES) return { available: false, size, reason: "Attachment exceeds 10 MiB limit" }; return { available: true, size, dataBase64: result.data ?? "" }; }
    if (tool === "calendar_list_calendars") return json("/calendar/v3/users/me/calendarList");
    if (tool === "calendar_list_events") { const params = new URLSearchParams(); for (const key of ["timeMin", "timeMax", "maxResults"] as const) if (args[key] !== undefined) params.set(key, String(args[key])); return json(`/calendar/v3/calendars/${encodePath(requiredString(args, "calendarId"))}/events?${params}`); }
    if (tool === "calendar_get_event") return json(`/calendar/v3/calendars/${encodePath(requiredString(args, "calendarId"))}/events/${encodePath(requiredString(args, "eventId"))}`);
    if (tool === "calendar_create_event") { const start = requiredString(args, "start"); const end = requiredString(args, "end"); if (!requiresTimezone(start) || !requiresTimezone(end)) throw new GoogleWorkspaceError("INVALID_ARGUMENT", "Calendar start and end must be ISO timestamps with timezone"); return json(`/calendar/v3/calendars/${encodePath(requiredString(args, "calendarId"))}/events`, "POST", { summary: args.summary, description: args.description, start: { dateTime: start, timeZone: args.timeZone }, end: { dateTime: end, timeZone: args.timeZone } }, false); }
    if (tool === "calendar_update_event") {
      const patch = args.patch;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new GoogleWorkspaceError("INVALID_ARGUMENT", "patch must be an object");
      for (const boundary of ["start", "end"] as const) {
        const value = (patch as Record<string, unknown>)[boundary];
        if (value !== undefined) {
          const dateTime = value && typeof value === "object" ? (value as Record<string, unknown>).dateTime : undefined;
          if (typeof dateTime !== "string" || !requiresTimezone(dateTime)) throw new GoogleWorkspaceError("INVALID_ARGUMENT", `Calendar ${boundary}.dateTime must be ISO timestamp with timezone`);
        }
      }
      return json(`/calendar/v3/calendars/${encodePath(requiredString(args, "calendarId"))}/events/${encodePath(requiredString(args, "eventId"))}`, "PATCH", patch, false);
    }
    if (tool === "calendar_delete_event") return json(`/calendar/v3/calendars/${encodePath(requiredString(args, "calendarId"))}/events/${encodePath(requiredString(args, "eventId"))}`, "DELETE", undefined, false);
    if (tool === "drive_list_files") { const params = new URLSearchParams({ fields: "files(id,name,mimeType,modifiedTime,size,webViewLink),nextPageToken" }); if (typeof args.query === "string") params.set("q", args.query); if (typeof args.pageSize === "number") params.set("pageSize", String(args.pageSize)); return json(`/drive/v3/files?${params}`); }
    if (tool === "drive_get_file") return json(`/drive/v3/files/${encodePath(requiredString(args, "fileId"))}?fields=id,name,mimeType,modifiedTime,size,webViewLink`);
    if (tool === "drive_download_file") return json(`/drive/v3/files/${encodePath(requiredString(args, "fileId"))}?alt=media`);
    if (tool === "drive_create_folder") return json("/drive/v3/files", "POST", { name: requiredString(args, "name"), mimeType: "application/vnd.google-apps.folder", ...(typeof args.parentId === "string" ? { parents: [args.parentId] } : {}) }, false);
    if (tool === "drive_upload_file") { const data = encodeBase64Url(requiredString(args, "contentBase64")); if (data.byteLength > MAX_GMAIL_ATTACHMENT_BYTES) throw new GoogleWorkspaceError("INVALID_ARGUMENT", "Drive upload exceeds 10 MiB limit"); return this.request(`/upload/drive/v3/files?uploadType=media&name=${encodeURIComponent(requiredString(args, "name"))}`, token, { method: "POST", headers: { "Content-Type": typeof args.mimeType === "string" ? args.mimeType : "application/octet-stream" }, body: data }, false); }
    if (tool === "drive_update_file") return json(`/drive/v3/files/${encodePath(requiredString(args, "fileId"))}`, "PATCH", args.patch, false);
    if (tool === "drive_delete_file") return json(`/drive/v3/files/${encodePath(requiredString(args, "fileId"))}`, "DELETE", undefined, false);
    if (tool === "drive_share_file") return json(`/drive/v3/files/${encodePath(requiredString(args, "fileId"))}/permissions?sendNotificationEmail=true`, "POST", { type: requiredString(args, "type"), role: requiredString(args, "role"), ...(typeof args.emailAddress === "string" ? { emailAddress: args.emailAddress } : {}) }, false);
    if (tool === "docs_get_document") return json(`https://docs.googleapis.com/v1/documents/${encodePath(requiredString(args, "documentId"))}`);
    if (tool === "docs_create_document") return json("https://docs.googleapis.com/v1/documents", "POST", { title: requiredString(args, "title") }, false);
    if (tool === "docs_update_document") return json(`https://docs.googleapis.com/v1/documents/${encodePath(requiredString(args, "documentId"))}:batchUpdate`, "POST", { requests: args.requests }, false);
    if (tool === "sheets_get_spreadsheet") return json(`https://sheets.googleapis.com/v4/spreadsheets/${encodePath(requiredString(args, "spreadsheetId"))}?includeGridData=${args.includeGridData === true}`);
    if (tool === "sheets_get_values") return json(`https://sheets.googleapis.com/v4/spreadsheets/${encodePath(requiredString(args, "spreadsheetId"))}/values/${encodePath(requiredString(args, "range"))}`);
    if (tool === "sheets_create_spreadsheet") return json("https://sheets.googleapis.com/v4/spreadsheets", "POST", { properties: { title: requiredString(args, "title") } }, false);
    if (tool === "sheets_update_values") return json(`https://sheets.googleapis.com/v4/spreadsheets/${encodePath(requiredString(args, "spreadsheetId"))}/values/${encodePath(requiredString(args, "range"))}?valueInputOption=${args.valueInputOption === "RAW" ? "RAW" : "USER_ENTERED"}`, "PUT", { values: args.values }, false);
    if (tool === "sheets_append_values") return json(`https://sheets.googleapis.com/v4/spreadsheets/${encodePath(requiredString(args, "spreadsheetId"))}/values/${encodePath(requiredString(args, "range"))}:append?valueInputOption=${args.valueInputOption === "RAW" ? "RAW" : "USER_ENTERED"}`, "POST", { values: args.values }, false);
    throw new GoogleWorkspaceError("INVALID_ARGUMENT", "Unknown Google Workspace tool");
  }
}
