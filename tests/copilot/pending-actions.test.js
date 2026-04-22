const { createPendingAction, verifyPendingAction } = require("../../supabase/functions/copilot/pending-actions.ts");
const { generateChatResponse } = require("../../supabase/functions/copilot/openai.ts");
const { executeConfirmedPendingAction, executeToolCall } = require("../../supabase/functions/copilot/tool-dispatch.ts");
const { chatToolDefinitions } = require("../../supabase/functions/copilot/tool-registry.ts");
const { createAuth, createRuntimeEnv, installFetchMock, jsonResponse, openAIResponse } = require("./helpers.js");

const INGREDIENT_UUID = "11111111-1111-4111-8111-111111111111";

describe("copilot pending actions and confirmation flow", () => {
  test("write intent produces requires_confirmation and does not execute the write during proposal", async () => {
    const env = createRuntimeEnv();
    const auth = createAuth();
    const request = {
      mode: "chat",
      message: "Receive 12 lb of mozzarella from US Foods",
    };

    const fetchSpy = installFetchMock(async (url, init) => {
      if (url === "https://api.openai.com/v1/responses") {
        const body = JSON.parse(init.body);
        if (body.previous_response_id) {
          return openAIResponse({
            id: "resp_2",
            output_text: "I can do that, but I need confirmation before making changes.",
          });
        }

        return openAIResponse({
          id: "resp_1",
          output: [
            {
              type: "function_call",
              call_id: "call_receive",
              name: "receive_inventory",
              arguments: JSON.stringify({
                p_ingredient_id: INGREDIENT_UUID,
                p_qty: 12,
                p_note: "US Foods",
              }),
            },
          ],
        });
      }

      if (url.startsWith(`${env.supabaseUrl}/rest/v1/ingredients`)) {
        return jsonResponse([
          { id: INGREDIENT_UUID, name: "Mozzarella", unit: "lb" },
        ]);
      }

      if (url.includes("/rpc/receive_inventory")) {
        throw new Error("receive_inventory RPC should not run during proposal");
      }

      throw new Error(`Unexpected fetch during write proposal: ${url}`);
    });

    const result = await generateChatResponse(env, request, auth, {
      definitions: chatToolDefinitions,
      execute: (call, req, authContext) => executeToolCall(call, env, req, authContext),
    });

    expect(result.data).toMatchObject({
      requires_confirmation: true,
      pending_action: {
        tool_name: "receive_inventory",
      },
    });
    expect(result.reply).toMatch(/confirm/i);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/rpc/receive_inventory"))).toBe(false);
  });

  test("confirmed writes bypass the action secret for read-only flows and still work when absent", async () => {
    const env = createRuntimeEnv({ actionSecret: null });
    const auth = createAuth();
    const request = {
      mode: "chat",
      message: "What does inventory look like?",
    };

    installFetchMock(async (url, init) => {
      if (url === "https://api.openai.com/v1/responses") {
        const body = JSON.parse(init.body);
        if (body.previous_response_id) {
          return openAIResponse({
            id: "resp_snapshot_2",
            output_text: "Mozzarella is low on hand and should be reordered soon.",
          });
        }

        return openAIResponse({
          id: "resp_snapshot_1",
          output: [
            {
              type: "function_call",
              call_id: "call_snapshot",
              name: "get_inventory_snapshot",
              arguments: "{}",
            },
          ],
        });
      }

      if (url.includes("/rpc/get_inventory_snapshot")) {
        return jsonResponse([
          {
            ingredient_id: INGREDIENT_UUID,
            name: "Mozzarella",
            unit: "lb",
            reorder_point: 8,
            lead_time_days: 2,
            unit_cost: 3.5,
            qty_on_hand: 4,
            avg_daily_usage: 2,
            days_of_supply: 2,
            days_to_reorder: 0,
            status: "critical",
          },
        ]);
      }

      throw new Error(`Unexpected fetch during read-only chat: ${url}`);
    });

    const result = await generateChatResponse(env, request, auth, {
      definitions: chatToolDefinitions,
      execute: (call, req, authContext) => executeToolCall(call, env, req, authContext),
    });

    expect(result.reply).toContain("Mozzarella");
    expect(result.data).toBeUndefined();
  });

  test("pending action contains signed confirmation fields", async () => {
    const pendingAction = await createPendingAction(
      {
        tool_name: "receive_inventory",
        arguments: { p_ingredient_id: INGREDIENT_UUID, p_qty: 12 },
        summary: "Receive 12 lb of Mozzarella",
      },
      createRuntimeEnv(),
      createAuth(),
    );

    expect(pendingAction).toMatchObject({
      tool_name: "receive_inventory",
      summary: "Receive 12 lb of Mozzarella",
      nonce: expect.any(String),
      signature: expect.any(String),
      issued_at: expect.any(String),
      expires_at: expect.any(String),
    });
  });

  test("write attempts fail safely when COPILOT_ACTION_SECRET is missing", async () => {
    await expect(createPendingAction(
      {
        tool_name: "receive_inventory",
        arguments: { p_ingredient_id: INGREDIENT_UUID, p_qty: 12 },
        summary: "Receive 12 lb of Mozzarella",
      },
      createRuntimeEnv({ actionSecret: null }),
      createAuth(),
    )).rejects.toMatchObject({
      code: "missing_action_secret",
    });
  });

  test("bad pending-action signature fails cleanly", async () => {
    const pendingAction = await createPendingAction(
      {
        tool_name: "receive_inventory",
        arguments: { p_ingredient_id: INGREDIENT_UUID, p_qty: 12 },
        summary: "Receive 12 lb of Mozzarella",
      },
      createRuntimeEnv(),
      createAuth(),
    );

    await expect(verifyPendingAction(
      { ...pendingAction, signature: "bad-signature" },
      createRuntimeEnv(),
      createAuth(),
    )).rejects.toMatchObject({
      code: "invalid_pending_action_signature",
    });
  });

  test("expired pending actions fail clearly", async () => {
    const pendingAction = await createPendingAction(
      {
        tool_name: "count_inventory",
        arguments: { p_ingredient_id: INGREDIENT_UUID, p_actual_qty: 8 },
        summary: "Set Mozzarella to 8 lb",
      },
      createRuntimeEnv(),
      createAuth(),
    );

    const expiredNow = new Date(pendingAction.expires_at).getTime() + 1;
    jest.spyOn(Date, "now").mockReturnValue(expiredNow);

    await expect(verifyPendingAction(
      pendingAction,
      createRuntimeEnv(),
      createAuth(),
    )).rejects.toMatchObject({
      code: "pending_action_expired",
    });
  });

  test("unsupported confirmed tools fail cleanly", async () => {
    const env = createRuntimeEnv();
    const auth = createAuth();
    const pendingAction = await createPendingAction(
      {
        tool_name: "upsert_bom_entry",
        arguments: { p_menu_item_id: "abc" },
        summary: "Edit a recipe",
      },
      env,
      auth,
    );

    await expect(executeConfirmedPendingAction(
      pendingAction,
      env,
      { mode: "chat", message: "confirm" },
      auth,
    )).rejects.toMatchObject({
      code: "unsupported_pending_action",
    });
  });

  test("valid confirmed action reaches execution path", async () => {
    const env = createRuntimeEnv();
    const auth = createAuth();
    const pendingAction = await createPendingAction(
      {
        tool_name: "receive_inventory",
        arguments: {
          p_ingredient_id: INGREDIENT_UUID,
          p_qty: 12,
          p_note: "US Foods",
        },
        summary: "Receive 12 lb of Mozzarella (US Foods)",
      },
      env,
      auth,
    );

    installFetchMock(async (url) => {
      if (url.includes("/rpc/receive_inventory")) {
        return jsonResponse({
          status: "success",
          ingredient_id: INGREDIENT_UUID,
          qty_received: 12,
          new_qty_on_hand: 42,
        });
      }

      throw new Error(`Unexpected fetch during confirmed write: ${url}`);
    });

    const result = await executeConfirmedPendingAction(
      pendingAction,
      env,
      { mode: "chat", message: "confirm" },
      auth,
    );

    expect(result.reply).toMatch(/recorded the inventory receipt/i);
    expect(result.data.executed_action).toMatchObject({
      tool_name: "receive_inventory",
    });
    expect(result.data.executed_action.result).toMatchObject({
      qty_received: 12,
      new_qty_on_hand: 42,
    });
  });

  test("confirmed write fails safely when the action secret is absent", async () => {
    const auth = createAuth();
    const signedAction = await createPendingAction(
      {
        tool_name: "count_inventory",
        arguments: {
          p_ingredient_id: INGREDIENT_UUID,
          p_actual_qty: 8,
        },
        summary: "Set Mozzarella to 8 lb",
      },
      createRuntimeEnv(),
      auth,
    );

    await expect(executeConfirmedPendingAction(
      signedAction,
      createRuntimeEnv({ actionSecret: null }),
      { mode: "chat", message: "confirm" },
      auth,
    )).rejects.toMatchObject({
      code: "missing_action_secret",
    });
  });
});
