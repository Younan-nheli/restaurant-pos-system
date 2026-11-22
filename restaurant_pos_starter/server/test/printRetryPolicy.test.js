import test from 'node:test';
import assert from 'node:assert/strict';
import { printRetryDelaySeconds } from '../src/domain/printRetryPolicy.js';

test('print retries use a bounded backoff instead of exhausting attempts immediately', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(printRetryDelaySeconds), [5, 15, 30, 60, 0]);
});

test('print retry policy rejects invalid attempt counts', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, 6, '2']) {
    assert.throws(() => printRetryDelaySeconds(value), /attemptCount/);
  }
});

test('SQL retry expression is generated from the tested server policy', async () => {
  const { PRINT_RETRY_DELAY_INTERVAL_SQL } = await import('../src/domain/printRetryPolicy.js');
  assert.equal(
    PRINT_RETRY_DELAY_INTERVAL_SQL,
    "CASE attempt_count WHEN 1 THEN interval '5 seconds' WHEN 2 THEN interval '15 seconds' WHEN 3 THEN interval '30 seconds' WHEN 4 THEN interval '60 seconds' WHEN 5 THEN interval '0 seconds' ELSE interval '0 seconds' END"
  );
});
