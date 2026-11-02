/**
 * What an expense can be filed under.
 *
 * A fixed list rather than free text: the dashboard's breakdown is only useful
 * if "Food" and "food " and "Fooding" are the same bucket, and a phone keyboard
 * guarantees they would not be. "Other" is the escape hatch, and an entry may
 * also have no category at all — everything added before categories existed.
 *
 * The API serves this at GET /api/categories, so the website's dropdown and
 * this validation cannot drift apart.
 */
export const CATEGORIES = [
  'Food & Drink',
  'Groceries',
  'Travel',
  'Shopping',
  'Bills & Utilities',
  'Health',
  'Entertainment',
  'Education',
  'Family & Gifts',
  'Other'
];

const BY_LOWER = new Map(CATEGORIES.map(name => [name.toLowerCase(), name]));

/**
 * @returns the canonical spelling, or null for anything not on the list —
 *   including an empty value, which is how the UI says "no category".
 */
export function normaliseCategory(value) {
  const text = String(value ?? '').trim().toLowerCase();

  return text ? BY_LOWER.get(text) ?? null : null;
}

/**
 * Words that give away what a WhatsApp expense was for.
 *
 * Nobody types "250 coffee, category Food & Drink" from a phone, so the
 * category is guessed from the description instead. A guess is only made when a
 * word matches outright; anything else stays uncategorised, because a wrong
 * category is worse than none in a breakdown.
 */
const KEYWORDS = {
  'Food & Drink': [
    'food', 'lunch', 'dinner', 'breakfast', 'brunch', 'snack', 'snacks',
    'coffee', 'chai', 'tea', 'juice', 'restaurant', 'hotel', 'cafe', 'canteen',
    'pizza', 'burger', 'biryani', 'dosa', 'idli', 'meals', 'swiggy', 'zomato',
    'icecream', 'bakery', 'sweets', 'water'
  ],
  Groceries: [
    'groceries', 'grocery', 'vegetables', 'veggies', 'fruits', 'milk', 'eggs',
    'rice', 'provisions', 'supermarket', 'kirana', 'bigbasket', 'blinkit',
    'zepto', 'dmart'
  ],
  Travel: [
    'travel', 'bus', 'train', 'ticket', 'tickets', 'flight', 'petrol', 'diesel',
    'fuel', 'auto', 'cab', 'taxi', 'uber', 'ola', 'rapido', 'metro', 'toll',
    'parking', 'trip'
  ],
  Shopping: [
    'shopping', 'clothes', 'shirt', 'pant', 'pants', 'shoes', 'dress', 'bag',
    'amazon', 'flipkart', 'myntra', 'meesho', 'electronics', 'mobile', 'laptop',
    'headphones', 'charger'
  ],
  'Bills & Utilities': [
    'bill', 'bills', 'recharge', 'electricity', 'current', 'water bill', 'gas',
    'cylinder', 'internet', 'wifi', 'broadband', 'rent', 'emi', 'insurance',
    'subscription', 'netflix', 'spotify', 'jio', 'airtel', 'maintenance'
  ],
  Health: [
    'medicine', 'medicines', 'medical', 'doctor', 'hospital', 'clinic',
    'pharmacy', 'tablets', 'checkup', 'dentist', 'gym', 'test', 'scan'
  ],
  Entertainment: [
    'movie', 'movies', 'cinema', 'game', 'games', 'concert', 'outing', 'party',
    'bowling', 'pvr', 'inox', 'theatre'
  ],
  Education: [
    'books', 'book', 'course', 'fees', 'fee', 'tuition', 'college', 'school',
    'exam', 'stationery', 'notebook', 'pen', 'udemy', 'coaching'
  ],
  'Family & Gifts': [
    'gift', 'gifts', 'birthday', 'wedding', 'donation', 'temple', 'family',
    'kids', 'mom', 'dad', 'mother', 'father', 'anniversary'
  ]
};

/** Keyword -> category, built once so each lookup is a plain map hit. */
const KEYWORD_INDEX = new Map();

for (const [category, words] of Object.entries(KEYWORDS)) {
  for (const word of words) {
    // First category to claim a word keeps it, so the order above is the
    // tie-breaker rather than whichever happens to be iterated last.
    if (!KEYWORD_INDEX.has(word)) {
      KEYWORD_INDEX.set(word, category);
    }
  }
}

/**
 * Guesses the category of a free-text description, for expenses that arrive
 * over WhatsApp.
 *
 * @returns a category name, or null when nothing in the text gives it away.
 */
export function guessCategory(description) {
  const words = String(description ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

  for (const word of words) {
    const hit = KEYWORD_INDEX.get(word);

    if (hit) {
      return hit;
    }
  }

  return null;
}
