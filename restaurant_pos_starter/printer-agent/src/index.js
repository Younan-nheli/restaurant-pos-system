import { readConfig } from './config.js';
import { runPrintAgent } from './worker.js';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

try {
  const config = readConfig();
  await runPrintAgent(config, { signal: controller.signal });
} catch (error) {
  // Never print environment values or the access token.
  console.error(`Printer agent could not start: ${error.message}`);
  process.exitCode = 1;
}
