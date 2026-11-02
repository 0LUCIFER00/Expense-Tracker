import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, guessCategory, normaliseCategory } from '../src/categories.mjs';

test('CATEGORIES has no duplicates and ends with the escape hatch', () => {
  assert.equal(new Set(CATEGORIES).size, CATEGORIES.length);
  assert.equal(CATEGORIES.at(-1), 'Other');
});

test('normaliseCategory accepts a listed category', () => {
  assert.equal(normaliseCategory('Travel'), 'Travel');
  assert.equal(normaliseCategory('Food & Drink'), 'Food & Drink');
});

test('normaliseCategory is forgiving about case and padding', () => {
  assert.equal(normaliseCategory('  travel '), 'Travel');
  assert.equal(normaliseCategory('FOOD & DRINK'), 'Food & Drink');
});

test('normaliseCategory rejects anything not on the list', () => {
  assert.equal(normaliseCategory('Yacht'), null);
  assert.equal(normaliseCategory('Travelling'), null);
});

test('normaliseCategory treats an empty value as no category', () => {
  for (const value of ['', '   ', null, undefined]) {
    assert.equal(normaliseCategory(value), null);
  }
});

test('guessCategory reads the category out of a description', () => {
  assert.equal(guessCategory('Coffee'), 'Food & Drink');
  assert.equal(guessCategory('Sunday groceries'), 'Groceries');
  assert.equal(guessCategory('bus ticket to work'), 'Travel');
  assert.equal(guessCategory('Electricity bill'), 'Bills & Utilities');
  assert.equal(guessCategory('medicine for mom'), 'Health');
});

test('guessCategory is case-insensitive and ignores punctuation', () => {
  assert.equal(guessCategory('CHAI!'), 'Food & Drink');
  assert.equal(guessCategory('Movie, with friends'), 'Entertainment');
});

test('guessCategory only matches whole words', () => {
  // "busy" contains "bus"; filing it under Travel would be a wrong guess.
  assert.equal(guessCategory('busy week'), null);
  assert.equal(guessCategory('bookshelf'), null);
});

test('guessCategory returns null when nothing gives it away', () => {
  assert.equal(guessCategory('Expense'), null);
  assert.equal(guessCategory(''), null);
  assert.equal(guessCategory(null), null);
});

test('every guess is a category the API would accept', () => {
  const samples = [
    'coffee', 'groceries', 'bus', 'shopping', 'recharge',
    'doctor', 'movie', 'books', 'gift'
  ];

  for (const sample of samples) {
    const guess = guessCategory(sample);

    assert.notEqual(guess, null, `"${sample}" should be recognised`);
    assert.equal(normaliseCategory(guess), guess, `"${guess}" is not on the list`);
  }
});
