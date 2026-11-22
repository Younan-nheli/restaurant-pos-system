import { validateApiOrigin } from './apiClient.js';

/**
 * Local-first endpoints for one logical POS environment. Both origins MUST
 * serve the same tenant database and share authentication signing keys.
 * Fallback is only safe for network failures; HTTP responses never fail over.
 */
export function createWaiterApiOrigins({ localApiOrigin = '', cloudApiOrigin = '', legacyApiOrigin = '' } = {}) {
  const raw = [localApiOrigin, cloudApiOrigin, legacyApiOrigin].filter(value => typeof value === 'string' && value.trim());
  const origins = [...new Set(raw.map(value => validateApiOrigin(value.trim())))];
  if (!origins.length) throw new TypeError('Configure a local or cloud POS API origin');
  return Object.freeze(origins);
}

export function getWaiterApiEnvironment(env = process.env) {
  return createWaiterApiOrigins({
    localApiOrigin: env.EXPO_PUBLIC_POS_LOCAL_API_ORIGIN || '',
    cloudApiOrigin: env.EXPO_PUBLIC_POS_CLOUD_API_ORIGIN || '',
    legacyApiOrigin: env.EXPO_PUBLIC_POS_API_ORIGIN || ''
  });
}
