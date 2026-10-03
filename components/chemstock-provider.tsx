"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readAllInventoryLogs } from "@/lib/supabase/inventory-logs";
import { AdminEmailStatus, AdminManagement, AdminOverview, AppSettings, DataSet, demoData, Forecast, Role } from "@/lib/chemstock-ui";

type ChemstockContextValue = {
  data: DataSet | null;
  loading: boolean;
  error: string;
  lastSyncedAt: string | null;
  refresh: () => void;
  preview: boolean;
  selectedRoomId: string;
  selectRoom: (id: string) => void;
  mutateDemo: (change: (data: DataSet) => DataSet) => void;
  runCommand: (operation: "movement" | "cancel" | "correct" | "threshold" | "deactivate", targetId: string, payload: Record<string, unknown>) => Promise<void>;
  runNotificationCommand: (notificationId: string, payload: { status: "acknowledged" | "resolved"; operatorName: string; reason: string | null }) => Promise<void>;
  runActivateRoomSolvent: (roomId: string, solventId: string, operatorName: string, reason: string) => Promise<void>;
  runAdminManagementCommand: (operation: "create_solvent" | "update_designated" | "update_setting", targetId: string | null, payload: Record<string, unknown>) => Promise<void>;
  setPreviewRole: (role: Role) => void;
  href: (path: string) => string;
};

const ChemstockContext = createContext<ChemstockContextValue | null>(null);
const DEMO_KEY = "chemstock-screen-preview-v1";
const PENDING_KEY = "chemstock-pending-commands-v1";

function pendingKeyFor(signature: string) {
  let stored: Record<string, string> = {};
  try { stored = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "{}"); } catch { /* ignore a broken draft */ }
  const key = stored[signature] || crypto.randomUUID();
  stored[signature] = key;
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(stored));
  return key;
}

function clearPendingKey(signature: string) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "{}") as Record<string, string>;
    delete stored[signature];
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(stored));
  } catch { sessionStorage.removeItem(PENDING_KEY); }
}

