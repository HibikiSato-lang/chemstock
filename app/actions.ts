"use server";

import { createClient } from "@/lib/supabase/server";
import { signInWithAccountId } from "@/lib/account-login";
import { redirect } from "next/navigation";

export async function signInAction(prevState: unknown, formData: FormData) {
    const rawLoginId = formData.get("login_id");
    const password = formData.get("password");
    if (typeof rawLoginId !== "string" || !rawLoginId.trim() || typeof password !== "string" || !password) {
        return { error: "アカウントIDとパスワードを入力してください" };
    }

    let signedIn = false;
    try {
        signedIn = await signInWithAccountId(rawLoginId.trim(), password);
    } catch {
        // Keep lookup and authentication failures indistinguishable to callers.
    }
    if (!signedIn) {
        return { error: "ログインできませんでした。IDとパスワードを確認してください。" };
    }

    return redirect("/protected");
}

export async function signInAsGuestAction() {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInAnonymously();

    if (error) {
        console.error("Guest login failed:", error);
        return { error: "ゲストログインに失敗しました: " + error.message };
    }

    return redirect("/protected");
}

export async function signOutAction() {
    const supabase = await createClient();
    await supabase.auth.signOut();
    return redirect("/"); // Redirect to root (which is login page usually, or landing)
}
