// Dependency-free behavioral harness: run actual TypeScript modules with isolated
// SDK/DB boundaries, not a second implementation of the recovery logic.
// node --test --test-concurrency=1 apps/backend/src/lib/metamcp/proxy-recovery.behavior.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

function load(file, deps, exports) {
  let source = stripTypeScriptTypes(readFileSync(new URL(file, import.meta.url), 'utf8'));
  const names = new Set();
  source = source.replace(/import\s+([\s\S]*?)\s+from\s+["'][^"']+["'];/g, (_, bindings) => {
    if (bindings.startsWith('{')) {
      for (const name of bindings.slice(1, -1).split(',')) {
        if (name.trim()) names.add(name.trim());
      }
    } else names.add(bindings.trim());
    return '';
  }).replace(/export /g, '');
  // Do not boot the production singleton's background timers in the unit harness.
  if (file === './mcp-server-pool.ts') source = source.replace('const mcpServerPool = McpServerPool.getInstance();', '');
  return new Function(...names, `${source}\nreturn {${exports.join(',')}}`)(
    ...[...names].map(name => deps[name] ?? name),
  );
}
const logger = { error() {}, warn() {}, info() {}, debug() {} };
const classifier = load('./session-error.ts', {}, ['isRecoverableBackendError', 'isBackendSessionLostError']);
const recovery = load('./list-handler-recovery.ts', { logger, ...classifier }, ['requestWithSessionRecovery']);

async function fixture({ hint, failure = new Error('Not connected'), freshFailure, listFailure, requestHook } = {}) {
  const calls = [];
  const gets = [];
  const recoveryGets = [];
  let recovering = false;
  const handlers = {};
  let owned;
  let invalidations = 0;
  const tools = ['read', 'sibling'].map(name => ({ name, inputSchema: { type: 'object' }, ...(hint === undefined ? {} : { annotations: { readOnlyHint: hint } }) }));
  const makeClient = (id) => ({ id, client: {
    getServerVersion: () => ({ name: 'backend' }),
    getServerCapabilities: () => ({ tools: {}, prompts: {}, resources: {} }),
    async request(request) {
      calls.push({ id, ...request });
      if (requestHook) {
        const result = await requestHook(id, request);
        if (result !== undefined) return result;
      }
      if (request.method === listFailure && id === 'old') throw new Error('Not connected');
      if (request.method === 'resources/templates/list') return { resourceTemplates: [] };
      if (request.method === 'tools/list') return { tools };
      if (request.method === 'prompts/list') return { prompts: [{ name: 'p' }] };
      if (request.method === 'resources/list') return { resources: [{ uri: 'r' }] };
      if (request.method === 'tools/call' && id === 'old') throw failure;
      if (request.method === 'tools/call' && id === 'fresh' && freshFailure) throw freshFailure;
      return { content: [{ type: 'text', text: id }] };
    },
  } });
  const old = makeClient('old');
  const fresh = makeClient('fresh');
  owned = old;
  const pool = {
    getPoolStatus: () => ({ idle: 1, active: 1 }),
    touchSession(_sid, _uuid, client) { return client === owned; },
    async getSession(...args) { gets.push(args); if (recovering) recoveryGets.push(args); recovering = false; owned ??= fresh; return owned; },
    async invalidateServerConnection() { invalidations++; owned = undefined; recovering = true; },
  };
  class Server { setRequestHandler(schema, handler) { handlers[schema] = handler; } }
  const identityMiddleware = () => (handler) => handler;
  const deps = {
    Server, logger, ...classifier, ...recovery, mcpServerPool: pool,
    namespacesRepository: { findByUuid: async () => ({}) },
    getMcpServers: async () => ({ uuid: { uuid: 'uuid', name: 'backend', headers: { base: 'yes' } } }),
    GoogleWorkspaceClient: class {}, googleConnectionsRepository: {},
    configService: { getMcpResetTimeoutOnProgress: async () => false, getMcpTimeout: async () => 100, getMcpMaxTotalTimeout: async () => 100 },
    extractForwardedHeaders: () => ({ uuid: { authorization: 'forwarded-test-value' } }),
    mergeHeaders: (base, extra) => ({ ...base, ...extra }),
    sanitizeName: name => name,
    parseToolName: name => ({ serverName: name.split('__')[0], originalToolName: name.split('__')[1] }),
    toolsSyncCache: { hasChanged: () => false },
    isExposedAdminToolName: () => false, getAdminToolsContext: () => undefined,
    compose: () => (handler) => handler,
    createAuditCallToolMiddleware: identityMiddleware, createFilterCallToolMiddleware: identityMiddleware,
    createFilterListToolsMiddleware: identityMiddleware, createToolOverridesCallToolMiddleware: identityMiddleware,
    createToolOverridesListToolsMiddleware: identityMiddleware,
  };
  const { createServer } = load('./metamcp-proxy.ts', deps, ['createServer']);
  await createServer('ns', 'sid', false, { authorization: 'forwarded-test-value' });
  const run = (schema, params = {}) => handlers[schema]({ params });
  await run('ListToolsRequestSchema');
  await run('ListPromptsRequestSchema');
  await run('ListResourcesRequestSchema');
  return { run, calls, gets, recoveryGets, old, fresh, evict: () => { owned = undefined; }, get invalidations() { return invalidations; } };
}

