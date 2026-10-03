import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL(
  "../supabase/functions/send-notification-emails/google-apps-script/Code.gs", import.meta.url),
"utf8");
const valid = {
  action: "send", token: "test-token-at-least-32-characters",
  deliveryId: "00000000-0000-0000-0000-000000000001",
  notificationId: "00000000-0000-0000-0000-000000000002",
  senderEmail: "chemstock.notice@gmail.com",
  recipientEmail: "store@example.edu",
  eventRatio: 1.05, eventAt: "2026-09-30T00:00:00Z",
};

function script(owner = valid.senderEmail, send = () => {}) {
  const output = { MimeType: { JSON: "JSON" },
    createTextOutput(value) { return { value, setMimeType() { return this; } }; } };
  const settings = new Map([
    ["WEBHOOK_TOKEN", valid.token], ["SENDER_EMAIL", valid.senderEmail],
    ["RECIPIENT_EMAIL", valid.recipientEmail], ["APP_URL", "https://chemstock.example.edu"],
  ]);
  const context = {
    ContentService: output,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => settings.get(key) }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => owner }) },
    Utilities: { formatDate: () => "2026/09/30 09:00:00" },
    MailApp: { sendEmail: send },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return (payload) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).value);
}

test("the script rejects missing token before reading sender details", () => {
  const call = script();
  assert.equal(call({ ...valid, token: "wrong" }).errorCode, "UNAUTHORIZED");
});

test("the script preflight confirms the actual owner address", () => {
  const call = script();
  assert.deepEqual(call({ action: "check", token: valid.token }), {
    ready: true, senderEmail: valid.senderEmail, recipientEmail: valid.recipientEmail,
  });
  assert.equal(script("wrong@gmail.com")({ action: "check", token: valid.token }).errorCode,
    "NOT_CONFIGURED");
});

test("only the configured recipient receives a valid alert", () => {
  const sent = [];
  const call = script(valid.senderEmail, (...args) => sent.push(args));
  assert.equal(call({ ...valid, recipientEmail: "other@example.edu" }).errorCode,
    "INVALID_REQUEST");
  assert.equal(sent.length, 0);
  assert.equal(call(valid).accepted, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], valid.recipientEmail);
  assert.equal(sent[0][3].name, "ChemStock 溶媒庫通知");
  assert.equal(sent[0][3].replyTo, valid.recipientEmail);
  assert.match(sent[0][2], /1\.050 倍/);
});

test("a mail service failure is reported as an unknown outcome", () => {
  const call = script(valid.senderEmail, () => { throw new Error("mail failed"); });
  assert.equal(call(valid).errorCode, "SEND_RESULT_UNKNOWN");
});
