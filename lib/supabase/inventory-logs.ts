import type { DataSet } from "@/lib/chemstock-ui";
import type { createClient } from "./client";

const LOG_BATCH_SIZE = 500;

export async function readAllInventoryLogs(client: ReturnType<typeof createClient>): Promise<DataSet["logs"]> {
  const logs: DataSet["logs"] = [];
  let lastId: string | null = null;

  while (true) {
    let query = client.from("inventory_logs")
      .select("id, inventory_id, change_amount, operator_name, purpose, status, occurred_at");
    if (lastId) query = query.gt("id", lastId);
    const result = await query.order("id", { ascending: true }).limit(LOG_BATCH_SIZE);
    if (result.error) throw result.error;
    if (!result.data) throw new Error("入出庫履歴の読み込みに失敗しました。");

    const page = result.data;
    logs.push(...page.map((log) => ({ ...log, change_amount: Number(log.change_amount) })) as DataSet["logs"]);
    if (page.length === 0) return logs;

    // Use the last returned ID even if the server caps this page below LOG_BATCH_SIZE.
    lastId = page[page.length - 1].id;
  }
}
