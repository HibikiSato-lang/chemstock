"use client";

import { ScreenContainer } from "@/components/ui/screen-container";
import { CustomButton } from "@/components/ui/custom-button";
import { CustomInput } from "@/components/ui/custom-input";
import { ArrowLeft, Beaker, Check, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ActionScreen() {
    return (
        <Suspense fallback={<ScreenContainer><div className="flex-1 flex items-center justify-center">読み込み中...</div></ScreenContainer>}>
            <ActionScreenContent />
        </Suspense>
    );
}

function ActionScreenContent() {

    // In strict Next.js 14/15 Client Components, we should check how params are passed.
    // However, useParams() hook is the standard client-side way to access route params.
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();

    // Determine mode from URL path param [type]
    // params.type can be 'add' or 'use'
    const typeParam = params?.type;
    const mode = typeParam === 'add' ? 'add' : 'use';

    const isAdd = mode === 'add';
    const modeLabel = isAdd ? "追加" : "使用";

    // Theme Colors
    const themeColor = isAdd ? 'text-teal-600 bg-teal-50 border-teal-200' : 'text-amber-600 bg-amber-50 border-amber-200';
    const btnColor = isAdd ? 'bg-teal-600 hover:bg-teal-700' : 'bg-amber-600 hover:bg-amber-700';

    // Initialize state based on searchParams
    const initialAmount = searchParams.get("amount") || "";
    const roomId = searchParams.get("roomId");
    const solventId = searchParams.get("solventId");

    // Fallback names for display if ID fetch fails or while loading (though we pass names mostly for convenience)
    // Ideally we should rely on IDs for logic and pass Names for pure display to avoid extra fetches if possible,
    // but fetching Fresh data is safer.
    const roomName = searchParams.get("roomName") || "未選択";
    const solventName = searchParams.get("solventName") || "未選択";

    // If we have an initial amount, skip directly to confirmation
    const [step, setStep] = useState<"input" | "confirm">(initialAmount ? "confirm" : "input");
    const [amount, setAmount] = useState(initialAmount);

    const [currentAmount, setCurrentAmount] = useState<number>(0);
    const [inventoryId, setInventoryId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Fetch Current Amount
    useEffect(() => {
        const fetchCurrentAmount = async () => {
            if (!roomId || !solventId) return;
            const { data, error } = await supabase
                .from('inventory')
                .select('id, amount')
                .eq('room_id', roomId)
                .eq('solvent_id', solventId)
                .single();

            if (data) {
                setCurrentAmount(data.amount);
                setInventoryId(data.id);
            }
            if (error) {
                console.error("Error fetching amount:", error);
            }
        };
        fetchCurrentAmount();
    }, [roomId, solventId]);

    const handleConfirm = () => {
        if (!amount) return;
        setStep("confirm");
    };

    const handleExecute = async () => {
        if (!roomId || !solventId || !inventoryId) {
            alert("エラー: 部屋または溶媒が正しく選択されていません。");
            return;
        }

        setLoading(true);
        const changeVal = parseFloat(amount);
        const changeAmount = isAdd ? changeVal : -changeVal;
        const newAmount = Math.max(0, currentAmount + changeAmount);

        // Execute Update on Inventory
        const { error: updateError } = await supabase
            .from('inventory')
            .update({ amount: newAmount, last_updated: new Date().toISOString() })
            .eq('id', inventoryId);

        if (updateError) {
            console.error("Update error:", updateError);
            alert("更新に失敗しました。");
            setLoading(false);
            return;
        }

        // Insert Log
        const { data: { user } } = await supabase.auth.getUser();
        const userName = user?.email || "担当者";

        const { error: logError } = await supabase
            .from('inventory_logs')
            .insert({
                inventory_id: inventoryId,
                change_amount: changeAmount,
                user_name: userName // Use verified email or fallback
            });

        if (logError) {
            // Log error but don't stop the flow since inventory was updated (safest to warn but proceed)
            console.error("Log error:", logError);
        }

        router.push("/inventory/complete");
    };

    // Header Title Logic
    const headerTitle = step === 'confirm' ? `${modeLabel}確認` : `${modeLabel}数量の入力`;

    return (
        <ScreenContainer>
            <header className="h-16 flex items-center px-4 border-b bg-white sticky top-0 z-10">
                <button onClick={() => step === 'input' ? router.back() : setStep('input')} className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors">
                    <ArrowLeft className="w-5 h-5 text-slate-600" />
                </button>
                <h1 className="ml-2 text-lg font-bold text-slate-800">
                    {headerTitle}
                </h1>
            </header>

            <div className="flex-1 p-6 bg-slate-50/50 flex flex-col">
                <div className="flex-1 max-w-md w-full mx-auto flex flex-col justify-center">

                    {/* Info Card */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-8 text-center">
                        <span className="text-xs text-slate-400 font-mono mb-1 block">ID: {solventId?.slice(0, 8)}...</span>
                        <p className="text-sm text-slate-500 font-bold mb-1">{roomName}</p>
                        <h2 className="text-2xl font-bold text-slate-800 mb-4">{solventName}</h2>
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 rounded-full text-sm font-medium text-slate-600">
                            現在: {currentAmount} L
                        </div>
                    </div>

                    {step === 'input' ? (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-700 ml-1">
                                    {modeLabel}する量 (L)
                                </label>
                                <div className="relative">
                                    <CustomInput
                                        type="number"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        placeholder="0.0"
                                        className="h-16 text-2xl font-bold text-center tracking-widest pl-12 pr-12 rounded-xl border-slate-300 focus:border-teal-500 focus:ring-teal-500"
                                        autoFocus
                                    />
                                    <div className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400 font-bold">L</div>
                                </div>
                            </div>

                            <div className="p-4 bg-blue-50 text-blue-800 text-sm rounded-xl flex gap-3 items-start">
                                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                <p>
                                    正確な数値を入力してください。<br />
                                    <span className="text-xs opacity-75">※ 小数点第2位まで入力可能です</span>
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
                            <div className={`p-6 rounded-2xl border-2 text-center space-y-2 ${themeColor}`}>
                                <p className="text-sm font-bold opacity-70">{modeLabel}量</p>
                                <p className="text-4xl font-bold">{amount} L</p>
                            </div>

                            <div className="flex items-center justify-center p-4">
                                <ArrowLeft className="w-4 h-4 text-slate-300 -rotate-90" />
                            </div>

                            <div className="p-4 bg-white border border-slate-200 rounded-xl text-center">
                                <p className="text-sm text-slate-500 mb-1">変更後の推定在庫</p>
                                <p className="text-2xl font-bold text-slate-800">
                                    {isAdd
                                        ? (currentAmount + Number(amount)).toFixed(1)
                                        : Math.max(0, currentAmount - Number(amount)).toFixed(1)
                                    } L
                                </p>
                            </div>
                        </div>
                    )}

                </div>

                <div className="mt-8">
                    <CustomButton
                        onClick={step === 'input' ? handleConfirm : handleExecute}
                        disabled={!amount || loading}
                        className={`w-full h-14 text-lg font-bold shadow-lg transition-all transform active:scale-[0.98] ${btnColor} ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {loading ? '処理中...' : (step === 'input' ? '確認画面へ' : `${modeLabel}を確定する`)}
                    </CustomButton>
                </div>
            </div>
        </ScreenContainer>
    );
}
