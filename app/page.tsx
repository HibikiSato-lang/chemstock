"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction } from "./actions";
import "./chemstock.css";

export default function LoginScreen() {
  const [state, action, isPending] = useActionState(signInAction, null);
  return (
    <div className="cs-viewport">
      <main className="cs-screen cs-login">
        <div className="cs-login-panel">
          <h1>ChemStock</h1>
          <p>研究室・溶媒庫の溶媒在庫管理</p>
          <form action={action}>
            <label className="cs-field">アカウントID<input name="login_id" type="text" placeholder="例: yamada_lab" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required /></label>
            <label className="cs-field">パスワード<input name="password" type="password" autoComplete="current-password" required /></label>
            {state?.error && <p className="cs-message" role="alert">{state.error}</p>}
            <button className="cs-button" type="submit" disabled={isPending}>{isPending ? "ログイン中…" : "ログイン"}</button>
          </form>
          <p className="cs-muted">事前に発行された共有アカウントを使います。</p>
          <details className="cs-login-help">
            <summary>ログインできないとき</summary>
            <p>ID・パスワードの確認や回復は、研究室の管理者へ依頼してください。</p>
          </details>
          <Link className="cs-inline-link" href="/preview">画面確認用データを開く</Link>
        </div>
      </main>
    </div>
  );
}
