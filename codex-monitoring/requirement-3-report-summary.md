# Requirement 3 Report Summary

## What was implemented

Requirement 3 added a real monitoring and security-analysis layer to Stockd:

- a structured event log stored in Supabase (`monitoring_events`)
- server-side logging for auth and Copilot security-relevant events
- authenticated client-side logging for CSV uploads, suspicious input, inventory receive actions, and physical count submissions
- a deterministic analysis pipeline that exports raw logs, a JSON summary, and a readable markdown report
- an optional AI-assisted summary step that explains the findings in plain English without replacing the deterministic detection logic
- a screenshotable monitoring page at `Frontend/pages/security-monitoring.html`

## Why it matters

Before this enhancement, Stockd had preventive controls but limited visibility. Security-relevant behavior was spread across console output and UI state, which made it hard to prove that the app was actually monitoring suspicious activity.

This requirement closes that gap by making it possible to say:

- we log structured security-relevant events
- we analyze those logs for suspicious patterns
- we can generate artifacts and UI evidence for a report or demo

## What is logged

Examples of logged events include:

- login successes and failures
- brute-force challenge and lockout events
- kiosk login attempts
- CSV upload attempts and validation failures
- suspicious sanitized/rejected input
- inventory receive actions
- inventory count submissions
- Copilot access rejections for disallowed RPC/table/filter/order requests

Sensitive values such as passwords, tokens, raw IPs, and raw identifiers are not stored in plaintext. Hashing and metadata redaction are applied before persistence.

## Deterministic vs AI-assisted analysis

The monitoring analysis is deterministic first:

- repeated failed logins
- lockout bursts
- suspicious input events
- high event volume from one source/device
- malformed CSV upload spikes
- top event-category summaries

AI is optional and only used to summarize those findings more clearly when enabled with `OPENAI_API_KEY`. If AI is unavailable, the system falls back to a deterministic narrative.

## Security posture improvement

This enhancement moves Stockd from “security controls exist, but evidence is fragmented” to “security-relevant traffic is logged, summarized, and explainable.” It gives the project a practical monitoring story that is easy to defend in front of an instructor and easy to include in the final report with both screenshots and generated artifacts.
