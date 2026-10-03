import { randomBytes } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.CHEMSTOCK_TEST_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const roomName = process.env.CHEMSTOCK_TEST_ROOM_NAME || "テスト研究室";
const credentialsPath = resolve("test-accounts.credentials.json");

if (!url || !serviceRoleKey || url.includes("your-project-ref")) {
  throw new Error("CHEMSTOCK_TEST_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。");
}

const projectUrl = new URL(url).origin;
if (!/^https:\/\/[^/]+\.supabase\.co$/.test(projectUrl) && !/^http:\/\/localhost(?::\d+)?$/.test(projectUrl) && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(projectUrl)) {
  throw new Error("接続先は Supabase プロジェクトまたはローカル Supabase にしてください。");
}

const client = createClient(projectUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const definitions = [
  { email: "test-lab@chemstock.test", loginId: "test-lab", role: "lab" },
  { email: "test-admin@chemstock.test", loginId: "test-admin", role: "global_admin" },
  { email: "test-solvent-admin@chemstock.test", loginId: "test-solvent-admin", role: "solvent_room_admin" },
];

async function checked(result, context) {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

async function findAuthUser(email) {
  for (let page = 1; ; page += 1) {
    const { users } = await checked(await client.auth.admin.listUsers({ page, perPage: 100 }), "Auth ユーザー一覧");
    const found = users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (users.length < 100) return null;
  }
}

async function saveCredentials(credentials) {
  const temporaryPath = `${credentialsPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporaryPath, credentialsPath);
}

let credentials;
try {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  credentials = { projectUrl, roomName, accounts: {} };
}
if (credentials.projectUrl !== projectUrl || credentials.roomName !== roomName) {
  throw new Error("既存の認証情報ファイルの接続先または研究室名が異なります。");
}

// Check the new schema before creating any Auth users.
await checked(await client.from("rooms").select("id").limit(1), "rooms テーブル");
await checked(await client.from("accounts").select("id").limit(1), "accounts テーブル");

let room = await checked(await client.from("rooms").select("id, name").eq("name", roomName).maybeSingle(), "研究室検索");
if (!room) {
  room = await checked(await client.from("rooms").insert({ name: roomName }).select("id, name").single(), "テスト研究室作成");
}

for (const definition of definitions) {
  let user = await findAuthUser(definition.email);
  let password = credentials.accounts[definition.email]?.password;
  if (user && user.app_metadata?.chemstock_test_account !== true) {
    throw new Error(`${definition.email} は既存の別ユーザーです。変更せず停止しました。`);
  }
  if (!user) {
    password ||= randomBytes(24).toString("base64url");
    user = await checked(await client.auth.admin.createUser({
      email: definition.email,
      password,
      email_confirm: true,
      app_metadata: { chemstock_test_account: true },
    }), `${definition.email} の Auth 作成`);
    user = user.user;
  } else if (!password) {
    password = randomBytes(24).toString("base64url");
    await checked(await client.auth.admin.updateUserById(user.id, { password }), `${definition.email} のパスワード再設定`);
  }

  credentials.accounts[definition.email] = { password, role: definition.role };
  await saveCredentials(credentials);

  const roomId = definition.role === "global_admin" ? null : room.id;
  const account = await checked(await client.from("accounts").select("id, room_id, role, login_id").eq("id", user.id).maybeSingle(), "accounts 検索");
  if (account) {
    if (account.role !== definition.role || account.room_id !== roomId || account.login_id !== definition.loginId) {
      throw new Error(`${definition.email} の既存 accounts 行が期待する権限または研究室と異なります。`);
    }
  } else {
    await checked(await client.from("accounts").insert({
      id: user.id,
      room_id: roomId,
      login_id: definition.loginId,
      role: definition.role,
      email: definition.email,
    }), `${definition.email} の accounts 作成`);
  }
  console.log(`${definition.role}: ${definition.email}`);
}

console.log(`認証情報: ${credentialsPath}`);
