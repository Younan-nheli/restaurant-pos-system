const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WAITER_ROLES = new Set(['waiter', 'restaurant_admin']);

export class WaiterApiError extends Error {
  constructor(status, code = 'request_failed') {
    super(code);
    this.name = 'WaiterApiError';
    this.status = status;
    this.code = typeof code === 'string' && /^[a-z0-9_-]{1,80}$/.test(code) ? code : 'request_failed';
  }
}

export function validateApiOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('apiOrigin must be an absolute HTTP(S) origin'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol !== 'https:' && !loopback) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('apiOrigin must be HTTPS (HTTP is allowed only for loopback development)');
  }
  return url.origin;
}

function requireUser(user) {
  if (!user || typeof user !== 'object' || Array.isArray(user) ||
      !UUID.test(user.id || '') || !UUID.test(user.restaurantId || '') ||
      !WAITER_ROLES.has(user.role) || typeof user.email !== 'string' ||
      user.email.length < 3 || user.email.length > 254) {
    throw new TypeError('Server returned an invalid waiter identity');
  }
  return Object.freeze({ id: user.id.toLowerCase(), restaurantId: user.restaurantId.toLowerCase(), role: user.role, email: user.email });
}

async function readJson(response) {
  try {
    const value = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function createWaiterApi({ apiOrigin, apiOrigins, fetchImpl = fetch }) {
  const origins = apiOrigins ? [...new Set(apiOrigins.map(validateApiOrigin))] : [validateApiOrigin(apiOrigin)];
  if (!origins.length) throw new TypeError('At least one API origin is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

  async function request(path, { method = 'GET', token, body } = {}) {
    const headers = { accept: 'application/json' };
    if (token !== undefined) {
      if (typeof token !== 'string' || token.length < 1 || token.length > 8192) throw new TypeError('A valid access token is required');
      headers.authorization = `Bearer ${token}`;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response;
    for (const origin of origins) {
      try {
        response = await fetchImpl(new URL(path, `${origin}/`), {
          method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        break;
      } catch {
        // Only transport failures may fall through to the next configured origin.
      }
    }
    if (!response) throw new WaiterApiError(0, 'network_error');
    const data = await readJson(response);
    if (!response.ok) throw new WaiterApiError(response.status, data.error);
    return data;
  }

  async function login({ email, password }) {
    if (typeof email !== 'string' || email.trim().length < 3 || email.length > 254 ||
        typeof password !== 'string' || password.length < 1 || password.length > 1024) {
      throw new TypeError('Email and password are required');
    }
    const data = await request('/api/v1/auth/login', {
      method: 'POST', body: { email: email.trim().toLowerCase(), password }
    });
    if (typeof data.accessToken !== 'string' || data.accessToken.length < 1 || data.accessToken.length > 8192) {
      throw new WaiterApiError(502, 'invalid_server_response');
    }
    return Object.freeze({ accessToken: data.accessToken, user: requireUser(data.user) });
  }

  async function getMe(accessToken) {
    const data = await request('/api/v1/auth/me', { token: accessToken });
    return requireUser(data);
  }

  async function getCatalog(accessToken, expectedRestaurantId) {
    if (!UUID.test(expectedRestaurantId || '')) throw new TypeError('expectedRestaurantId must be a UUID');
    const data = await request('/api/v1/waiter/catalog', { token: accessToken });
    if (data.restaurantId !== expectedRestaurantId) throw new WaiterApiError(502, 'catalog_tenant_mismatch');
    if (!data.restaurant || !Array.isArray(data.categories) || !Array.isArray(data.items) ||
        !Array.isArray(data.serviceAreas) || !Array.isArray(data.tables)) {
      throw new WaiterApiError(502, 'invalid_catalog_response');
    }
    return data;
  }

  return Object.freeze({ login, getMe, getCatalog });
}
