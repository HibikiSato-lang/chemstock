"use client";

// import { ScreenContainer } from "@/components/ui/screen-container";
// import { CustomButton } from "@/components/ui/custom-button";
// import { CustomInput } from "@/components/ui/custom-input";
// import { Search as SearchIcon, Home, FileText, Hash, MapPin } from "lucide-react";
// import Link from "next/link";
// import { useState } from "react";
// import { useSearchParams } from "next/navigation";

"use client";

import { ScreenContainer } from "@/components/ui/screen-container";
import { CustomButton } from "@/components/ui/custom-button";
import { CustomInput } from "@/components/ui/custom-input";
import { Search as SearchIcon, Home, FileText, Hash, MapPin, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SearchScreen() {
    const searchParams = useSearchParams();
    const mode = searchParams.get('mode') || 'view'; // 'view' or 'action'
    const [searchType, setSearchType] = useState<"name" | "cas" | "room">("name");
    const [query, setQuery] = useState("");
    const [showSuggestions, setShowSuggestions] = useState(false);

    // Candidates State
    const [candidates, setCandidates] = useState({
        room: [] as string[],
        name: [] as string[],
        cas: [] as string[]
    });

    // Load candidates on mount
    useEffect(() => {
        const fetchCandidates = async () => {
            const { data: rooms } = await supabase.from('rooms').select('name');
            const { data: solvents } = await supabase.from('solvents').select('name, cas_number');

            if (rooms && solvents) {
                // Unique values
                const roomNames = Array.from(new Set(rooms.map(r => r.name))).filter(Boolean);
                const solventNames = Array.from(new Set(solvents.map(s => s.name))).filter(Boolean);
                const casNumbers = Array.from(new Set(solvents.map(s => s.cas_number))).filter(Boolean);

                setCandidates({
                    room: roomNames,
                    name: solventNames,
                    cas: casNumbers
                });
            }
        };
        fetchCandidates();
    }, []);

    const headerTitle = mode === 'action' ? '在庫検索' : '在庫検索';
    const headerColor = mode === 'action' ? 'bg-[#E0F2F1] border-[#B2DFDB]' : 'bg-[#E1F5FE] border-[#B3E5FC]';

    const getPlaceholder = () => {
        switch (searchType) {
            case "name": return "メタノール";
            case "cas": return "67-56-1";
            case "room": return "D105";
            default: return "";
        }
    };

    const getHelperText = () => {
        switch (searchType) {
            case "name": return "試薬容器のラベルに記載されている名称を入力してください";
            case "cas": return "ハイフンなしで入力しても検索可能です (例: 67561)";
            case "room": return "部屋名を入力してください (例: D105)";
            default: return "";
        }
    };

    // Filter Logic
    const getSuggestions = () => {
        if (!query) return [];
        const q = query.toLowerCase();
        let list: string[] = [];

        if (searchType === 'room') list = candidates.room;
        else if (searchType === 'name') list = candidates.name;
        else if (searchType === 'cas') {
            // Special handling for CAS to ignore hyphens
            const cleanQ = q.replace(/-/g, '');
            return candidates.cas.filter(c => c.replace(/-/g, '').includes(cleanQ)).slice(0, 5);
        }

        return list.filter(item => item.toLowerCase().includes(q)).slice(0, 5);
    };

    const suggestions = getSuggestions();

    const handleSelect = (val: string) => {
        setQuery(val);
        setShowSuggestions(false);
    };

    return (
        <ScreenContainer>
            <header className={`h-16 flex items-center px-4 border-b ${headerColor} justify-between sticky top-0 z-10 bg-opacity-90 backdrop-blur`}>
                <h1 className="text-lg font-bold text-slate-800">{headerTitle}</h1>
                <Link href="/protected" className="p-2 hover:bg-black/5 rounded-full transition-colors">
                    <Home className="w-6 h-6 text-[#00695C]" />
                </Link>
            </header>

            <div className="flex-1 flex flex-col p-6 gap-8 bg-slate-50/30">
                <div className="max-w-md w-full mx-auto space-y-8 mt-8 relative">

                    {/* Search Type Selector */}
                    <div className="flex p-1 bg-slate-200 rounded-xl relative z-0">
                        <button
                            onClick={() => { setSearchType("room"); setQuery(""); setShowSuggestions(false); }}
                            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-lg transition-all duration-200 ${searchType === "room"
                                ? "bg-white text-slate-800 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                                }`}
                        >
                            <MapPin className="w-4 h-4" />
                            部屋名
                        </button>
                        <button
                            onClick={() => { setSearchType("name"); setQuery(""); setShowSuggestions(false); }}
                            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-lg transition-all duration-200 ${searchType === "name"
                                ? "bg-white text-slate-800 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                                }`}
                        >
                            <FileText className="w-4 h-4" />
                            溶媒名
                        </button>
                        <button
                            onClick={() => { setSearchType("cas"); setQuery(""); setShowSuggestions(false); }}
                            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-lg transition-all duration-200 ${searchType === "cas"
                                ? "bg-white text-slate-800 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                                }`}
                        >
                            <Hash className="w-4 h-4" />
                            CAS番号
                        </button>
                    </div>

                    {/* Search Input Area */}
                    <div className="space-y-4 relative z-20">
                        <div className="relative group">
                            <CustomInput
                                placeholder={getPlaceholder()}
                                value={query}
                                onChange={(e) => {
                                    setQuery(e.target.value);
                                    setShowSuggestions(true);
                                }}
                                onFocus={() => setShowSuggestions(true)}
                                // Delay blur to allow click on suggestion
                                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                className="h-14 pl-5 pr-12 text-lg rounded-xl border-slate-200 shadow-sm focus:ring-2 focus:ring-teal-500 transition-all bg-white"
                            />
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                                <SearchIcon className="w-6 h-6" />
                            </div>

                            {/* Suggestions Dropdown */}
                            {showSuggestions && suggestions.length > 0 && (
                                <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                                    {suggestions.map((suggestion, idx) => (
                                        <button
                                            key={idx}
                                            className="w-full text-left px-5 py-3 hover:bg-teal-50 text-slate-700 flex justify-between items-center group transition-colors border-b border-slate-50 last:border-0"
                                            onClick={() => handleSelect(suggestion)}
                                        >
                                            <span className="font-medium">{suggestion}</span>
                                            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-teal-500" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <p className="text-xs text-slate-400 px-2 text-center">
                            {getHelperText()}
                        </p>
                    </div>

                    {/* Action Button */}
                    <div className="pt-4 z-0">
                        <Link href={`/inventory/list?type=${searchType}&q=${encodeURIComponent(query)}`}>
                            <CustomButton className={`w-full h-14 text-lg font-bold shadow-lg shadow-teal-500/20 active:scale-[0.98] transition-all transform ${mode === 'action' ? 'bg-[#00897B] hover:bg-[#00796B]' : 'bg-[#039BE5] hover:bg-[#0288D1]'}`}>
                                在庫状況を表示
                            </CustomButton>
                        </Link>
                    </div>

                </div>
            </div>
        </ScreenContainer>
    );
}
