function setDenoEnv(values) {
  const store = global.__COPILOT_TEST_ENV__;
  store.clear();

  Object.entries(values || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      store.set(key, String(value));
    }
  });
}

function createRuntimeEnv(overrides = {}) {
  return {
    apiKey: "test-openai-key",
    model: "gpt-4o-mini",
    supabaseUrl: "https://stockd-test.supabase.co",
    supabaseAnonKey: "test-supabase-anon-key",
    actionSecret: "test-copilot-action-secret",
    ...overrides,
  };
}

function createAuth(overrides = {}) {
  return {
    bearerToken: "header.eyJzdWIiOiJ1c2VyLXRlc3QifQ.signature",
    hasAuth: true,
    authState: "token_present",
    userId: "user-test",
    claims: { sub: "user-test" },
    ...overrides,
  };
}

function createJsonRequest(body, options = {}) {
  return new Request("http://localhost/functions/v1/copilot", {
    method: options.method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: JSON.stringify(body),
  });
}

function createTextRequest(bodyText, options = {}) {
  return new Request("http://localhost/functions/v1/copilot", {
    method: options.method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: bodyText,
  });
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function installFetchMock(handler) {
  return jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    return handler(url, init || {});
  });
}

function openAIResponse(payload, status = 200) {
  return jsonResponse(payload, status, { "x-request-id": "req_test_123" });
}

module.exports = {
  setDenoEnv,
  createRuntimeEnv,
  createAuth,
  createJsonRequest,
  createTextRequest,
  jsonResponse,
  installFetchMock,
  openAIResponse,
};
