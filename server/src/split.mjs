/**
 * Splitting an expense between people, and matching repayments to it.
 *
 * Pure — no database — so the arithmetic and the matching are testable on
 * their own, and the website and WhatsApp cannot disagree about either.
 */

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 50;

/**
 * How many people an expense is split between, the owner included.
 *
 * @returns the count, or null when the value is not a usable one.
 */
export function parseMembers(raw) {
  const members = Number(raw);

  if (!Number.isInteger(members) || members < MIN_MEMBERS || members > MAX_MEMBERS) {
    return null;
  }

  return members;
}

/**
 * Divides an amount between `members` people.
 *
 * People hand each other whole rupees, so each of the others is asked for the
 * nearest one and the owner — who paid the shop — absorbs what is left. ₹1,455
 * between four is ₹363.75 each, which nobody pays: the others give ₹364 and the
 * owner's share is ₹363.
 *
 * Rounding to whole rupees can ask the others for more than the bill on small
 * amounts (₹9 between six would be ₹2 each, ₹10 in all), so then it falls back
 * to paise. Working in paise throughout keeps the parts summing to the amount
 * exactly, which floating point would not.
 *
 * @returns { share, personal } in rupees: what each other person owes, and the
 *   owner's own part. share × (members − 1) + personal === amount.
 */
export function splitAmount(amount, members) {
  const total = Math.round(Number(amount) * 100);
  const others = members - 1;

  let share = Math.round(total / members / 100) * 100;

  if (share <= 0 || share * others > total) {
    share = Math.floor(total / members);
  }

  return {
    share: share / 100,
    personal: (total - share * others) / 100
  };
}

/** How much the others owe between them, in all. */
export function owedByOthers(split) {
  return Math.round(Number(split.share) * (split.members - 1) * 100) / 100;
}

/**
 * Words worth comparing: lower case, letters and digits only, three or more
 * characters, so "a", "of" and punctuation never make two things look alike.
 */
function significantWords(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3);
}

/**
 * How well a repayment's words describe a split expense.
 *
 * A word counts when one is the start of the other, because people shorten:
 * "oct" for "October", "veg" for "vegetables". Names of the people paying
 * ("Kalai") simply score nothing rather than counting against.
 */
function score(words, split) {
  const target = significantWords(split.description);

  return words.filter(word =>
    target.some(candidate => candidate.startsWith(word) || word.startsWith(candidate))
  ).length;
}

/**
 * Picks which open split a repayment is for.
 *
 * @param text   the words of the message, the amount and account already removed
 * @param open   splits that still have something owed, newest first
 * @returns one of
 *   { split }               a single clear match
 *   { ambiguous: [...] }    several fit equally well; ask rather than guess
 *   { none: true }          nothing to match against, or nothing fits
 *
 * When the words name nothing but there is only one open split, that one is
 * taken: "+364 share hdfc" can only mean it.
 */
export function matchSplit(text, open) {
  if (open.length === 0) {
    return { none: true };
  }

  const words = significantWords(text).filter(word => word !== 'share');

  const scored = open.map(split => ({ split, points: score(words, split) }));
  const best = Math.max(...scored.map(entry => entry.points));

  if (best === 0) {
    return open.length === 1 ? { split: open[0] } : { ambiguous: open };
  }

  const top = scored.filter(entry => entry.points === best).map(entry => entry.split);

  return top.length === 1 ? { split: top[0] } : { ambiguous: top };
}
