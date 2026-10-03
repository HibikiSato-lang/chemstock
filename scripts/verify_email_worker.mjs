import assert from "node:assert/strict";
import { test } from "node:test";
import { handleWorkerRequest, messageFor } from "../supabase/functions/send-notification-emails/worker.mjs";

const env = {
  EMAIL_WORKER_TOKEN: "test-worker-token-at-least-32-characters",
  SUPABASE_URL: "https://db.example.edu",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  M365_TENANT_ID: "test-tenant",
  M365_CLIENT_ID: "test-client",
  M365_CLIENT_SECRET: "test-client-secret",
  M365_SENDER: "sender@example.edu",
  CHEMSTOCK_APP_URL: "https://chemstock.example.edu",
};
const job = {
  id: "00000000-0000-0000-0000-000000000001",
  notificationId: "00000000-0000-0000-0000-000000000002",
  recipientEmail: "store@example.edu",
  senderEmail: "sender@example.edu",
  eventRatio: 1.05,
  eventAt: "2026-09-29T12:00:00Z",
  leaseToken: "00000000-0000-0000-0000-000000000003",
};
const gmailEnv = {
  ...env,
  EMAIL_PROVIDER: "gmail_apps_script",
  GMAIL_SCRIPT_URL: "https://script.google.com/macros/s/test-deployment/exec",
  GMAIL_SCRIPT_TOKEN: "test-script-token-at-least-32-characters",
  GMAIL_SENDER: "chemstock.notice@gmail.com",
};
const gmailJob = { ...job, senderEmail: gmailEnv.GMAIL_SENDER };

function request(token = env.EMAIL_WORKER_TOKEN) {
  return new Request("https://worker.example.edu", {
    method: "POST", headers: { "x-worker-token": token },
  });
}

function fakeFetch(graphStatus, calls) {
  return async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/oauth2/v2.0/token")) {
      return Response.json({ access_token: "test-access-token" });
    }
    if (url.endsWith("/email_worker_claim")) return Response.json([job]);
    if (url.includes("/sendMail")) {
      if (graphStatus === "network") throw new Error("timeout");
      return new Response(null, { status: graphStatus });
    }
    if (url.endsWith("/email_worker_accept") || url.endsWith("/email_worker_fail")) {
      return Response.json(true);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

test("the worker requires its private token and full configuration", async () => {
  const noFetch = () => { throw new Error("unexpected network request"); };
  assert.equal((await handleWorkerRequest(request("wrong"), env, noFetch)).status, 401);
  assert.equal((await handleWorkerRequest(request(), { ...env, M365_CLIENT_SECRET: "" }, noFetch)).status, 503);
});

test("Graph credentials are checked before any delivery is claimed", async () => {
  const urls = [];
  const result = await handleWorkerRequest(request(), env, async (url) => {
    urls.push(url);
    return new Response(null, { status: 401 });
  });
  assert.equal(result.status, 503);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /oauth2\/v2\.0\/token$/);
});

test("a successful Graph 202 is recorded as accepted, without lab inventory details", async () => {
  const calls = [];
  const result = await handleWorkerRequest(request(), env, fakeFetch(202, calls));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { claimed: 1, accepted: 1, retry: 0, failed: 0 });
  const graph = calls.find((call) => call.url.includes("/sendMail"));
  assert.match(graph.url, /users\/sender%40example.edu\/sendMail$/);
  const message = JSON.parse(graph.options.body).message;
  assert.equal(message.toRecipients[0].emailAddress.address, "store@example.edu");
  assert.match(message.body.content, /1\.050 倍/);
  assert.match(message.body.content, /manage\/admin\/notifications/);
  assert.equal(calls.filter((call) => call.url.endsWith("/email_worker_accept")).length, 1);
  const accepted = calls.find((call) => call.url.endsWith("/email_worker_accept"));
  assert.equal(JSON.parse(accepted.options.body).p_provider_message_id, null);
});

test("only a definite rate limit is retried", async () => {
  const calls = [];
  const result = await handleWorkerRequest(request(), env, fakeFetch(429, calls));
  assert.deepEqual(await result.json(), { claimed: 1, accepted: 0, retry: 1, failed: 0 });
  const failure = calls.find((call) => call.url.endsWith("/email_worker_fail"));
  assert.deepEqual(JSON.parse(failure.options.body), {
    p_delivery_id: job.id, p_lease_token: job.leaseToken,
    p_error_code: "GRAPH_RATE_LIMITED", p_permanent: false,
  });
});

test("an uncertain network result requires manual review", async () => {
  const calls = [];
  const result = await handleWorkerRequest(request(), env, fakeFetch("network", calls));
  assert.deepEqual(await result.json(), { claimed: 1, accepted: 0, retry: 0, failed: 1 });
  const failure = calls.find((call) => call.url.endsWith("/email_worker_fail"));
  assert.equal(JSON.parse(failure.options.body).p_permanent, true);
  assert.equal(JSON.parse(failure.options.body).p_error_code, "GRAPH_UNKNOWN_OUTCOME");
});

