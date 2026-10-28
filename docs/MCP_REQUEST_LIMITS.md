# MCP request limits and SDK security upgrade

## Runtime and Next.js follow-up (2026-10-26)

The original 47-path OAuth/request-limit change set is retained. This follow-up
changes seven existing paths (including this note and `README-oauth.md`), adding
only `Dockerfile` and `packages/eslint-config/package.json` to the uncommitted
path set: **49 paths, 40 modified and 9 untracked**. No Next 16 migration or
unrelated audit fix was performed.

The prior Docker validation identified Node **20.20.2**, bundled Undici
**6.24.1**, and frontend Next **15.5.12**. npm overrides cannot patch the Undici
embedded in Node's global fetch implementation. The base now pins the official
`node:22.23.4-trixie-slim` image, retaining Debian trixie and the existing slim
runtime layout. Node 22 is LTS; Node 20 is EOL. Official registry inspection with
`docker buildx imagetools inspect node:22.23.4-trixie-slim` resolved index digest
`sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf`.
The rebuilt runner reports **Node 22.23.4 / Undici 6.29.1**, not the vulnerable
old embedded fetch implementation.

Frontend Next and the existing `@next/eslint-plugin-next` are pinned to
**15.5.28**, the highest stable 15.x version returned by the official npm
registry during this check. There is no `eslint-config-next` dependency to
align. Next's accepted sharp range includes old 0.34.x releases; the narrowly
scoped root override `next>sharp: 0.35.5` prevents retained old lockfile entries.
Both the installed dependency chain and the Linux standalone runtime resolve
**sharp 0.35.5**. The runtime smoke actually loads its native binary and generates
a synthetic 1x1 PNG; it does not merely inspect a manifest.

Official references checked:

- `https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c`:
  content-encoding error DoS affects `>=6.23.0 <6.29.1`; fixed in 6.29.1.
- `https://nodejs.org/en/about/previous-releases` and
  `https://github.com/nodejs/node/releases/tag/v22.23.4`: supported release line
  and security release provenance.
- `https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r`:
  Server Action DoS fixed in 15.5.28. This source tree has no `use server`,
  `action=`, `formAction=` or `serverActions` matches; the generated server
  reference manifest also has **zero node and zero edge actions**. Consequently
  this specific action-dependent exploit was not demonstrated in this app;
  upgrading still removes the vulnerable framework version.
- `https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw`:
  glibc Linux image-processing RCE, patched Next 15.5.28 / sharp >=0.35.5.
- `https://registry.npmjs.org/next` and
  `https://registry.npmjs.org/@next%2feslint-plugin-next/15.5.28`: package metadata.

Native validation, all foreground and sequential:

1. `pnpm install --lockfile-only --ignore-scripts`, then
   `pnpm install --frozen-lockfile`: passed. The existing `next-runtime-env`
   next@14/react@18 peer mismatch remains; it was not introduced by Next 15.5.28.
2. `pnpm --filter @repo/zod-types build`, then
   `pnpm --filter @repo/trpc build`: JS + declarations passed.
3. `pnpm check-types --concurrency=1`: 4/4 passed, zero cached tasks.
4. `pnpm --filter backend test --maxWorkers=1`: 29 files / **332 passed**, no
   skips; all 12 transport-security cases included. Separate
   `pnpm --filter backend test --maxWorkers=1 src/trpc/oauth-provider.test.ts`:
   **7 passed**.
5. `node --test --test-concurrency=1 apps/backend/src/lib/metamcp/proxy-recovery.behavior.test.mjs`:
   **26 passed**, no skips.
6. Touched backend/frontend TypeScript ESLint with `--max-warnings=0`, and
   `pnpm --filter @repo/zod-types exec eslint src/index.ts src/oauth.zod.ts src/oauth-issuer.ts src/mcp-servers.zod.ts --max-warnings=0`:
   passed without fixes. `pnpm --filter backend build`: passed.

Linux full build: `docker build --progress=plain -t fix-validation-metamcp:local -f Dockerfile .`
passed. Dockerfile now uses `pnpm build --concurrency=1` (scheduling only; no
packaging/typecheck/security checks disabled). All four build tasks passed,
zero cached: Next 15.5.28 compiled, checked types, generated 5/5 static pages,
traced standalone dependencies and exported the runner image. The installed
Next standalone setting remains unchanged; native Windows EPERM was not retried.
BuildKit internal stages and compiler worker counts were not CPU-capped; only
one foreground job and one Turbo package task ran at a time.

