import net from 'node:net';

function integer(value, fallback, min, max, name) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function validHost(host) {
  if (typeof host !== 'string' || host.length < 1 || host.length > 253 || /[\s/\\]/.test(host)) return false;
  if (net.isIP(host)) return true;
  return host.split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
}

export function readConfig(env = process.env) {
  const apiValue = env.POS_API_URL;
  const token = env.POS_ACCESS_TOKEN;
  const group = env.POS_PRINT_GROUP;
  const host = env.PRINTER_HOST;
  if (!apiValue || !token || !group || !host) {
    throw new Error('POS_API_URL, POS_ACCESS_TOKEN, POS_PRINT_GROUP and PRINTER_HOST are required');
  }
  let apiUrl;
  try { apiUrl = new URL(apiValue); } catch { throw new Error('POS_API_URL must be a valid absolute URL'); }
  if (!['https:', 'http:'].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash || apiUrl.pathname !== '/') {
    throw new Error('POS_API_URL must be an origin-only HTTP(S) URL without credentials, path, query or fragment');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(apiUrl.hostname.replace(/^\[|\]$/g, ''));
  if (apiUrl.protocol !== 'https:' && !loopback) {
    throw new Error('POS_API_URL must use HTTPS except for loopback development');
  }
  if (!['kitchen', 'bar', 'other'].includes(group)) throw new Error('POS_PRINT_GROUP must be kitchen, bar or other');
  if (!validHost(host)) throw new Error('PRINTER_HOST must be a valid IP address or DNS hostname');
  return Object.freeze({
    apiOrigin: apiUrl.origin,
    token,
    group,
    printerHost: host,
    printerPort: integer(env.PRINTER_PORT, 9100, 1, 65535, 'PRINTER_PORT'),
    columns: integer(env.PRINTER_COLUMNS, 42, 24, 64, 'PRINTER_COLUMNS'),
    pollIntervalMs: integer(env.POLL_INTERVAL_MS, 2000, 250, 60000, 'POLL_INTERVAL_MS'),
    requestTimeoutMs: integer(env.REQUEST_TIMEOUT_MS, 8000, 500, 60000, 'REQUEST_TIMEOUT_MS'),
    printerTimeoutMs: integer(env.PRINTER_TIMEOUT_MS, 5000, 500, 30000, 'PRINTER_TIMEOUT_MS')
  });
}
