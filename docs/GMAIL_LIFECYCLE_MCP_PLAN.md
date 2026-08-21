# Gmail Lifecycle MCP Plan

## Goal

Expose full Gmail lifecycle operations through `GoogleWorkspace` MCP tools. Users may enable any operation in a namespace. Every new Gmail tool starts `INACTIVE`; no endpoint exposes it until an authorized user explicitly activates it.

Do not add generic `gmail_modify`. Each operation must have a narrow, visible, auditable tool name.

## Implementation Status

| Phase | Status | Notes |
| --- | --- | --- |
| OAuth: `gmail.modify` | Complete | Scope selection, forced re-consent, five locales, and tests added. |
| Phase 1: Message and thread organization | Complete | Tools require `gmail.modify`; namespace policy stays default-deny. |
| Phase 2: Labels and drafts | Complete | Label management uses `gmail.modify`; drafts use `gmail.compose`; structured MIME builder rejects header injection. |
| Phase 3: Outbound delivery | Pending | Send, reply, reply-all, forward, send-draft, and `gmail.send` consent. |
| Phase 4: Batch operations | Pending | Must remain phase-gated after normal write telemetry. |

## Current State

- Existing Gmail tools are read-only: search, message/thread retrieval, labels, attachment download.
- OAuth base connection requests `gmail.readonly`.
- `GoogleWorkspace` tools are provisioned to namespaces as `INACTIVE`.
- Runtime rejects Workspace tools without an explicit `ACTIVE` namespace mapping.
- Existing audit middleware records tool identity, caller identity, outcome, and sanitized Google errors. It does not record tool arguments or response bodies.

## Non-Goals

- No permanent message or thread deletion in initial release.
- No generic raw Gmail API request tool.
- No domain-wide delegation, service accounts, or cross-user mailbox access.
- No automatic policy activation when an OAuth scope is granted.

## Tool Contract

All tools accept optional `connectionId`. It selects one connected Google account owned by authenticated caller; otherwise caller's default connection is used.

### Phase 1: Message and Thread Organization

Require OAuth scope `https://www.googleapis.com/auth/gmail.modify`.

| Tool | Gmail endpoint | Action | Safety |
| --- | --- | --- | --- |
| `gmail_mark_read` | `POST /gmail/v1/users/me/messages/{messageId}/modify` | Remove `UNREAD` | Idempotent |
| `gmail_mark_unread` | same | Add `UNREAD` | Idempotent |
| `gmail_star` | same | Add `STARRED` | Idempotent |
| `gmail_unstar` | same | Remove `STARRED` | Idempotent |
| `gmail_archive` | same | Remove `INBOX` | Idempotent |
| `gmail_unarchive` | same | Add `INBOX` | Idempotent |
| `gmail_move_to_inbox` | same | Add `INBOX` | Idempotent |
| `gmail_trash` | `POST /gmail/v1/users/me/messages/{messageId}/trash` | Move message to Trash | Reversible, destructive hint |
| `gmail_untrash` | `POST /gmail/v1/users/me/messages/{messageId}/untrash` | Restore message | Idempotent |
| `gmail_report_spam` | `POST /gmail/v1/users/me/messages/{messageId}/modify` | Add `SPAM` | Idempotent |
| `gmail_remove_spam` | same | Remove `SPAM`, add `INBOX` | Idempotent |
| `gmail_add_labels` | same | Add caller-supplied label IDs | Idempotent |
| `gmail_remove_labels` | same | Remove caller-supplied label IDs | Idempotent |
| `gmail_trash_thread` | `POST /gmail/v1/users/me/threads/{threadId}/trash` | Move thread to Trash | Reversible, destructive hint |
| `gmail_untrash_thread` | `POST /gmail/v1/users/me/threads/{threadId}/untrash` | Restore thread | Idempotent |

Input rules:

- Single-message tools require `messageId`.
- Thread tools require `threadId`.
- Label tools require 1–100 `labelIds` and never allow Gmail system-label mutations outside explicit tools.
- Gmail's `modify` requests use only `addLabelIds` and `removeLabelIds`.

### Phase 2: Label Management and Draft Lifecycle

Require `gmail.modify` for labels. Require `https://www.googleapis.com/auth/gmail.compose` for drafts.