Rebuilt image index: `sha256:3a498476a906442acce5a4785b5466a0d3eec530a457359cda082c3077506765`.
Smoke used `docker run --rm --network none --read-only --cpus 1 --memory 512m --entrypoint node`
with only a read-only synthetic validation script mount, no ports or app env.
Passed: UID 1001; exact Node/Undici/Next/sharp versions; backend SDK 1.32.2 ESM
imports; Express 5.2.1 -> body-parser 2.4.0; pg load; native sharp PNG; generated
standalone artifacts; frontend issuer guard in compiled chunks; generated Zod
issuer preservation through token/client/upsert/get outputs and fail-closed
legacy/mismatch checks. Backend `node --check` also passed. Frontend SDK is
browser-bundled, not an independently traced standalone module; absence of that
package in standalone is not claimed as a version check. Migration loader import
was tested only; no migration/config/DB execution or normal entrypoint start.

Evidence: approved temporary directory `opencode/metamcp-runtime-*` logs and
the reused `docker-validation-20261026/metamcp.smoke.cjs` harness. Runtime evidence
supersedes prior image version results; previous validation logs remain historical.
`pnpm audit --json` still exits 1: **166 findings (6 critical, 74 high, 75 moderate,
11 low)**. None of its advisories name next, sharp, undici, body-parser or the SDK;
this does not audit Node's embedded dependencies or OS packages. No clean whole
dependency/OS security claim. Existing tracer optional-adapter/native-binary
warnings and optional SWC metadata warning remain; no validation was weakened.
OAuth pooled-session, callback/config race, expected_state and live-E2E
limitations below remain unchanged.

## Dependency baseline (2026-10-25)

Both applications pin `@modelcontextprotocol/sdk` to **1.32.2**. The root pnpm
override prevents older transitive SDK versions; another override forces
`body-parser` 2.x below 2.4.0 to **2.4.0**. Install with the repository's
`pnpm@10.29.3` and commit `pnpm-lock.yaml` together with the manifests.

Upstream references:

- `https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828`
  (compressed request trailing bytes; fixed in 2.4.0 / 1.20.9).
- `https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-f897-62hf-6gxq`
  (raw HTTP body and batch bounds; fixed in SDK 1.30.1).
- `https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453`
  (`McpServer.maxToolInputElements`, introduced in 1.32.0, disabled unless set).
- `https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.32.2`

## Explicit application policy

The shared source configuration is
`apps/backend/src/lib/metamcp/request-limits.ts`. These are code constants, **not
environment variables or database settings**. No migration is required.

| Input | Ceiling | Enforcement and rejection |
| --- | --- | --- |
| Streamable HTTP POST body | 1 MiB (1,048,576 bytes) | SDK `maxRequestBodySize`; 413 for declared or streamed excess before JSON parsing |
| Streamable HTTP batch | 100 JSON-RPC messages | Patched SDK's fixed ceiling; 400 / -32600 before dispatch. SDK 1.32.2 exposes no configurable batch-size option. |
| Legacy SSE POST body | 1 MiB | Route-local `express.json({ limit })` followed by `handlePostMessage(req, res, req.body)`; 413 on excess |
| Legacy SSE batch | Not supported | SDK accepts a single JSON-RPC message; arrays rejected with 400 |
| OpenAPI tool POST body | 1 MiB | Explicit Express parser limit, including the parent tool-path parser; 413 on excess |
| Tool arguments | 10,000 object members + array entries across all nesting | Application guard before dispatch; JSON-RPC -32602 for MCP, HTTP 400 for OpenAPI |

1 MiB leaves room for ordinary structured tool calls and long strings while
reducing the SDK's 4 MiB raw-body allocation budget. The element budget follows
the upstream 10,000-element example and limits validation amplification even
when JSON fits within the byte budget. These are conservative gateway defaults,
not measurements of every upstream tool. Legitimate bulk tools exceeding them
need smaller calls or a reviewed source-policy adjustment. Exact ceilings are
accepted; one extra byte/element is rejected. String characters do not count as
elements (the byte ceiling still applies).

MetaMCP uses the SDK's **low-level `Server`** with custom request handlers, not
`McpServer`. Its inspector server proxy forwards raw transport messages without
any SDK server instance. `maxToolInputElements` is only supported on the
high-level `McpServer`; putting it on either existing path would not enforce
anything. A shared iterative, early-exit guard implements the same counting
semantics without changing server architecture. It runs before admin, virtual,
or upstream tools, also in the transport-only proxy and OpenAPI path. This is
not an SDK `isError` tool-result wrapper: the existing low-level error path
returns JSON-RPC InvalidParams instead.

### Path coverage

- `/metamcp/:endpoint_name/mcp`: raw stream remains unparsed; new transports get
  explicit SDK options, reused sessions retain those options.
- `/mcp-proxy/metamcp/:uuid/mcp` and `/mcp-proxy/server/mcp`: same SDK options;
  no `parsedBody` bypass of the raw-body bound.
