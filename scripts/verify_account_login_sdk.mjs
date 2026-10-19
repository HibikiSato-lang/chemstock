import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

// Installed SDK integration, synthetic fetch only. No .env, credentials, Auth
// service or database is used; every HTTP route and query is allowlisted.
const ID = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
const URL_BASE = "https://sdk-fixture.supabase.test";
const COOKIE = "sb-sdk-fixture-auth-token";
const syntheticEnv = { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-public", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" };
const source = await readFile(new URL("../lib/account-login.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { fileName: "lib/account-login.ts", compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true }, reportDiagnostics: true });
assert.equal((compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const isAuthCookie = (name) => name === COOKIE || (name.startsWith(COOKIE + ".") && /^\d+$/.test(name.slice(COOKIE.length + 1)));
const base64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function authUser(id, padding) {
  return { id, aud: "authenticated", role: "authenticated", email: "current-auth@synthetic.test", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { synthetic: "x".repeat(padding) }, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", identities: [] };
}
function fixture(existing = []) {
  const jar = new Map(existing.map(({ name, value }) => [name, value]));
  const calls = { fetch: [], unexpected: [], writes: [], cookieReads: 0, sdkLogs: [] };
  let scenario = { padding: 0, id: ID, wrongPassword: false };
  const fakeFetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? (input instanceof Request ? input.method : "GET");
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : {}));
    const record = `${method} ${url.pathname}${url.search}`;
    calls.fetch.push(record);
    assert.equal(calls.writes.length, 0, "HTTP auth must complete before response cookies are committed");
    if (url.origin === URL_BASE && method === "GET" && url.pathname === "/rest/v1/accounts" && url.searchParams.get("select") === "id" && url.searchParams.get("login_id") === "eq.Lab-A" && [...url.searchParams.keys()].length === 2 && headers.get("apikey") === syntheticEnv.SUPABASE_SERVICE_ROLE_KEY) {
      return json([{ id: ID }]);
    }
    if (url.origin === URL_BASE && method === "GET" && url.pathname === `/auth/v1/admin/users/${ID}` && !url.search && headers.get("Authorization") === `Bearer ${syntheticEnv.SUPABASE_SERVICE_ROLE_KEY}`) {
      return json(authUser(ID, 0));
    }
    if (url.origin === URL_BASE && method === "POST" && url.pathname === "/auth/v1/token" && url.search === "?grant_type=password" && headers.get("apikey") === syntheticEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
      const body = JSON.parse(init.body ?? (input instanceof Request ? await input.text() : "null"));
      assert.equal(body.email, "current-auth@synthetic.test");
      assert.equal(body.password, "synthetic-password");
      if (scenario.wrongPassword) return json({ code: "invalid_credentials", msg: "Synthetic invalid credentials" }, 400);
      const iat = Math.floor(Date.now() / 1000), exp = iat + 3600;
      const accessToken = `${base64({ alg: "HS256", typ: "JWT" })}.${base64({ sub: scenario.id, aud: "authenticated", role: "authenticated", iat, exp, iss: URL_BASE + "/auth/v1" })}.synthetic-signature`;
      return json({ access_token: accessToken, refresh_token: "synthetic-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: exp, user: authUser(scenario.id, scenario.padding) });
    }
    calls.unexpected.push(record);
    throw new Error("Unexpected SDK request blocked");
  };
  const imports = {
    "server-only": {},
    "@supabase/supabase-js": { createClient: (url, key, config) => createClient(url, key, { ...config, global: { ...config.global, fetch: fakeFetch } }) },
    "@supabase/ssr": { createServerClient: (url, key, config) => createServerClient(url, key, { ...config, global: { ...config.global, fetch: fakeFetch } }) },
    "next/headers": { cookies: async () => {
      calls.cookieReads++;
      return { getAll: () => [...jar].map(([name, value]) => ({ name, value })), set: (name, value, options) => {
        calls.writes.push({ name, value, options: { ...options } });
        if (options.maxAge === 0) jar.delete(name); else jar.set(name, value);
      } };
    } },
  };
  const actionModule = { exports: {} };
  const context = vm.createContext({ module: actionModule, exports: actionModule.exports, URL, process: { env: syntheticEnv }, require: (name) => { assert.ok(Object.hasOwn(imports, name)); return imports[name]; } }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(compiled.outputText, { filename: "account-login.ts (real SDK synthetic fetch)" }).runInContext(context, { timeout: 1000 });
  return {
    jar, calls,
    async signIn(next = {}) {
      scenario = { padding: 0, id: ID, wrongPassword: false, ...next };
      calls.fetch.length = 0; calls.writes.length = 0; calls.cookieReads = 0;
      return actionModule.exports.signInWithAccountId("Lab-A", "synthetic-password");
    },
    async restore() {
      // Standard server client, default storage key: same constructor as the
      // app's normal session reader, with custom fetch only to block real HTTP.
      const reader = createServerClient(URL_BASE, syntheticEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { global: { fetch: fakeFetch }, cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: () => { throw new Error("Unexpired roundtrip must not refresh or write cookies"); },
      } });
      const before = calls.fetch.length;
      const { data, error } = await reader.auth.getSession();
      assert.equal(error, null);
      assert.equal(calls.fetch.length, before, "session restoration is local and must not call Auth");
      assert.ok(data.session);
      // This is a serialization roundtrip only, not server-side authorization.
      assert.equal(data.session.user.id, ID);
      assert.equal(data.session.user.user_metadata.synthetic.length, scenario.padding);
      return data.session;
    },
  };
}
const priorGlobalFetch = globalThis.fetch;
// A fallback or omitted injection must fail instead of reaching the network.
globalThis.fetch = async () => { throw new Error("External network disabled in SDK fixture"); };
try {
  const subject = fixture([{ name: "unrelated", value: "preserve" }, { name: "sb-other-auth-token", value: "preserve-other-project" }]);
  assert.equal(await subject.signIn(), true);
  assert.deepEqual(subject.calls.fetch.map((path) => path.split("?")[0]), ["GET /rest/v1/accounts", `GET /auth/v1/admin/users/${ID}`, "POST /auth/v1/token"]);
  assert.ok(subject.jar.has(COOKIE), "small session uses the SDK's unchunked cookie");
  assert.equal([...subject.jar.keys()].filter((name) => name.startsWith(COOKIE + ".")).length, 0);
  await subject.restore();
  assert.equal(await subject.signIn({ padding: 14000 }), true);
  assert.equal(subject.jar.has(COOKIE), false, "switch to chunks clears the old base cookie");
  const largeNames = [...subject.jar.keys()].filter(isAuthCookie);
  assert.ok(largeNames.length > 2, "long metadata forces actual SDK cookie chunking");
  assert.ok(largeNames.every((name, index) => name === COOKIE + "." + index), "chunks are contiguous and SDK-named");
  await subject.restore();
  assert.equal(await subject.signIn({ padding: 4000 }), true);
  const smallerNames = [...subject.jar.keys()].filter(isAuthCookie);
  assert.ok(smallerNames.length >= 2 && smallerNames.length < largeNames.length, "smaller chunked session removes surplus chunks");
  for (const name of largeNames.filter((name) => !smallerNames.includes(name))) assert.ok(subject.calls.writes.some((write) => write.name === name && write.options.maxAge === 0 && write.options.path === "/"));
  await subject.restore();
  assert.equal(await subject.signIn(), true);
  assert.deepEqual([...subject.jar.keys()].filter(isAuthCookie), [COOKIE], "chunked to small clears every old chunk");
  for (const name of smallerNames) assert.ok(subject.calls.writes.some((write) => write.name === name && write.options.maxAge === 0));
  await subject.restore();
  assert.equal(subject.jar.get("unrelated"), "preserve");
  assert.equal(subject.jar.get("sb-other-auth-token"), "preserve-other-project");
  assert.deepEqual(subject.calls.unexpected, []);
  const beforeFailure = [...subject.jar];
  assert.equal(await subject.signIn({ wrongPassword: true }), false);
  assert.deepEqual([...subject.jar], beforeFailure);
  assert.equal(subject.calls.writes.length, 0);
  assert.equal(subject.calls.cookieReads, 0);
  assert.equal(await subject.signIn({ id: OTHER, padding: 14000 }), false);
  assert.deepEqual([...subject.jar], beforeFailure, "mismatching SDK session is never committed");
  assert.equal(subject.calls.writes.length, 0);
  assert.equal(subject.calls.cookieReads, 0);
  assert.deepEqual(subject.calls.unexpected, []);
  console.log("Installed Supabase SDK: synthetic HTTP only, session Cookie UUID roundtrip, small/large/fewer/small chunk transitions, unrelated cookies and failure isolation verified. Live Auth/DB and JWT authorization remain untested.");
} finally {
  globalThis.fetch = priorGlobalFetch;
}
