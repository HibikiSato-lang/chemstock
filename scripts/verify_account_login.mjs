import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

// Production helper with SDK, env and next/headers replaced. No real credentials,
// network, database or Auth service enter this VM.
const source = await readFile(new URL("../lib/account-login.ts", import.meta.url), "utf8");
assert.match(source, /import "server-only"/);
const compiled = ts.transpileModule(source, { fileName: "lib/account-login.ts", compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true }, reportDiagnostics: true });
assert.equal((compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
const ID = "00000000-0000-0000-0000-000000000001", OTHER = "00000000-0000-0000-0000-000000000002";
const env = { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-public", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" };
const COOKIE = "sb-synthetic-auth-token";
const normalized = (value) => JSON.parse(JSON.stringify(value));

function load(options = {}) {
  const calls = { admin: [], query: [], getUser: [], public: [], signIn: [], initialized: false, cookieRead: 0, writes: [], initialJar: [], logs: [] };
  const response = { data: { user: { id: ID }, session: { user: { id: ID }, access_token: "synthetic-access", refresh_token: "synthetic-refresh" } }, error: null };
  const imports = {
    "server-only": {},
    "@supabase/supabase-js": { createClient: (...args) => {
      calls.admin.push(normalized(args));
      if (options.adminThrows) throw new Error("synthetic private admin detail");
      return {
        from: (table) => {
          calls.query.push(["from", table]);
          return { select: (columns) => {
            calls.query.push(["select", columns]);
            return { eq: (column, value) => {
              calls.query.push(["eq", column, value]);
              return { maybeSingle: async () => {
                if (options.lookupThrows) throw new Error("synthetic private lookup detail");
                return options.lookup ?? { data: { id: ID, email: "contact-only@synthetic.test" }, error: null };
              } };
            } };
          } };
        },
        auth: { admin: { getUserById: async (id) => {
          calls.getUser.push(id);
          if (options.userThrows) throw new Error("synthetic private user detail");
          return options.authUser ?? { data: { user: { id: ID, email: "current-auth@synthetic.test" } }, error: null };
        } } },
      };
    } },
    "@supabase/ssr": { createServerClient: (url, key, config) => {
      calls.public.push([url, key, config.cookieOptions.name, config.auth.storageKey]);
      calls.initialJar.push(normalized(config.cookies.getAll()));
      return { auth: { initialize: async () => {
        await Promise.resolve();
        if (options.initializeThrows) throw new Error("synthetic private initialization failure");
        calls.initialized = true;
        return { error: options.initializeError ? { message: "synthetic initialization error" } : null };
      }, signInWithPassword: async (credentials) => {
        assert.equal(calls.initialized, true, "initialization must finish before password auth");
        calls.signIn.push(normalized(credentials));
        const sets = options.sets ?? [{ name: COOKIE, value: "synthetic-new-session", options: { path: "/", sameSite: "lax", secure: true } }];
        // Even malicious/unexpected writes on an Auth failure stay in the buffer.
        for (const batch of options.batches ?? [sets]) config.cookies.setAll(batch);
        assert.equal(calls.cookieRead, 0);
        assert.deepEqual(calls.writes, []);
        if (options.signInThrows) throw new Error("synthetic private auth detail");
        return options.response ?? response;
      } } };
    } },
    "next/headers": { cookies: async () => {
      calls.cookieRead++;
      if (options.cookiesThrows) throw new Error("synthetic cookie context unavailable");
      return { getAll: () => options.existingCookies ?? [{ name: COOKIE + ".0", value: "old-session-part" }, { name: COOKIE + ".1", value: "old-session-part2" }, { name: "unrelated", value: "keep" }, { name: "sb-other-auth-token", value: "other-project" }], set: (...args) => calls.writes.push(normalized(args)) };
    } },
  };
  const actionModule = { exports: {} };
  const context = vm.createContext({ module: actionModule, exports: actionModule.exports, process: { env: options.env ?? env }, URL, console: { log: (...args) => calls.logs.push(args), error: (...args) => calls.logs.push(args), warn: (...args) => calls.logs.push(args) }, require: (name) => { assert.ok(Object.hasOwn(imports, name), `unexpected import ${name}`); return imports[name]; } }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(compiled.outputText, { filename: "account-login.ts (transpiled)" }).runInContext(context, { timeout: 1000 });
  return { run: actionModule.exports.signInWithAccountId, calls };
}
async function failure(options, id = "Lab-A", password = "synthetic password") {
  const subject = load(options);
  assert.equal(await subject.run(id, password), false);
  assert.deepEqual(subject.calls.writes, []);
  assert.deepEqual(subject.calls.logs, []);
  return subject.calls;
}

const success = load();
assert.equal(await success.run("  Lab-A  ", " synthetic password "), true);
assert.deepEqual(success.calls.query, [["from", "accounts"], ["select", "id"], ["eq", "login_id", "Lab-A"]]);
assert.deepEqual(success.calls.getUser, [ID]);
assert.deepEqual(success.calls.signIn, [{ email: "current-auth@synthetic.test", password: " synthetic password " }]);
assert.deepEqual(success.calls.admin, [[env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }]]);
assert.deepEqual(success.calls.public, [[env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, COOKIE, COOKIE]]);
assert.deepEqual(success.calls.initialJar, [[]], "previous session never enters authentication jar");
assert.deepEqual(success.calls.writes, [[COOKIE + ".0", "", { path: "/", maxAge: 0 }], [COOKIE + ".1", "", { path: "/", maxAge: 0 }], [COOKIE, "synthetic-new-session", { path: "/", sameSite: "lax", secure: true }]]);
assert.deepEqual(success.calls.logs, []);
const unknown = await failure({ lookup: { data: null, error: null } });
assert.equal(unknown.getUser.length, 0); assert.equal(unknown.signIn.length, 0);
await failure({ lookup: { data: { id: ID }, error: { message: "private lookup error" } } });
await failure({ authUser: { data: { user: null }, error: { message: "private Auth error" } } });
await failure({ authUser: { data: { user: { id: OTHER, email: "wrong@synthetic.test" } }, error: null } });
await failure({ authUser: { data: { user: { id: ID } }, error: null } });
await failure({ response: { data: { user: null, session: null }, error: { message: "wrong password" } } });
await failure({ response: { data: { user: { id: OTHER }, session: { user: { id: OTHER }, access_token: "bad", refresh_token: "bad" } }, error: null } });
await failure({ response: { data: { user: { id: ID }, session: { user: { id: OTHER }, access_token: "bad", refresh_token: "bad" } }, error: null } });
await failure({ response: { data: { user: { id: ID }, session: null }, error: null } });
await failure({ response: { data: { user: { id: ID }, session: { user: { id: ID } } }, error: null } });
await failure({ sets: [] });
await failure({ sets: [{ name: "unrelated", value: "not-a-session", options: {} }] });
for (const name of Object.keys(env)) { const missing = { ...env }; delete missing[name]; const calls = await failure({ env: missing }); assert.equal(calls.admin.length, 0); }
for (const name of ["adminThrows", "lookupThrows", "userThrows", "initializeThrows", "signInThrows", "cookiesThrows"]) await failure({ [name]: true });
const initializationFailure = await failure({ initializeError: true }); assert.equal(initializationFailure.signIn.length, 0);
for (const [id, password] of [["", "p"], ["   ", "p"], ["Lab-A", ""], [null, "p"], ["Lab-A", null]]) { const calls = await failure({}, id, password); assert.equal(calls.admin.length, 0); }
const chunks = load({ sets: [{ name: COOKIE + ".0", value: "new0", options: { path: "/" } }] });
assert.equal(await chunks.run("Lab-A", "p"), true);
assert.deepEqual(chunks.calls.writes, [[COOKIE + ".1", "", { path: "/", maxAge: 0 }], [COOKIE + ".0", "new0", { path: "/" }]]);
const batches = load({ batches: [[{ name: COOKIE, value: "first", options: { path: "/" } }], [{ name: COOKIE, value: "last", options: { path: "/", secure: true } }, { name: COOKIE + ".0", value: "", options: { path: "/", maxAge: 0 } }]] });
assert.equal(await batches.run("Lab-A", "p"), true);
assert.deepEqual(batches.calls.writes, [[COOKIE + ".1", "", { path: "/", maxAge: 0 }], [COOKIE, "last", { path: "/", secure: true }], [COOKIE + ".0", "", { path: "/", maxAge: 0 }]]);
console.log("Account ID login: private Auth-email resolution, exact ID lookup, isolated session, UUID checks, deferred cookies and safe failures verified with SDK/headers/env mocks; real Auth is untested.");
