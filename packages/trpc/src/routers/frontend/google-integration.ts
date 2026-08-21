import {
  GoogleConnectionStatusResponse,
  GoogleConnectionStatusResponseSchema,
  GoogleConnectRequest,
  GoogleConnectRequestSchema,
  GoogleConnectUrlResponse,
  GoogleConnectUrlResponseSchema,
  GoogleDisconnectRequest,
  GoogleDisconnectRequestSchema,
  GoogleDisconnectResponse,
  GoogleDisconnectResponseSchema,
  GoogleReconnectRequest,
  GoogleReconnectRequestSchema,
  GoogleSetDefaultRequest,
  GoogleSetDefaultRequestSchema,
} from "@repo/zod-types";

import { protectedProcedure, router } from "../../trpc";

export const createGoogleIntegrationRouter = (implementations: {
  getStatus: (userId: string) => Promise<GoogleConnectionStatusResponse>;
  getConnectUrl: (
    userId: string,
    input?: GoogleConnectRequest,
  ) => Promise<GoogleConnectUrlResponse>;
  reconnect: (
    input: GoogleReconnectRequest,
    userId: string,
  ) => Promise<GoogleConnectUrlResponse>;
  setDefault: (
    input: GoogleSetDefaultRequest,
    userId: string,
  ) => Promise<{ success: boolean }>;
  disconnect: (
    userId: string,
    input?: GoogleDisconnectRequest,
  ) => Promise<GoogleDisconnectResponse>;
}) => {
  return router({
    getStatus: protectedProcedure
      .output(GoogleConnectionStatusResponseSchema)
      .query(async ({ ctx }) => {
        return await implementations.getStatus(ctx.user.id);
      }),

    getConnectUrl: protectedProcedure
      .input(GoogleConnectRequestSchema.optional())
      .output(GoogleConnectUrlResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.getConnectUrl(ctx.user.id, input);
      }),

    reconnect: protectedProcedure
      .input(GoogleReconnectRequestSchema)
      .output(GoogleConnectUrlResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.reconnect(input, ctx.user.id);
      }),

    setDefault: protectedProcedure
      .input(GoogleSetDefaultRequestSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.setDefault(input, ctx.user.id);
      }),

    disconnect: protectedProcedure
      .input(GoogleDisconnectRequestSchema.optional())
      .output(GoogleDisconnectResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.disconnect(ctx.user.id, input);
      }),
  });
};
