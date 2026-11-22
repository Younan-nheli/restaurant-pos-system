# Local ESC/POS print agent

This is an initial Node.js worker for a Windows PC on the restaurant LAN. It claims one kitchen, bar, or `other` print job from the POS API and sends raw ESC/POS bytes to a configured Ethernet/Wi-Fi printer over TCP (commonly port 9100).

## Run on Windows

1. Install Node.js 20 or newer on the Windows PC.
2. Copy `.env.example` to `.env` and set the API URL, a station access token, the station group, and the printer's reserved LAN IP/hostname. The start command loads this file using Node.js `--env-file`.
3. Run `npm test`, then `npm start`.
4. Use a test printer or a controlled test ticket before connecting this agent to live kitchen/bar operations.

The `other` group requires a Restaurant Admin token; kitchen and bar station tokens can claim only their own group. The agent can also be run with environment variables injected by Windows Task Scheduler or an approved service wrapper. This package does not yet install itself as a Windows Service.

## Current support and safety boundaries

- TCP raw printing only; USB, Bluetooth, Windows spooler queues, printer discovery and device status queries are not implemented.
- The renderer intentionally supports printable ASCII only. It rejects Arabic and other Unicode text rather than silently producing unreadable paper. Arabic requires a tested raster-image renderer and a selected Windows font/printer profile.
- The server currently issues expiring access tokens and has no refresh-token workflow. A station token must be renewed manually after expiry; automated credential storage/refresh is intentionally not included.
- A successful TCP socket flush is not proof that paper physically emerged. Printer-specific status feedback is not implemented.
- Delivery remains at-least-once. If bytes reach the printer but the API acknowledgement is lost, the agent does not falsely report a failure; the server lease can later expire and the ticket may print twice. Operators must inspect uncertain jobs before manually requeuing them.
- Use HTTPS for the API except loopback development. The printer's raw TCP connection is intended for a trusted, segmented restaurant LAN; do not expose port 9100 to the internet.
- `POS_ACCESS_TOKEN` is a secret. Restrict access to the `.env` file and Windows account, rotate tokens, and never include the file in backups shared outside the restaurant.

## Verification

`npm test` runs unit tests with a fake API and fake printer transport. These tests do not contact PostgreSQL, a real printer, or Windows printer drivers.
