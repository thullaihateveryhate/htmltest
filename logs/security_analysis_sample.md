# Stockd Monitoring Analysis

Generated at: 2026-04-22T09:18:00.000Z
Source: fixture

## Executive Summary

Monitoring flagged 5 suspicious patterns in the analyzed window. The most significant issue was "high event volume from one source", which accounted for 9 related events.

## Traffic Overview

- Total events analyzed: 16
- Last hour: 3 events
- Last 24 hours: 16 events
- Last 7 days: 16 events

## Security-Relevant Counters

- Login failures: 3
- Login successes: 1
- Brute-force challenges: 1
- Brute-force lockouts: 2
- Suspicious input events: 1
- CSV validation failures: 2
- Copilot access rejections: 1

## Top Security-Relevant Event Types

- login_failure: 3
- bruteforce_lockout_triggered: 2
- csv_upload_attempted: 2
- csv_validation_failure: 2
- bruteforce_challenge_triggered: 1
- copilot_security_rejection: 1
- inventory_count_submission: 1
- inventory_receive_action: 1

## Suspicious Findings

- [MEDIUM] High event volume from one source: 9 monitored events were associated with the same hashed client/user scope.
- [MEDIUM] Repeated failed logins detected: 3 failed logins were recorded for the same hashed identifier/device scope.
- [MEDIUM] Lockout burst detected: 2 lockout events occurred inside the same 15-minute window.
- [MEDIUM] Suspicious input attempts recorded: 1 security-relevant input events were detected or rejected.
- [MEDIUM] Malformed CSV upload activity detected: 1 CSV validation failures were recorded, with 14 rejected rows in total.

## Recent Event Preview

| Time | Event | Severity | Source | Flow |
| --- | --- | --- | --- | --- |
| 2026-04-22T09:18:00.000Z | login_success | info | auth_edge | web_login |
| 2026-04-22T09:15:05.000Z | csv_validation_failure | warning | frontend | onboarding_sales_history |
| 2026-04-22T09:15:00.000Z | csv_upload_attempted | info | frontend | onboarding_sales_history |
| 2026-04-21T15:00:00.000Z | copilot_security_rejection | warning | copilot_edge | copilot_data_access |
| 2026-04-21T14:20:00.000Z | inventory_count_submission | info | frontend | physical_count |
| 2026-04-21T14:00:00.000Z | inventory_receive_action | info | frontend | manual_receive |
| 2026-04-21T13:10:20.000Z | suspicious_input_detected | warning | frontend | daily_sales_upload |
| 2026-04-21T13:10:10.000Z | csv_validation_failure | warning | frontend | daily_sales_upload |
| 2026-04-21T13:10:00.000Z | csv_upload_attempted | info | frontend | daily_sales_upload |
| 2026-04-21T12:06:40.000Z | bruteforce_lockout_triggered | warning | auth_edge | kiosk_login |
