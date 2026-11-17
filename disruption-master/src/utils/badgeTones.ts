/**
 * What colour a status or bucket chip wears, and why.
 *
 * Split out of the badge components so the mapping can be asserted directly.
 * These colours carry meaning on a report somebody reads at a glance, and a
 * chip that quietly falls through to grey because a status was renamed is the
 * kind of regression no screenshot review catches.
 *
 * Almost every tone uses one recipe: a `-50` surface, a `-200`/`-300` hairline
 * and a `-700`/`-800` label. That is the combination index.css remaps for dark
 * mode wholesale, so a tone added here is legible in both themes the day it
 * ships rather than the day somebody remembers to annotate it. `done` is the
 * one deliberate exception - see its note.
 */

export type BadgeTone =
  | 'neutral'
  | 'critical'
  | 'alert'
  | 'caution'
  | 'inProgress'
  | 'watch'
  | 'inAudit'
  | 'done'
  | 'parked';

export interface ToneStyle {
  /** Surface, hairline and label, as Tailwind utilities. */
  chip: string;
  /** The leading dot. A chip is never colour-only; the dot is a second cue. */
  dot: string;
}

const TONES: Record<BadgeTone, ToneStyle> = {
  /** Nothing has happened yet, or the state carries no judgement. */
  neutral: { chip: 'bg-slate-100 text-slate-700 border-slate-300', dot: 'bg-slate-400' },

  /** The store is down. The loudest thing on the report. */
  critical: { chip: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },

  /** Needs somebody now, but is not the breakdown itself. */
  alert: { chip: 'bg-rose-50 text-rose-700 border-rose-300', dot: 'bg-rose-500' },

  /** Open, lower severity. Non Breakdown lives here. */
  caution: { chip: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },

  /** Somebody is on the way or on site. Every RAC and OEM state. */
  inProgress: { chip: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },

  /** Waiting on somebody else's call - an issue nobody on this team owns. */
  watch: { chip: 'bg-yellow-50 text-yellow-800 border-yellow-200', dot: 'bg-yellow-500' },

  /** Being checked. Green by request: an audit in process is somebody working. */
  inAudit: { chip: 'bg-emerald-50 text-emerald-700 border-emerald-300', dot: 'bg-emerald-500' },

  /**
   * Finished.
   *
   * A solid fill rather than the pale tint, and the only tone that breaks the
   * recipe. 'Audit in Process' is green by request, and two light green chips in
   * the same column would read as one state; filled green is unmistakably
   * "closed" next to outlined green "being checked". `bg-emerald-600` is already
   * dark, so index.css leaves it alone and white-on-green holds in both themes
   * with no second rule.
   */
  done: { chip: 'bg-emerald-600 text-white border-emerald-700', dot: 'bg-white/80' },

  /** Open, but not being worked this minute. */
  parked: { chip: 'bg-slate-200 text-slate-800 border-slate-400', dot: 'bg-slate-500' },
};

export function toneStyle(tone: BadgeTone): ToneStyle {
  return TONES[tone];
}

/**
 * The tone for a Current Status.
 *
 * Matched on the status strings rather than through a category helper because
 * the status list is admin-editable: a value this file has never heard of has
 * to land somewhere sane, and `neutral` says "no judgement" instead of
 * inventing one.
 */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    // Green: an audit in process is somebody actively checking the store.
    case 'Audit in Process':
      return 'inAudit';

    // Blue: a technician is aligned or already on site. "RAC on the way".
    case 'RAC Aligned':
    case 'RAC Visited':
    case 'OEM Aligned':
    case 'OEM Visited':
      return 'inProgress';

    // Yellow: an admin-side issue, parked on somebody outside this team.
    case 'Known Admin Issue':
      return 'watch';

    case 'Disruption':
      return 'critical';

    case 'Auto Disable':
      return 'alert';

    case 'Resolved by RAC':
    case 'Resolved by OEM':
    case 'Resolved by Dealer':
    case 'Resolved by CC':
      return 'done';

    case 'Disable':
      return 'parked';

    case 'No Update':
      return 'neutral';

    default:
      return 'neutral';
  }
}

/**
 * The tone for a Bucket.
 *
 * A blank bucket is handled by the badge itself rather than here: it renders
 * different text ("Bucket not set"), not just a different colour, so the
 * decision belongs with the thing that writes the label.
 */
export function bucketTone(bucket: string): BadgeTone {
  switch (bucket) {
    case 'Breakdown':
      return 'critical';
    case 'Non Breakdown':
      return 'caution';
    case 'False Alarm / Invalid':
      return 'neutral';
    default:
      return 'neutral';
  }
}
