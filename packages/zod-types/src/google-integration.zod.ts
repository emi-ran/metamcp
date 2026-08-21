import { z } from "zod";

export const GoogleWorkspaceScopeEnum = z.enum([
  "gmail.readonly",
  "calendar.readonly",
  "calendar.events",
  "drive.readonly",
  "drive.file",
  "documents.readonly",
  "documents",
  "spreadsheets.readonly",
  "spreadsheets",
]);

export type GoogleWorkspaceScopeType = z.infer<typeof GoogleWorkspaceScopeEnum>;

export const GoogleConnectionItemSchema = z.object({
  id: z.string().uuid(),
  maskedEmail: z.string().nullable().optional(),
  scopes: z.array(z.string()).default([]),
  isDefault: z.boolean().default(false),
  expiresAt: z.union([z.date(), z.string()]).nullable().optional(),
  updatedAt: z.union([z.date(), z.string()]).nullable().optional(),
  revokedAt: z.union([z.date(), z.string()]).nullable().optional(),
});

export type GoogleConnectionItem = z.infer<typeof GoogleConnectionItemSchema>;

export const GoogleConnectionStatusResponseSchema = z.object({
  connected: z.boolean(),
  defaultConnectionId: z.string().uuid().nullable().optional(),
  connections: z.array(GoogleConnectionItemSchema).default([]),
  // Backward-compatibility fields representing default connection:
  maskedEmail: z.string().nullable().optional(),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.union([z.date(), z.string()]).nullable().optional(),
  updatedAt: z.union([z.date(), z.string()]).nullable().optional(),
  revokedAt: z.union([z.date(), z.string()]).nullable().optional(),
});

export type GoogleConnectionStatusResponse = z.infer<
  typeof GoogleConnectionStatusResponseSchema
>;

export const GoogleConnectUrlResponseSchema = z.object({
  url: z.string().url(),
});

export type GoogleConnectUrlResponse = z.infer<
  typeof GoogleConnectUrlResponseSchema
>;

export const GoogleConnectRequestSchema = z.object({
  workspaceScopes: z.array(GoogleWorkspaceScopeEnum).default([]),
});

export type GoogleConnectRequest = z.infer<typeof GoogleConnectRequestSchema>;

export const GoogleReconnectRequestSchema = z.object({
  connectionId: z.string().uuid().optional(),
  workspaceScopes: z.array(GoogleWorkspaceScopeEnum).default([]),
});

export type GoogleReconnectRequest = z.infer<
  typeof GoogleReconnectRequestSchema
>;

export const GoogleSetDefaultRequestSchema = z.object({
  connectionId: z.string().uuid(),
});

export type GoogleSetDefaultRequest = z.infer<
  typeof GoogleSetDefaultRequestSchema
>;

export const GoogleDisconnectRequestSchema = z.object({
  connectionId: z.string().uuid().optional(),
});

export type GoogleDisconnectRequest = z.infer<
  typeof GoogleDisconnectRequestSchema
>;

export const GoogleDisconnectResponseSchema = z.object({
  success: z.boolean(),
});

export type GoogleDisconnectResponse = z.infer<
  typeof GoogleDisconnectResponseSchema
>;
