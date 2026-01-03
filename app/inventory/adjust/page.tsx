"use client";

import { ScreenContainer } from "@/components/ui/screen-container";
import { CustomButton } from "@/components/ui/custom-button";
import { CustomInput } from "@/components/ui/custom-input";
import { Home, Tag, CheckSquare, Square } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AdjustInventoryScreen() {
    const router = useRouter();
    // specific types for our data
    type Item = { id: string; name: string };

    const [selectedRoom, setSelectedRoom] = useState<Item | null>(null);
    const [selectedSolvent, setSelectedSolvent] = useState<Item | null>(null);
    const [amount, setAmount] = useState<string>("0");
    const [actionType, setActionType] = useState<"add" | "use">("add");
    const [roomQuery, setRoomQuery] = useState("");
    const [solventQuery, setSolventQuery] = useState("");
    const [showRoomList, setShowRoomList] = useState(false);
    const [showSolventList, setShowSolventList] = useState(false);

    // Dynamic Options from DB
    const [rooms, setRooms] = useState<Item[]>([]);
    const [solvents, setSolvents] = useState<Item[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            // Fetch Rooms
            const { data: roomData } = await supabase.from('rooms').select('id, name').order('name');
            if (roomData) {
                setRooms(roomData);
            }

            // Fetch Solvents
            const { data: solventData } = await supabase.from('solvents').select('id, name').order('name');
            if (solventData) {
                setSolvents(solventData);
            }
        };
        fetchData();
    }, []);

    const adjustAmount = (delta: number) => {
        const current = parseFloat(amount) || 0;
        const next = Math.max(0, current + delta);
        // Round to 1 decimal place to avoid floating point errors
        setAmount(String(Math.round(next * 10) / 10));
    };

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        // Allow empty string or valid float format
        if (val === "" || /^\d*\.?\d*$/.test(val)) {
            setAmount(val);
        }
    };

    const handleConfirm = () => {
        // Build query params
        const params = new URLSearchParams();
        if (selectedRoom) {
            params.set("roomId", selectedRoom.id);
            params.set("roomName", selectedRoom.name);
        }
        if (selectedSolvent) {
            params.set("solventId", selectedSolvent.id);
            params.set("solventName", selectedSolvent.name);
        }
        params.set("amount", amount);

        // Navigate to /inventory/action/add or /inventory/action/use
        router.push(`/inventory/action/${actionType}?${params.toString()}`);
    };

    return (
        <ScreenContainer>
            {/* Header */}
            <header className="flex items-center justify-between px-6 pt-6 pb-2">
                <h1 className="text-3xl font-bold tracking-wider text-slate-800" style={{ textShadow: "1px 1px 2px rgba(0,0,0,0.1)" }}>
                    残量調整
                </h1>
                <Link href="/protected">
                    <Home className="w-8 h-8 text-black" />
                </Link>
            </header>

            <div className="flex-1 flex flex-col px-6 pb-8 space-y-8 overflow-y-auto">

                {/* Room Selection */}
                <div className="space-y-3">
                    <h2 className="text-xl font-bold text-black flex items-center">
                        <span className="inline-block w-4 h-4 rounded-full border-2 border-black mr-2"></span>
                        部屋選択
                    </h2>
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="部屋を選択..."
                            value={roomQuery}
                            onChange={(e) => {
                                setRoomQuery(e.target.value);
                                setShowRoomList(true);
                            }}
                            onFocus={() => setShowRoomList(true)}
                            onBlur={() => setTimeout(() => setShowRoomList(false), 200)}
                            className="w-full border-2 border-[#1E88E5] rounded-md p-3 text-black bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1E88E5] shadow-sm"
                        />
                        {showRoomList && (
                            <div className="absolute z-10 w-full mt-1 bg-white rounded-lg shadow-xl border border-slate-200 max-h-60 overflow-y-auto">
                                {rooms.filter(room => room.name.includes(roomQuery)).length > 0 ? (
                                    rooms.filter(room => room.name.includes(roomQuery)).map((room) => (
                                        <button
                                            key={room.id}
                                            onClick={() => {
                                                setSelectedRoom(room);
                                                setRoomQuery(room.name);
                                                setShowRoomList(false);
                                            }}
                                            className={`flex items-center w-full text-left p-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors ${selectedRoom?.id === room.id ? "bg-teal-50 text-teal-700 font-bold" : "text-gray-700"}`}
                                        >
                                            <Tag className="w-4 h-4 mr-3 rotate-90 text-slate-400" />
                                            <span>{room.name}</span>
                                        </button>
                                    ))
                                ) : (
                                    <div className="p-4 text-center text-sm text-slate-400">
                                        候補が見つかりません
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Solvent Selection */}
                <div className="space-y-3">
                    <h2 className="text-xl font-bold text-black flex items-center">
                        <span className="inline-block w-4 h-4 rounded-full border-2 border-black mr-2"></span>
                        溶媒選択
                    </h2>
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="溶媒を選択..."
                            value={solventQuery}
                            onChange={(e) => {
                                setSolventQuery(e.target.value);
                                setShowSolventList(true);
                            }}
                            onFocus={() => setShowSolventList(true)}
                            onBlur={() => setTimeout(() => setShowSolventList(false), 200)}
                            className="w-full border-2 border-[#1E88E5] rounded-md p-3 text-black bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1E88E5] shadow-sm"
                        />
                        {showSolventList && (
                            <div className="absolute z-10 w-full mt-1 bg-white rounded-lg shadow-xl border border-slate-200 max-h-60 overflow-y-auto">
                                {solvents.filter(s => s.name.includes(solventQuery)).length > 0 ? (
                                    solvents.filter(s => s.name.includes(solventQuery)).map((solvent) => (
                                        <button
                                            key={solvent.id}
                                            onClick={() => {
                                                setSelectedSolvent(solvent);
                                                setSolventQuery(solvent.name);
                                                setShowSolventList(false);
                                            }}
                                            className={`flex items-center w-full text-left p-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors ${selectedSolvent?.id === solvent.id ? "bg-teal-50 text-teal-700 font-bold" : "text-gray-700"}`}
                                        >
                                            <Tag className="w-4 h-4 mr-3 rotate-90 text-slate-400" />
                                            <span>{solvent.name}</span>
                                        </button>
                                    ))
                                ) : (
                                    <div className="p-4 text-center text-sm text-slate-400">
                                        候補が見つかりません
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Amount Adjustment */}
                <div className="space-y-4">
                    <h2 className="text-xl font-bold text-black border-b border-black inline-block pb-1">
                        残量調整
                    </h2>

                    <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col gap-2">
                            <button
                                onClick={() => adjustAmount(-3.8)}
                                className="bg-[#F0F4C3] hover:bg-[#E6EE9C] text-black text-sm font-bold py-2 px-4 rounded-full shadow-sm"
                            >
                                − 1 gal
                            </button>
                            <button
                                onClick={() => adjustAmount(-18)}
                                className="bg-[#F0F4C3] hover:bg-[#E6EE9C] text-black text-sm font-bold py-2 px-4 rounded-full shadow-sm"
                            >
                                − 1 斗缶
                            </button>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="relative">
                                {/* Blue border container as per request (blue frame) */}
                                <div className="border-4 border-[#1E88E5] rounded-xl p-1 bg-white shadow-sm">
                                    <input
                                        type="text"
                                        value={amount}
                                        onChange={handleAmountChange}
                                        className="w-32 h-14 text-center text-3xl font-bold border-none outline-none focus:ring-0 text-black bg-white"
                                    />
                                </div>
                            </div>
                            <span className="text-2xl font-bold text-black">L</span>
                        </div>

                        <div className="flex flex-col gap-2">
                            <button
                                onClick={() => adjustAmount(3.8)}
                                className="bg-[#AED581] hover:bg-[#9CCC65] text-black text-sm font-bold py-2 px-4 rounded-full shadow-sm"
                            >
                                + 1 gal
                            </button>
                            <button
                                onClick={() => adjustAmount(18)}
                                className="bg-[#AED581] hover:bg-[#9CCC65] text-black text-sm font-bold py-2 px-4 rounded-full shadow-sm"
                            >
                                + 1 斗缶
                            </button>
                        </div>
                    </div>
                </div>

                {/* Action Type */}
                <div className="flex items-center justify-center gap-8 pt-4 mx-auto w-fit">
                    <button
                        onClick={() => setActionType("add")}
                        className="flex items-center gap-2 text-xl font-bold text-black"
                    >
                        <div className={`w-8 h-8 rounded flex items-center justify-center border-2 ${actionType === "add" ? "bg-[#7E57C2] border-[#7E57C2]" : "border-slate-400 bg-white"}`}>
                            {actionType === "add" && <CheckSquare className="w-6 h-6 text-white" />}
                        </div>
                        追加する
                    </button>

                    <button
                        onClick={() => setActionType("use")}
                        className="flex items-center gap-2 text-xl font-bold text-black"
                    >
                        <div className={`w-8 h-8 rounded flex items-center justify-center border-2 ${actionType === "use" ? "bg-[#7E57C2] border-[#7E57C2]" : "border-slate-400 bg-white"}`}>
                            {actionType === "use" && <CheckSquare className="w-6 h-6 text-white" />}
                        </div>
                        使用する
                    </button>
                </div>

                {/* Footer Actions */}
                <div className="flex items-center justify-between pt-8 pb-4">
                    <button
                        onClick={() => setAmount("0")}
                        className="text-lg font-medium hover:opacity-70 text-black"
                    >
                        リセット
                    </button>
                    <CustomButton
                        onClick={handleConfirm}
                        className="w-40 bg-[#26897D] hover:bg-[#207a6f] text-white font-bold text-lg rounded-md shadow-md"
                    >
                        確認画面へ
                    </CustomButton>
                </div>
            </div>
        </ScreenContainer>
    );
}
