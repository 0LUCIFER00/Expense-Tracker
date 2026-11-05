import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAGS, permissionsFor } from '../src/settings-store.mjs';

/*
 * The real rule, not a copy of it. This file used to restate the logic in a
 * local function, so the tests would have kept passing whatever the server
 * actually did; permissionsFor is now the one both use.
 */
const derive = permissionsFor;

const ALL_ON = {
  balanceUserAccess: true,
  addMoneyUserAccess: true,
  whatsappBalanceUserAccess: true,
  expenseUserAccess: true,
  updatePermissionUser: true,
  viewPermissionUser: true,
  removePermissionUser: true
};

test('both new flags are stored', () => {
  assert.equal(FLAGS.addMoneyUserAccess, 'add_money_user_access');
  assert.equal(FLAGS.whatsappBalanceUserAccess, 'whatsapp_balance_user_access');
});

test('everything granted lets everything through', () => {
  const p = derive(ALL_ON, 'user');

  assert.equal(p.canSeeBalances, true);
  assert.equal(p.canAddMoney, true);
  assert.equal(p.canSeeBalancesOnWhatsapp, true);
});

test('Add Money is independent of seeing balances', () => {
  const hidden = derive({ ...ALL_ON, balanceUserAccess: false }, 'user');
  assert.equal(hidden.canAddMoney, true, 'the page stays reachable');

  const off = derive({ ...ALL_ON, addMoneyUserAccess: false }, 'user');
  assert.equal(off.canSeeBalances, true, 'balances stay visible elsewhere');
  assert.equal(off.canAddMoney, false);
});

// A phone is a screen someone else might see, so the master switch still wins.
test('hiding balances hides them over WhatsApp too, whatever that flag says', () => {
  const p = derive(
    { ...ALL_ON, balanceUserAccess: false, whatsappBalanceUserAccess: true },
    'user'
  );

  assert.equal(p.canSeeBalancesOnWhatsapp, false);
});

test('WhatsApp balances can be switched off on their own', () => {
  const p = derive({ ...ALL_ON, whatsappBalanceUserAccess: false }, 'user');

  assert.equal(p.canSeeBalances, true, 'still visible on the website');
  assert.equal(p.canSeeBalancesOnWhatsapp, false);
});

test('retyping a balance needs both seeing it and debiting from it', () => {
  assert.equal(derive(ALL_ON, 'user').canManageBalances, true);
  assert.equal(derive({ ...ALL_ON, expenseUserAccess: false }, 'user').canManageBalances, false);
  assert.equal(derive({ ...ALL_ON, balanceUserAccess: false }, 'user').canManageBalances, false);
  assert.equal(
    derive({ ...ALL_ON, balanceUserAccess: false, expenseUserAccess: false }, 'admin')
      .canManageBalances,
    true
  );
});

test('an admin is narrowed by neither', () => {
  const p = derive(
    { balanceUserAccess: false, addMoneyUserAccess: false, whatsappBalanceUserAccess: false },
    'admin'
  );

  assert.equal(p.canSeeBalances, true);
  assert.equal(p.canAddMoney, true);
  assert.equal(p.canSeeBalancesOnWhatsapp, true);
});
