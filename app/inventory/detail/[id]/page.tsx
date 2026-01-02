"use client";

import { ScreenContainer } from "@/components/ui/screen-container";
import { CustomButton } from "@/components/ui/custom-button";
import { ArrowLeft, Beaker, Download, History, Plus, Minus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface InventoryDetail {
    id: string;
    amount: number;
    room_id: string;
    solvent_id: string;
    rooms: { name: string } | null;
    solvents: {
        name: string;
        cas_number: string;
        formula: string | null;
        molecular_weight: string | null;
    } | null;
}

interface LogItem {
    id: string;
    change_amount: number;
    user_name: string;
    created_at: string;
}

export default function DetailScreen() {
    const params = useParams();
    const id = params?.id as string;

    const [detail, setDetail] = useState<InventoryDetail | null>(null);
    const [logs, setLogs] = useState<LogItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchAll = async () => {
            if (!id) return;
            setLoading(true);

            // 1. Fetch Detail
            try {
                const { data: detailData, error: detailError } = await supabase
                    .from('inventory')
                    .select(`
                        id,
                        amount,
                        room_id,
                        solvent_id,
                        rooms ( name ),
                        solvents ( name, cas_number, formula, molecular_weight )
                    `)
                    .eq('id', id)
                    .single();

                if (detailError) {
                    console.error("Detail Fetch Error:", detailError);
                    setDetail(null);
                } else {
                    setDetail(detailData as any);

                    // 2. Fetch Logs (Only if detail exists)
                    try {
                        const { data: logData, error: logError } = await supabase
                            .from('inventory_logs')
                            .select('*')
                            .eq('inventory_id', id)
                            .order('created_at', { ascending: false });

                        if (logError) {
                            console.error("Log Fetch Error:", logError);
                        } else {
                            setLogs(logData || []);
                        }
                    } catch (logErr) {
                        console.error("Log Fetch Exception:", logErr);
                    }
                }

            } catch (err) {
                console.error("Unexpected Error:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchAll();
    }, [id]);

    if (loading) {
        return (
            <ScreenContainer>
                <div className="flex items-center justify-center h-screen">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
                </div>
            </ScreenContainer>
        );
    }

    if (!detail) {
        return (
            <ScreenContainer>
                <div className="p-8 text-center text-slate-500">
                    データが見つかりませんでした。
                </div>
            </ScreenContainer>
        );
    }

    const { solvents, rooms } = detail;


    // Helper to format date
    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
    };

    return (
        <ScreenContainer>
            <header className="h-16 flex items-center px-4 border-b bg-white sticky top-0 z-10">
                <Link href="/inventory/list" className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors">
                    <ArrowLeft className="w-5 h-5 text-slate-600" />
                </Link>
                <div className="ml-2 flex-1 text-center pr-8">
                    <h1 className="text-sm text-slate-500">詳細情報</h1>
                </div>
            </header>

            <div className="flex-1 flex flex-col bg-slate-50/50 overflow-hidden">
                <div className="flex-1 overflow-y-auto pb-24">
                    {/* Hero Section */}
                    <div className="bg-white p-6 pb-8 border-b border-slate-200">
                        <div className="flex flex-col items-center">
                            <div className="p-4 bg-teal-50 rounded-full mb-4">
                                <Beaker className="w-12 h-12 text-teal-600" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-800 text-center mb-1">{solvents?.name}</h2>
                            <span className="text-sm font-mono bg-slate-100 px-2 py-1 rounded text-slate-600 mt-1">
                                {rooms?.name || "保管場所不明"}
                            </span>

                            {/* Prominent Amount Display */}
                            <div className="mt-6 mb-4 text-center">
                                <p className="text-xs text-slate-400 font-medium mb-1">現在量</p>
                                <p className="text-4xl font-bold text-teal-600 tracking-tight">
                                    {detail.amount} <span className="text-xl text-teal-500 ml-1">L</span>
                                </p>
                            </div>

                            {/* Properties Grid */}
                            <div className="grid grid-cols-3 w-full bg-slate-50 rounded-xl border border-slate-200 divide-x divide-slate-200 overflow-hidden">
                                <div className="p-3 text-center">
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">CAS番号</p>
                                    <p className="font-mono font-medium text-slate-700 text-xs sm:text-sm">{solvents?.cas_number}</p>
                                </div>
                                <div className="p-3 text-center">
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">分子式</p>
                                    <p className="font-mono font-medium text-slate-700 text-xs sm:text-sm">{solvents?.formula || "-"}</p>
                                </div>
                                <div className="p-3 text-center">
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">分子量</p>
                                    <p className="font-mono font-medium text-slate-700 text-xs sm:text-sm">{solvents?.molecular_weight || "-"}</p>
                                </div>
                            </div>

                            <button className="mt-6 flex items-center gap-2 text-xs text-[#00897B] font-medium hover:underline">
                                <Download className="w-3 h-3" />
                                SDS (PDF) をダウンロード
                            </button>
                        </div>
                    </div>

                    {/* History Section */}
                    <div className="p-4">
                        <div className="flex items-center gap-2 mb-3 px-2">
                            <History className="w-4 h-4 text-slate-500" />
                            <h3 className="font-bold text-slate-700 text-sm">入出庫履歴</h3>
                        </div>

                        {logs.length === 0 ? (
                            <div className="p-8 text-center text-sm text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">
                                履歴はまだありません
                            </div>
                        ) : (
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden text-sm">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wider">
                                        <tr>
                                            <th className="p-3 font-medium">日付</th>
                                            <th className="p-3 font-medium text-right">変動量</th>
                                            <th className="p-3 font-medium text-right">使用者</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {logs.map((row) => (
                                            <tr key={row.id} className="hover:bg-[#E0F2F1]/30">
                                                <td className="p-3 text-slate-600 font-mono text-xs">{formatDate(row.created_at)}</td>
                                                <td className={`p-3 text-right font-medium ${row.change_amount > 0 ? 'text-[#00897B]' : 'text-amber-600'}`}>
                                                    {row.change_amount > 0 ? '+' : ''} {row.change_amount} L
                                                </td>
                                                <td className="p-3 text-right text-slate-600">{row.user_name}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ScreenContainer>
    );
}