| Tool | Gmail endpoint | Action | Safety |
| --- | --- | --- | --- |
| `gmail_create_label` | `POST /gmail/v1/users/me/labels` | Create user label | Non-idempotent |
| `gmail_update_label` | `PATCH /gmail/v1/users/me/labels/{labelId}` | Rename/change display settings | Idempotent patch |
| `gmail_delete_label` | `DELETE /gmail/v1/users/me/labels/{labelId}` | Delete user label | Destructive hint |
| `gmail_list_drafts` | `GET /gmail/v1/users/me/drafts` | List draft IDs/metadata | Read-only |
| `gmail_get_draft` | `GET /gmail/v1/users/me/drafts/{draftId}` | Retrieve draft | Read-only |
| `gmail_create_draft` | `POST /gmail/v1/users/me/drafts` | Create RFC 2822 draft | Non-idempotent |
| `gmail_update_draft` | `PUT /gmail/v1/users/me/drafts/{draftId}` | Replace draft body | Idempotent |
| `gmail_delete_draft` | `DELETE /gmail/v1/users/me/drafts/{draftId}` | Delete draft | Destructive hint |

### Phase 3: Outbound Delivery

Require `https://www.googleapis.com/auth/gmail.send`.

| Tool | Gmail endpoint | Action |
| --- | --- | --- |
| `gmail_send` | `POST /gmail/v1/users/me/messages/send` | Send new message |
| `gmail_reply` | same | Reply to one message |
| `gmail_reply_all` | same | Reply to original recipients and CC recipients |
| `gmail_forward` | same | Forward one message to supplied recipients |
| `gmail_send_draft` | `POST /gmail/v1/users/me/drafts/send` | Send existing draft |

Message-building rules:

- Accept structured `to`, optional `cc`/`bcc`, `subject`, `bodyText`, optional `bodyHtml`, and optional attachments.
- Require at least one body representation for send, reply, forward, and draft creation.
- Build RFC 2822 MIME server-side; clients never submit raw headers.
- Reject CR/LF in recipient, subject, filename, and MIME-type inputs to prevent header injection.
- For reply/reply-all, first fetch source message metadata and construct `In-Reply-To`, `References`, normalized `Re:` subject, and `threadId` server-side.
- Forwards require explicit `to`; they never infer recipients.
- Set total decoded attachment limit to 10 MiB, matching current download limit. Enforce per-file and aggregate limits before MIME encoding.
- No automatic retries for send, reply, forward, draft creation, or draft sending. Retrying could duplicate mail.

### Phase 4: Batch Operations

Require `gmail.modify`.

| Tool | Gmail endpoint | Action |
| --- | --- | --- |
| `gmail_batch_modify` | `POST /gmail/v1/users/me/messages/batchModify` | Add/remove labels for 1–1000 message IDs |
| `gmail_batch_trash` | Client-bounded individual trash calls, or deferred API-supported equivalent | Move multiple messages to Trash |

Batch tools must include `messageIds`, maximum 1000 IDs, and return per-message success/failure. `gmail_batch_trash` remains disabled by default and is phase-gated because a large reversible destructive operation still has high blast radius.

## OAuth and Re-Consent

### Scopes

Add scope names and URLs to OAuth service and Zod types:

```text
gmail.modify  -> https://www.googleapis.com/auth/gmail.modify
gmail.compose -> https://www.googleapis.com/auth/gmail.compose
gmail.send    -> https://www.googleapis.com/auth/gmail.send
```

Keep `gmail.readonly` for current read tools. Mark all three new Gmail scopes as write scopes so `buildGoogleAuthUrl()` rejects non-forced requests and reconnect uses `prompt=consent select_account`.

### Scope Selection UX

- Add separate Gmail scope choices in `GoogleWorkspaceIntegrationCard`:
  - Read Gmail
  - Organize Gmail (`gmail.modify`)
  - Draft Gmail (`gmail.compose`)
  - Send Gmail (`gmail.send`)
- Show specific operation groups and destructive examples before redirecting to Google.
- Scope grant and namespace activation are independent. Granting a scope never enables MCP tools.
- Existing connections remain valid. Users re-consent only when enabling an operation needing a new scope.
- Update Google Cloud OAuth consent-screen instructions. Gmail `modify`, `compose`, and `send` are sensitive/restricted scopes and may need Google verification outside an internal Workspace deployment.

