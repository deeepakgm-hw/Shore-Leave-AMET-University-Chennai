import React, { forwardRef } from "react";
import { ChevronDown } from "lucide-react";

export interface ShoreSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: React.ReactNode;
}

export const ShoreSelect = forwardRef<HTMLSelectElement, ShoreSelectProps>(
  ({ label, error, hint, icon, className = "", id, children, ...props }, ref) => {
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-xs font-bold uppercase tracking-wider text-slate-700"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
              {icon}
            </div>
          )}
          <select
            id={selectId}
            ref={ref}
            className={`w-full appearance-none rounded-2xl border bg-white px-4 py-3 pr-10 text-sm text-slate-900 transition-all focus:outline-none focus:ring-2 focus:ring-[#0077f6]/30 focus:border-[#0077f6] disabled:bg-slate-50 disabled:text-slate-500 ${
              icon ? "pl-11" : ""
            } ${
              error
                ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/20"
                : "border-slate-200/90 hover:border-slate-300"
            } ${className}`}
            {...props}
          >
            {children}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>
        {hint && !error && (
          <p className="text-xs text-slate-500">{hint}</p>
        )}
        {error && (
          <p className="text-xs font-medium text-rose-500">{error}</p>
        )}
      </div>
    );
  },
);

ShoreSelect.displayName = "ShoreSelect";
