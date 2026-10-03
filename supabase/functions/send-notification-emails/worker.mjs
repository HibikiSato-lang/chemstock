const jsonHeaders = { "content-type": "application/json" };

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function sameSecret(actual, expected) {
  if (!actual || !expected) return false;
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < Math.max(actual.length, expected.length); index++) {
    difference |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function configured(env) {
  const required = ["EMAIL_WORKER_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "CHEMSTOCK_APP_URL"];
  const provider = env.EMAIL_PROVIDER || "microsoft_graph";
  if (provider === "microsoft_graph") {
    required.push("M365_TENANT_ID", "M365_CLIENT_ID", "M365_CLIENT_SECRET", "M365_SENDER");
  } else if (provider === "gmail_apps_script") {
    required.push("GMAIL_SCRIPT_URL", "GMAIL_SCRIPT_TOKEN", "GMAIL_SENDER");
  } else {
    return false;
  }
  if (required.some((name) => !env[name]) || env.EMAIL_WORKER_TOKEN.length < 32) return false;
  try {
    const appUrl = new URL(env.CHEMSTOCK_APP_URL);
    const supabaseUrl = new URL(env.SUPABASE_URL);
    if (appUrl.protocol !== "https:" || supabaseUrl.protocol !== "https:") return false;
    if (provider === "gmail_apps_script") {
      const scriptUrl = new URL(env.GMAIL_SCRIPT_URL);
      return scriptUrl.protocol === "https:" && scriptUrl.hostname === "script.google.com" &&
        /^\/macros\/s\/[^/]+\/exec$/.test(scriptUrl.pathname) &&
        env.GMAIL_SCRIPT_TOKEN.length >= 32;
    }
    return true;
  } catch {
    return false;
  }
}

async function post(fetchImpl, url, headers, body, timeoutMs = 10000) {
  return fetchImpl(url, {
    method: "POST", headers, body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function graphToken(fetchImpl, env) {
  const form = new URLSearchParams({
    client_id: env.M365_CLIENT_ID,
    client_secret: env.M365_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const tokenResponse = await post(fetchImpl,
    `https://login.microsoftonline.com/${encodeURIComponent(env.M365_TENANT_ID)}/oauth2/v2.0/token`,
    { "content-type": "application/x-www-form-urlencoded" }, form);
  if (!tokenResponse.ok) throw new Error("GRAPH_TOKEN_REJECTED");
  const token = (await tokenResponse.json()).access_token;
  if (typeof token !== "string" || !token) throw new Error("GRAPH_TOKEN_MISSING");
  return token;
}

async function rpc(fetchImpl, env, name, args) {
  const result = await post(fetchImpl,
    `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${name}`,
    { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json" }, JSON.stringify(args));
  if (!result.ok) throw new Error(`DATABASE_${name.toUpperCase()}_FAILED`);
  return result.json();
}

async function googleScriptRequest(fetchImpl, env, payload) {
  const result = await post(fetchImpl, env.GMAIL_SCRIPT_URL,
    { "content-type": "application/json" },
    JSON.stringify({ ...payload, token: env.GMAIL_SCRIPT_TOKEN }), 20000);
  if (!result.ok) throw new Error("GOOGLE_SCRIPT_HTTP_ERROR");
  return result.json();
}

export function messageFor(job, appUrl) {
  const ratio = Number(job.eventRatio);
  if (!Number.isFinite(ratio) || ratio < 1 || !Number.isFinite(Date.parse(job.eventAt))) {
    throw new Error("INVALID_EVENT");
  }
  return {
    message: {
      subject: "[ChemStock] 指定数量の合算倍率が1.0以上になりました",
      body: { contentType: "Text", content: [
        "指定数量の合算倍率が1.0以上になりました。",
        `発生時点の倍率: ${ratio.toFixed(3)} 倍`,
        `発生日時: ${new Date(job.eventAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} JST`,
        `通知ID: ${job.notificationId}`,
        "最新の状況は管理者画面で確認してください。",
        new URL("/manage/admin/notifications", appUrl).toString(),
      ].join("\n") },
      toRecipients: [{ emailAddress: { address: job.recipientEmail } }],
    },
  };
}

export async function handleWorkerRequest(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return response(405, { error: "METHOD_NOT_ALLOWED" });
  if (!sameSecret(request.headers.get("x-worker-token"), env.EMAIL_WORKER_TOKEN)) {
    return response(401, { error: "UNAUTHORIZED" });
  }
  if (!configured(env)) return response(503, { error: "WORKER_NOT_CONFIGURED" });

  const provider = env.EMAIL_PROVIDER || "microsoft_graph";
  let token;
  let scriptStatus;
  try {
    if (provider === "microsoft_graph") token = await graphToken(fetchImpl, env);
    else {
      scriptStatus = await googleScriptRequest(fetchImpl, env, { action: "check" });
      if (scriptStatus.ready !== true ||
          scriptStatus.senderEmail?.toLowerCase() !== env.GMAIL_SENDER.toLowerCase()) {
        throw new Error("GOOGLE_SCRIPT_NOT_READY");
      }
    }
  } catch {
    return response(503, { error: "MAIL_PROVIDER_UNAVAILABLE" });
  }

  let jobs;
  try {
    jobs = await rpc(fetchImpl, env, "email_worker_claim", { p_limit: 3 });
    if (!Array.isArray(jobs)) throw new Error("INVALID_CLAIM_RESULT");
  } catch {
    return response(503, { error: "DATABASE_UNAVAILABLE" });
  }

  const result = { claimed: jobs.length, accepted: 0, retry: 0, failed: 0 };
  for (const job of jobs) {
    let errorCode = provider === "microsoft_graph" ? "GRAPH_UNKNOWN_OUTCOME" : "GOOGLE_UNKNOWN_OUTCOME";
    let retry = false;
    try {
      if (typeof job.senderEmail !== "string" ||
          job.senderEmail.toLowerCase() !==
            (provider === "microsoft_graph" ? env.M365_SENDER : env.GMAIL_SENDER).toLowerCase()) {
        throw new Error("SENDER_MISMATCH");
      }
      let accepted = false;
      if (provider === "microsoft_graph") {
        const mail = messageFor(job, env.CHEMSTOCK_APP_URL);
        const sent = await post(fetchImpl,
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.M365_SENDER)}/sendMail`,
          { authorization: `Bearer ${token}`, "content-type": "application/json" },
          JSON.stringify(mail));
        accepted = sent.status === 202;
        if (!accepted) {
          errorCode = sent.status === 429 ? "GRAPH_RATE_LIMITED" :
            sent.status >= 500 ? "GRAPH_AMBIGUOUS_RESPONSE" : "GRAPH_REJECTED";
          retry = sent.status === 429;
        }
      } else {
        if (scriptStatus.recipientEmail?.toLowerCase() !== job.recipientEmail?.toLowerCase()) {
          throw new Error("RECIPIENT_MISMATCH");
        }
        const sent = await googleScriptRequest(fetchImpl, env, {
          action: "send", deliveryId: job.id, notificationId: job.notificationId,
          senderEmail: job.senderEmail, recipientEmail: job.recipientEmail,
          eventRatio: job.eventRatio, eventAt: job.eventAt,
        });
        accepted = sent.accepted === true &&
          sent.senderEmail?.toLowerCase() === job.senderEmail.toLowerCase() &&
          sent.recipientEmail?.toLowerCase() === job.recipientEmail.toLowerCase();
        if (!accepted) errorCode = "GOOGLE_SCRIPT_REJECTED";
      }
      if (accepted) {
        const recorded = await rpc(fetchImpl, env, "email_worker_accept", {
          p_delivery_id: job.id,
          p_lease_token: job.leaseToken,
          p_provider_message_id: null,
        });
        if (recorded !== true) throw new Error("DATABASE_ACCEPT_REJECTED");
        result.accepted++;
        continue;
      }
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_EVENT") errorCode = "INVALID_EVENT";
      else if (error instanceof Error && error.message === "SENDER_MISMATCH") errorCode = "SENDER_MISMATCH";
      else if (error instanceof Error && error.message === "RECIPIENT_MISMATCH") errorCode = "RECIPIENT_MISMATCH";
      else if (error instanceof Error && error.message === "DATABASE_ACCEPT_REJECTED") {
        // The provider accepted the mail. Let the lease expire for manual review.
        result.failed++;
        continue;
      }
    }
    try {
      const recorded = await rpc(fetchImpl, env, "email_worker_fail", {
        p_delivery_id: job.id, p_lease_token: job.leaseToken,
        p_error_code: errorCode, p_permanent: !retry,
      });
      if (recorded !== true) throw new Error("DATABASE_FAIL_REJECTED");
      if (retry) result.retry++;
      else result.failed++;
    } catch {
      // The lease expiry moves an unrecorded send outcome to manual review.
      result.failed++;
    }
  }
  return response(200, result);
}
