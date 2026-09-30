import React from 'react';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Settings,
  User,
  Radio,
  Clock,
  Layers,
  FileSpreadsheet,
} from 'lucide-react';
import { SyncStatus } from '../types';

interface HeaderProps {
  activeTab: 'liveTracker' | 'activeDisruptions' | 'config';
  setActiveTab: (tab: 'liveTracker' | 'activeDisruptions' | 'config') => void;
  syncStatus: SyncStatus;
  isSyncing: boolean;
  onSyncNow: () => void;
  onOpenConfig: () => void;
  currentUser: string;
  onSelectUser: (user: string) => void;
  userOptions: string[];
  activeCount: number;
  totalCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  syncStatus,
  isSyncing,
  onSyncNow,
  onOpenConfig,
  currentUser,
  onSelectUser,
  userOptions,
  activeCount,
  totalCount,
}) => {
  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40 shadow-md">
      {/* Top Bar: Title, Sync Banner, User Attribution */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          {/* Logo & System Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center text-white shadow-inner font-bold text-lg tracking-wider">
              DMS
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">Disruption Management System</h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/30">
                  LIVE OPS
                </span>
              </div>
              <p className="text-xs text-slate-400">Real-time incident response, master lookup & sync console</p>
            </div>
          </div>

          {/* Sync Status Banner */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-700/80 text-xs">
            {/* Sync Indicator */}
            <div className="flex items-center gap-2">
              {isSyncing || syncStatus.status === 'Syncing' ? (
                <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
              ) : syncStatus.status === 'Success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400" />
              )}
              <div className="flex flex-col">
                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  Last Sync:
                </span>
                <span className="font-mono font-medium text-slate-200">
                  {syncStatus.lastSyncTime || 'Pending initial sync'}
                </span>
              </div>
            </div>

            <div className="hidden sm:block h-6 w-px bg-slate-700" />

            {/* Records cached */}
            <div className="flex flex-col">
              <span className="text-[11px] text-slate-400">Master Records:</span>
              <span className="font-semibold text-emerald-300">
                {syncStatus.recordsCount} Outlets Cached
              </span>
            </div>

            <div className="hidden sm:block h-6 w-px bg-slate-700" />

            {/* SYNC NOW Button */}
            <button
              id="sync-now-button"
              type="button"
              onClick={onSyncNow}
              disabled={isSyncing}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Immediately fetch latest Google Sheet master data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'SYNCING...' : 'SYNC NOW'}</span>
            </button>

            {/* Config Button */}
            <button
              id="config-settings-button"
              type="button"
              onClick={onOpenConfig}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs transition"
              title="Configure Google Sheet URL, Mappings & Masters"
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Settings</span>
            </button>
          </div>

          {/* User / CC POC Operator switcher */}
          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700 text-xs">
            <User className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="text-slate-400">Operator:</span>
            <select
              id="header-user-select"
              value={currentUser}
              onChange={(e) => onSelectUser(e.target.value)}
              className="bg-slate-900 text-white font-medium rounded border border-slate-700 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {userOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-800 overflow-x-auto no-scrollbar">
          <button
            id="nav-live-tracker"
            type="button"
            onClick={() => setActiveTab('liveTracker')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all whitespace-nowrap ${
              activeTab === 'liveTracker'
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Radio className="w-4 h-4" />
            <span>Live Tracker</span>
            <span
              className={`ml-1 px-2 py-0.2 rounded-full text-xs font-semibold ${
                activeTab === 'liveTracker' ? 'bg-red-800/80 text-white' : 'bg-slate-700 text-slate-300'
              }`}
            >
              {totalCount}
            </span>
          </button>

          <button
            id="nav-active-disruptions"
            type="button"
            onClick={() => setActiveTab('activeDisruptions')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all whitespace-nowrap ${
              activeTab === 'activeDisruptions'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Live Active Disruption</span>
            <span
              className={`ml-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                activeTab === 'activeDisruptions' ? 'bg-amber-800 text-white' : 'bg-amber-500/20 text-amber-300'
              }`}
            >
              {activeCount} Active
            </span>
          </button>

          <button
            id="nav-sheet-config"
            type="button"
            onClick={() => setActiveTab('config')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all whitespace-nowrap ${
              activeTab === 'config'
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Google Sheet & Masters</span>
          </button>
        </div>
      </div>
    </header>
  );
};
