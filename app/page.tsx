"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction } from "./actions";
import "./chemstock.css";

export default function LoginScreen() {
  const [state, action, isPending] = useActionState(signInAction, null);
  return <div className="cs-viewport"><main className="cs-screen cs-login"><div className="cs-login-panel"><h1>ChemStock</h1><p>研究室・溶媒庫の溶媒在庫管理</p><form action={action}><label className="cs-field">共有アカウントのメールアドレス<input name="email" type="email" autoComplete="username" required /></label><label className="cs-field">パスワード<input name="password" type="password" autoComplete="current-password" required /></label>{state?.error && <p className="cs-message" role="alert">{state.error}</p>}<button className="cs-button" type="submit" disabled={isPending}>{isPending ? "ログイン中…" : "ログイン"}</button></form><p className="cs-muted">研究室単位の共有アカウントです。各操作で実操作者名を入力します。</p><Link className="cs-inline-link" href="/preview">画面確認用データを開く</Link></div></main></div>;
}
