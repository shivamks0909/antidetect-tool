import React from "react";
import { RefreshCw, Bell } from "lucide-react";

interface HeaderProps {
  title: string;
  subtitle: string;
  onRefresh: () => void;
  actionButton?: React.ReactNode;
}

export function Header({ title, subtitle, onRefresh, actionButton }: HeaderProps) {
  return (
    <header className="bg-white border-b border-slate-200/80 px-8 py-5 flex items-center justify-between shadow-2xs">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
          <img src="/opinion_insights_emblem.png?v=3" alt="Opinion Insights" className="w-7 h-7 object-contain drop-shadow-2xs" />
          {title}
        </h1>
        <p className="text-sm font-medium text-slate-500 mt-0.5">{subtitle}</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onRefresh}
          className="p-2.5 text-slate-600 bg-slate-100 hover:bg-slate-200/80 rounded-xl transition-colors flex items-center gap-2 text-xs font-bold"
          title="Refresh Data"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
        {actionButton}
      </div>
    </header>
  );
}
