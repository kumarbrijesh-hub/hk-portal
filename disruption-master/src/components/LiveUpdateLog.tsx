import React from 'react';
import { Disruption } from '../types';
import { cumulativeLiveUpdate, liveUpdateEntries } from '../utils/liveUpdateLog';

interface LiveUpdateLogProps {
  disruption: Disruption;
  /**
   * In a table cell the full run would stretch the row out of shape, so the
   * compact form shows the newest few and says how many are behind them. The
   * hover text always carries the whole thing.
   */
  compact?: boolean;
  /** How many entries the compact form shows before it starts counting. */
  compactLimit?: number;
}

export const LiveUpdateLog: React.FC<LiveUpdateLogProps> = ({
  disruption,
  compact = false,
  compactLimit = 2,
}) => {
  const entries = liveUpdateEntries(disruption);

  if (entries.length === 0) {
    return <span className="text-slate-400">—</span>;
  }

  // Newest first on screen: the current state of the disruption is what someone
  // scanning the tracker needs, with the history underneath it.
  const newestFirst = [...entries].reverse();
  const shown = compact ? newestFirst.slice(0, compactLimit) : newestFirst;
  const hidden = newestFirst.length - shown.length;
  const fullLog = cumulativeLiveUpdate(disruption);

  return (
    <div className="space-y-1" title={fullLog}>
      {shown.map((entry, i) => (
        <div
          key={`${entry.timestamp}-${i}`}
          className="border-l-2 border-slate-300 pl-2 first:border-blue-400"
        >
          {entry.timestamp && (
            <span className="block text-[10px] text-slate-500 tabular-nums">{entry.timestamp}</span>
          )}
          <p className={`text-xs text-slate-700 ${compact ? 'line-clamp-2' : ''}`}>{entry.text}</p>
        </div>
      ))}
      {hidden > 0 && (
        <span className="block text-[10px] font-semibold text-slate-500">
          +{hidden} earlier {hidden === 1 ? 'update' : 'updates'}
        </span>
      )}
    </div>
  );
};
