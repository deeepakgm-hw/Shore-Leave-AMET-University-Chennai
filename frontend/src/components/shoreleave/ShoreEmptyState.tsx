import React from "react";
import { ShoreCard } from "./ShoreCard";
import { ShoreButton } from "./ShoreButton";

export interface ShoreEmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const ShoreEmptyState: React.FC<ShoreEmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className = "",
}) => {
  return (
    <ShoreCard
      variant="default"
      padding="xl"
      className={`text-center flex flex-col items-center justify-center ${className}`}
    >
      {icon && (
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-blue-50 text-[#0077f6]">
          {icon}
        </div>
      )}
      <h3 className="text-xl font-bold text-slate-900">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-slate-500 leading-relaxed">
        {description}
      </p>
      {actionLabel && onAction && (
        <div className="mt-6">
          <ShoreButton variant="primary" onClick={onAction}>
            {actionLabel}
          </ShoreButton>
        </div>
      )}
    </ShoreCard>
  );
};
