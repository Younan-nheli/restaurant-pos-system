# Phase 14 — Local/cloud endpoint routing and bilingual waiter UI

## Implemented

- Added local-first API origin configuration using `EXPO_PUBLIC_POS_LOCAL_API_ORIGIN` and `EXPO_PUBLIC_POS_CLOUD_API_ORIGIN`.
- Retained the older `EXPO_PUBLIC_POS_API_ORIGIN` as a single-origin compatibility option.
- API requests try the local origin first and fall back to cloud only when the request fails at the transport/network layer. HTTP responses are never treated as a signal to switch origins.
- Order sync uses the same persisted idempotency key when retrying against the cloud origin after a local network failure.
- Added Arabic and English UI dictionaries and an in-app language switch. Arabic uses RTL-oriented alignment/row direction; English uses left-to-right alignment/row direction.
- Added tests for origin ordering, HTTPS restrictions, local-to-cloud network fallback, no fallback after HTTP authorization errors, and reuse of the same order idempotency key.

## Required deployment topology — not implemented by this client change

The configured local and cloud origins MUST front the same logical tenant data and use compatible shared authentication signing keys. The client does not replicate PostgreSQL databases or reconcile independent local/cloud writes. If local and cloud servers have separate databases, this fallback design must not be enabled; a server-to-server replication/outbox protocol with conflict handling and tenant-scoped credentials is required first.

A local server reached over Wi-Fi must expose HTTPS with a certificate trusted by the Android device. Plain HTTP is accepted only for loopback development. Do not disable TLS validation or embed credentials in Expo public environment variables.

## Verification boundaries

- Automated Node tests cover the client configuration, network fallback policy, and idempotent retry key preservation.
- The Expo Android app was not built or run on a physical Android device in this environment.
- No local/cloud server pair, shared PostgreSQL deployment, TLS certificate, or replication topology was provisioned or integration-tested.
- The language switch is client UI localization; catalog names remain in the language stored by the restaurant and are not machine-translated.
