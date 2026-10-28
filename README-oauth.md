## OAuth

SDK upgrade note: [MCP security and OAuth scope](docs/MCP_REQUEST_LIMITS.md#oauth-scope--unresolved-issuer-binding)
documents issuer preservation and connection-scoped legacy reauthorization.
Optional issuer fields survive persistence/output parsing; unbound or mismatched
credentials are not replayed. Pre-registered clients must explicitly supply their
original authorization-server issuer in Advanced OAuth; saving requires a fresh
interactive authorization, not an implicit legacy-token rebind. No migration,
bulk deletion or provider revocation is performed. Independent admin issuer
pinning is separate hardening, not a prerequisite for this SDK advisory fix.
Native serial validation passed on 2026-10-26: shared JS/declarations builds,
all four typechecks, 332 backend tests (including seven frontend-provider tests),
26 separate recovery tests, touched TypeScript strict lint and backend build.
Linux standalone build and read-only/network-isolated image smoke also passed
after the runtime follow-up: Node 22.23.4 / bundled Undici 6.29.1, Next 15.5.28
and sharp 0.35.5. Native Windows packaging was not retried. No live OAuth/database
validation was performed. See the security note for full commands, remaining
audit findings and refresh/pool concurrency limitations.

sequenceDiagram
    participant Client as MCP Client
    participant Auth as MetaMCP OAuth Server
    participant User as User/Browser
    participant API as MetaMCP API
    
    Note over Client,API: OAuth 2.1 Dynamic Registration & Authorization Flow
    
    Client->>Auth: POST /oauth/register<br/>{redirect_uris, client_name, ...}
    Auth-->>Client: {client_id, endpoints, security_note}
    
    Note over Client,Auth: PKCE Authorization Code Flow
    
    Client->>Client: Generate code_verifier & code_challenge
    Client->>User: Redirect to /oauth/authorize<br/>?client_id=...&code_challenge=...
    User->>Auth: GET /oauth/authorize (with PKCE)
    
    alt User Not Authenticated
        Auth-->>User: Redirect to /login
        User->>Auth: Login credentials
        Auth-->>User: Redirect back to authorize
    end
    
    Auth-->>User: Redirect to client<br/>?code=...&state=...
    User->>Client: Authorization code received
    
    Client->>Auth: POST /oauth/token<br/>{code, code_verifier, client_id}
    Auth->>Auth: Verify PKCE (S256)
    Auth-->>Client: {access_token, token_type, expires_in}
    
    Client->>API: API Request<br/>Authorization: Bearer {access_token}
    API-->>Client: Protected resource response
