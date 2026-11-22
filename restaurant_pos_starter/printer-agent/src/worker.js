import { buildEscPosTicket } from './escpos.js';
import { sendRawTcp } from './transport.js';

function endpoint(config, path) { return new URL(path, `${config.apiOrigin}/`); }

async function apiCall(config, path, { method = 'POST', body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(endpoint(config, path), {
    method,
    headers: {
      authorization: `Bearer ${config.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(config.requestTimeoutMs)
  });
  if (!response.ok && response.status !== 204) {
    const detail = await response.text().catch(() => '');
    throw new Error(`POS API returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }
  return response;
}

export async function claimNextJob(config, { fetchImpl = fetch } = {}) {
  const response = await apiCall(config, '/api/v1/print-jobs/claim', {
    body: { group: config.group }, fetchImpl
  });
  if (response.status === 204) return null;
  const data = await response.json();
  const job = data?.job;
  if (!job || typeof job.id !== 'string' || typeof job.claim_token !== 'string' || job.routing_group !== config.group) {
    throw new Error('POS API returned an invalid or wrong-station print job');
  }
  return job;
}

async function reportFailure(config, job, error, fetchImpl) {
  const message = String(error?.message || error || 'Unknown printer error').slice(0, 500);
  return apiCall(config, `/api/v1/print-jobs/${encodeURIComponent(job.id)}/fail`, {
    body: { claimToken: job.claim_token, error: message }, fetchImpl
  });
}

export async function processClaimedJob(job, config, {
  fetchImpl = fetch,
  send = sendRawTcp,
  logger = console
} = {}) {
  if (!job || job.routing_group !== config.group) throw new Error('Claimed job does not belong to this station group');
  let bytes;
  try {
    bytes = buildEscPosTicket(job, { columns: config.columns });
    await send({
      host: config.printerHost,
      port: config.printerPort,
      bytes,
      timeoutMs: config.printerTimeoutMs
    });
  } catch (error) {
    try {
      await reportFailure(config, job, error, fetchImpl);
      logger.error?.(`Print job ${job.id} failed and was reported to the POS server: ${error.message}`);
      return { status: 'failed', error };
    } catch (reportError) {
      logger.error?.(`Print job ${job.id} failed; reporting the failure also failed: ${reportError.message}`);
      return { status: 'failure_unreported', error, reportError };
    }
  }

  // Once bytes have been sent, never report a printer failure just because the
  // HTTP acknowledgement failed: the paper may already have printed. Let the
  // server lease expire and surface the at-least-once duplicate risk in logs.
  try {
    await apiCall(config, `/api/v1/print-jobs/${encodeURIComponent(job.id)}/complete`, {
      body: { claimToken: job.claim_token }, fetchImpl
    });
    logger.info?.(`Print job ${job.id} delivered to ${config.group} printer`);
    return { status: 'delivered' };
  } catch (error) {
    logger.error?.(`Print job ${job.id} may already be on paper, but server acknowledgement failed; duplicate output is possible after lease expiry: ${error.message}`);
    return { status: 'acknowledgement_unknown', error };
  }
}

function sleep(ms, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(); }
    function onAbort() { done(); }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function runPrintAgent(config, { signal, fetchImpl = fetch, send = sendRawTcp, logger = console } = {}) {
  logger.info?.(`Starting ${config.group} print agent for ${config.printerHost}:${config.printerPort}`);
  while (!signal?.aborted) {
    try {
      const job = await claimNextJob(config, { fetchImpl });
      if (job) await processClaimedJob(job, config, { fetchImpl, send, logger });
      else await sleep(config.pollIntervalMs, signal);
    } catch (error) {
      logger.error?.(`Print agent request failed: ${error.message}`);
      await sleep(config.pollIntervalMs, signal);
    }
  }
  logger.info?.('Print agent stopped');
}
