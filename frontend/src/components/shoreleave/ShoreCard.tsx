import React from "react";

export interface ShoreCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "featured" | "subtle" | "ghost" | "accent";
  padding?: "none" | "sm" | "md" | "lg" | "xl";
  hoverable?: boolean;
}

export const ShoreCard: React.FC<ShoreCardProps> = ({
  children,
  variant = "default",
  padding = "md",
  hoverable = false,
  className = "",
  ...props
}) => {
  const baseStyles =
    "relative rounded-3xl transition-all duration-200";

  const variantStyles = {
    default:
      "bg-white border border-slate-100/90 shadow-[0_4px_24px_-8px_rgba(15,23,42,0.06)] text-slate-900",
    featured:
      "bg-gradient-to-br from-[#60a5fa] via-[#3b82f6] to-[#2563eb] text-white shadow-[0_12px_36px_-10px_rgba(37,99,235,0.35)] border border-blue-400/30",
    subtle:
      "bg-[#f0f7ff] border border-blue-100/70 text-slate-900",
    ghost:
      "bg-white/60 backdrop-blur-md border border-white/60 text-slate-900",
    accent:
      "bg-white border-2 border-[#0077f6]/20 shadow-md shadow-blue-500/5 text-slate-900",
  }[variant];

  const paddingStyles = {
    none: "p-0",
    sm: "p-4 sm:p-5",
    md: "p-5 sm:p-6",
    lg: "p-6 sm:p-8",
    xl: "p-8 sm:p-10",
  }[padding];

  const hoverStyles = hoverable
    ? "hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-6px_rgba(15,23,42,0.1)] cursor-pointer"
    : "";

  return (
    <div
      className={`${baseStyles} ${variantStyles} ${paddingStyles} ${hoverStyles} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
