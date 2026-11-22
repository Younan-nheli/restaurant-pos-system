const RETRY_DELAY_SECONDS = Object.freeze([0, 5, 15, 30, 60, 0]);

/**
 * Returns a bounded server-side delay after a failed print attempt.
 * Attempt five is terminal in the current print-job policy and is not retried.
 */
export function printRetryDelaySeconds(attemptCount) {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1 || attemptCount > 5) {
    throw new RangeError('attemptCount must be an integer between 1 and 5');
  }
  return RETRY_DELAY_SECONDS[attemptCount];
}

// This SQL fragment is assembled only from the fixed numeric policy above.
// The database applies it to the persisted attempt_count, never a client value.
export const PRINT_RETRY_DELAY_INTERVAL_SQL = `CASE attempt_count ${[1, 2, 3, 4, 5]
  .map(attempt => `WHEN ${attempt} THEN interval '${printRetryDelaySeconds(attempt)} seconds'`)
  .join(' ')} ELSE interval '0 seconds' END`;