- `/metamcp/:endpoint_name/message`, `/mcp-proxy/metamcp/:uuid/message`, and
  `/mcp-proxy/server/message`: bounded SSE parser. Both inspector SSE setup
  paths (including STDIO) feed the latter message route.
- `/metamcp/:endpoint_name/api/:tool_name`: bounded parser and element guard.

Existing endpoint lookup, API-key/OAuth, better-auth, and rate-limit middleware
ordering is retained. Unrelated global JSON and OAuth parsers are unchanged.
These per-request bounds are not a global connection, rate, or response-size
budget. Transport session lifecycle and resource/prompt contents are unchanged.

### Public-contract impact and middleware order

These limits are **new externally observable admission policy**, not existing
admin Settings values or configurable per-endpoint allowances. The existing
`config.service.ts` timeout/retry/session settings, endpoint authentication and
rate-limit fields, stored tool `inputSchema`, and header forwarding configuration
do not override them. No stored setting or schema was rewritten. A tool schema
may permit a larger array/string while the gateway now refuses its request.

| Route / operation | Previous checkout behavior | New observable outcome |
| --- | --- | --- |
| POST `/metamcp/:endpoint_name/mcp`, `/mcp-proxy/metamcp/:uuid/mcp`, `/mcp-proxy/server/mcp` | SDK 1.29.0 raw `req.json()` had no application byte/batch ceiling | Above 1 MiB: HTTP 413 / SDK JSON-RPC error; above 100 messages: HTTP 400 / -32600. Valid JSON at exactly 1 MiB and batch 100 remain admissible (subject to auth/session/protocol checks). Malformed JSON: HTTP 400. |
| POST `/metamcp/:endpoint_name/message`, `/mcp-proxy/metamcp/:uuid/message`, `/mcp-proxy/server/message` | Legacy SDK reader allowed 4 MiB, single JSON-RPC message | Above 1 MiB: HTTP 413, JSON `{ "error": "Request body too large" }`. Malformed JSON: HTTP 400, JSON `{ "error": "Invalid request body" }`. Valid single message remains HTTP 202; batch array remains unsupported / HTTP 400. |
| POST `/metamcp/:endpoint_name/api/:tool_name` | Route-local Express default was 100 KiB, not 50 MiB | Explicit 1 MiB: **raises** the normal route's byte allowance; above it returns HTTP 413. Parser errors use sanitized JSON, not Express development HTML/stacks. Above 10,000 tool elements returns HTTP 400 `{ "error": "Invalid tool arguments", "message": ... }` before server acquisition. GET on the same route continues passing empty arguments. |
| `tools/call` on any MCP transport, including admin/virtual/upstream tools and inspector-to-STDIO proxy | No element ceiling in low-level/custom dispatch | Above 10,000: -32602 with the original request ID, no upstream/admin/virtual dispatch. Streamable JSON response uses HTTP 200 containing the JSON-RPC error; SSE POST can return 202 and deliver the error on its SSE stream. Exactly 10,000 remains allowed. |

The old parent OpenAPI parser had a 50 MiB allowance only on paths containing
`/api/tools/`, not the ordinary `/:endpoint_name/api/:tool_name` shape. That
conditional parser now has the same bounded/sanitized behavior; it does not
provide a larger pre-parsed-body escape hatch. Unmatched paths do not execute
tools. The normal OpenAPI route always has its own bounded parser. This patch
does **not** imply every request formerly accepted at 4 MiB/50 MiB remains
compatible. Users of bulk tools must reduce payloads or request a reviewed
source-policy change, not a database/environment workaround.

Self-review of the actual mount/route chains found:

- `src/index.ts` skips global parsing for MCP mounts intentionally, using
  `isMcpTransportPath` with the same case-insensitive matching as Express mounts.
  Self-review caught the previous case-sensitive skip: `/MetaMcp/...` could hit
  the unrelated 50 MiB global parser before reaching the MCP router. The skip
  now matches mixed-case/base mount paths as well, without matching prefix
  lookalikes such as `/metamcp-other`.
  All three Streamable transport constructors receive the explicit bound;
  their new/existing-session POST branches delegate raw requests without a
  supplied `parsedBody`. This is not an unbounded global-parser bypass.
- Public SSE ordering remains endpoint lookup → API-key/OAuth → rate limiter →
  bounded parser → session lookup/SDK. Inspector routers retain their existing
  router-wide better-auth before parser/transport. Public Streamable auth/rate
  ordering is unchanged.
- OpenAPI's existing parser-before-auth ordering is retained, including the
  parent conditional parser. Unauthenticated malformed/oversized OpenAPI input
  can therefore receive 400/413 before an auth response, but cannot reach tool
  execution. Moving its auth boundary is outside this fix.
