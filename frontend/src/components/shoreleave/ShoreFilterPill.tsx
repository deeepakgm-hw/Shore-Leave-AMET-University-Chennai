import React from "react";

export interface ShoreFilterPillProps {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
  className?: string;
}

export const ShoreFilterPill: React.FC<ShoreFilterPillProps> = ({
  label,
  active,
  count,
  onClick,
  className = "",
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-200 select-none ${
        active
          ? "bg-[#0077f6] text-white shadow-md shadow-blue-500/25"
          : "bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-200/80 shadow-sm"
      } ${className}`}
    >
      <span>{label}</span>
      {typeof count === "number" && (
        <span
          className={`grid min-w-[20px] place-items-center rounded-full px-1.5 py-0.5 text-xs font-bold leading-none ${
            active
              ? "bg-white/20 text-white"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
};
