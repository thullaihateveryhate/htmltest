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

global.__COPILOT_TEST_ENV__ = new Map();
global.Deno = {
  env: {
    get(name) {
      return global.__COPILOT_TEST_ENV__.has(name)
        ? global.__COPILOT_TEST_ENV__.get(name)
        : undefined;
    },
  },
};

const security = require("../Frontend/js/security.js");
const { parseToastCSV } = require("../Frontend/js/csv-parser.js");
const { createSupabaseGateway } = require("../supabase/functions/copilot/supabase.ts");
const { parseAndValidateRequest } = require("../supabase/functions/copilot/validation.ts");

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

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
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
    global.__COPILOT_TEST_ENV__.clear();
  }
}

(async () => {
  let passed = 0;
  let failed = 0;

  if (await run("sanitizeTextInput strips script blocks", () => {
    assert.equal(
      security.sanitizeTextInput(" <script>alert(1)</script> Mozzarella "),
      "Mozzarella",
    );
  })) passed += 1; else failed += 1;

  if (await run("sanitizeTextInput removes event-handler payloads", () => {
    assert.equal(
      security.sanitizeTextInput('<img src=x onerror=alert(1)> Fresh Basil'),
      "Fresh Basil",
    );
  })) passed += 1; else failed += 1;

  if (await run("escapeHtml encodes dangerous markup before rendering", () => {
    assert.equal(
      security.escapeHtml("<svg onload=alert(1)>"),
      "&lt;svg onload=alert(1)&gt;",
    );
  })) passed += 1; else failed += 1;

  if (await run("parseToastCSV sanitizes imported fields and drops malformed rows", async () => {
    global.Papa = {
      parse(_file, options) {
        options.complete({
          data: [
            {
              "Void?": "false",
              "Order Date": "04/20/2026 18:22",
              "Menu Item": "<script>alert(1)</script> Pepperoni Pizza",
              "Sales Category": '<img src=x onerror=alert(1)> Signature',
              "Qty": "2",
              "Net Price": "24.50",
            },
            {
              "Void?": "false",
              "Order Date": "not-a-date",
              "Menu Item": "Broken Row",
              "Sales Category": "Invalid",
              "Qty": "bad",
              "Net Price": "10.00",
            },
          ],
        });
      },
    };

    const parsed = await parseToastCSV({ name: "sales.csv" });
    delete global.Papa;

    assert.equal(parsed.rows.length, 1);
    assert.deepEqual(parsed.rows[0], {
      business_date: "2026-04-20",
      menu_item_name: "Pepperoni Pizza",
      category: "Signature",
      qty: 2,
      net_sales: 24.5,
      source: "toast",
    });
    assert.match(JSON.stringify(parsed.rows[0]), /^((?!<|script|onerror).)*$/i);
  })) passed += 1; else failed += 1;

  if (await run("copilot gateway rejects disallowed rpc/select/filter/order targets", async () => {
    global.fetch = async () => {
      throw new Error("fetch should not be called for rejected gateway requests");
    };

    const gateway = createSupabaseGateway(createRuntimeEnv(), createAuth());

    await assert.rejects(gateway.rpc("pg_sleep", {}), (error) => error && error.code === "invalid_supabase_target");
    await assert.rejects(gateway.select("users", { select: "*" }), (error) => error && error.code === "invalid_supabase_target");
    await assert.rejects(
      gateway.select("ingredients", { select: "id,name", filters: { created_at: "gte.2026-04-01" } }),
      (error) => error && error.code === "invalid_supabase_filter",
    );
    await assert.rejects(
      gateway.select("ingredients", { select: "id,name", order: "created_at.desc" }),
      (error) => error && error.code === "invalid_supabase_order",
    );
  })) passed += 1; else failed += 1;

  if (await run("copilot gateway allows approved rpc/select access", async () => {
    global.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/rest/v1/rpc/get_inventory_snapshot")) {
        return jsonResponse([{ ingredient_id: "ingredient-1" }]);
      }

      if (url.includes("/rest/v1/ingredients?")) {
        assert.match(url, /select=id%2Cname/);
        assert.match(url, /name=ilike\.\*moz\*/);
        assert.match(url, /order=name\.asc/);
        assert.match(url, /limit=5/);
        return jsonResponse([{ id: "ingredient-1", name: "Mozzarella" }]);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const gateway = createSupabaseGateway(createRuntimeEnv(), createAuth());
    const rpcResult = await gateway.rpc("get_inventory_snapshot", {});
    const selectResult = await gateway.select("ingredients", {
      select: "id,name",
      filters: { name: "ilike.*moz*" },
      order: "name.asc",
      limit: 5,
    });

    assert.deepEqual(rpcResult, [{ ingredient_id: "ingredient-1" }]);
    assert.deepEqual(selectResult, [{ id: "ingredient-1", name: "Mozzarella" }]);
  })) passed += 1; else failed += 1;

  if (await run("copilot request validation strips control characters", async () => {
    const request = new Request("http://localhost/functions/v1/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "chat",
        message: "  hello\u0000world  ",
      }),
    });

    const parsed = await parseAndValidateRequest(request);
    assert.equal(parsed.message, "helloworld");
  })) passed += 1; else failed += 1;

  console.log(`\nSecurity tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
})();