test('Not connected retries a positively read-only tool once and preserves forwarded headers', async () => {
  const f = await fixture({ hint: true });
  const result = await f.run('CallToolRequestSchema', { name: 'backend__read', arguments: { a: 1 }, _meta: { trace: 'test' } });
  assert.equal(result.content[0].text, 'fresh');
  assert.equal(f.invalidations, 1);
  assert.equal(f.calls.filter(c => c.method === 'tools/call').length, 2);
  assert.equal(f.gets.at(-1)[2].headers.authorization, 'forwarded-test-value');
  assert.deepEqual(f.calls.at(-1).params, { name: 'read', arguments: { a: 1 }, _meta: { trace: 'test' } });
});

test('recovery refreshes sibling tool, prompt and resource mappings', async () => {
  const f = await fixture({ hint: true });
  await f.run('CallToolRequestSchema', { name: 'backend__read' });
  await f.run('CallToolRequestSchema', { name: 'backend__sibling' });
  await f.run('GetPromptRequestSchema', { name: 'backend__p' });
  await f.run('ReadResourceRequestSchema', { uri: 'r' });
  assert.equal(f.invalidations, 1);
  assert.deepEqual(f.calls.filter(c => ['prompts/get', 'resources/read'].includes(c.method)).map(c => c.id), ['fresh', 'fresh']);
});

for (const [schema, params] of [['CallToolRequestSchema', { name: 'backend__read' }], ['GetPromptRequestSchema', { name: 'backend__p' }], ['ReadResourceRequestSchema', { uri: 'r' }]]) {
  test(`evicted cached identity is replaced before ${schema}`, async () => {
    const f = await fixture();
    f.evict();
    await f.run(schema, params);
    assert.equal(f.calls.at(-1).id, 'fresh');
    assert.equal(f.invalidations, 0);
    assert.equal(f.gets.at(-1)[2].headers.authorization, 'forwarded-test-value');
  });
}

test('pool touches only its current owned identity', () => {
  const { McpServerPool } = load('./mcp-server-pool.ts', {
    logger, setInterval: () => 0,
    configService: { getSessionLifetime: async () => null },
  }, ['McpServerPool']);
  const pool = Object.create(McpServerPool.prototype);
  const current = {};
  pool.activeSessions = { sid: { uuid: current } };
  pool.sessionTimestamps = { sid: 1 };
  assert.equal(pool.touchSession('sid', 'uuid', current), true);
  const touched = pool.sessionTimestamps.sid;
  assert.ok(touched > 1);
  assert.equal(pool.touchSession('sid', 'uuid', {}), false);
  assert.equal(pool.sessionTimestamps.sid, touched);
  assert.equal(pool.touchSession('missing', 'uuid', current), false);
});

for (const hint of [false, 'true', undefined]) {
  test(`Not connected does not replay tool with readOnlyHint=${String(hint)}`, async () => {
    const f = await fixture({ hint });
    await assert.rejects(f.run('CallToolRequestSchema', { name: 'backend__read' }), /Not connected/);
    assert.equal(f.invalidations, 1);
    assert.equal(f.calls.filter(c => c.method === 'tools/call').length, 1);
    await f.run('GetPromptRequestSchema', { name: 'backend__p' });
    assert.equal(f.calls.at(-1).id, 'fresh');
  });
}

