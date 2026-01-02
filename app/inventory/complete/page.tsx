import { ScreenContainer } from "@/components/ui/screen-container";
import { CustomButton } from "@/components/ui/custom-button";
import { CheckCircle2, Home } from "lucide-react";
import Link from "next/link";

export default function CompleteScreen() {
    return (
        <ScreenContainer className="bg-teal-50/50">
            <div className="flex-1 flex flex-col justify-center items-center p-8 text-center animate-in fade-in duration-500">

                <div className="w-24 h-24 bg-teal-100 rounded-full flex items-center justify-center mb-8 shadow-sm">
                    <CheckCircle2 className="w-12 h-12 text-teal-600" />
                </div>

                <h1 className="text-2xl font-bold text-slate-800 mb-2">変更しました</h1>
                <p className="text-slate-500 mb-12">
                    在庫データの更新が完了しました。<br />
                    履歴に操作が記録されました。
                </p>

                <div className="w-full max-w-xs space-y-4">
                    <Link href="/protected" className="block w-full">
                        <CustomButton className="w-full h-14 bg-teal-600 hover:bg-teal-700 text-lg font-bold shadow-lg shadow-teal-500/20">
                            ホームに戻る
                        </CustomButton>
                    </Link>

                    <Link href="/inventory?mode=action" className="block w-full">
                        <button className="w-full py-4 text-teal-600 font-bold hover:bg-teal-50 rounded-xl transition-colors">
                            続けて操作する
                        </button>
                    </Link>
                </div>

            </div>
        </ScreenContainer>
    );
}
