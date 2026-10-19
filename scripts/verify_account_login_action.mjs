import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

// Execute the production actions with their server dependencies replaced. No Supabase
// SDK, environment file, Next runtime or network capability enters the VM.
const source = await readFile(new URL("../app/actions.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  fileName: "app/actions.ts",
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    strict: true,
  },
  reportDiagnostics: true,
});
const errors = (compiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n"));

function loadAction({ signOut = async () => ({ error: null }), createClientError, signIn = async () => true } = {}) {
  const calls = { createClient: 0, signOut: [], signIn: [], redirect: [] };
  const redirectSignal = new Error("synthetic Next redirect");
  const actionModule = { exports: {} };
  const imports = {
    "@/lib/account-login": {
      signInWithAccountId: async (...args) => {
        calls.signIn.push(args);
        return signIn(...args);
      },
    },
    "@/lib/supabase/server": {
      createClient: async () => {
        calls.createClient += 1;
        if (createClientError) throw createClientError;
        return {
          auth: {
            signOut: async (...args) => {
              // Normalize VM objects before host-side strict comparisons.
              calls.signOut.push(args.map((options) => ({ ...options })));
              return signOut();
            },
          },
        };
      },
    },
    "next/navigation": {
      redirect: (path) => {
        calls.redirect.push(path);
        // Real Next redirects throw. The action must let this escape its catch.
        throw redirectSignal;
      },
    },
  };
  const context = vm.createContext({
    module: actionModule,
    exports: actionModule.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(imports, name), `unexpected production import: ${name}`);
      return imports[name];
    },
  }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(compiled.outputText, { filename: "app/actions.ts (transpiled)" }).runInContext(context, { timeout: 1000 });
  assert.equal(typeof actionModule.exports.signOutAction, "function");
  return { action: actionModule.exports.signOutAction, signInAction: actionModule.exports.signInAction, calls, redirectSignal };
}

function loginForm(loginId, password) {
  const form = new FormData();
  if (loginId !== undefined) form.set("login_id", loginId);
  if (password !== undefined) form.set("password", password);
  return form;
}

// FormData values can be Files. Reject malformed input before any auth lookup.
for (const form of [
  loginForm(undefined, "synthetic password"),
  loginForm("  ", "synthetic password"),
  loginForm("sample_lab", undefined),
  loginForm("sample_lab", ""),
  loginForm(new Blob(["sample_lab"]), "synthetic password"),
  loginForm("sample_lab", new Blob(["synthetic password"])),
]) {
  const invalid = loadAction();
  const state = await invalid.signInAction(null, form);
  assert.equal(typeof state.error, "string");
  assert.deepEqual(invalid.calls.signIn, []);
  assert.deepEqual(invalid.calls.redirect, []);
  assert.equal(invalid.calls.createClient, 0);
}

// IDs trim surrounding whitespace but retain case; passwords are never trimmed.
const accountLogin = loadAction();
await assert.rejects(accountLogin.signInAction(null, loginForm("  Sample_lab  ", " synthetic password ")), (error) => error === accountLogin.redirectSignal);
assert.deepEqual(accountLogin.calls.signIn, [["Sample_lab", " synthetic password "]]);
assert.deepEqual(accountLogin.calls.redirect, ["/protected"]);
assert.equal(accountLogin.calls.createClient, 0, "only the verified account helper may create a login session");

const deniedLogin = loadAction({ signIn: async () => false });
const unavailableLogin = loadAction({ signIn: async () => { throw new Error("synthetic private upstream detail"); } });
const deniedState = await deniedLogin.signInAction(null, loginForm("sample_lab", "synthetic password"));
const unavailableState = await unavailableLogin.signInAction(null, loginForm("sample_lab", "synthetic password"));
assert.equal(deniedState.error, unavailableState.error, "lookup/auth/transport errors share one public message");
assert.ok(!unavailableState.error.includes("upstream"));
assert.deepEqual(deniedLogin.calls.redirect, []);
assert.deepEqual(unavailableLogin.calls.redirect, []);

console.log("production signInAction: malformed forms, ID case/trim, password preservation, generic failures and verified-only redirect checked without Auth traffic");
