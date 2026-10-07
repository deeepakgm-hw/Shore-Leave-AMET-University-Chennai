import React from "react";

export interface ShoreStatusBadgeProps {
  status: string;
  size?: "sm" | "md";
  className?: string;
}

export const ShoreStatusBadge: React.FC<ShoreStatusBadgeProps> = ({
  status,
  size = "md",
  className = "",
}) => {
  const normalized = (status || "").toLowerCase().trim();

  let style = "bg-slate-100 text-slate-700 border-slate-200";

  if (["approved", "ready", "gate_pass_ready", "success"].includes(normalized)) {
    style = "bg-emerald-50 text-emerald-700 border-emerald-200/70";
  } else if (["pending", "review", "in_review", "submitted"].includes(normalized)) {
    style = "bg-amber-50 text-amber-700 border-amber-200/70";
  } else if (["rejected", "cancelled", "blocked", "failed", "danger"].includes(normalized)) {
    style = "bg-rose-50 text-rose-700 border-rose-200/70";
  } else if (["active", "out", "checked_out"].includes(normalized)) {
    style = "bg-sky-50 text-[#0077f6] border-blue-200/70";
  } else if (["returned", "in", "checked_in"].includes(normalized)) {
    style = "bg-slate-100 text-slate-700 border-slate-200";
  }

  const sizeStyle =
    size === "sm"
      ? "text-[10px] px-2.5 py-0.5"
      : "text-xs px-3 py-1 font-semibold";

  const displayStatus = normalized
    .replace(/_/g, " ")
    .toUpperCase();

  return (
    <span
      className={`inline-flex items-center rounded-full border font-bold uppercase tracking-wider select-none ${style} ${sizeStyle} ${className}`}
    >
      {displayStatus}
    </span>
  );
};