## Policy, Runtime, and Audit

1. Add each tool to `GOOGLE_WORKSPACE_TOOLS` with `write`, `destructive`, and `idempotent` annotations set accurately.
2. Extend `requiredScope()` so Gmail tools map to one of `gmail.readonly`, `gmail.modify`, `gmail.compose`, or `gmail.send` rather than treating every `gmail_*` tool as read-only.
3. Existing Google Workspace default-deny policy continues unchanged: tool mappings are inserted as `INACTIVE`; list and call middleware require `ACTIVE`.
4. Extend audit-log schema only if structured operation metadata is needed. Never store message bodies, subject text, recipients, attachment filenames, attachment bytes, raw headers, or OAuth tokens.
5. If metadata logging is added, permit only operation type, message/thread/draft/label IDs, count, connection ID, status, duration, and sanitized error code.
6. Preserve current caller-bound Google connection behavior. API-key callers without a user-bound Google connection must fail rather than borrowing an owner account.

## Implementation Order

1. Add Gmail scope enum values, OAuth URL tests, reconnect UI scope controls, and docs scope table.
2. Add Phase 1 tool catalog entries, scope mapping, dispatch helpers, strict input validation, and fake-HTTP tests.
3. Add Phase 2 draft/label helpers plus MIME builder unit tests.
4. Add Phase 3 send/reply/forward with header-injection, recipient, and attachment-limit tests.
5. Add Phase 4 only after production telemetry validates ordinary write operations.
6. Confirm namespace UI can activate every new catalog entry independently and public `tools/list` exposes only explicitly active tools.

## Files Expected to Change

```text
apps/backend/src/lib/google-workspace/google-workspace.ts
apps/backend/src/lib/google-workspace/google-workspace.test.ts
apps/backend/src/routers/google-oauth/google-oauth-service.ts
apps/backend/src/routers/google-oauth/google-oauth-service.test.ts
apps/backend/src/trpc/google-integration.impl.test.ts
apps/frontend/components/google-workspace-integration-card.tsx
packages/zod-types/src/google-integration.zod.ts
docs/en/integrations/google-workspace.mdx
docs/cn/integrations/google-workspace.mdx
```

`mcp_request_audit_logs` schema/repository changes are conditional on choosing structured safe operation metadata. Existing audit records already exclude arguments and response contents.

## Verification and Acceptance Criteria

### Automated

- Unit tests cover exact Gmail endpoint, HTTP method, and JSON payload for every tool.
- Tests reject missing IDs, invalid label arrays, unsafe header inputs, empty recipients, malformed base64, attachments over 10 MiB, and batch sizes outside bounds.
- Scope tests prove `gmail.readonly` cannot execute modify/compose/send tools and return exact re-consent guidance.
- OAuth tests prove each new Gmail write scope forces re-consent.
- Policy tests prove every new tool is hidden and blocked until its namespace mapping is `ACTIVE`.
- Audit tests prove Gmail content and recipient data never persist in audit rows.
- Backend and frontend typechecks pass; existing Gmail read regression tests remain green.

### Manual Production

1. Reconnect one test Google account with each scope combination.
2. Enable only one corresponding namespace tool at a time.
3. Run `tools/list`; verify only explicit active tools appear.
4. Execute against a disposable mailbox and verify Gmail result plus safe audit row.
5. Verify an API key or another user's OAuth connection cannot operate test account mailbox.

## Rollback

- Disable affected namespace tool mappings immediately; gateway removes them from `tools/list` without OAuth token deletion.
- Remove optional scopes through reconnect if needed; disconnect/revoke removes stored tokens.
- No database migration is expected for tool catalog or OAuth scope storage. If structured audit metadata is introduced, ship additive nullable migration and ignore it during rollback.

## Open Decisions

1. Whether `gmail_batch_trash` ships in Phase 4 or stays admin-only.
2. Whether user-label deletion needs an application-level confirmation field in addition to explicit tool activation.
3. Whether attachments launch in Phase 3 or later due to malware/data-exfiltration controls.
4. Whether audit metadata needs IDs/counts, given current audit events intentionally omit all arguments.
