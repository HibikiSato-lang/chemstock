import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Resolve the pre-issued account ID privately; expose only success/failure. */
export async function signInWithAccountId(loginId: string, password: string): Promise<boolean> {
  try {
    if (typeof loginId !== "string" || !loginId.trim() || typeof password !== "string" || !password) return false;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !serviceKey || !publishableKey) return false;

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: account, error: lookupError } = await admin.from("accounts").select("id").eq("login_id", loginId.trim()).maybeSingle();
    if (lookupError || !account || typeof account.id !== "string" || !account.id) return false;
    const { data: authUser, error: userError } = await admin.auth.admin.getUserById(account.id);
    if (userError || !authUser?.user || authUser.user.id !== account.id || !authUser.user.email) return false;

    // An isolated jar prevents initialization/refresh of a previous account's
    // session. SDK auth events may write here, but cannot touch response cookies.
    const cookieName = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
    const pending = new Map<string, { name: string; value: string; options: CookieOptions }>();
    const client = createServerClient(url, publishableKey, {
      cookieOptions: { name: cookieName },
      auth: { storageKey: cookieName },
      cookies: {
        getAll: () => [...pending.values()].map(({ name, value }) => ({ name, value })),
        setAll: (values) => {
          for (const value of values) pending.set(value.name, { ...value, options: { ...value.options } });
        },
      },
    });
    // Finish constructor initialization before sign-in so INITIAL_SESSION
    // recovery cannot race the newly authenticated account's storage.
    const initialized = await client.auth.initialize();
    if (initialized.error) return false;
    const { data, error } = await client.auth.signInWithPassword({ email: authUser.user.email, password });
    if (error || data?.user?.id !== account.id || data?.session?.user?.id !== account.id || !data.session.access_token || !data.session.refresh_token) return false;
    const isSessionCookie = (name: string) => name === cookieName || (name.startsWith(cookieName + ".") && /^\d+$/.test(name.slice(cookieName.length + 1)));
    if (![...pending.values()].some(({ name, value }) => isSessionCookie(name) && value)) return false;

    const store = await cookies();
    // The isolated jar could not see old chunks. Expire only obsolete chunks for
    // this project's auth cookie, after UUID verification has succeeded.
    const obsolete = store.getAll().filter(({ name }) => isSessionCookie(name) && !pending.has(name));
    for (const { name } of obsolete) store.set(name, "", { path: "/", maxAge: 0 });
    for (const { name, value, options } of pending.values()) store.set(name, value, options);
    return true;
  } catch {
    // Never return or log IDs, passwords, Auth emails, keys or upstream errors.
    return false;
  }
}
