/**
 * Issue taxonomy helpers.
 *
 * Operators only ever pick sub-issues; the parent issue is looked up from the
 * master so the two can never contradict each other. Shared by the server (for
 * validation and export) and the UI (for display).
 */

export type IssueMaster = Record<string, string[]>;

/** The category a sub-issue sits under, or undefined if it is not in the master. */
export function parentIssueFor(subIssue: string, issueMaster: IssueMaster): string | undefined {
  const needle = subIssue.trim().toLowerCase();
  if (!needle) return undefined;
  for (const [category, subs] of Object.entries(issueMaster)) {
    if (subs.some((s) => s.trim().toLowerCase() === needle)) return category;
  }
  return undefined;
}

/** Parent categories for a set of sub-issues, de-duplicated and order-preserving. */
export function deriveIssues(subIssues: string[], issueMaster: IssueMaster): string[] {
  const out: string[] = [];
  for (const sub of subIssues) {
    const parent = parentIssueFor(sub, issueMaster);
    if (parent && !out.includes(parent)) out.push(parent);
  }
  return out;
}

/** Every sub-issue in the master, flattened, for a single searchable picker. */
export function allSubIssues(issueMaster: IssueMaster): { subIssue: string; issue: string }[] {
  const out: { subIssue: string; issue: string }[] = [];
  for (const [issue, subs] of Object.entries(issueMaster)) {
    for (const subIssue of subs) {
      out.push({ subIssue, issue });
    }
  }
  return out;
}

/**
 * Normalises whatever a record carries into a sub-issue list. Older records
 * stored a single `subIssue` string, so both shapes have to read the same.
 */
export function readSubIssues(record: { subIssues?: string[]; subIssue?: string }): string[] {
  if (Array.isArray(record.subIssues) && record.subIssues.length > 0) {
    return record.subIssues;
  }
  return record.subIssue ? [record.subIssue] : [];
}

/** Same idea for the parent issues. */
export function readIssues(record: { issues?: string[]; issue?: string }): string[] {
  if (Array.isArray(record.issues) && record.issues.length > 0) {
    return record.issues;
  }
  return record.issue ? [record.issue] : [];
}
