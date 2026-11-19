import React from 'react';
import { Disruption } from '../types';
import { cumulativeLiveUpdate, liveUpdateCount } from '../utils/liveUpdateLog';

interface LiveUpdateLogProps {
  disruption: Disruption;
  /**
   * The table-cell form: a fixed-width column that wraps, with the number of
   * updates underneath.
   *
   * It used to clamp the text to three lines as well, and that was the wrong
   * call for a report. The cell is the account of the disruption - what broke,
   * who went, what they found - and a report that ends it in an ellipsis is a
   * report whose most-read column cannot be read. The width is what keeps the
   * row in shape; the height is allowed to grow.
   */
  compact?: boolean;
}

/** The space the column gets. Fixed, so a long account grows downwards. */
const COLUMN_WIDTH = 'w-[330px] max-w-[330px]';

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
    <div title={text} className={compact ? COLUMN_WIDTH : undefined}>
      {/* slate-900, not slate-700. This is the column people actually read on a
          downloaded report, and at 11-12px on a white page the mid-slate step
          was washing out - worse once the PNG is printed or viewed on a phone
          in daylight. The weight is nudged up for the same reason: the cell is
          the account of the disruption, so it should read like body copy rather
          than like a caption.

          break-words because an account can carry a ticket reference or a URL
          with no space in it, and one long token in a fixed-width column would
          otherwise push the whole table sideways instead of wrapping. */}
      <p className="text-xs leading-relaxed font-medium text-slate-900 break-words">{text}</p>
      {compact && count > 1 && (
        <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">
          {count} updates
        </span>
      )}
    </div>
  );
};
