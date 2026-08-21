import { and, eq, gt, lt } from "drizzle-orm";

import { db } from "../index";
import { googleOAuthStateTable } from "../schema";

export interface GoogleOAuthStateCreateInput {
  state: string;
  user_id: string;
  code_verifier: string;
  redirect_uri: string;
  expires_at: Date;
}

export class GoogleOAuthStateRepository {
  async createState(data: GoogleOAuthStateCreateInput): Promise<void> {
    await db.insert(googleOAuthStateTable).values({
      state: data.state,
      user_id: data.user_id,
      code_verifier: data.code_verifier,
      redirect_uri: data.redirect_uri,
      expires_at: data.expires_at,
    });
  }

  async consumeState(
    state: string,
  ): Promise<typeof googleOAuthStateTable.$inferSelect | null> {
    const [record] = await db
      .delete(googleOAuthStateTable)
      .where(
        and(
          eq(googleOAuthStateTable.state, state),
          gt(googleOAuthStateTable.expires_at, new Date()),
        ),
      )
      .returning();

    return record ?? null;
  }

  async cleanupExpired(): Promise<void> {
    const now = new Date();
    await db
      .delete(googleOAuthStateTable)
      .where(lt(googleOAuthStateTable.expires_at, now));
  }
}

export const googleOAuthStateRepository = new GoogleOAuthStateRepository();