export function ChemstockProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const preview = pathname.startsWith("/preview");
  const outsideDashboard = pathname === "/" || pathname.startsWith("/auth");
  const fetchRoute = preview ? "/preview" : pathname;
  const [data, setData] = useState<DataSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const dataRef = useRef<DataSet | null>(null);

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => {
    if (preview || outsideDashboard) return;
    const onFocus = () => setReloadVersion((version) => version + 1);
    const onVisibility = () => { if (document.visibilityState === "visible") onFocus(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [preview, outsideDashboard]);

  const refresh = useCallback(() => setReloadVersion((version) => version + 1), []);

  useEffect(() => {
    if (preview) {
      try {
        const saved = localStorage.getItem(DEMO_KEY);
        const stored = saved ? JSON.parse(saved) as DataSet : demoData;
        const next = { ...stored, audits: Array.isArray(stored.audits) ? stored.audits : [], settings: stored.settings || demoData.settings, forecasts: Array.isArray(stored.forecasts) ? stored.forecasts : [] };
        setData(next);
        setSelectedRoomId(next.account.room_id || next.rooms[0]?.id || "");
      } catch {
        setData(demoData);
        setSelectedRoomId(demoData.account.room_id || "");
      }
      setError("");
      setLoading(false);
      return;
    }
    if (outsideDashboard) return;
    let cancelled = false;
    async function fetchData() {
      if (!dataRef.current) setLoading(true);
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
        setError("Supabase の接続設定がありません。画面確認は /preview から行えます。");
        setData(null);
        setLoading(false);
        return;
      }
      try {
        const client = createClient();
        const auth = await client.auth.getUser();
        if (!auth.data.user) {
          router.replace("/auth/login");
          return;
        }
        const accountResult = await client.from("accounts").select("id, room_id, role, login_id").eq("id", auth.data.user.id).single();
        if (accountResult.error || !accountResult.data) throw new Error("アカウント情報を取得できません。基礎DBとアカウントを確認してください。");
        const [rooms, solvents, stocks, logs, settingsResult, forecastsResult] = await Promise.all([
          client.from("rooms").select("id, name").order("name"),
          client.from("solvents").select("id, name, cas_number, formula, molecular_weight").order("name"),
          client.from("inventory").select("id, room_id, solvent_id, amount, opening_amount, opened_at, low_stock_threshold, is_active, last_updated"),
          readAllInventoryLogs(client),
          client.rpc("app_settings"),
          client.rpc("inventory_forecasts"),
        ]);
        const problem = [rooms, solvents, stocks, settingsResult, forecastsResult].find((result) => result.error)?.error;
        if (problem) throw problem;
        const settings = settingsResult.data as AppSettings;
        if (!settings || !Number.isFinite(Number(settings.unitGalToL)) || !Number.isFinite(Number(settings.unitTokanToL)) || !Number.isInteger(Number(settings.forecastWindowDays))) {
          throw new Error("換算・予測設定を取得できません。もう一度読み込んでください。");
        }
        let adminOverview: AdminOverview | null = null;
        let adminEmailStatus: AdminEmailStatus | null = null;
        let adminManagement: AdminManagement | null = null;
        if (accountResult.data.role === "solvent_room_admin" || accountResult.data.role === "global_admin") {
          const [overview, emailStatus, management] = await Promise.all([
            client.rpc("admin_overview"), client.rpc("admin_email_status"), client.rpc("admin_management"),
          ]);
          if (overview.error) throw overview.error;
          if (management.error) throw management.error;
          adminOverview = overview.data as AdminOverview;
          adminManagement = management.data as AdminManagement;
          // The email migration is optional until the institution enables it.
          if (!emailStatus.error) adminEmailStatus = emailStatus.data as AdminEmailStatus;
        }
        if (cancelled) return;
        const next: DataSet = {
          account: accountResult.data as DataSet["account"],
          rooms: rooms.data || [],
          solvents: (solvents.data || []).map((solvent) => ({ ...solvent, designated_quantity: adminManagement?.solvents.find((item) => item.id === solvent.id)?.designatedQuantity ?? null })),
          stocks: (stocks.data || []).map((stock) => ({ ...stock, amount: Number(stock.amount), opening_amount: Number(stock.opening_amount), low_stock_threshold: stock.low_stock_threshold == null ? null : Number(stock.low_stock_threshold) })),
          logs,
          audits: [],
          notices: adminOverview?.notifications || [],
          settings: { unitGalToL: Number(settings.unitGalToL), unitTokanToL: Number(settings.unitTokanToL), forecastWindowDays: Number(settings.forecastWindowDays) },
          forecasts: (forecastsResult.data || []) as Forecast[],
          adminOverview,
          adminEmailStatus,
          adminManagement,
        };
        setData(next);
        setSelectedRoomId((current) => next.account.role === "global_admin" && next.rooms.some((room) => room.id === current)
          ? current : next.account.room_id || next.rooms[0]?.id || "");
        setError("");
        setLastSyncedAt(new Date().toISOString());
      } catch (cause) {
        if (!cancelled) { if (!dataRef.current) setData(null); setError(cause instanceof Error ? cause.message : "データの取得に失敗しました。"); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [preview, router, outsideDashboard, fetchRoute, reloadVersion]);

  useEffect(() => {
    if (preview && data) localStorage.setItem(DEMO_KEY, JSON.stringify(data));
  }, [preview, data]);

  const mutateDemo = useCallback((change: (data: DataSet) => DataSet) => {
    if (!preview) return;
    setData((current) => current ? change(current) : current);
  }, [preview]);

  const runCommand = useCallback(async (operation: "movement" | "cancel" | "correct" | "threshold" | "deactivate", targetId: string, payload: Record<string, unknown>) => {
    if (preview) throw new Error("画面確認用データにはDBのCommandを実行できません。");
    const signature = JSON.stringify([dataRef.current?.account.id, operation, targetId, payload]);
    const key = pendingKeyFor(signature);
    const client = createClient();
    const { error } = await client.rpc("inventory_command", {
      p_operation: operation,
      p_target_id: targetId,
      p_payload: payload,
      p_idempotency_key: key,
    });
    if (error) {
      const messages: Record<string, string> = {
        TARGET_NOT_FOUND: "対象が見つからないか、操作する権限がありません。",
        INSUFFICIENT_STOCK: "更新後の在庫が不足します。",
        INVALID_LOG_STATE: "この履歴は変更できません。",
        INACTIVE_INVENTORY: "利用停止中の在庫は変更できません。",
        INVALID_INVENTORY_STATE: "残量が0 Lの利用中在庫のみ停止できます。",
        VERSION_CONFLICT: "ほかの更新が反映されています。画面を読み込み直してください。",
        IDEMPOTENCY_KEY_REUSED: "再送キーが別の操作に使われました。",
      };
      throw new Error(messages[error.message] || error.message);
    }
    clearPendingKey(signature);
    setReloadVersion((version) => version + 1);
  }, [preview]);

  const runNotificationCommand = useCallback(async (notificationId: string, payload: { status: "acknowledged" | "resolved"; operatorName: string; reason: string | null }) => {
    if (preview) throw new Error("画面確認用データにはDBのCommandを実行できません。");
    const signature = JSON.stringify([dataRef.current?.account.id, "notification_status", notificationId, payload]);
    const key = pendingKeyFor(signature);
    const client = createClient();
    const { error } = await client.rpc("notification_command", {
      p_notification_id: notificationId,
      p_payload: payload,
      p_idempotency_key: key,
    });
    if (error) {
      const messages: Record<string, string> = {
        UNAUTHORIZED: "通知を変更する権限がありません。",
        TARGET_NOT_FOUND: "通知が見つかりません。",
        INVALID_NOTIFICATION_STATE: "通知の状態が変わっています。画面を読み込み直してください。",
      };
      throw new Error(messages[error.message] || error.message);
    }
    clearPendingKey(signature);
    setReloadVersion((version) => version + 1);
  }, [preview]);

  const runActivateRoomSolvent = useCallback(async (roomId: string, solventId: string, operatorName: string, reason: string) => {
    if (preview) throw new Error("画面確認用データにはDBのCommandを実行できません。");
    const signature = JSON.stringify([dataRef.current?.account.id, "activate_room_solvent", roomId, solventId, operatorName, reason]);
    const key = pendingKeyFor(signature);
    const { error } = await createClient().rpc("activate_room_solvent", { p_room_id: roomId, p_solvent_id: solventId, p_operator_name: operatorName, p_reason: reason, p_idempotency_key: key });
    if (error) {
      const messages: Record<string, string> = {
        ALREADY_ACTIVE: "すでに管理対象です。画面を更新してください。",
        TARGET_NOT_FOUND: "対象が見つからないか、操作する権限がありません。",
        INVALID_COMMAND: "入力内容を確認してください。",
        IDEMPOTENCY_KEY_REUSED: "再送キーが別の操作に使われました。",
      };
      throw new Error(messages[error.message] || error.message);
    }
    clearPendingKey(signature);
    setReloadVersion((version) => version + 1);
  }, [preview]);

  const runAdminManagementCommand = useCallback(async (operation: "create_solvent" | "update_designated" | "update_setting", targetId: string | null, payload: Record<string, unknown>) => {
    if (preview) throw new Error("画面確認用データにはDBのCommandを実行できません。");
    const signature = JSON.stringify([dataRef.current?.account.id, operation, targetId, payload]);
    const key = pendingKeyFor(signature);
    const { error } = await createClient().rpc("admin_management_command", { p_operation: operation, p_target_id: targetId, p_payload: payload, p_idempotency_key: key });
    if (error) {
      const messages: Record<string, string> = {
        UNAUTHORIZED: "この設定を変更する権限がありません。",
        TARGET_NOT_FOUND: "対象が見つかりません。画面を更新してください。",
        INVALID_COMMAND: "入力内容を確認してください。",
        INVALID_OPERATOR_OR_REASON: "実操作者名と理由を確認してください。",
        INVALID_SOLVENT: "溶媒名とCAS番号を確認してください。",
        INVALID_DESIGNATED_QUANTITY: "指定数量を確認してください。",
        INVALID_SETTING: "設定値を確認してください。",
        IDEMPOTENCY_KEY_REUSED: "再送キーが別の操作に使われました。",
      };
      throw new Error(messages[error.message] || (operation === "create_solvent" && error.code === "23505" ? "このCAS番号はすでに登録されています。" : error.message));
    }
    clearPendingKey(signature);
    setReloadVersion((version) => version + 1);
  }, [preview]);

  const selectRoom = useCallback((id: string) => {
    setSelectedRoomId(id);
    sessionStorage.removeItem("chemstock-adjust-draft");
  }, []);

  const setPreviewRole = useCallback((role: Role) => {
    mutateDemo((current) => ({ ...current, account: { ...current.account, role, room_id: role === "global_admin" ? null : "room-yamada" } }));
    setSelectedRoomId("room-yamada");
  }, [mutateDemo]);

  const value = useMemo(() => ({ data, loading, error, lastSyncedAt, refresh, preview, selectedRoomId, selectRoom, mutateDemo, runCommand, runNotificationCommand, runActivateRoomSolvent, runAdminManagementCommand, setPreviewRole, href: (path: string) => preview ? `/preview${path === "/protected" ? "" : path}` : path }), [data, loading, error, lastSyncedAt, refresh, preview, selectedRoomId, selectRoom, mutateDemo, runCommand, runNotificationCommand, runActivateRoomSolvent, runAdminManagementCommand, setPreviewRole]);
  return <ChemstockContext.Provider value={value}>{children}</ChemstockContext.Provider>;
}

export function useChemstock() {
  const value = useContext(ChemstockContext);
  if (!value) throw new Error("ChemstockProvider is missing");
  return value;
}
