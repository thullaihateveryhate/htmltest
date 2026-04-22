const { createCopilotHandler } = require("../../supabase/functions/copilot/index.ts");
const { createPendingAction } = require("../../supabase/functions/copilot/pending-actions.ts");
const {
  createAuth,
  createRuntimeEnv,
  createJsonRequest,
  createTextRequest,
  installFetchMock,
  jsonResponse,
  openAIResponse,
} = require("./helpers.js");

const INGREDIENT_UUID = "11111111-1111-4111-8111-111111111111";

describe("copilot request handler", () => {
  test("returns a structured invalid_json response", async () => {
    const handler = createCopilotHandler();
    const response = await handler(createTextRequest("{"));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      ok: false,
      error: {
        code: "invalid_json",
        message: "Request body must be valid JSON.",
      },
    });
  });

  test("pricing_insights success response is normalized", async () => {
    const env = createRuntimeEnv();
    const handler = createCopilotHandler({
      getEnv: () => env,
    });

    installFetchMock(async (url) => {
      if (url === "https://api.openai.com/v1/responses") {
        return openAIResponse({
          output_text: JSON.stringify({
            summary: "Prices look mostly stable with one modest increase opportunity.",
            assumptions: ["Based on a 7-day item summary."],
            recommendations: [
              {
                item_name: "Pepperoni Pizza",
                action: "increase",
                reason: "High recent sales with healthy demand.",
                suggested_price: 19.5,
                price_change_percent: 5,
                confidence: "medium",
                risk: "medium",
              },
            ],
          }),
        });
      }

      throw new Error(`Unexpected fetch in pricing test: ${url}`);
    });

    const response = await handler(createJsonRequest({
      mode: "pricing_insights",
      message: "Analyze pricing",
      context: {
        items: [
          { name: "Pepperoni Pizza", revenue: 400, qty: 20, price: 18.5 },
        ],
      },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.mode).toBe("pricing_insights");
    expect(payload.meta.provider).toBe("openai");
    expect(payload.data.recommendations[0]).toMatchObject({
      item_name: "Pepperoni Pizza",
      action: "increase",
    });
  });

  test("pricing_insights handles partial or unstructured provider output gracefully", async () => {
    const env = createRuntimeEnv();
    const handler = createCopilotHandler({
      getEnv: () => env,
    });

    installFetchMock(async (url) => {
      if (url === "https://api.openai.com/v1/responses") {
        return openAIResponse({
          output_text: "Not enough data for structured pricing recommendations yet.",
        });
      }

      throw new Error(`Unexpected fetch in pricing fallback test: ${url}`);
    });

    const response = await handler(createJsonRequest({
      mode: "pricing_insights",
      message: "Analyze pricing",
      context: { items: [] },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data).toBeNull();
    expect(payload.reply).toContain("Not enough data");
  });

  test("confirmed writes bypass the model loop", async () => {
    const env = createRuntimeEnv();
    const auth = createAuth();
    const pendingAction = await createPendingAction(
      {
        tool_name: "receive_inventory",
        arguments: {
          p_ingredient_id: INGREDIENT_UUID,
          p_qty: 6,
          p_note: "US Foods",
        },
        summary: "Receive 6 lb of Mozzarella (US Foods)",
      },
      env,
      auth,
    );

    const handler = createCopilotHandler({
      getEnv: () => env,
    });

    const fetchSpy = installFetchMock(async (url) => {
      if (url === "https://api.openai.com/v1/responses") {
        throw new Error("OpenAI should not be called for confirm=true requests");
      }

      if (url.includes("/rpc/receive_inventory")) {
        return jsonResponse({
          status: "success",
          ingredient_id: INGREDIENT_UUID,
          qty_received: 6,
          new_qty_on_hand: 18,
        });
      }

      throw new Error(`Unexpected fetch during confirmed handler flow: ${url}`);
    });

    const response = await handler(createJsonRequest({
      mode: "chat",
      message: "Confirm that change",
      confirm: true,
      pending_action: pendingAction,
    }, {
      headers: {
        Authorization: `Bearer ${auth.bearerToken}`,
      },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.executed_action).toMatchObject({
      tool_name: "receive_inventory",
    });
    expect(fetchSpy.mock.calls.some(([url]) => String(url) === "https://api.openai.com/v1/responses")).toBe(false);
  });
});
