const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_MICROSECOND_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/;

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = UTC_MICROSECOND_TIMESTAMP.exec(value);
  if (!match) return false;
  const millisecondIso = `${value.slice(0, 19)}.${match[7].slice(0, 3)}Z`;
  const date = new Date(millisecondIso);
  return Number.isFinite(date.getTime()) && date.toISOString() === millisecondIso;
}

/** Opaque, versioned keyset cursor. It is a paging hint, never an authorization token. */
export function encodeTicketCursor({ createdAt, itemId }) {
  if (!isCanonicalUtcTimestamp(createdAt) || typeof itemId !== 'string' || !UUID.test(itemId)) {
    throw new TypeError('Invalid ticket cursor fields');
  }
  return Buffer.from(JSON.stringify({ v: 1, createdAt, itemId }), 'utf8').toString('base64url');
}

export function decodeTicketCursor(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError('Invalid ticket cursor');
  }

  let parsed;
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new Error('non-canonical base64url');
    parsed = JSON.parse(decoded.toString('utf8'));
  } catch {
    throw new TypeError('Invalid ticket cursor');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      Object.keys(parsed).sort().join(',') !== 'createdAt,itemId,v' || parsed.v !== 1 ||
      !isCanonicalUtcTimestamp(parsed.createdAt) || typeof parsed.itemId !== 'string' || !UUID.test(parsed.itemId)) {
    throw new TypeError('Invalid ticket cursor');
  }
  return Object.freeze({ createdAt: parsed.createdAt, itemId: parsed.itemId });
}
