const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = function transpileTypeScript(module, filename) {
  const sourceText = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(sourceText, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      allowJs: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
  });

  module._compile(result.outputText, filename);
};

if (typeof global.btoa !== "function") {
  global.btoa = (value) => Buffer.from(value, "binary").toString("base64");
}

if (typeof global.atob !== "function") {
  global.atob = (value) => Buffer.from(value, "base64").toString("binary");
}

global.__AUTH_LOGIN_TEST_ENV__ = new Map();
global.Deno = {
  env: {
    get(name) {
      return global.__AUTH_LOGIN_TEST_ENV__.has(name)
        ? global.__AUTH_LOGIN_TEST_ENV__.get(name)
        : undefined;
    },
  },
};

global.fetch = async () => new Response(null, { status: 201 });

const { computeLockoutMs } = require("../supabase/functions/auth-login/protection.ts");
const { createAuthLoginHandler } = require("../supabase/functions/auth-login/index.ts");

function createEnv(overrides = {}) {
  return {
    supabaseUrl: "https://stockd-test.supabase.co",
    supabaseAnonKey: "anon-key",
    supabaseServiceRoleKey: "service-role-key",
    challengeSecret: "challenge-secret",
    kioskDemoEmail: "demo@tonys.pizza",
    kioskDemoPassword: "NotInTheClient123!",
    ...overrides,
  };
}

function createClock(iso = "2026-04-21T16:00:00.000Z") {
  let nowMs = Date.parse(iso);
  return {
    now() {
      return new Date(nowMs);
    },
    advance(ms) {
      nowMs += ms;
    },
  };
}

function createGuardStore() {
  const state = new Map();

  return {
    async fetch(_env, scopeKeys) {
      return scopeKeys
        .map((scopeKey) => state.get(scopeKey))
        .filter(Boolean)
        .map((entry) => ({ ...entry }));
    },
    async upsert(_env, states) {
      states.forEach((entry) => {
        state.set(entry.scope_key, { ...entry });
      });
    },
    snapshot() {
      return Array.from(state.values()).map((entry) => ({ ...entry }));
    },
  };
}

function makeRequest(body, extraHeaders = {}) {
  return new Request("http://localhost/functions/v1/auth-login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

function solveChallengePrompt(prompt) {
  const match = String(prompt).match(/What is (\d+) ([+-]) (\d+)\?/);
  assert(match, `Unexpected challenge prompt: ${prompt}`);
  const left = Number(match[1]);
  const operator = match[2];
  const right = Number(match[3]);
  return String(operator === "+" ? left + right : left - right);
}

function createHandlerHarness(options = {}) {
  const env = createEnv(options.env);
  const clock = createClock(options.now);
  const store = createGuardStore();
  const attemptedCredentials = [];

  const handler = createAuthLoginHandler({
    getEnv: () => env,
    fetchGuardStates: (_env, scopeKeys) => store.fetch(_env, scopeKeys),
    upsertGuardStates: (_env, states) => store.upsert(_env, states),
    attemptPasswordGrant: async (_env, email, password) => {
      attemptedCredentials.push({ email, password });
      if (typeof options.passwordGrant === "function") {
        return await options.passwordGrant({ email, password, env, attempts: attemptedCredentials.length });
      }

      return { ok: false };
    },
    now: () => clock.now(),
  });

  return {
    handler,
    clock,
    store,
    env,
    attemptedCredentials,
  };
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error && error.stack ? error.stack : error);
    return false;
  } finally {
    global.__AUTH_LOGIN_TEST_ENV__.clear();
  }
}

