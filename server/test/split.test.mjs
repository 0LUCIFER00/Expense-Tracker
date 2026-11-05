import test from 'node:test';
import assert from 'node:assert/strict';
import { matchSplit, parseMembers, splitAmount } from '../src/split.mjs';
import { parseMessage } from '../src/whatsapp/parser.mjs';

/*
 * The case that started this: ₹1,455 of October vegetables, paid from HDFC,
 * shared between four. ₹363.75 each is not something anyone hands over, so the
 * other three pay ₹364 and the owner's own cost is what is left.
 */
test('₹1,455 between four: the others pay ₹364 and yours is ₹363', () => {
  assert.deepEqual(splitAmount(1455, 4), { share: 364, personal: 363 });
});

test('the owner absorbs the rounding in either direction', () => {
  // ₹333.33 each: the others round down, so the owner pays the extra rupee.
  assert.deepEqual(splitAmount(1000, 3), { share: 333, personal: 334 });
});

test('the parts always add back up to the amount, to the paisa', () => {
  for (const amount of [1, 7, 9, 10, 99.99, 250, 1455, 1000, 33333.33, 100000]) {
    for (let members = 2; members <= 12; members += 1) {
      const { share, personal } = splitAmount(amount, members);
      const back = Math.round((share * (members - 1) + personal) * 100);

      assert.equal(back, Math.round(amount * 100), `${amount} ÷ ${members}`);
      assert.ok(personal >= 0, `${amount} ÷ ${members}: the owner's share is never negative`);
      assert.ok(share >= 0, `${amount} ÷ ${members}: nobody is owed money`);
    }
  }
});

test('when whole rupees would ask for more than the bill, it falls back to paise', () => {
  // ₹9 between six at ₹2 each would be ₹10 from the others alone.
  const { share, personal } = splitAmount(9, 6);

  assert.ok(share * 5 <= 9, 'the others are not asked for more than the bill');
  assert.equal(share, 1.5);
  assert.equal(personal, 1.5);
});

test('a head count has to be a whole number of at least two', () => {
  assert.equal(parseMembers('4'), 4);
  assert.equal(parseMembers(2), 2);
  assert.equal(parseMembers(1), null, 'one person is not a split');
  assert.equal(parseMembers(0), null);
  assert.equal(parseMembers(2.5), null);
  assert.equal(parseMembers('four'), null);
  assert.equal(parseMembers(51), null);
});

const VEGETABLES = { id: 'v', description: 'October Month Vegetables' };
const MOVIE = { id: 'm', description: 'Movie tickets' };
const GROCERIES = { id: 'g', description: 'November Groceries' };

test('a repayment is matched to the split its words name', () => {
  // The owner's own habit: who paid, which month, what for.
  assert.equal(matchSplit('Kalai Oct Vegetables share', [VEGETABLES, MOVIE]).split, VEGETABLES);
  assert.equal(matchSplit('movie share', [VEGETABLES, MOVIE]).split, MOVIE);
});

test('shortened words still match, either way round', () => {
  assert.equal(matchSplit('veg share', [VEGETABLES, MOVIE]).split, VEGETABLES);
  assert.equal(matchSplit('oct share', [MOVIE, VEGETABLES]).split, VEGETABLES);
});

test('with only one split open, a repayment that names nothing is for that one', () => {
  assert.equal(matchSplit('Kamesh share', [VEGETABLES]).split, VEGETABLES);
});

test('it asks rather than guesses when the words fit several equally', () => {
  const both = [VEGETABLES, { id: 'v2', description: 'September Vegetables' }];
  const result = matchSplit('vegetables share', both);

  assert.equal(result.split, undefined);
  assert.equal(result.ambiguous.length, 2);
});

test('it asks when several are open and the words name none of them', () => {
  assert.equal(matchSplit('Kalai share', [VEGETABLES, MOVIE]).ambiguous.length, 2);
});

test('with nothing open there is nothing to match', () => {
  assert.equal(matchSplit('vegetables share', []).none, true);
});

test('the better match wins over a partial one', () => {
  assert.equal(
    matchSplit('November groceries share', [VEGETABLES, GROCERIES]).split,
    GROCERIES
  );
});

const ACCOUNTS = [
  { id: 'a1', type: 'Bank Account', category: 'HDFC Bank' },
  { id: 'a2', type: 'Hand Cash', category: 'Wallet' }
];

test('WhatsApp: "split 4" marks an expense as shared four ways', () => {
  const parsed = parseMessage('1455 vegetables hdfc split 4', ACCOUNTS);

  assert.equal(parsed.kind, 'expense');
  assert.equal(parsed.amount, 1455);
  assert.equal(parsed.splitMembers, 4);
  assert.equal(parsed.description, 'Vegetables', 'the split words are not part of the description');
  assert.equal(parsed.account.category, 'HDFC Bank');
});

test('WhatsApp: the head count is never mistaken for the amount', () => {
  // The amount is the first standalone number, so the split has to go first.
  const parsed = parseMessage('split 4 1455 vegetables hdfc', ACCOUNTS);

  assert.equal(parsed.amount, 1455);
  assert.equal(parsed.splitMembers, 4);
});

test('WhatsApp: the forms people actually type', () => {
  for (const text of [
    '1455 vegetables split by 4',
    '1455 vegetables split between 4 people',
    '1455 vegetables split 4 ways',
    '1455 vegetables split4'
  ]) {
    assert.equal(parseMessage(text, ACCOUNTS).splitMembers, 4, text);
  }
});

test('WhatsApp: a split that cannot exist is flagged, not quietly dropped', () => {
  const parsed = parseMessage('1455 vegetables split 1', ACCOUNTS);

  assert.equal(parsed.splitInvalid, true);
  assert.equal(parsed.splitMembers, null);
});

test('WhatsApp: an ordinary expense has no split', () => {
  const parsed = parseMessage('250 coffee hdfc', ACCOUNTS);

  assert.equal(parsed.splitMembers, null);
  assert.equal(parsed.splitInvalid, false);
});

test('WhatsApp: "share" on money in marks a repayment, and keeps the words', () => {
  const parsed = parseMessage('+364 Kalai Oct Vegetables share hdfc', ACCOUNTS);

  assert.equal(parsed.kind, 'income');
  assert.equal(parsed.amount, 364);
  assert.equal(parsed.repayment, true);
  // Who paid stays in the record, which is the reason people write it.
  assert.equal(parsed.description, 'Kalai Oct Vegetables share');
  assert.equal(parsed.account.category, 'HDFC Bank');
});

test('WhatsApp: ordinary money in is not a repayment', () => {
  assert.equal(parseMessage('+50000 salary hdfc', ACCOUNTS).repayment, false);
});

test('WhatsApp: "split" on its own asks what is still owed', () => {
  assert.equal(parseMessage('splits', ACCOUNTS).kind, 'splits');
  assert.equal(parseMessage('split', ACCOUNTS).kind, 'splits');
  assert.equal(parseMessage('owed', ACCOUNTS).kind, 'splits');
});
