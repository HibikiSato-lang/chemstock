"use client";

import { ScreenContainer } from "@/components/ui/screen-container";
import { CustomButton } from "@/components/ui/custom-button";
import { ArrowLeft, Beaker, ChevronRight, Home } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useEffect, useState, Suspense } from "react";

// Define strict types for the fetched data
interface InventoryData {
    id: string;
    amount: number;
    rooms: { name: string } | null;
    solvents: { name: string; cas_number: string } | null;
}

interface DisplayItem {
    id: string;
    name: string;
    amount: string;
    cas: string;
    location: string;
}

export default function InventoryListScreen() {
    return (
        <Suspense fallback={<ScreenContainer><div className="flex-1 flex items-center justify-center">読み込み中...</div></ScreenContainer>}>
            <InventoryListScreenContent />
        </Suspense>
    );
}

function InventoryListScreenContent() {
    const searchParams = useSearchParams();
    const type = searchParams.get("type");
    const query = searchParams.get("q") || "";

    const [inventory, setInventory] = useState<DisplayItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchInventory = async () => {
            setLoading(true);
            try {
                // Fetch all inventory with joined room and solvent data
                const { data, error } = await supabase
                    .from('inventory')
                    .select(`
                        id,
                        amount,
                        rooms ( name ),
                        solvents ( name, cas_number )
                    `);

                if (error) {
                    console.error("Error fetching inventory:", error);
                    return;
                }

                if (data) {
                    // Map and flatten the data for display
                    const mappedData: DisplayItem[] = (data as any[]).map((item) => ({
                        id: item.id,
                        name: item.solvents?.name || "Unknown",
                        amount: `${item.amount} L`,
                        cas: item.solvents?.cas_number || "-",
                        location: item.rooms?.name || "Unknown",
                    }));
                    setInventory(mappedData);
                }
            } catch (err) {
                console.error("Unexpected error:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchInventory();
    }, []);

    // Client-side filtering
    const filteredInventory = inventory.filter(item => {
        if (!query) return true;
        const q = query.toLowerCase();

        if (type === "room") {
            return item.location.toLowerCase().includes(q);
        } else if (type === "cas") {
            const cleanCas = item.cas.replace(/-/g, "");
            const cleanQuery = q.replace(/-/g, "");
            return cleanCas.includes(cleanQuery);
        } else {
            return item.name.toLowerCase().includes(q);
        }
    });

    return (
        <ScreenContainer>
            <header className="h-16 flex items-center px-4 border-b bg-white sticky top-0 z-10 justify-between">
                <div className="flex items-center">
                    <Link href="/inventory" className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors">
                        <ArrowLeft className="w-5 h-5 text-slate-600" />
                    </Link>
                    <h1 className="ml-2 text-lg font-bold text-slate-800">在庫一覧</h1>
                </div>
                <Link href="/protected" className="p-2 hover:bg-black/5 rounded-full transition-colors">
                    <Home className="w-6 h-6 text-[#00695C]" />
                </Link>
            </header>

            <div className="flex-1 p-6">
                <div className="flex justify-center items-center mb-2 px-2">
                    <span className="text-xl font-bold text-[#00897B]">
                        {query ? `${query} の検索結果` : "全在庫"}
                    </span>
                </div>
                <div className="mb-4 px-2">
                    <span className="text-sm text-slate-500">
                        {loading ? "読み込み中..." : `検索結果: ${filteredInventory.length}件`}
                    </span>
                </div>

                <div className="space-y-3">
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00897B]"></div>
                        </div>
                    ) : (
                        filteredInventory.map((item) => (
                            <Link href={`/inventory/detail/${item.id}`} key={item.id} className="block group">
                                <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm group-hover:shadow-md group-hover:border-[#80CBC4] transition-all">
                                    <div className="flex justify-between items-start">
                                        <div className="flex gap-3">
                                            <div className="p-2 bg-[#E0F2F1] rounded-lg h-fit">
                                                <Beaker className="w-5 h-5 text-[#00897B]" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-800 group-hover:text-[#00695C] transition-colors">
                                                    {item.name}
                                                </h3>
                                                <p className="text-xs text-slate-400 mt-1">CAS: {item.cas}</p>
                                                <p className="text-xs text-slate-500 mt-0.5">{item.location}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <span className="block text-lg font-bold text-slate-700">
                                                {item.amount}
                                            </span>
                                            <span className="text-xs text-slate-400">残量</span>
                                        </div>
                                    </div>
                                    <div className="mt-3 pt-3 border-t border-slate-100 flex justify-end items-center text-xs text-[#00897B] font-medium">
                                        詳細を見る
                                        <ChevronRight className="w-4 h-4 ml-1" />
                                    </div>
                                </div>
                            </Link>
                        ))
                    )}
                </div>
            </div>
        </ScreenContainer>
    );
}
