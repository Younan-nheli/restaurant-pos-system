import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, validatePassword } from '../src/security/passwords.js';
import { signAccessToken, verifyAccessToken } from '../src/security/tokens.js';
import { canAccessRestaurant, isTokenIdentityCurrent, isValidIdentity, requireRole } from '../src/security/auth.js';

const secret = 'test-secret-with-at-least-thirty-two-bytes-long';

test('password hashing verifies only the correct password', async () => {
  const hash = await hashPassword('correct-horse-battery-77');
  assert.notEqual(hash, 'correct-horse-battery-77');
  assert.equal(await verifyPassword('correct-horse-battery-77', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
});

test('password policy rejects short passwords', () => {
  assert.throws(() => validatePassword('short'), /12 and 200/);
});

test('access tokens validate signature and expiry', () => {
  const token = signAccessToken({ sub: 'u-1', role: 'restaurant_admin', restaurantId: 'r-1' }, secret, 60, 1000);
  assert.equal(verifyAccessToken(token, secret, 1020).sub, 'u-1');
  assert.equal(verifyAccessToken(token, secret, 1060), null);
  assert.equal(verifyAccessToken(token + 'x', secret, 1020), null);
});

test('tenant access is isolated except for platform master admin', () => {
  const user = { id: 'u1', role: 'restaurant_admin', restaurant_id: 'r1' };
  assert.equal(isValidIdentity(user), true);
  assert.equal(canAccessRestaurant(user, 'r1'), true);
  assert.equal(canAccessRestaurant(user, 'r2'), false);
  assert.equal(canAccessRestaurant({ role: 'master_admin' }, 'r2'), true);
  assert.equal(requireRole(user, ['restaurant_admin']), true);
});

test('a token stops working when the account is disabled or its role/tenant changes', () => {
  const claims = { sub: 'u1', role: 'waiter', restaurantId: 'r1' };
  const activeUser = { id: 'u1', role: 'waiter', restaurant_id: 'r1', active: true };
  assert.equal(isTokenIdentityCurrent(claims, activeUser), true);
  assert.equal(isTokenIdentityCurrent(claims, { ...activeUser, active: false }), false);
  assert.equal(isTokenIdentityCurrent(claims, { ...activeUser, role: 'restaurant_admin' }), false);
  assert.equal(isTokenIdentityCurrent(claims, { ...activeUser, restaurant_id: 'r2' }), false);
});