(async () => {
  let passed = 0;
  let failed = 0;

  if (await run("web login escalates from invalid credentials to challenge to lockout", async () => {
    const { handler } = createHandlerHarness();
    const baseBody = {
      flow: "web_login",
      email: "chef@example.com",
      password: "wrong-password",
      client_token: "stockd-web-client-123456",
    };

    const first = await readJson(await handler(makeRequest(baseBody)));
    const second = await readJson(await handler(makeRequest(baseBody)));
    const third = await readJson(await handler(makeRequest(baseBody)));

    assert.equal(first.code, "invalid_credentials");
    assert.equal(second.code, "invalid_credentials");
    assert.equal(third.code, "challenge_required");
    assert.ok(third.challenge);

    const fourth = await readJson(await handler(makeRequest({
      ...baseBody,
      challenge_token: third.challenge.token,
      challenge_answer: solveChallengePrompt(third.challenge.prompt),
    })));
    assert.equal(fourth.code, "challenge_required");
    assert.ok(fourth.challenge);

    const fifth = await readJson(await handler(makeRequest({
      ...baseBody,
      challenge_token: fourth.challenge.token,
      challenge_answer: solveChallengePrompt(fourth.challenge.prompt),
    })));

    assert.equal(fifth.code, "too_many_attempts");
    assert.equal(fifth.retry_after_ms, 30000);
  })) passed += 1; else failed += 1;

  if (await run("lockout duration expires before the next protected attempt is processed", async () => {
    const { handler, clock } = createHandlerHarness();
    const baseBody = {
      flow: "web_login",
      email: "chef@example.com",
      password: "wrong-password",
      client_token: "stockd-web-client-654321",
    };

    await handler(makeRequest(baseBody));
    await handler(makeRequest(baseBody));
    const challengeStep = await readJson(await handler(makeRequest(baseBody)));
    const nextChallenge = await readJson(await handler(makeRequest({
      ...baseBody,
      challenge_token: challengeStep.challenge.token,
      challenge_answer: solveChallengePrompt(challengeStep.challenge.prompt),
    })));
    await handler(makeRequest({
      ...baseBody,
      challenge_token: nextChallenge.challenge.token,
      challenge_answer: solveChallengePrompt(nextChallenge.challenge.prompt),
    }));

    clock.advance(29000);
    const stillLocked = await readJson(await handler(makeRequest(baseBody)));
    assert.equal(stillLocked.code, "too_many_attempts");

    clock.advance(2000);
    const afterExpiry = await readJson(await handler(makeRequest(baseBody)));
    assert.equal(afterExpiry.code, "challenge_required");
    assert.equal(afterExpiry.retry_after_ms, undefined);
  })) passed += 1; else failed += 1;

  if (await run("successful login resets the failure state", async () => {
    const { handler } = createHandlerHarness({
      passwordGrant: async ({ password }) => {
        if (password === "correct-horse-battery-staple") {
          return {
            ok: true,
            session: {
              access_token: "access-token",
              refresh_token: "refresh-token",
            },
          };
        }
        return { ok: false };
      },
    });

    const failingBody = {
      flow: "web_login",
      email: "chef@example.com",
      password: "wrong-password",
      client_token: "stockd-web-client-success-reset",
    };

    const successBody = {
      ...failingBody,
      password: "correct-horse-battery-staple",
    };

    await handler(makeRequest(failingBody));
    await handler(makeRequest(failingBody));
    const success = await readJson(await handler(makeRequest(successBody)));
    const nextFailure = await readJson(await handler(makeRequest(failingBody)));

    assert.equal(success.ok, true);
    assert.equal(success.code, "signed_in");
    assert.equal(nextFailure.code, "invalid_credentials");
  })) passed += 1; else failed += 1;

  if (await run("kiosk login throttles after repeated failed attempts", async () => {
    const { handler } = createHandlerHarness();
    const body = {
      flow: "kiosk_login",
      client_token: "stockd-kiosk-client-123456",
    };

    const first = await readJson(await handler(makeRequest(body)));
    const second = await readJson(await handler(makeRequest(body)));
    const third = await readJson(await handler(makeRequest(body)));

    assert.equal(first.code, "invalid_credentials");
    assert.equal(second.code, "invalid_credentials");
    assert.equal(third.code, "too_many_attempts");
    assert.equal(third.retry_after_ms, 30000);
  })) passed += 1; else failed += 1;

  if (await run("kiosk flow ignores client-supplied credentials and uses server env values", async () => {
    const { handler, attemptedCredentials, env } = createHandlerHarness({
      passwordGrant: async () => ({
        ok: true,
        session: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
      }),
    });

    const response = await readJson(await handler(makeRequest({
      flow: "kiosk_login",
      email: "attacker@example.com",
      password: "guess-me",
      client_token: "stockd-kiosk-client-654321",
    })));

    assert.equal(response.ok, true);
    assert.deepEqual(attemptedCredentials[0], {
      email: env.kioskDemoEmail,
      password: env.kioskDemoPassword,
    });
  })) passed += 1; else failed += 1;

  if (await run("lockout policy uses the expected escalating durations", async () => {
    assert.equal(computeLockoutMs("web_login", 4), 0);
    assert.equal(computeLockoutMs("web_login", 5), 30000);
    assert.equal(computeLockoutMs("web_login", 6), 60000);
    assert.equal(computeLockoutMs("web_login", 7), 300000);
    assert.equal(computeLockoutMs("web_login", 8), 900000);
    assert.equal(computeLockoutMs("kiosk_login", 2), 0);
    assert.equal(computeLockoutMs("kiosk_login", 3), 30000);
  })) passed += 1; else failed += 1;

  console.log(`\nBrute-force tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
})();
