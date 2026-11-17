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
      {/* slate-900, not slate-700. This is the column people actually read on a
          downloaded report, and at 11-12px on a white page the mid-slate step
          was washing out - worse once the PNG is printed or viewed on a phone
          in daylight. The weight is nudged up for the same reason: the cell is
          the account of the disruption, so it should read like body copy rather
          than like a caption. */}
      <p className={`text-xs leading-relaxed font-medium text-slate-900 ${compact ? 'line-clamp-3' : ''}`}>
        {text}
      </p>
      {compact && count > 1 && (
        <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">
          {count} updates
        </span>
      )}
    </div>
  );
};
