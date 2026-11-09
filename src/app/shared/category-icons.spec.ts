import { categoryIcon } from './category-icons';

describe('categoryIcon', () => {
  it('has an icon for every expense category and income source', () => {
    const names = [
      'Food & Drink', 'Groceries', 'Travel', 'Shopping', 'Bills & Utilities', 'Health',
      'Entertainment', 'Education', 'Family & Gifts',
      'Salary', 'Business', 'Refund', 'Gift', 'Interest', 'Sold something', 'Repayment'
    ];
    const other = categoryIcon('Other');

    for (const name of names) {
      expect(categoryIcon(name)).withContext(name).not.toBe(other);
    }
  });

  it('falls back to the Other dots for anything unknown or missing', () => {
    expect(categoryIcon('Something new')).toBe(categoryIcon('Other'));
    expect(categoryIcon(null)).toBe(categoryIcon('Other'));
    expect(categoryIcon('')).toBe(categoryIcon('Other'));
  });
});
