import { createHmac, timingSafeEqual } from 'node:crypto';

function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }

export function signAccessToken(claims, secret, ttlSeconds = 28800, nowSeconds = Math.floor(Date.now()/1000)) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET must contain at least 32 bytes');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ ...claims, iat: nowSeconds, exp: nowSeconds + ttlSeconds });
  const body = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyAccessToken(token, secret, nowSeconds = Math.floor(Date.now()/1000)) {
  if (typeof token !== 'string' || typeof secret !== 'string' || Buffer.byteLength(secret) < 32) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const body = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', secret).update(body).digest();
  let supplied;
  try { supplied = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || !claims.sub || !claims.role || !Number.isInteger(claims.exp) || claims.exp <= nowSeconds) return null;
    return claims;
  } catch { return null; }
}
