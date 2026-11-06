import { initialsOf } from './initials';

describe('initialsOf', () => {
  it('uses the first letter of a one-word name', () => {
    expect(initialsOf('Test')).toBe('T');
    expect(initialsOf('test')).toBe('T');
  });

  it('uses the first letters of the first and last words', () => {
    expect(initialsOf('Prajwal M')).toBe('PM');
    expect(initialsOf('  anil   kumar rao ')).toBe('AR');
  });

  it('is empty without a name', () => {
    expect(initialsOf('')).toBe('');
    expect(initialsOf('   ')).toBe('');
    expect(initialsOf(null)).toBe('');
  });
});