- Shared parser catches only parser 4xx errors, preserves 400/413/415 status,
  returns a generic JSON body without input/stack details, and never calls the
  handler afterward. Unexpected/non-4xx errors still propagate to Express.
  Parser failures sit outside async route `try/catch`, so they are not converted
  to a route's generic 500 or double-written after SDK completion.
- Resources/prompts are byte/batch-bounded but not tool-element-counted;
  GET/DELETE do not add a tool-body reader. Unrelated OAuth/global JSON parsers
  and session/auth behavior were not modified.

Evidence scope: existing auth tests verify OAuth-only + X-API-Key → 401 with
challenge, owner API-key access allowed, non-owner private access → 403. Existing
header-forwarding tests verify allowed-header filtering, case handling and
merge behavior. Transport tests verify actual backend client Authorization,
X-Api-Key, MCP protocol version, SSE Accept after same-origin redirect, and zero
requests to a cross-origin redirect target. Those are **not** browser login or
live end-to-end OAuth tests; frontend `credentials: "include"` preservation was
checked in source/typecheck, not claimed as browser runtime verification.

## Headers and redirects

SDK 1.32.x forwards request-init headers on the SSE GET itself, including Accept
and negotiated MCP protocol headers. Backend overrides that rebuilt a second
header bag were removed; browser overrides retain `credentials: "include"` but
preserve the SDK's header bag. Bearer/custom header injection remains in
`requestInit.headers`. No authentication source, preference order, or stored
record was changed.

