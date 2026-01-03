"use client";

import { ScreenContainer } from "@/components/ui/screen-container";
import { CustomButton } from "@/components/ui/custom-button";
import { CustomInput } from "@/components/ui/custom-input";
import { signInAction, signInAsGuestAction } from "./actions";
import { useActionState } from "react";
import { UserCircle } from "lucide-react";

// Check environment variable
const GUEST_LOGIN_ENABLED = process.env.NEXT_PUBLIC_GUEST_LOGIN_ENABLED === "true";

export default function LoginScreen() {
  const [state, action, isPending] = useActionState(signInAction, null);

  return (
    <ScreenContainer className="items-center justify-center bg-[#E5F9F6]">
      <div className="flex flex-col items-center justify-center h-full px-8 w-full max-w-sm mx-auto">
        <h1
          className="text-4xl font-bold text-center mb-16 tracking-wider leading-relaxed text-[#2D2D2D]"
          style={{ textShadow: "2px 2px 4px rgba(0,0,0,0.1)" }}
        >
          実験用試薬
          <br />
          管理システム
        </h1>

        <form action={action} className="w-full space-y-8">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium ml-1 text-slate-700">
              ID
            </label>
            <CustomInput
              id="email"
              name="email"
              placeholder="Value"
              className="h-12 bg-white border border-slate-700 rounded-lg shadow-sm"
              style={{ borderRadius: "8px" }}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium ml-1 text-slate-700">
              パスワード
            </label>
            <CustomInput
              id="password"
              name="password"
              type="password"
              placeholder="Value"
              className="h-12 bg-white border border-slate-700 rounded-lg shadow-sm"
              style={{ borderRadius: "8px" }}
            />
          </div>
          {state?.error && (
            <p className="text-red-500 text-sm font-medium">{state.error}</p>
          )}

          <div className="mt-8 w-48 mx-auto relative">
            <CustomButton
              type="submit"
              className="w-full h-16 text-2xl font-bold bg-[#00897B] hover:bg-[#00796B] text-white rounded-xl shadow-lg transition-transform active:scale-95"
              disabled={isPending}
              style={{ borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -1px rgba(0, 0, 0, 0.1)" }}
            >
              {isPending ? "..." : "ログイン"}
            </CustomButton>
          </div>
        </form>

        {GUEST_LOGIN_ENABLED && (
          // @ts-expect-error: Server action return type causing mismatch with form action type
          <form action={signInAsGuestAction} className="w-full mt-8 flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="relative w-full flex items-center mb-6">
              <div className="flex-grow border-t border-slate-300"></div>
              <span className="flex-shrink-0 mx-4 text-slate-400 text-xs font-bold tracking-widest uppercase">または</span>
              <div className="flex-grow border-t border-slate-300"></div>
            </div>

            <CustomButton
              type="submit"
              variant="secondary"
              className="w-full h-12 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold border border-slate-200 rounded-xl transition-all"
            >
              <UserCircle className="w-5 h-5" />
              ゲストとしてログイン
            </CustomButton>
          </form>
        )}
      </div>
    </ScreenContainer>
  );
}
