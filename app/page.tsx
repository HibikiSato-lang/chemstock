"use client";

import { ScreenContainer } from "@/components/ui/screen-container";
import { CustomButton } from "@/components/ui/custom-button";
import { CustomInput } from "@/components/ui/custom-input";
import { signInAction } from "./actions";
import { useActionState } from "react";

export default function LoginScreen() {
  const [state, action, isPending] = useActionState(signInAction, null);

  return (
    <ScreenContainer className="items-center justify-center bg-[#E5F9F6]">
      <form
        action={action}
        className="flex flex-col items-center justify-center h-full px-8 w-full max-w-sm"
      >
        <h1
          className="text-4xl font-bold text-center mb-16 tracking-wider leading-relaxed text-[#2D2D2D]"
          style={{ textShadow: "2px 2px 4px rgba(0,0,0,0.1)" }}
        >
          実験用試薬
          <br />
          管理システム
        </h1>

        <div className="w-full space-y-8">
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
        </div>

        <div className="mt-20 w-48 relative">
          <CustomButton
            type="submit"
            className="w-full h-16 text-2xl font-bold bg-[#00897B] hover:bg-[#00796B] text-white rounded-xl shadow-lg transition-transform active:scale-95"
            disabled={isPending}
            style={{ borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -1px rgba(0, 0, 0, 0.1)" }}
          >
            {isPending ? "..." : "ログイン"}
          </CustomButton>

          {/* Decorative line to simulate the diagram connector if needed, simplified for now */}
        </div>
      </form>
    </ScreenContainer>
  );
}
