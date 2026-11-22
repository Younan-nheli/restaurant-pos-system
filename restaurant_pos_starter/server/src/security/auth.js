export const ROLES = Object.freeze(['master_admin','restaurant_admin','waiter','cashier','kitchen','bar']);

export function isValidIdentity(user) {
  return Boolean(user && typeof user.id === 'string' && ROLES.includes(user.role) &&
    (user.role === 'master_admin' ? user.restaurant_id === null : typeof user.restaurant_id === 'string'));
}

export function canAccessRestaurant(user, restaurantId) {
  if (!user || typeof restaurantId !== 'string' || !restaurantId) return false;
  return user.role === 'master_admin' || user.restaurant_id === restaurantId;
}

export function requireRole(user, allowedRoles) {
  return Boolean(user && Array.isArray(allowedRoles) && allowedRoles.includes(user.role));
}

export function isTokenIdentityCurrent(claims, user) {
  return Boolean(claims && user && user.active === true && claims.sub === user.id &&
    claims.role === user.role && (claims.restaurantId ?? null) === (user.restaurant_id ?? null));
}
