import React from "react";

export interface ShorePageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  greeting?: string;
  className?: string;
}

export const ShorePageHeader: React.FC<ShorePageHeaderProps> = ({
  title,
  subtitle,
  badge,
  actions,
  greeting,
  className = "",
}) => {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 ${className}`}>
      <div className="space-y-1">
        {badge && <div className="mb-1.5">{badge}</div>}
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm sm:text-base font-normal text-slate-500">
            {subtitle}
          </p>
        )}
        {greeting && (
          <p className="text-base sm:text-lg font-medium text-slate-800 pt-1">
            {greeting}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-3 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
};
