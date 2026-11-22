const KEY = 'restaurant-pos.waiter.session.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set(['waiter', 'restaurant_admin']);

function normalizeSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.accessToken !== 'string' || value.accessToken.length < 1 || value.accessToken.length > 8192 ||
      !value.user || typeof value.user !== 'object' || !UUID.test(value.user.id || '') ||
      !UUID.test(value.user.restaurantId || '') || !ROLES.has(value.user.role) ||
      typeof value.user.email !== 'string' || value.user.email.length < 3 || value.user.email.length > 254) {
    throw new TypeError('Invalid waiter session');
  }
  return {
    accessToken: value.accessToken,
    user: {
      id: value.user.id.toLowerCase(), restaurantId: value.user.restaurantId.toLowerCase(),
      role: value.user.role, email: value.user.email
    }
  };
}

/** Stores the bearer token and minimal identity only in the OS secure store, never SQLite. */
export function createWaiterSessionStore(secureStore) {
  if (typeof secureStore?.getItemAsync !== 'function' || typeof secureStore?.setItemAsync !== 'function' ||
      typeof secureStore?.deleteItemAsync !== 'function') {
    throw new TypeError('secureStore must implement getItemAsync, setItemAsync and deleteItemAsync');
  }

  async function save(session) {
    const normalized = normalizeSession(session);
    await secureStore.setItemAsync(KEY, JSON.stringify(normalized));
    return normalized;
  }

  async function load() {
    const raw = await secureStore.getItemAsync(KEY);
    if (raw == null) return null;
    try { return normalizeSession(JSON.parse(raw)); }
    catch {
      await secureStore.deleteItemAsync(KEY);
      return null;
    }
  }

  async function clear() {
    await secureStore.deleteItemAsync(KEY);
  }

  return Object.freeze({ save, load, clear });
}
