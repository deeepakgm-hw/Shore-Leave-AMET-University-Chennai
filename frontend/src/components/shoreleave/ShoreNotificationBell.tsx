import React from "react";
import { Bell } from "lucide-react";

export interface ShoreNotificationBellProps {
  unreadCount?: number;
  onClick: () => void;
  className?: string;
}

export const ShoreNotificationBell: React.FC<ShoreNotificationBellProps> = ({
  unreadCount = 0,
  onClick,
  className = "",
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
      className={`relative grid h-11 w-11 place-items-center rounded-full bg-white text-slate-800 shadow-[0_4px_16px_-4px_rgba(15,23,42,0.08)] border border-slate-100 transition-all hover:scale-105 active:scale-95 ${className}`}
    >
      <Bell className="h-5 w-5 text-slate-700" />
      {unreadCount > 0 && (
        <span className="absolute top-2.5 right-2.5 h-2.5 w-2.5 rounded-full bg-[#0077f6] ring-2 ring-white" />
      )}
    </button>
  );
};
