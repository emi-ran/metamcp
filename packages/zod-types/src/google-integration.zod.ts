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

export const GoogleConnectionStatusResponseSchema = z.object({
  connected: z.boolean(),
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

export const GoogleReconnectRequestSchema = z.object({
  workspaceScopes: z.array(GoogleWorkspaceScopeEnum).default([]),
});

export type GoogleReconnectRequest = z.infer<
  typeof GoogleReconnectRequestSchema
>;

export const GoogleDisconnectResponseSchema = z.object({
  success: z.boolean(),
});

export type GoogleDisconnectResponse = z.infer<
  typeof GoogleDisconnectResponseSchema
>;
