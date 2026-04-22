# Requirement 2 Report Summary

## What was implemented

Requirement 2 was implemented as a real brute-force mitigation layer for Stockd’s actual architecture:

- a new protected Supabase Edge Function login proxy in `supabase/functions/auth-login/`
- server-side login attempt tracking in Postgres via `auth_bruteforce_guards`
- escalating temporary lockouts after repeated failed sign-in attempts
- a threshold-triggered verification challenge for repeated web login failures
- kiosk hardening that removes the demo password from client-side JavaScript and routes kiosk bootstrap through the protected login function
- a lower baseline Supabase Auth rate limit in `supabase/config.toml`

## Why it matters

Before this pass, Stockd’s web login and kiosk both relied on direct browser-side password sign-in with no Stockd-owned throttling. That meant repeated rapid guesses were not meaningfully controlled inside the repo.

The new implementation makes repeated password guessing much harder by:

- slowing attackers down with lockouts
- blocking unlimited rapid retries
- requiring an extra verification step after repeated failures
- resetting counters only after successful authentication

## Patterns and technologies used

- Supabase Edge Function as a login gateway
- Postgres-backed guard-state table for attempt tracking
- hashed identifier/device/IP scope keys instead of raw values
- HMAC-signed lightweight challenge tokens
- client-side cooldown UX that mirrors server-enforced `retry_after_ms`
- targeted runnable verification via `npm run test:bruteforce`

## Example attacks now mitigated

- repeated wrong-password attempts against `Frontend/login.html` now escalate to challenge and then temporary lockout
- kiosk sign-in can no longer be attacked by scraping a shipped password from `kiosk/kiosk.js`
- automated retry loops are slowed by both server-side lockouts and kiosk/browser backoff behavior

## Security posture improvement

This change moves Stockd from “direct browser password login with effectively unlimited rapid guessing” to “protected login flows with server-side attempt tracking, lockout behavior, and a demonstrable anti-automation step.” It is not a full enterprise auth platform, but it is a concrete and defensible brute-force protection implementation for the current Supabase-based repo.
