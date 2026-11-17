/**
 * What counts as "something to post" on a Live Update.
 *
 * The modal refuses a completely blank submit, because an empty post appends a
 * history row that says nothing, changes nothing and is filtered back out of
 * the log anyway. That refusal is the only one left on this form - the sub-issue
 * tagging and the RAC arrival time stopped being blockers because an operator
 * with news to record and no answer to those two had no way to record it.
 *
 * The rule lives here, away from the form, because it got this wrong once: the
 * Internal Remarks box was left out of the check, so writing only a handover
 * note was answered with "write an update, change the status, or tag the
 * sub-issue" - asking the operator to invent a live update or move the status
 * in order to save a note that is for the team's own eyes and goes into no
 * report. The server already accepted a remarks-only post; only the form stood
 * in the way. Keeping the rule in one tested place is what stops a field added
 * later from being forgotten the same way.
 */

export interface LivePostContentArgs {
  /** The live update sentence, as typed. */
  updateText: string;
  /** Whether the status dropdown has been moved off the record's current one. */
  statusChanged: boolean;
  /** Sub-issues ticked on this post. */
  subIssues: string[];
  /** Whether a RAC first-response figure was actually supplied. */
  hasRacFrt: boolean;
  /** Internal Remarks as typed now. */
  remarks: string;
  /**
   * Internal Remarks as they stand on the record. A post that leaves the box
   * exactly as it was carries no note, so re-saving an unchanged note is not by
   * itself something to post; editing or clearing it is.
   */
  existingRemarks: string;
}

/** True when the post carries at least one thing worth recording. */
export function hasSomethingToPost(args: LivePostContentArgs): boolean {
  return (
    args.updateText.trim() !== '' ||
    args.statusChanged ||
    args.subIssues.length > 0 ||
    args.hasRacFrt ||
    remarksChanged(args.remarks, args.existingRemarks)
  );
}

/**
 * Whether the remarks box differs from what is on the record.
 *
 * Compared trimmed, because the server stores the trimmed note - without that,
 * adding a trailing space would read as a change here and then save as no
 * change at all, and the operator would be told the post went through while
 * nothing moved.
 */
export function remarksChanged(next: string, existing: string): boolean {
  return next.trim() !== existing.trim();
}

/**
 * The message shown when there is nothing to post.
 *
 * It names Internal Remarks too, so the one case this rule used to get wrong is
 * now spelled out as a way to satisfy it rather than omitted from the list.
 */
export const NOTHING_TO_POST_MESSAGE =
  'Nothing to post yet. Write an update, change the status, tag the sub-issue, or add an internal remark.';
