ALTER TYPE "mcp_server_type" ADD VALUE IF NOT EXISTS 'VIRTUAL';
--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP CONSTRAINT IF EXISTS "mcp_servers_url_check";
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_url_check" CHECK (
  (type = 'SSE' AND url IS NOT NULL AND command IS NULL AND url ~ '^https?://[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*(:[0-9]+)?(/[a-zA-Z0-9-._~:/?#\[\]@!$&''()*+,;=]*)?$') OR
  (type = 'STDIO' AND url IS NULL AND command IS NOT NULL) OR
  (type = 'STREAMABLE_HTTP' AND url IS NOT NULL AND command IS NULL AND url ~ '^https?://[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*(:[0-9]+)?(/[a-zA-Z0-9-._~:/?#\[\]@!$&''()*+,;=]*)?$') OR
  (type = 'VIRTUAL' AND url IS NULL AND command IS NULL)
);
