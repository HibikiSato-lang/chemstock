"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function signInAction(prevState: any, formData: FormData) {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const supabase = await createClient();

    if (!email || !password) {
        return { error: "IDとパスワードを入力してください" };
    }

    const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) {
        return { error: "ログインに失敗しました: " + error.message };
    }

    return redirect("/protected"); // Fixed redirect to correct path
}

export async function signOutAction() {
    const supabase = await createClient();
    await supabase.auth.signOut();
    return redirect("/"); // Redirect to root (which is login page usually, or landing)
}