test("a sender setting mismatch prevents an email request", async () => {
  const calls = [];
  const send = fakeFetch(202, calls);
  const result = await handleWorkerRequest(request(), env, async (url, options) => {
    if (url.endsWith("/email_worker_claim")) return Response.json([{ ...job, senderEmail: "other@example.edu" }]);
    return send(url, options);
  });
  assert.equal((await result.json()).failed, 1);
  assert.equal(calls.some((call) => call.url.includes("/sendMail")), false);
  const failure = calls.find((call) => call.url.endsWith("/email_worker_fail"));
  assert.equal(JSON.parse(failure.options.body).p_error_code, "SENDER_MISMATCH");
});

test("a Graph server error is classified as an uncertain outcome", async () => {
  const calls = [];
  const result = await handleWorkerRequest(request(), env, fakeFetch(503, calls));
  assert.equal((await result.json()).failed, 1);
  const failure = calls.find((call) => call.url.endsWith("/email_worker_fail"));
  assert.equal(JSON.parse(failure.options.body).p_error_code, "GRAPH_AMBIGUOUS_RESPONSE");
  assert.equal(JSON.parse(failure.options.body).p_permanent, true);
});

test("invalid event data never reaches Graph", () => {
  assert.throws(() => messageFor({ ...job, eventRatio: 0.8 }, env.CHEMSTOCK_APP_URL),
    /INVALID_EVENT/);
});

test("the dedicated Gmail script confirms its sender before claiming", async () => {
  const calls = [];
  const result = await handleWorkerRequest(request(), gmailEnv, async (url, options) => {
    calls.push({ url, options });
    if (url === gmailEnv.GMAIL_SCRIPT_URL) {
      const body = JSON.parse(options.body);
      assert.equal(body.action, "check");
      return Response.json({ ready: true, senderEmail: "wrong@gmail.com",
        recipientEmail: job.recipientEmail });
    }
    throw new Error("delivery must not be claimed");
  });
  assert.equal(result.status, 503);
  assert.equal(calls.length, 1);
});

test("the dedicated Gmail route records a fixed-account send", async () => {
  const calls = [];
  const result = await handleWorkerRequest(request(), gmailEnv, async (url, options) => {
    calls.push({ url, options });
    if (url === gmailEnv.GMAIL_SCRIPT_URL) {
      const body = JSON.parse(options.body);
      if (body.action === "check") {
        return Response.json({ ready: true, senderEmail: gmailJob.senderEmail,
          recipientEmail: gmailJob.recipientEmail });
      }
      assert.equal(body.action, "send");
      assert.equal(body.senderEmail, gmailJob.senderEmail);
      assert.equal(body.recipientEmail, gmailJob.recipientEmail);
      assert.equal(body.token, gmailEnv.GMAIL_SCRIPT_TOKEN);
      return Response.json({ accepted: true, senderEmail: gmailJob.senderEmail,
        recipientEmail: gmailJob.recipientEmail });
    }
    if (url.endsWith("/email_worker_claim")) return Response.json([gmailJob]);
    if (url.endsWith("/email_worker_accept")) return Response.json(true);
    throw new Error(`Unexpected URL: ${url}`);
  });
  assert.deepEqual(await result.json(), { claimed: 1, accepted: 1, retry: 0, failed: 0 });
  assert.equal(calls.filter((call) => call.url === gmailEnv.GMAIL_SCRIPT_URL).length, 2);
});

test("an uncertain Gmail script response is never retried automatically", async () => {
  const calls = [];
  const result = await handleWorkerRequest(request(), gmailEnv, async (url, options) => {
    calls.push({ url, options });
    if (url === gmailEnv.GMAIL_SCRIPT_URL) {
      const body = JSON.parse(options.body);
      if (body.action === "check") return Response.json({ ready: true,
        senderEmail: gmailJob.senderEmail, recipientEmail: gmailJob.recipientEmail });
      throw new Error("connection lost after submission");
    }
    if (url.endsWith("/email_worker_claim")) return Response.json([gmailJob]);
    if (url.endsWith("/email_worker_fail")) return Response.json(true);
    throw new Error(`Unexpected URL: ${url}`);
  });
  assert.equal((await result.json()).failed, 1);
  const failure = calls.find((call) => call.url.endsWith("/email_worker_fail"));
  assert.equal(JSON.parse(failure.options.body).p_error_code, "GOOGLE_UNKNOWN_OUTCOME");
  assert.equal(JSON.parse(failure.options.body).p_permanent, true);
});

test("a changed shared recipient is blocked before calling the Gmail script send action", async () => {
  const calls = [];
  const result = await handleWorkerRequest(request(), gmailEnv, async (url, options) => {
    calls.push({ url, options });
    if (url === gmailEnv.GMAIL_SCRIPT_URL) {
      const body = JSON.parse(options.body);
      assert.equal(body.action, "check");
      return Response.json({ ready: true, senderEmail: gmailJob.senderEmail,
        recipientEmail: "other@example.edu" });
    }
    if (url.endsWith("/email_worker_claim")) return Response.json([gmailJob]);
    if (url.endsWith("/email_worker_fail")) return Response.json(true);
    throw new Error(`Unexpected URL: ${url}`);
  });
  assert.equal((await result.json()).failed, 1);
  const failure = calls.find((call) => call.url.endsWith("/email_worker_fail"));
  assert.equal(JSON.parse(failure.options.body).p_error_code, "RECIPIENT_MISMATCH");
});