The patched SDK refuses cross-origin redirects by default. Keep that policy:
configure an upstream's final URL instead of opting into `redirectPolicy:
"follow"`. Node same-origin redirects work; the SDK rejects all browser
redirects by default. Custom headers and request
bodies must not be sent to an untrusted redirect destination. Reference:
`https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw`.

## OAuth scope / unresolved issuer binding

Historical investigation below is superseded by the 2026-10-26 correction and
implementation section immediately below. It records the original loss/blocker,
not current source behavior. This upgrade alone did **not** claim remediation of
`https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h`.
Inspection found real SDK OAuth usage: `apps/frontend/hooks/useConnection.ts`
passes `authProvider` on STDIO/Streamable HTTP inspector paths and calls SDK
`auth()` directly; `apps/frontend/lib/oauth-provider.ts` reads saved credentials
through `OAuthTokensSchema` / `OAuthClientInformationSchema`. The advisory says
an upgrade alone does not secure pre-upgrade credentials without issuer binding.
The project's own `packages/zod-types/src/oauth.zod.ts` token schema omits
`issuer`; token payloads parsed through that schema can discard the SDK's new
binding field, including on later reads. Client information is passthrough, but
that alone does not establish trusted provenance for tokens.
Backend upstream connections otherwise inject saved bearer headers and use the
project's separate token-exchange/refresh code, not an SDK auth provider.

**Superseded investigation result (incorrect blocker, corrected below):**
The user approved issuer preservation plus connection-scoped legacy
reauthentication, not authenticated legacy rebind, live-record mutation, or
provider revocation. Approval is no longer the blocker. Inspection did not find
an independent, connection-scoped trusted authorization-server issuer source.
No issuer was inferred from resource metadata or an incoming credential field;
no OAuth schema/provider/exchange/refresh code or saved credential was changed.
The existing OAuth exposure remains unresolved; this is not a completed fix.

#### Superseded trust-source argument (not a GHSA prerequisite)

- Installed SDK `dist/esm/client/auth.js:751-768` selects the first
  `resourceMetadata.authorization_servers` entry or the MCP resource origin.
  Its metadata reader at `696-729` parses the response schema but does not
  establish an independent issuer pin. The binding at `258-262` explicitly
  avoids `metadata.issuer` because it does not verify that echo against the
  discovery URL. Implementing `saveDiscoveryState` to accept this value blindly
  would persist the resource server's claim, not establish trust.
- Backend `src/lib/oauth-upstream/token-exchange.ts:237-285` fetches the MCP
  resource origin's well-known URL with default redirect handling and returns
  the JSON object without issuer/source validation. `resolveTokenEndpoint`
  at `293-311` prioritizes saved client metadata, then discovered metadata,
  then `/token`. It is not an independent issuer authority for either the
  callback exchange or `refresh-on-401.ts`.
- Pre-registration accepts client ID/secret, authorization/token endpoints,
  scope and auth method (`packages/zod-types/src/mcp-servers.zod.ts:132-139`;
  `apps/backend/src/trpc/pre-registered-oauth.ts`). It supplies no independently
  verified expected issuer. Endpoint URLs alone do not establish the missing
  binding. The optional login OIDC configuration in `example.env` concerns
  application login, not each upstream MCP connection; local OAuth-server
  `routers/oauth/metadata.ts` describes MetaMCP, not an upstream issuer pin.

**External requirement:** an explicitly chosen, independently trusted expected
issuer source keyed to the upstream connection, including who is authorized to
set it and how authorization/token/registration metadata is verified against
it. Existing discovered metadata, client/token `issuer`, or a successful
refresh cannot substitute for that decision. No new trust/config contract was
invented. Once that requirement is supplied, preservation and fail-closed
checks must cover frontend provider getters/invalidation, inspector bearer
injection, backend access-token injection, callback exchange and refresh before
any old refresh token or client secret is sent. Reauthorization alone cannot
make an untrusted credential destination safe.

This investigation executed no install, build, tests, OAuth request, database
operation or sessionStorage operation. Only documentation was edited in this
turn; the prior 26-path uncommitted change set, including the 1 MiB/10,000
request policy, was retained. No new fixture was presented as an implemented
security boundary. Source implementation and regression fixtures remain
blocked; serial-queue validation is also pending, not passed.

### Exact issuer-loss path (read-only evidence)

Line references are for this checkout and installed SDK **1.32.2**:

1. SDK `dist/esm/client/auth.js:258-262` binds to
   `String(authorizationServerUrl)` used by discovery, **not** blindly to
   `metadata.issuer`. Lines 323-324 stamp client registration; lines 338 and 363
   call `provider.saveTokens({ ...tokens, issuer })` after exchange/refresh.
   Lines 164-171 reject a different stored issuer but accept a missing stamp;
   lines 343-348 explicitly warn that unstamped refresh tokens remain usable.
2. `apps/frontend/lib/oauth-provider.ts:170-181` stores the entire token object
   into sessionStorage, then submits it to protected `frontend.oauth.upsert`
   for an existing server. Browser sessionStorage itself does **not** strip it.
3. `packages/trpc/src/routers/frontend/oauth.ts:46-50` parses mutation input
   through `UpsertOAuthSessionRequestSchema` before `implementations.upsert`.
   `packages/zod-types/src/oauth.zod.ts:170-175` uses the project's narrow
   `OAuthTokensSchema`, defined at **20-26**, with no issuer or passthrough:

   ```ts
   // Existing project contract, shown for evidence only; not changed.
   const OAuthTokensSchema = z.object({
     access_token: z.string(), token_type: z.string(),
     expires_in: z.number().optional(), scope: z.string().optional(),
     refresh_token: z.string().optional(),
   });
   // UpsertOAuthSessionRequestSchema: tokens: OAuthTokensSchema.optional()
   ```

   Unknown fields are stripped at this input parse. `apps/backend/src/trpc/
   oauth.impl.ts:156-161` forwards the already-parsed tokens to repository upsert.
4. Independently, GET uses `.output(GetOAuthSessionResponseSchema)` at
   `packages/trpc/src/routers/frontend/oauth.ts:38-42`. That response uses
   `OAuthSessionSchema.tokens` (`oauth.zod.ts:133-152`), again the narrow token
   schema. Thus even a token with issuer already in storage can lose it on the
   response path. `oauth-sessions.serializer.ts:28-35` merely copies tokens;
   it is **not** the stripping location.
5. `apps/frontend/lib/oauth-provider.ts:148-152` passes that response to the
   SDK's `OAuthTokensSchema.parseAsync`. SDK `dist/esm/shared/auth.js:120-133`
   accepts optional issuer, but cannot reconstruct the field lost before it.
   The project client-information schema is passthrough (`oauth.zod.ts:10-17`),
   so it does not have this exact stripping defect; that still does not prove
   historical credentials belong to a trusted issuer.

Flow: SDK stamped tokens → provider.saveTokens → tRPC input parse **drops issuer**
→ repo; separately repo → serializer → tRPC output parse **drops issuer** →
provider.tokens → SDK sees unstamped legacy-compatible tokens. No real record
was read or mutated to establish this code-level finding.

Historical options from the prior review, before the source fix below. The user
selected legacy reauthentication. The earlier independent-pin requirement below
was too strong for SDK-model replay prevention and is superseded:

- **Legacy reauthentication:** first preserve/enforce issuer binding end-to-end
  and pin a trusted issuer; prevent reuse of unbound credentials and ask the
  user to sign in again. Affected upstream sessions/automated calls stop until
  consent/sign-in succeeds; DCR may need replacement registration, while
  pre-registered clients require operator-provided trusted configuration.
  Removing local tokens loses the local credential copy (not application/user
  business data) and does not revoke provider-side tokens; revocation and client
  retirement are separate explicit actions. Do not indiscriminately delete
  clients, accounts or unrelated sessions.
- **Authenticated trusted rebind:** after the same contract fix, an authorized
  administrator/user verifies original issuer/client provenance through an
  independent trusted configuration or authenticated provider record, then
  binds only matching legacy credentials with an audit record. Do not trust the
  resource server's newly advertised metadata, token contents, or a successful
  refresh alone as historical provenance. No credential deletion intended;
  sessions can continue when evidence matches, but mismatches/unknown history
  must fail closed and require sign-in. Verification that refreshes tokens can
  rotate/consume refresh tokens and invalidate parallel sessions, so it needs a
  separate serialized, explicitly approved operation rather than a read-only
  “check.” If reliable provenance is absent, use reauthentication.

### 2026-10-26 correction: SDK-model issuer preservation and legacy reauth

The earlier independent-admin-pin blocker was **incorrect for this advisory's
scope**. The official GHSA's Fix section requires providers to preserve the
issuer passed by `saveTokens`/`saveClientInformation`, and to supply issuer for
pre-registered credentials. Its legacy-credential paragraph allows binding with
known provenance or clearing for sign-in. Its Not covered section explicitly
excludes a **new interactive sign-in** to the server named by the resource and
direct `refreshAuthorization`/`exchangeAuthorization` calls. This implementation
uses fail-closed reads rather than deleting legacy rows. It does not silently
stamp old tokens from today's discovery. Independent admin pinning and metadata
issuer-echo enforcement remain separate hardening, not a prerequisite here.

Source reference: the official advisory linked above, read in full on
2026-10-26. Installed SDK 1.32.2 `client/auth.js:146-175` compares stored stamps
and omits response-supplied issuer; `258-262` chooses discovery's AS URL;
`278-324` rejects/replaces a mismatched registration and saves its stamp;
`343-363` gates refresh and stamps output. SDK `auth.d.ts:39-69` requires exact
issuer preservation; `112-116` exposes credential invalidation. No SDK
`expectedIssuer` option was invented for this interactive provider.

Implemented source paths (native validation completed below on 2026-10-26):

- `oauth.zod.ts` adds optional validated issuer to client, narrow token and
  upstream persisted-token shapes. Existing upsert/get/output/session and
  ServerParameters contracts reuse these shapes; serializer already copies
  credentials unchanged. Both `utils.ts` and `fetch-metamcp.ts` explicitly copy
  issuer when constructing backend parameters; refreshed parameter copies do too.
- Shared issuer comparison matches SDK URL normalization/single-slash tolerance,
  but absent/invalid stamps fail closed. Optional fields preserve old wire/DB
  compatibility without giving old credentials permission to be reused.
- Frontend provider keeps SDK discovery's selected URL in memory (no persistent
  discovery cache); getters reject legacy/mismatch tokens before manual header
  injection. DCR clients register afresh; pre-registered/unknown confidential
  clients receive an actionable connection-only reauthorization error. SDK
  invalidation suppresses credential reads for that provider instance and never
  deletes a row. Persistence failures are not silently accepted as success.
- SDK-saved client information retains its provenance and selected token
  endpoint. A fresh registration marks that connection authorization-pending so
  stale tokens cannot revive after reload even if the issuer/client ID matches.
- Advanced OAuth accepts an optional original registration issuer, as required
  for pre-registered credentials by the advisory. No automatic issuer inference
  or legacy-token rebind occurs. Explicitly saving client configuration marks
  fresh authorization required until the callback succeeds. This field is not a
  new global admin trust architecture. Only configure issuers/endpoints whose
  provenance you know; do not copy them blindly from a newly advertised server.
- Custom backend callback/refresh now use SDK `discoverOAuthServerInfo` and
  compare saved client/token stamps with its selected AS URL **before the grant
  POST**. Unbound client credentials fail even before discovery. Token output
  issuer is stamped locally from this checked context, overriding any response
  claim. Fresh callback success clears only the connection's authorization-pending
  marker, in the same credential upsert. No destructive migration is required.
- Dynamic registration token endpoints are pinned alongside the registration;
  a changed endpoint under the same issuer requires reauthorization instead of
  sending secrets there. Explicit pre-registered endpoints are retained as user
  configuration after checking the configured registration issuer against current
  SDK discovery. Credential-bearing token POSTs reject redirects. No old
  `/token` fallback is selected from the MCP resource when a distinct AS exists.
- Backend pooled access-token injection validates the OAuth context before the
  first handshake. Manual Bearer-only, API-key-only and STDIO connections do not
  trigger this check. Frontend inspector uses guarded manual access-token
  injection and explicit upstream `auth()`; its transports no longer receive an
  upstream provider that could discover against the local inspector proxy URL.

Added fixtures cover input/repository/serializer/output preservation; missing
and mismatched token/client stamps with zero credential POST/mutation; changed
AS and endpoint; response issuer not trusted as the binding key; SDK provider
invalidation; real SDK `auth()` with mocked discovery/DCR/redirect; redirect
policy; and lookup failure without browser-credential fallback. Existing grant
fixtures now declare issuer provenance rather than depending on legacy reuse.

**Native serial validation completed on 2026-10-26.** This supersedes the
source-only turn's "TESTS PENDING serial queue" status. No new install was
necessary; existing dependencies built and validated successfully. The
2026-10-25 results below remain historical, not evidence for the OAuth patch.

Validation fixes were limited to a typed `globalThis.window` assertion in the
backend-hosted provider tests, Windows-safe dynamic import paths via
`fileURLToPath`, and a complete DCR response fixture (`redirect_uris`). No tests
were deleted, skipped or weakened. Self-review also fixed two source gaps:
SDK invalid-client re-registration now persists the pending marker even if the
client ID and issuer are unchanged; manual `tokens()` reads apply the client's
endpoint/provenance guard before returning an access token. Added regressions
exercise pending state after reload, same-issuer SDK refresh with an untrusted
response issuer, endpoint changes, pending zero-fetch, and a real loopback 307
redirect with zero requests to the redirect target.

Commands executed sequentially (no concurrent build/test jobs):

- `pnpm --filter @repo/zod-types build`: JS and declarations passed.
- `pnpm --filter @repo/trpc build`: JS and declarations passed.
- `pnpm check-types --concurrency=1`: all four tasks passed; final run had no
  cached tasks.
- `pnpm --filter backend test --maxWorkers=1`: **29 files / 332 tests passed**,
  including all 12 transport-security cases; no skipped tests.
- `pnpm --filter backend test --maxWorkers=1 src/trpc/oauth-provider.test.ts`:
  **7 tests passed**, importing the actual frontend provider and SDK auth flow
  against mocked storage/network. No browser E2E claim.
- `node --test --test-concurrency=1 apps/backend/src/lib/metamcp/proxy-recovery.behavior.test.mjs`:
  **26 passed**, no skips. This remains separate from Vitest.
- Touched backend/frontend TypeScript paths from `git diff --name-only` plus
  `git ls-files --others --exclude-standard` were checked with package-local
  `pnpm --filter backend exec eslint <paths> --fix --max-warnings=0` and
  `pnpm --filter frontend exec eslint <paths> --fix --max-warnings=0`.
  Shared lint: `pnpm --filter @repo/zod-types exec eslint src/index.ts src/oauth.zod.ts src/oauth-issuer.ts src/mcp-servers.zod.ts --max-warnings=0`.
  All passed; formatter/import-order corrections were confined to touched files.
- `pnpm --filter backend build`: passed; tsup warned that optional `@swc/core`
  is absent for `emitDecoratorMetadata`. No dependency/config workaround applied.
- `git diff --check`: passed.

No Docker build was run; container validation belongs to the separate serial
worker. Frontend typecheck passed, but no new frontend webpack/package success
is claimed: installed Next's compile mode still reaches the unconditional
`output: standalone` packaging call (`build/index.js:2445-2446`). Repeating that
mode would encounter the known Windows symlink restriction. Standalone config,
tracing and production build semantics were not changed.

Residual risks: new interactive sign-in still trusts the selected upstream;
complete it only for trusted servers. Metadata echo/admin pinning, compromised
same-issuer endpoints, cross-process refresh races, existing ownership policies,
and already-open pooled sessions are not solved by this change. The initial
connection guard does not revalidate every request on a live pooled transport.
Refresh's process-local mutex coalesces concurrent refresh calls, not interactive
configuration/callback writes or separate instances. A refresh already in flight
can persist tokens after a new pending configuration, but its token-only upsert
does not clear that marker; subsequent guarded reads still reject pending state.
Callback/provider credential writes are not compare-and-swap operations: competing
interactive flows or configuration changes still require external serialization
to avoid a stale snapshot overwriting newer credentials/pending state. No claim
of atomic reauthorization, session revocation or cross-process race safety is made.
Existing
expected_state persistence/null behavior was not refactored. No real credentials,
DB records, sessionStorage state, accounts, business data or provider revocation
were accessed/mutated while implementing. Already exposed secrets require a
separately authorized rotation/revocation operation.

## Local verification

After `pnpm install --frozen-lockfile`, build workspace declarations before
running package typechecks/tests:

```sh
pnpm exec turbo run build --filter='./packages/*' --concurrency=1
pnpm --filter backend test --maxWorkers=1 src/lib/metamcp/request-limits.test.ts src/lib/metamcp/transport-security.test.ts
pnpm check-types --concurrency=1
pnpm --filter backend test --maxWorkers=1
node --test --test-concurrency=1 apps/backend/src/lib/metamcp/proxy-recovery.behavior.test.mjs
pnpm build --concurrency=1
pnpm -r why @modelcontextprotocol/sdk
pnpm -r why body-parser
pnpm audit --json
```

Security fixtures bind loopback port 0, own and close all servers/transports,
mock DB repositories, and contain only synthetic tokens. Tests cover malformed
JSON, exact/exceeded byte limits, chunked bodies, batch boundaries, nested tool
elements, low-level and raw-proxy dispatch, SSE parsing, auth/custom/protocol
headers, same-origin redirects, cross-origin rejection, and compressed-body
trailing garbage followed by a healthy request. Audit is a whole dependency
graph check: unrelated findings are not implicitly remediated by this patch.
The existing dependency-free recovery harness uses `node:test`, so Vitest excludes
that single file; run it separately with the command above. Its fixture now
injects the actual element guard imported by the proxy handler.

### Verification observed on Windows (2026-10-25)

- Frozen install and all four workspace typecheck tasks passed.
- Backend Vitest: 26 files / 308 tests; separate Node recovery harness: 26 tests.
- Backend/package builds passed. Full `pnpm build --concurrency=1` compiled the
  frontend, checked types and generated static pages, but standalone packaging
  failed with Windows `EPERM` while creating pnpm dependency symlinks. A complete
  release artifact was **not** verified; no build configuration was weakened.
- Strict ESLint passed for the three new TypeScript files. The broader touched
  backend slice returned no errors but existing formatting/import warnings
  (mostly CRLF/Prettier); no repository-wide formatting was applied.
- `pnpm -r why` resolved only SDK 1.32.2 and body-parser 2.4.0. The audit returned
  no advisory for those two package names, but still exited 1: metadata reported
  9 critical, 89 high, 88 moderate and 13 low findings elsewhere. This is **not**
  a clean whole-repository security audit.
- No live OAuth E2E, database, migration, container deployment or production
  verification was performed.

### Windows standalone packaging follow-up

No supported non-symlink substitute was found for this installed Next **15.5.12**
standalone build. `apps/frontend/next.config.js:3` selects standalone; installed
`next/dist/build/index.js:2445-2446` always calls `writeStandaloneDirectory` for
that output, and `next/dist/build/utils.js:1219-1229` recreates a traced symlink
with `fs.promises.symlink`, otherwise copies an ordinary file. It has no
permission-error junction/copy fallback. `next build --help` has no equivalent
“dereference standalone dependencies” flag; experimental compile/generate mode
is not a full packaging-equivalent success and was not used as a workaround.
Changing pnpm's layout, disabling standalone/tracing, patching node_modules, or
mocking filesystem calls would change the evaluated artifact and was not done.

Read-only host checks: `whoami /priv` lists no `SeCreateSymbolicLinkPrivilege`;
the Windows Developer Mode registry flag is absent. Docker CLI is installed but
the `dockerDesktopLinuxEngine` pipe is absent (daemon unavailable); WSL lists
only `docker-desktop`, no ready user build distro. Neither service was started,
no security policy was changed, and no elevation was attempted.

Exact external requirement for a native Windows rerun: a build process allowed
to create the directory symbolic links requested by Node/Next — typically an
elevated token holding `SeCreateSymbolicLinkPrivilege`, or explicit administrator
approval for Windows Developer Mode's supported unprivileged symlink path. Do
not enable global policy/Developer Mode automatically. An already authorized
Linux/WSL/container build environment with Node/pnpm dependencies installed
inside that environment is the alternative; the current host does not provide
one ready for use. References:
`https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createsymboliclinka`
and `https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-userrights#createsymboliclinks`.

Local compile + TypeScript + static generation remain useful partial evidence,
but **not** proof of a finished standalone release artifact. No `next.config`,
OS/global security setting or production build semantics changed in follow-up.

Follow-up validation deliberately did **not** execute compressed/oversized
advisory payloads again: 25 other Vitest files / 298 tests passed; filtered
transport header/redirect and sanitized-error checks passed 3 tests (9 skipped).
The separate Node harness passed 26 tests; all four typecheck tasks, backend
build, strict lint for the three new TS files and `git diff --check` passed.
The added unit check covers mixed-case/base mount paths versus lookalike prefixes;
the added benign malformed-JSON check verifies generic 400, no handler dispatch,
and a succeeding normal request. In-memory schema parsing of synthetic tokens
confirmed project token/upsert schemas drop issuer while SDK schema retains it;
no tRPC mutation or real OAuth/DB operation was called. Earlier full bounds-test
results remain historical evidence, not a claim that every abuse case was rerun
after the follow-up parser wrapper.
