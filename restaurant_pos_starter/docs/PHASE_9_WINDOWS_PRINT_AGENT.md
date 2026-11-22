# Phase 9 – Initial Windows TCP ESC/POS print agent

## Implemented

- Added a standalone Node.js 20+ print-agent package under `printer-agent/`, with no third-party runtime dependencies.
- The worker authenticates with a station access token and claims only the configured `kitchen`, `bar`, or `other` group. Tenant identity continues to be derived by the API from the signed account; the agent never sends a restaurant ID.
- Added a bounded configuration loader. Remote API origins must use HTTPS; HTTP is accepted only for loopback development. Printer host, port, column width and timeouts are validated.
- Added an ESC/POS ticket renderer with initialization, code-page selection, centered station heading, order/table/time snapshot, quantities, notes, line feed and optional partial cut.
- Order creation now snapshots the dining table's display name into the durable print payload, so a later table rename does not rewrite an already-created ticket.
- Added raw TCP transport for Ethernet/Wi-Fi printers and a sequential polling worker.
- A printer transport failure is reported to the server using the existing claim token. Completion is acknowledged only after the local socket reports its write stream finished.
- If the bytes were sent but the API completion request fails, the agent does not report a false printer failure; it logs that output is uncertain and a duplicate is possible after lease expiry.

## Important limitations

- The renderer supports printable ASCII only. It rejects Arabic and other Unicode characters instead of printing mojibake. Arabic requires a raster-image renderer using a tested Windows font and printer profile.
- Only raw TCP printers are supported. USB, Bluetooth, Windows spooler queues, discovery, paper/cover status and model-specific command differences are not implemented.
- TCP stream completion only means bytes were flushed by the local socket; it is not a physical-paper confirmation.
- Delivery remains at-least-once, not exactly-once. A printer can receive the ticket while the acknowledgement is lost, leading to a duplicate after the 120-second lease expires.
- Access tokens expire and the API has no refresh-token workflow yet. Renew the station token manually and restart the agent when it expires. Do not store restaurant admin credentials in the agent.
- The package is a console worker, not an installed Windows Service. Use a controlled Task Scheduler or approved service wrapper if needed.

## Verification

- Server unit suite: run `cd server && npm test`.
- Agent unit suite: run `cd printer-agent && npm test`.
- Agent tests use fake fetch and fake printer transport. No PostgreSQL, Windows machine, network printer or physical paper test was available in this development environment.

## Safe test procedure

1. Use a dedicated test restaurant and station account, never a production token.
2. Configure the printer to a reserved LAN address on a segmented local network.
3. Verify the correct station account can claim only its own group.
4. Print a single controlled test order, check text alignment, wrapping and cutter behavior, then inspect the server job status.
5. Simulate printer-offline and API-acknowledgement-loss cases before enabling automatic operation.
