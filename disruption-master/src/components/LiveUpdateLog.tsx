import React from 'react';
import { Disruption } from '../types';
import { cumulativeLiveUpdate, liveUpdateCount } from '../utils/liveUpdateLog';

interface LiveUpdateLogProps {
  disruption: Disruption;
  /**
   * In a table cell a long account would stretch the row out of shape, so the
   * compact form clamps it to a few lines. The hover text always carries the
   * whole thing.
   */
  compact?: boolean;
}

/**
 * The running account of a disruption, as one continuous line of text.
 *
 * Deliberately not a list of separate entries: the updates are comma-joined
 * into a single sentence so the cell reads the way someone would say it out
 * loud. Who posted which part, and when, is the audit log's job.
 */
export const LiveUpdateLog: React.FC<LiveUpdateLogProps> = ({ disruption, compact = false }) => {
  const text = cumulativeLiveUpdate(disruption);

  if (!text) {
    return <span className="text-slate-400">—</span>;
  }

  const count = liveUpdateCount(disruption);

  return (
    <div title={text}>
      <p className={`text-xs leading-relaxed text-slate-700 ${compact ? 'line-clamp-3' : ''}`}>
        {text}
      </p>
      {compact && count > 1 && (
        <span className="mt-0.5 block text-[10px] font-semibold text-slate-400">
          {count} updates
        </span>
      )}
    </div>
  );
};
