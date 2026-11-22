import net from 'node:net';

/**
 * Sends raw ESC/POS bytes to an Ethernet/Wi-Fi printer listening on TCP.
 * The 'finish' event confirms the local socket flushed its buffer, not that
 * paper physically emerged from the printer.
 */
export function sendRawTcp({ host, port = 9100, bytes, timeoutMs = 5000, createConnection = net.createConnection }) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return Promise.reject(new TypeError('Non-empty printer bytes are required'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = createConnection({ host, port });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error('Printer TCP connection timed out')));
    socket.once('error', error => finish(error));
    socket.once('connect', () => {
      socket.end(bytes);
    });
    socket.once('finish', () => finish(null));
  });
}
