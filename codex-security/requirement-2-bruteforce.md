# Requirement 2: Brute-Force Login Protection

## 1. Why this requirement applies

Stockd’s auth story is not a monolithic Node/Express login backend. The real repo architecture is:

- static frontend pages in `Frontend/`
- Supabase Auth for password sign-in
- browser-side Supabase clients in `Frontend/js/supabase-client.js`
- a kiosk sidecar in `kiosk/`
- Supabase Edge Functions for custom server-side logic

That still leaves real brute-force risk if repeated password guesses are not controlled.

Before this pass:

- `Frontend/login.html` called `sb.auth.signInWithPassword(...)` directly from the browser
- `kiosk/kiosk.js` contained hardcoded demo credentials and also called `sb.auth.signInWithPassword(...)` directly
- there was no Stockd-owned server-side attempt counter, lockout, or challenge step
- the local Supabase config allowed `30` sign-in/sign-up requests per 5 minutes per IP in `supabase/config.toml`

So even though Stockd is “just a Supabase-backed prototype,” this requirement clearly applies to the user-visible login paths.

## 2. Login and auth-adjacent flows reviewed

The following files were audited as part of Requirement 2:

- `Frontend/login.html`
- `Frontend/js/supabase-client.js`
- `Frontend/js/env.js`
- `kiosk/index.html`
- `kiosk/kiosk.js`
- `kiosk/env.js`
- `scripts/generate-config.js`
- `.envexample`
- `supabase/config.toml`
- `supabase/functions/auth-login/index.ts`
- `supabase/functions/auth-login/protection.ts`
- `supabase/functions/auth-login/validation.ts`
- `supabase/functions/auth-login/provider.ts`
- `supabase/functions/auth-login/store.ts`
- `supabase/migrations/20260422000100_requirement2_bruteforce_guard.sql`

No separate admin login, magic-link login, OTP flow, or custom Node auth API was found in the current repo.

## 3. What brute-force risks existed

### Main login risk

`Frontend/login.html` used a direct password grant from the browser. That meant the Stockd repo itself had:

- no per-user attempt counter
- no per-device/browser counter
- no escalating cooldown
- no temporary lockout
- no challenge after repeated failures

### Kiosk risk

`kiosk/kiosk.js` exposed demo credentials in client-side JavaScript:

- `demo@tonys.pizza`
- `TonysPizza2026!`

That was not just a brute-force problem. It also meant anyone with the shipped JS could recover the kiosk password and reuse it directly.

### Platform gap

Supabase Auth is public-by-design behind the project URL and anon key. That means:

- moving the app UI behind a custom Edge Function improves the real Stockd flows
- but direct requests to Supabase Auth still need baseline platform rate limits

That is why this pass implements both a Stockd-owned protected login path and a lower Supabase Auth rate-limit baseline in repo config.

## 4. Exact protections added

### A. Protected login Edge Function

Added a new Supabase Edge Function in `supabase/functions/auth-login/`:

- `index.ts`
- `env.ts`
- `validation.ts`
- `protection.ts`
- `store.ts`
- `provider.ts`
- `responses.ts`
- `types.ts`
- `cors.ts`

This function now sits in front of the password grant used by the Stockd UI.

What it does:

- validates incoming login payloads
- normalizes the email / client token inputs
- hashes identity signals before storage
- stores throttle state in Postgres via `auth_bruteforce_guards`
- enforces escalating lockouts
- requires a lightweight verification challenge after repeated failed web logins
- resets counters on successful login
- returns only generic user-facing failure messages

### B. Server-side throttle state in Postgres

Added `supabase/migrations/20260422000100_requirement2_bruteforce_guard.sql`.

This creates `public.auth_bruteforce_guards`, which stores:

- hashed scope keys
- flow type (`web_login`, `kiosk_login`)
- scope type (`identifier`, `device`, `identifier_device`, `ip`)
- failed attempt count
- challenge-required flag
- lockout expiration
- success/failure timestamps

The browser never writes this table directly. It is intended for service-role access from the `auth-login` Edge Function only.

### C. Web login policy

In `supabase/functions/auth-login/protection.ts`, the web login flow now follows this policy:

- after `3` failed password attempts: verification challenge required
- after `5` failed attempts: temporary lockout
- escalating lockout durations:
  - 30 seconds
  - 60 seconds
  - 5 minutes
  - 15 minutes

The challenge is:

- generated server-side
- HMAC-signed
- bound to the login flow, email hash, and device token hash
- short-lived

This makes it harder to script repeated guesses even after the attacker reaches the challenge threshold.

### D. Kiosk policy

The kiosk flow now uses the same protected function, but with kiosk-specific behavior:

- the kiosk no longer ships a password in `kiosk/kiosk.js`
- the actual kiosk demo email/password now live in server environment variables:
  - `KIOSK_DEMO_EMAIL`
  - `KIOSK_DEMO_PASSWORD`
- the kiosk flow locks after `3` failed attempts
- the kiosk client respects `retry_after_ms` and backs off before retrying

This changes the kiosk from “client exposes password and can retry freely” to “client requests a protected server-side demo sign-in path.”

### E. Main login UI hardening

`Frontend/login.html` was changed so the browser now:

- calls the `auth-login` Edge Function instead of `sb.auth.signInWithPassword(...)`
- generates and persists a browser/device token for throttle scoping
- shows the challenge UI only after the server requests it
- honors server-provided `retry_after_ms`
- disables the sign-in button during lockout
- restores the lockout countdown from local storage for UX continuity
- sets the Supabase session only after the protected function returns a valid session payload

Important detail:

