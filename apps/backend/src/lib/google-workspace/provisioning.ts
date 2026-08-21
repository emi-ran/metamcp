import { and, eq, notInArray } from "drizzle-orm";

import { db } from "@/db";
import {
  mcpServersTable,
  namespaceServerMappingsTable,
  namespacesTable,
  namespaceToolMappingsTable,
  toolsTable,
} from "@/db/schema";

import {
  GOOGLE_WORKSPACE_DEFAULT_TOOL_STATUS,
  GOOGLE_WORKSPACE_SERVER_NAME,
  GOOGLE_WORKSPACE_SERVER_UUID,
  GOOGLE_WORKSPACE_TOOLS,
} from "./google-workspace";

/** Creates one global first-party adapter and maps its opt-in catalog to a namespace. */
export async function provisionGoogleWorkspace(
  namespaceUuid?: string,
): Promise<void> {
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

  for (const tool of GOOGLE_WORKSPACE_TOOLS) {
    const values = {
      name: tool.name,
      description: tool.description ?? "",
      toolSchema: tool.inputSchema,
      mcp_server_uuid: GOOGLE_WORKSPACE_SERVER_UUID,
    };
    await db
      .insert(toolsTable)
      .values(values)
      .onConflictDoUpdate({
        target: [toolsTable.mcp_server_uuid, toolsTable.name],
        set: {
          description: values.description,
          toolSchema: values.toolSchema,
          updated_at: new Date(),
        },
      });
  }

  await db.delete(toolsTable).where(
    and(
      eq(toolsTable.mcp_server_uuid, GOOGLE_WORKSPACE_SERVER_UUID),
      notInArray(
        toolsTable.name,
        GOOGLE_WORKSPACE_TOOLS.map((tool) => tool.name),
      ),
    ),
  );

  const namespaceUuids = namespaceUuid
    ? [namespaceUuid]
    : (
        await db.select({ uuid: namespacesTable.uuid }).from(namespacesTable)
      ).map((namespace) => namespace.uuid);

  for (const targetNamespaceUuid of namespaceUuids)
    await provisionNamespace(targetNamespaceUuid);
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
        status: GOOGLE_WORKSPACE_DEFAULT_TOOL_STATUS,
      });
    }
  }
}
