import React from "react";
import { ShoreCard } from "./ShoreCard";

export interface ShoreTableProps {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const ShoreTable: React.FC<ShoreTableProps> = ({
  title,
  subtitle,
  actions,
  children,
  footer,
  className = "",
}) => {
  return (
    <ShoreCard
      variant="default"
      padding="none"
      className={`overflow-hidden ${className}`}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
          <div>
            {title && (
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-slate-500 font-normal mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="overflow-x-auto">{children}</div>
      {footer && (
        <div className="border-t border-slate-100 px-6 py-4 bg-slate-50/50">
          {footer}
        </div>
      )}
    </ShoreCard>
  );
};
