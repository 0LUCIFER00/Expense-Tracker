/** The fewest and most people an expense can be split between. */
export const MIN_SPLIT_MEMBERS = 2;
export const MAX_SPLIT_MEMBERS = 50;

export interface SplitPreview {
  members: number;
  /** What each of the others owes. */
  share: number;
  /** What is left for the owner. */
  personal: number;
}

/**
 * The same division the server makes, so the form can show it before saving.
 *
 * The others are asked for the nearest whole rupee and the owner absorbs the
 * rest: ₹1,455 between four is ₹364 from each of the others and ₹363 for the
 * owner. When whole rupees would ask the others for more than the bill, it
 * falls back to paise. Worked in paise so the parts add up exactly.
 *
 * Only a preview. The server does this again and stores its own result, which
 * is what counts — see server/src/split.mjs.
 */
export function splitAmount(amount: number, members: number): SplitPreview | null {
  if (
    !Number.isFinite(amount) || amount <= 0 ||
    !Number.isInteger(members) || members < MIN_SPLIT_MEMBERS || members > MAX_SPLIT_MEMBERS
  ) {
    return null;
  }

  const total = Math.round(amount * 100);
  const others = members - 1;

  let share = Math.round(total / members / 100) * 100;

  if (share <= 0 || share * others > total) {
    share = Math.floor(total / members);
  }

  return {
    members,
    share: share / 100,
    personal: (total - share * others) / 100
  };
}
