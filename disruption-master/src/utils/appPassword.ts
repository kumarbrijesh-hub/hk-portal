/**
 * The rules for changing the console's shared sign-in password.
 *
 * The password itself is generated in-cluster on first boot and written to a
 * volume, which is why it has never existed in this repository, in a manifest or
 * in anyone's shell history. Changing it used to mean deleting that file and
 * reading the new one out of the pod log. This lets the owner set it from the
 * console instead: the value is typed into their browser and goes straight to
 * the file, so it still never passes through a manifest, a commit or a chat.
 *
 * Only the rules live here, deliberately free of crypto and of the filesystem,
 * so they can be tested directly. Whether the supplied current password is
 * correct is decided by the caller with a timing-safe compare and handed in as a
 * boolean - a string compare in here would leak the answer through timing.
 */

/** Short enough to type on a phone, long enough not to be guessed in an hour. */
export const MIN_PASSWORD_LENGTH = 10;

/** bcrypt-era habits aside, a shared console password past this is a paste error. */
export const MAX_PASSWORD_LENGTH = 128;

export interface PasswordChangeDecision {
  /** The value to store. Empty when the change is refused. */
  next: string;
  /** Non-null when the request must be refused, with the message to send. */
  error: string | null;
}

export function decidePasswordChange(args: {
  next: unknown;
  confirm: unknown;
  /** Whether the supplied current password matched. Ignored when none is set. */
  currentMatches: boolean;
  /** Whether a password is in force at all right now. */
  passwordRequired: boolean;
  /** Whether the proposed password equals the one already in force. */
  sameAsCurrent: boolean;
}): PasswordChangeDecision {
  const { currentMatches, passwordRequired, sameAsCurrent } = args;

  const fail = (error: string): PasswordChangeDecision => ({ next: '', error });

  // Owner session or not, the current password has to be re-entered. A console
  // left open on an unlocked laptop is the likeliest way this gets misused, and
  // that is exactly the case this check covers.
  if (passwordRequired && !currentMatches) {
    return fail('The current password is not right.');
  }

  if (typeof args.next !== 'string' || typeof args.confirm !== 'string') {
    return fail('Enter the new password twice.');
  }

  const next = args.next;
  const confirm = args.confirm;

  if (!next) {
    return fail('Enter a new password.');
  }

  // The stored file is read back with .trim(), so a password with a space at
  // either end would silently become a different password than the one typed -
  // and the person would be locked out with no way to tell why. Refused rather
  // than quietly trimmed, so the mistake is visible while it can still be fixed.
  if (next !== next.trim()) {
    return fail('The new password cannot start or end with a space.');
  }

  // One line, because the file holds exactly one.
  if (/[\r\n\t]/.test(next)) {
    return fail('The new password cannot contain line breaks or tabs.');
  }

  if (next.length < MIN_PASSWORD_LENGTH) {
    return fail(`The new password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  if (next.length > MAX_PASSWORD_LENGTH) {
    return fail(`The new password cannot be longer than ${MAX_PASSWORD_LENGTH} characters.`);
  }

  if (next !== confirm) {
    return fail('The two new passwords do not match.');
  }

  if (sameAsCurrent) {
    return fail('That is already the current password.');
  }

  return { next, error: null };
}
