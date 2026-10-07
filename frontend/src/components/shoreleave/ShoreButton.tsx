import React, { forwardRef } from "react";
import { Loader2 } from "lucide-react";

export interface ShoreButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "white";
  size?: "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
}

export const ShoreButton = forwardRef<HTMLButtonElement, ShoreButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      loading = false,
      icon,
      iconRight,
      fullWidth = false,
      disabled,
      className = "",
      ...props
    },
    ref,
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-semibold transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed select-none";

    const variantStyles = {
      primary:
        "bg-[#0077f6] hover:bg-[#0062cc] text-white shadow-md shadow-blue-500/20 active:shadow-sm",
      secondary:
        "bg-white hover:bg-slate-50 text-[#0077f6] border border-blue-100 shadow-sm",
      outline:
        "bg-transparent hover:bg-blue-50/60 text-[#0077f6] border border-blue-300",
      ghost:
        "bg-transparent hover:bg-slate-100/70 text-slate-700",
      danger:
        "bg-rose-500 hover:bg-rose-600 text-white shadow-md shadow-rose-500/20",
      white:
        "bg-white hover:bg-slate-50 text-slate-900 shadow-md",
    }[variant];

    const sizeStyles = {
      sm: "text-xs px-3.5 py-1.5 rounded-xl gap-1.5 min-h-[34px]",
      md: "text-sm px-5 py-2.5 rounded-2xl gap-2 min-h-[42px]",
      lg: "text-base px-6 py-3.5 rounded-2xl gap-2.5 min-h-[50px]",
      xl: "text-base md:text-lg px-7 py-4 rounded-2xl gap-3 min-h-[56px]",
    }[size];

    const widthStyle = fullWidth ? "w-full" : "";

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${baseStyles} ${variantStyles} ${sizeStyles} ${widthStyle} ${className}`}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-current" />
        ) : (
          icon && <span className="shrink-0">{icon}</span>
        )}
        <span>{children}</span>
        {!loading && iconRight && <span className="shrink-0">{iconRight}</span>}
      </button>
    );
  },
);

ShoreButton.displayName = "ShoreButton";
