import React from "react";
import { cn } from "@/lib/utils";

interface CustomButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "outline";
}

export function CustomButton({ className, variant = "primary", ...props }: CustomButtonProps) {
    return (
        <button
            className={cn(
                "w-full py-3 px-4 rounded-md border border-black shadow-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                variant === "primary" && "bg-[#A8F2DE] hover:bg-[#8eead0] text-black", // Minty green
                variant === "secondary" && "bg-[#B4E4FF] hover:bg-[#9cdbff] text-black", // Light blue for "Back" button
                variant === "outline" && "bg-transparent hover:bg-black/5 text-black",
                className
            )}
            {...props}
        />
    );
}
