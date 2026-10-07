import React from "react";
import { ShoreCard } from "./ShoreCard";

export interface ShoreStatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: React.ReactNode;
  tone?: "blue" | "emerald" | "amber" | "rose" | "neutral";
  onClick?: () => void;
  className?: string;
}

export const ShoreStatCard: React.FC<ShoreStatCardProps> = ({
  label,
  value,
  subtext,
  icon,
  tone = "neutral",
  onClick,
  className = "",
}) => {
  const toneLabelColor = {
    blue: "text-[#0077f6]",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    rose: "text-rose-600",
    neutral: "text-slate-500",
  }[tone];

  const toneBgColor = {
    blue: "bg-blue-50 text-[#0077f6]",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    neutral: "bg-slate-50 text-slate-600",
  }[tone];

  return (
    <ShoreCard
      variant="default"
      padding="md"
      hoverable={Boolean(onClick)}
      onClick={onClick}
      className={`relative overflow-hidden ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div
            className={`text-[11px] sm:text-xs font-bold uppercase tracking-wider ${toneLabelColor}`}
          >
            {label}
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            {value}
          </div>
          {subtext && (
            <div className="mt-1 text-xs text-slate-500 font-medium">
              {subtext}
            </div>
          )}
        </div>
        {icon && (
          <div
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${toneBgColor}`}
          >
            {icon}
          </div>
        )}
      </div>
    </ShoreCard>
  );
};