test('read-only retry failure never triggers a second reconnect or third call', async () => {
  const f = await fixture({ hint: true, freshFailure: new Error('Not connected again') });
  await assert.rejects(f.run('CallToolRequestSchema', { name: 'backend__read' }), /Not connected again/);
  assert.equal(f.invalidations, 1);
  assert.equal(f.calls.filter(c => c.method === 'tools/call').length, 2);
});

test('unrelated backend failure is propagated without reconnect or replay', async () => {
  const failure = new Error('permission denied');
  const f = await fixture({ hint: true, failure });
  await assert.rejects(f.run('CallToolRequestSchema', { name: 'backend__read' }), error => error === failure);
  assert.equal(f.invalidations, 0);
  assert.equal(f.calls.filter(c => c.method === 'tools/call').length, 1);
});

for (const [method, schema] of [['tools/list', 'ListToolsRequestSchema'], ['prompts/list', 'ListPromptsRequestSchema'], ['resources/list', 'ListResourcesRequestSchema'], ['resources/templates/list', 'ListResourceTemplatesRequestSchema']]) {
  test(`${method} recovery retains forwarded headers`, async () => {
    const f = await fixture({ listFailure: method });
    if (method === 'resources/templates/list') await f.run(schema);
    assert.equal(f.invalidations, 1);
    const freshGet = f.recoveryGets[0];
    assert.equal(freshGet[2].headers.authorization, 'forwarded-test-value');
  });
}

test('session loss reconnects but never replays an unannotated tool', async () => {
  const f = await fixture({ failure: new Error('HTTP 404 Session not found') });
  await assert.rejects(f.run('CallToolRequestSchema', { name: 'backend__read' }), /Session not found/);
  assert.equal(f.invalidations, 1);
  assert.equal(f.calls.filter(c => c.method === 'tools/call').length, 1);
});

function poolFixture() {
  const { McpServerPool } = load('./mcp-server-pool.ts', {
    logger, ...load('./header-forwarding.ts', { logger }, ['serverRequiresForwardedHeaders']),
  }, ['McpServerPool']);
  const pool = Object.create(McpServerPool.prototype);
  Object.assign(pool, { activeSessions: {}, idleSessions: {}, sessionToServers: {},
    sessionTimestamps: {}, serverParamsCache: {}, creatingIdleSessions: new Set(),
    idleSessionGenerations: {}, pendingSessions: new Map(), maxConnectionsPerServer: 1 });
  pool.createIdleSessionAsync = () => {};
  return pool;
}

test('late failure only invalidates the failing identity, never its replacement', async () => {
  const pool = poolFixture();
  let cleaned = 0;
  const old = { cleanup: async () => { cleaned++; } };
  const fresh = { cleanup: async () => { cleaned++; } };
  pool.activeSessions = { sid: { uuid: fresh }, other: { uuid: old } };
  await pool.invalidateServerConnection('sid', 'uuid', old);
  assert.equal(pool.activeSessions.sid.uuid, fresh);
  assert.equal(pool.activeSessions.other.uuid, undefined);
  assert.equal(cleaned, 1);
});

