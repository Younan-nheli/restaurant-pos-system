import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaiterSessionStore } from '../src/sessionStore.js';

const session = {
  accessToken: 'signed-token',
  user: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    restaurantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    role: 'waiter', email: 'waiter@example.test'
  }
};

function fakeSecureStore() {
  const values = new Map();
  return {
    values,
    getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => values.set(key, value),
    deleteItemAsync: async key => values.delete(key)
  };
}

test('stores and restores the session through the secure-store adapter', async () => {
  const secure = fakeSecureStore();
  const store = createWaiterSessionStore(secure);
  await store.save(session);
  assert.deepEqual(await store.load(), session);
  assert.equal([...secure.values.values()].some(value => value.includes('password')), false);
  await store.clear();
  assert.equal(await store.load(), null);
});

test('rejects invalid roles and removes malformed secure-store contents', async () => {
  const secure = fakeSecureStore();
  const store = createWaiterSessionStore(secure);
  await assert.rejects(() => store.save({ ...session, user: { ...session.user, role: 'master_admin' } }), /Invalid waiter session/);
  secure.values.set('restaurant-pos.waiter.session.v1', '{broken');
  assert.equal(await store.load(), null);
  assert.equal(secure.values.size, 0);
});
