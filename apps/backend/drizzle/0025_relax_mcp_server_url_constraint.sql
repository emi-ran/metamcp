-- Keep type/field consistency in PostgreSQL. HTTP(S) URL syntax is validated
-- at the API boundary, where the URL parser handles valid RFC URL forms.
ALTER TABLE "mcp_servers" DROP CONSTRAINT IF EXISTS "mcp_servers_url_check";
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_url_check" CHECK (
  (type = 'SSE' AND url IS NOT NULL AND command IS NULL) OR
  (type = 'STDIO' AND url IS NULL AND command IS NOT NULL) OR
  (type = 'STREAMABLE_HTTP' AND url IS NOT NULL AND command IS NULL) OR
  (type = 'VIRTUAL' AND url IS NULL AND command IS NULL)
);