test('concurrent recovery acquisitions create exactly one connection', async () => {
  const pool = poolFixture();
  let creations = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fresh = { cleanup: async () => {} };
  pool.createNewConnection = async () => { creations++; await gate; return fresh; };
  const a = pool.getSession('sid', 'uuid', { forward_headers: { authorization: 'Authorization' } });
  const b = pool.getSession('sid', 'uuid', { forward_headers: { authorization: 'Authorization' } });
  release();
  assert.deepEqual(await Promise.all([a, b]), [fresh, fresh]);
  assert.equal(creations, 1);
});
test('reconnected cached client cannot inherit read-only eligibility', async () => {
  const f = await fixture({ hint: true, freshFailure: new Error('Not connected fresh') });
  f.evict();
  await assert.rejects(f.run('CallToolRequestSchema', { name: 'backend__read' }), /Not connected fresh/);
  assert.equal(f.calls.filter(c => c.method === 'tools/call').length, 1);
});
test('changed fresh readOnlyHint forbids replay of previously read-only tool', async () => {
  const f = await fixture({ hint: true, requestHook: (id, req) => {
    if (id === 'fresh' && req.method === 'tools/list') return { tools: [{ name: 'read', annotations: { readOnlyHint: false } }] };
  } });
  await assert.rejects(f.run('CallToolRequestSchema', { name: 'backend__read' }), /Not connected/);
  assert.equal(f.calls.filter(c => c.method === 'tools/call').length, 1);
});
test('successful discovery removes obsolete cached tool routes', async () => {
  let removed = false;
  const f = await fixture({ hint: true, requestHook: (_id, req) => {
    if (removed && req.method === 'tools/list') return { tools: [] };
  } });
  removed = true;
  await f.run('ListToolsRequestSchema');
  await assert.rejects(f.run('CallToolRequestSchema', { name: 'backend__read' }), /Unknown tool/);
  assert.equal(f.calls.filter(c => c.method === 'tools/call').length, 0);
});
test('forwarded credentials fail closed at cap instead of borrowing another session', async () => {
  const pool = poolFixture();
  const alice = { cleanup: async () => {} };
  pool.activeSessions = { alice: { uuid: alice } };
  pool.sessionTimestamps.alice = 1;
  let created = 0;
  pool.createNewConnection = async () => { created++; return {}; };
  const result = await pool.getSession('bob', 'uuid', { forward_headers: { authorization: 'Authorization' }, headers: { authorization: 'bob-test' } });
  assert.equal(result, undefined);
  assert.equal(pool.activeSessions.bob.uuid, undefined);
  assert.equal(created, 0);
  assert.equal(pool.activeSessions.alice.uuid, alice);
});
test('concurrent list recovery preserves replacement and shares acquisition', async () => {
  const pool = poolFixture();
  let cleaned = 0, created = 0, releaseLate;
  const old = { cleanup: async () => { cleaned++; } };
  const fresh = { cleanup: async () => {} };
  pool.activeSessions = { sid: { uuid: old } };
  pool.sessionToServers = { sid: new Set(['uuid']) };
  pool.createNewConnection = async () => { created++; return fresh; };
  const late = new Promise(resolve => { releaseLate = resolve; });
  const opts = { pool, sessionId: 'sid', serverUuid: 'uuid', params: { forward_headers: { authorization: 'Authorization' } },
    operation: 'tools/list', serverName: 'backend', session: old };
  const a = recovery.requestWithSessionRecovery({ ...opts, attempt: async client => {
    if (client === old) throw new Error('Not connected');
    return 'fresh';
  } });
  const b = recovery.requestWithSessionRecovery({ ...opts, attempt: async client => {
    if (client === old) { await late; throw new Error('Not connected'); }
    return 'fresh';
  } });
  assert.equal(await a, 'fresh');
  releaseLate();
  assert.equal(await b, 'fresh');
  assert.equal(pool.activeSessions.sid.uuid, fresh);
  assert.equal(created, 1);
  assert.equal(cleaned, 1);
});
test('late old tools discovery cannot restore removed replacement tools', async () => {
  let delay = false, release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture({ requestHook: async (id, req) => {
    if (delay && id === 'old' && req.method === 'tools/list') { started(); await gate; }
    if (id === 'fresh' && req.method === 'tools/list') return { tools: [] };
  } });
  delay = true;
  const late = f.run('ListToolsRequestSchema');
  await waiting;
  f.evict();
  await f.run('ListToolsRequestSchema');
  release();
  await late;
  await assert.rejects(f.run('CallToolRequestSchema', { name: 'backend__read' }), /Unknown tool/);
  assert.equal(f.calls.filter(c => c.method === 'tools/call').length, 0);
});

test('pending credential-isolated acquisition counts toward the per-server cap', async () => {
  const pool = poolFixture();
  let release, creations = 0;
  const gate = new Promise(resolve => { release = resolve; });
  pool.createNewConnection = async () => { creations++; await gate; return { cleanup: async () => {} }; };
  const a = pool.getSession('alice', 'uuid', { forward_headers: { authorization: 'Authorization' } });
  const b = pool.getSession('bob', 'uuid', { forward_headers: { authorization: 'Authorization' } });
  release();
  await a;
  assert.equal(await b, undefined);
  assert.equal(creations, 1);
});
