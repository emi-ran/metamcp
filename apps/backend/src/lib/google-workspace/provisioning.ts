import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  mcpServersTable,
  namespacesTable,
  namespaceServerMappingsTable,
  namespaceToolMappingsTable,
  toolsTable,
} from "@/db/schema";

import {
  GOOGLE_WORKSPACE_SERVER_NAME,
  GOOGLE_WORKSPACE_SERVER_UUID,
  GOOGLE_WORKSPACE_TOOLS,
} from "./google-workspace";

/** Creates one global first-party adapter and maps its opt-in catalog to a namespace. */
export async function provisionGoogleWorkspace(namespaceUuid?: string): Promise<void> {
  await db
    .insert(mcpServersTable)
    .values({
      uuid: GOOGLE_WORKSPACE_SERVER_UUID,
      name: GOOGLE_WORKSPACE_SERVER_NAME,
      description: "First-party Google Workspace adapter",
      type: "VIRTUAL",
      args: [],
      env: {},
      headers: {},
      forward_headers: {},
      user_id: null,
    })
    .onConflictDoNothing({ target: mcpServersTable.uuid });

  await db
    .insert(toolsTable)
    .values(
      GOOGLE_WORKSPACE_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        toolSchema: tool.inputSchema,
        mcp_server_uuid: GOOGLE_WORKSPACE_SERVER_UUID,
      })),
    )
    .onConflictDoNothing();

  const namespaceUuids = namespaceUuid
    ? [namespaceUuid]
    : (await db.select({ uuid: namespacesTable.uuid }).from(namespacesTable)).map(
        (namespace) => namespace.uuid,
      );

  for (const targetNamespaceUuid of namespaceUuids) await provisionNamespace(targetNamespaceUuid);
}

async function provisionNamespace(namespaceUuid: string): Promise<void> {
  await db
    .insert(namespaceServerMappingsTable)
    .values({
      namespace_uuid: namespaceUuid,
      mcp_server_uuid: GOOGLE_WORKSPACE_SERVER_UUID,
      status: "ACTIVE",
    })
    .onConflictDoNothing();

  const catalog = await db
    .select({ uuid: toolsTable.uuid })
    .from(toolsTable)
    .where(eq(toolsTable.mcp_server_uuid, GOOGLE_WORKSPACE_SERVER_UUID));

  for (const tool of catalog) {
    const existing = await db
      .select({ uuid: namespaceToolMappingsTable.uuid })
      .from(namespaceToolMappingsTable)
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid),
          eq(namespaceToolMappingsTable.tool_uuid, tool.uuid),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      await db.insert(namespaceToolMappingsTable).values({
        namespace_uuid: namespaceUuid,
        tool_uuid: tool.uuid,
        mcp_server_uuid: GOOGLE_WORKSPACE_SERVER_UUID,
        status: "INACTIVE",
      });
    }
  }
}
