/**
 * The letters shown on the account button: the first letter of a one-word
 * name ("Test" → "T"), or the first letters of the first and last words
 * ("Prajwal M" → "PM", "Anil Kumar Rao" → "AR"). Empty when there is no name.
 */
export function initialsOf(name: string | null | undefined): string {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return '';
  }

  // Array.from keeps a letter made of two UTF-16 units whole.
  const first = (word: string) => Array.from(word)[0].toLocaleUpperCase();

  return words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1]);
}
