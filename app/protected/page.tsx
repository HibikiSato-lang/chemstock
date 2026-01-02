import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Beaker, Search, LogOut } from "lucide-react";
import { ScreenContainer } from "@/components/ui/screen-container";
import Link from "next/link";
import { signOutAction } from "../actions";

export default async function ProtectedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/auth/login");
  }

  return (
    <ScreenContainer>
      {/* Header */}
      <header className="flex h-16 items-center justify-between px-6 pt-4 pb-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-bold text-slate-800">ホーム</h1>
          <span className="text-xs text-slate-500">{user.email}</span>
        </div>
        <form action={signOutAction}>
          <button type="submit" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
            <LogOut className="w-3 h-3" />
            <span>ログアウト</span>
          </button>
        </form>
      </header>

      <div className="flex-1 flex flex-col items-center gap-6 px-6 pt-4 pb-8 overflow-y-auto">
        {/* Solvent Registration/Usage Card */}
        <Link href="/inventory/adjust" className="w-full max-w-sm group">
          <div className="bg-white rounded-[2rem] border-[3px] border-[#B2DFDB] p-8 flex flex-col items-center text-center shadow-sm group-hover:shadow-md transition-all h-full">
            <div className="bg-[#E0F2F1] p-6 rounded-full mb-6 group-hover:scale-110 transition-transform">
              <Beaker className="w-10 h-10 text-[#00897B]" strokeWidth={1.5} />
            </div>
            <h2 className="text-xl font-bold text-[#263238] mb-4">
              溶媒の登録・使用
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              新しい試薬を登録、<br />
              または使用量を記録します
            </p>
          </div>
        </Link>

        {/* Solvent Viewing Card */}
        <Link href="/inventory" className="w-full max-w-sm group">
          <div className="bg-white rounded-[2rem] border-[3px] border-[#B3E5FC] p-8 flex flex-col items-center text-center shadow-sm group-hover:shadow-md transition-all h-full">
            <div className="bg-[#E1F5FE] p-6 rounded-full mb-6 group-hover:scale-110 transition-transform">
              <Search className="w-10 h-10 text-[#039BE5]" strokeWidth={2} />
            </div>
            <h2 className="text-xl font-bold text-[#263238] mb-4">
              溶媒の在庫閲覧
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              現在の在庫状況を確認、<br />
              検索します
            </p>
          </div>
        </Link>
      </div>
    </ScreenContainer>
  );
}
