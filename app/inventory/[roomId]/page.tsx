import { ScreenContainer } from "@/components/ui/screen-container";
import { CustomButton } from "@/components/ui/custom-button";
import { CustomInput } from "@/components/ui/custom-input";
import { Search, ArrowUpDown } from "lucide-react";
import Link from "next/link";

// Mock data for inventory
const inventoryData = [
    { name: "メタノール", amount: "50.5 L" },
    { name: "エタノール", amount: "30 L" },
    { name: "イソプロパノール", amount: "20 L" },
    { name: "アセトン", amount: "10 L" },
    { name: "トルエン", amount: "10 L" },
];

export default async function RoomInventoryScreen({
    params,
}: {
    params: Promise<{ roomId: string }>;
}) {
    const { roomId } = await params;

    // Map roomId to display name (mock logic)
    const roomName =
        roomId === "solvent"
            ? "溶媒庫"
            : roomId === "d105"
                ? "D105学生実験室"
                : roomId === "d106"
                    ? "D106学生実験室"
                    : roomId === "d201"
                        ? "D201共同利用化学実験室"
                        : "実験室";

    return (
        <ScreenContainer>
            <header className="h-16 border-b-2 border-black flex items-center px-4 bg-[hsl(163,70%,80%)]">
                <h1 className="text-2xl font-bold">在庫閲覧</h1>
            </header>

            <div className="flex-1 flex flex-col p-6 gap-6">
                <h2 className="text-2xl font-bold text-center">{roomName}</h2>

                {/* Search and Sort Controls */}
                <div className="flex gap-4 items-center">
                    <button className="p-2 border border-black bg-white rounded hover:bg-gray-50">
                        <ArrowUpDown className="w-5 h-5" />
                    </button>
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <CustomInput
                            placeholder="検索"
                            className="h-10 pl-9 rounded-full border-none shadow-sm"
                        />
                    </div>
                </div>

                {/* Inventory Table */}
                <div className="border border-black rounded overflow-hidden">
                    <div className="grid grid-cols-2 bg-[#D9D9D9] border-b border-black text-center font-medium py-2">
                        <div className="border-r border-black">溶媒名</div>
                        <div>残量</div>
                    </div>
                    {inventoryData.map((item, index) => (
                        <div
                            key={index}
                            className="grid grid-cols-2 bg-white border-b border-black last:border-b-0 text-center py-3"
                        >
                            <div className="border-r border-black">{item.name}</div>
                            <div>{item.amount}</div>
                        </div>
                    ))}
                </div>

                <div className="mt-auto mb-8 flex justify-center">
                    <Link href="/inventory">
                        <CustomButton variant="secondary" className="w-32 h-12 text-lg shadow-md">
                            戻る
                        </CustomButton>
                    </Link>
                </div>
            </div>
        </ScreenContainer>
    );
}
