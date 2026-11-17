import React from 'react';
import { BucketType, CurrentStatus } from '../types';
import { BadgeTone, bucketTone, statusTone, toneStyle } from '../utils/badgeTones';

/**
 * The chip shape, shared by both badges.
 *
 * A leading dot, a hairline and a semibold label. The dot is not decoration:
 * these chips are read side by side in a column on a report that gets printed
 * and forwarded, so the state has to survive a greyscale printer and a reader
 * who cannot separate the tints. The dot plus the word carries it; the colour
 * is the third cue, not the only one.
 */
const Chip: React.FC<{ tone: BadgeTone; label: string; title?: string }> = ({ tone, label, title }) => {
  const { chip, dot } = toneStyle(tone);
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 pl-1.5 pr-2 py-[3px] rounded-md border text-[11px] font-semibold tracking-tight whitespace-nowrap shadow-2xs ${chip}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
};

interface StatusBadgeProps {
  status: CurrentStatus | string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => (
  <Chip tone={statusTone(status)} label={status} />
);

export const BucketBadge: React.FC<{ bucket: BucketType | string }> = ({ bucket }) => {
  // Deliberately loud, and deliberately different text rather than only a
  // different colour. A blank bucket is not an error, but it is unfinished
  // work, and it should be obvious at a glance in the tracker - not only on the
  // form that left it blank.
  if (!bucket) {
    return (
      <Chip
        tone="alert"
        label="Bucket not set"
        title="No bucket was chosen for this disruption yet"
      />
    );
  }

  return <Chip tone={bucketTone(bucket)} label={bucket} />;
};