- local storage is only used for browser UX continuity
- actual enforcement is server-side in the Edge Function + Postgres guard table

### F. Kiosk client hardening

`kiosk/kiosk.js` now:

- uses `kiosk/env.js` for public Supabase runtime config
- reuses an existing session if one already exists
- otherwise calls the protected `auth-login` Edge Function with `flow: "kiosk_login"`
- stores a kiosk device token in local storage
- schedules retries with exponential backoff when login fails
- honors server lockout delays if `retry_after_ms` is returned

### G. Lower Supabase Auth baseline rate limit

`supabase/config.toml` was updated:

- `[auth.rate_limit].sign_in_sign_ups = 10`

This is not the primary Stockd defense anymore, but it is an important second layer for local/self-hosted Supabase setups and for any direct hits to Supabase Auth that bypass the app UI.

## 5. Protection classification: client-side vs server-side vs hybrid

| Protection | Location | Classification |
| --- | --- | --- |
| Attempt counters and lockout state | `supabase/functions/auth-login/` + `auth_bruteforce_guards` table | Server-side |
| Challenge creation and verification | `supabase/functions/auth-login/protection.ts` | Server-side |
| Credential check against Supabase password grant | `supabase/functions/auth-login/provider.ts` | Server-side |
| Kiosk demo credentials moved off the client | Edge Function env (`KIOSK_DEMO_EMAIL`, `KIOSK_DEMO_PASSWORD`) | Server-side |
| Main login countdown button state | `Frontend/login.html` | Client-side UX only |
| Browser device token | `Frontend/login.html`, `kiosk/kiosk.js` | Hybrid |
| Kiosk retry backoff | `kiosk/kiosk.js` | Client-side hardening / UX |
| Supabase native sign-in rate limit | `supabase/config.toml` | Platform-level |

## 6. Exact files changed

### Auth protection implementation

- `supabase/functions/auth-login/index.ts`
- `supabase/functions/auth-login/env.ts`
- `supabase/functions/auth-login/validation.ts`
- `supabase/functions/auth-login/protection.ts`
- `supabase/functions/auth-login/store.ts`
- `supabase/functions/auth-login/provider.ts`
- `supabase/functions/auth-login/responses.ts`
- `supabase/functions/auth-login/types.ts`
- `supabase/functions/auth-login/cors.ts`
- `supabase/migrations/20260422000100_requirement2_bruteforce_guard.sql`

### Frontend and kiosk

- `Frontend/login.html`
- `kiosk/index.html`
- `kiosk/kiosk.js`
- `kiosk/env.js`
- `scripts/generate-config.js`

### Config and docs

- `.envexample`
- `supabase/config.toml`
- `Readme.md`
- `codex-security/requirement-2-bruteforce.md`
- `codex-security/requirement-2-report-summary.md`

### Tests

- `scripts/run-bruteforce-tests.js`
- `package.json`

## 7. How to demo the protection to a grader

### Demo A: Web login escalation

1. Apply the migration `supabase/migrations/20260422000100_requirement2_bruteforce_guard.sql`.
2. Deploy the `auth-login` Edge Function with:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `AUTH_BRUTE_FORCE_SECRET`
3. Open `Frontend/login.html`.
4. Enter a valid email with the wrong password several times.
5. On the third failed attempt, the page should show the verification prompt.
6. Continue failing logins and show that the UI switches to a cooldown/lockout state with the button disabled.

What to point at:

- `Frontend/login.html` now calls the protected function instead of `signInWithPassword`
- `supabase/functions/auth-login/protection.ts` contains the challenge + lockout policy
- `supabase/migrations/20260422000100_requirement2_bruteforce_guard.sql` contains the guard-state table

### Demo B: Success resets the counter

1. Cause a couple of failed login attempts.
2. Sign in successfully with the correct password.
3. Log out and attempt one more failure.
4. Show that the next failure is treated like a fresh first failure, not an immediate lockout/challenge.

### Demo C: Kiosk hardening

1. Open `kiosk/kiosk.js`.
2. Show that the password is no longer hardcoded in shipped client JavaScript.
3. Show that kiosk sign-in now routes through the protected `auth-login` function.
4. If desired, misconfigure kiosk env on purpose and show that retries back off instead of looping rapidly.

### Demo D: Test evidence

Run:

```bash
npm run test:bruteforce
```

This verifies:

- repeated failed web logins escalate to challenge then lockout
- lockout duration behaves as expected
- successful login resets counters
- kiosk login is throttled
- kiosk client-supplied credentials are ignored in favor of server env credentials

## 8. Remaining limitations and future improvements

1. The strongest protection is on the Stockd-owned login flows, not on every possible direct request to Supabase Auth.

- The app UI now uses the protected Edge Function.
- But Supabase Auth still exists as a public service endpoint behind the project URL and anon key.
- For a hosted project, the equivalent rate-limit settings must also be configured in the Supabase dashboard.

2. The challenge is intentionally lightweight.

- It is a threshold-triggered arithmetic challenge, not Cloudflare Turnstile, reCAPTCHA, or hCaptcha.
- That is appropriate for this repo and grading requirement, but a production deployment should upgrade to a stronger anti-bot provider.

3. Device tokens are not tamper-proof.

- The browser/kiosk device token is stored locally and can be cleared.
- The server compensates by also tracking identifier-based and IP-based scopes where available.

4. The kiosk path is still demo-oriented.

- Requirement 2 removes the exposed password and throttles retries.
- It does not redesign the kiosk into a production-grade least-privilege auth model.

5. Deployment is still an operational step.

- The migration and Edge Function code are in the repo.
- They still need to be applied/deployed to the target Supabase project for live enforcement.
