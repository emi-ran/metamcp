import { eq } from "drizzle-orm";

import { db } from "@/db";
import { mcpServersTable, namespaceServerMappingsTable } from "@/db/schema";
import { parseToolName } from "../tool-name-parser";
import { sanitizeName } from "../utils";

/** Resolve only an unambiguous server belonging to this namespace. */
export async function resolveNamespaceServer(
  serverName: string,
  namespaceUuid: string,
) {
  const servers = await db
    .select({ uuid: mcpServersTable.uuid, name: mcpServersTable.name })
    .from(mcpServersTable)
    .innerJoin(
      namespaceServerMappingsTable,
      eq(namespaceServerMappingsTable.mcp_server_uuid, mcpServersTable.uuid),
    )
    .where(eq(namespaceServerMappingsTable.namespace_uuid, namespaceUuid));
  const matches = servers.filter(
    (server) => sanitizeName(server.name) === serverName,
  );
  return matches.length === 1 ? matches[0] : null;
}

export async function resolveToolIdentity(
  toolName: string,
  namespaceUuid: string,
): Promise<{
  mcpServerUuid?: string;
  mcpServerName?: string;
}> {
  const parsed = parseToolName(toolName);
  if (!parsed) return {};
  const server = await resolveNamespaceServer(parsed.serverName, namespaceUuid);
  return { mcpServerUuid: server?.uuid, mcpServerName: server?.name };
}
