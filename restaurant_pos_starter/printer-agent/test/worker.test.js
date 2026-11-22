import test from 'node:test';
import assert from 'node:assert/strict';
import { claimNextJob, processClaimedJob } from '../src/worker.js';

const config = {
  apiOrigin: 'https://pos.example.invalid', token: 'test-token', group: 'kitchen',
  printerHost: '192.0.2.20', printerPort: 9100, columns: 42,
  requestTimeoutMs: 1000, printerTimeoutMs: 1000
};
const job = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  routing_group: 'kitchen',
  claim_token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  payload: {
    orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tableId: null, tableName: null,
    createdAt: '2026-11-16T10:15:30.000Z', routingGroup: 'kitchen',
    items: [{ name: 'Soup', quantity: 1, notes: null }]
  }
};
const ok = (status = 200, data = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => data, text: async () => '' });

test('claims one job for the configured station using the bearer token', async () => {
  let request;
  const claimed = await claimNextJob(config, { fetchImpl: async (url, options) => {
    request = { url: String(url), options };
    return ok(200, { job });
  } });
  assert.equal(claimed.id, job.id);
  assert.equal(request.url, 'https://pos.example.invalid/api/v1/print-jobs/claim');
  assert.equal(request.options.headers.authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(request.options.body), { group: 'kitchen' });
});

test('returns no job when the server responds with 204', async () => {
  assert.equal(await claimNextJob(config, { fetchImpl: async () => ok(204) }), null);
});

test('sends bytes before acknowledging the print job', async () => {
  const sequence = [];
  const result = await processClaimedJob(job, config, {
    send: async ({ bytes, host, port }) => {
      assert.ok(Buffer.isBuffer(bytes));
      assert.equal(host, config.printerHost);
      assert.equal(port, config.printerPort);
      sequence.push('printer');
    },
    fetchImpl: async (url, options) => {
      sequence.push('complete');
      assert.match(String(url), /\/print-jobs\/[a-f0-9-]+\/complete$/);
      assert.equal(JSON.parse(options.body).claimToken, job.claim_token);
      return ok();
    },
    logger: { info() {}, error() {} }
  });
  assert.equal(result.status, 'delivered');
  assert.deepEqual(sequence, ['printer', 'complete']);
});

test('reports a printer transport failure without acknowledging completion', async () => {
  const calls = [];
  const result = await processClaimedJob(job, config, {
    send: async () => { throw new Error('printer offline'); },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body) });
      return ok();
    },
    logger: { info() {}, error() {} }
  });
  assert.equal(result.status, 'failed');
  assert.match(calls[0].url, /\/fail$/);
  assert.equal(calls[0].body.claimToken, job.claim_token);
  assert.equal(calls[0].body.error, 'printer offline');
});

test('does not report failure after bytes were sent but server acknowledgement is lost', async () => {
  const calls = [];
  const result = await processClaimedJob(job, config, {
    send: async () => {},
    fetchImpl: async url => {
      calls.push(String(url));
      throw new Error('network lost after print');
    },
    logger: { info() {}, error() {} }
  });
  assert.equal(result.status, 'acknowledgement_unknown');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/complete$/);
});

test('refuses a job from a different station before printing', async () => {
  await assert.rejects(() => processClaimedJob({ ...job, routing_group: 'bar' }, config), /station group/);
});
