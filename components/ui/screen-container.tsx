import React from "react";

interface ScreenContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function ScreenContainer({ children, className = "" }: ScreenContainerProps) {
  return (
    <div className={`min-h-screen w-full flex justify-center bg-gray-100 ${className}`}>
      <div className="w-full max-w-md min-h-screen bg-[#E8F8F4] flex flex-col relative shadow-xl">
        {children}
      </div>
    </div>
  );
}
