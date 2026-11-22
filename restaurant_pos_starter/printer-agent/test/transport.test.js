import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { sendRawTcp } from '../src/transport.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

test('sends the exact ESC/POS byte sequence to a local TCP test receiver', async () => {
  const received = [];
  const server = net.createServer(socket => {
    socket.on('data', chunk => received.push(chunk));
  });
  const port = await listen(server);
  try {
    const expected = Buffer.from([0x1b, 0x40, 0x48, 0x49, 0x0a, 0x1d, 0x56, 0x01]);
    await sendRawTcp({ host: '127.0.0.1', port, bytes: expected, timeoutMs: 2000 });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(Buffer.concat(received), expected);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('rejects empty or non-buffer printer payloads before opening a connection', async () => {
  await assert.rejects(() => sendRawTcp({ host: '127.0.0.1', port: 9100, bytes: Buffer.alloc(0) }), /Non-empty/);
  await assert.rejects(() => sendRawTcp({ host: '127.0.0.1', port: 9100, bytes: 'text' }), /Non-empty/);
});
