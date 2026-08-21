import {
  GoogleConnectUrlResponse,
  GoogleConnectUrlResponseSchema,
  GoogleConnectionStatusResponse,
  GoogleConnectionStatusResponseSchema,
  GoogleDisconnectResponse,
  GoogleDisconnectResponseSchema,
  GoogleReconnectRequest,
  GoogleReconnectRequestSchema,
} from "@repo/zod-types";

import { protectedProcedure, router } from "../../trpc";

export const createGoogleIntegrationRouter = (implementations: {
  getStatus: (userId: string) => Promise<GoogleConnectionStatusResponse>;
  getConnectUrl: (userId: string) => Promise<GoogleConnectUrlResponse>;
  reconnect: (
    input: GoogleReconnectRequest,
    userId: string,
  ) => Promise<GoogleConnectUrlResponse>;
  disconnect: (userId: string) => Promise<GoogleDisconnectResponse>;
}) => {
  return router({
    getStatus: protectedProcedure
      .output(GoogleConnectionStatusResponseSchema)
      .query(async ({ ctx }) => {
        return await implementations.getStatus(ctx.user.id);
      }),

    getConnectUrl: protectedProcedure
      .output(GoogleConnectUrlResponseSchema)
      .mutation(async ({ ctx }) => {
        return await implementations.getConnectUrl(ctx.user.id);
      }),

    reconnect: protectedProcedure
      .input(GoogleReconnectRequestSchema)
      .output(GoogleConnectUrlResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.reconnect(input, ctx.user.id);
      }),

    disconnect: protectedProcedure
      .output(GoogleDisconnectResponseSchema)
      .mutation(async ({ ctx }) => {
        return await implementations.disconnect(ctx.user.id);
      }),
  });
};
