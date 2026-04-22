const { parseAndValidateRequest } = require("../../supabase/functions/copilot/validation.ts");
const { createJsonRequest, createTextRequest } = require("./helpers.js");

describe("copilot request validation", () => {
  test("rejects invalid JSON body", async () => {
    await expect(parseAndValidateRequest(createTextRequest("{"))).rejects.toMatchObject({
      code: "invalid_json",
    });
  });

  test("rejects missing mode", async () => {
    await expect(parseAndValidateRequest(createJsonRequest({
      message: "hello",
    }))).rejects.toMatchObject({
      code: "invalid_mode",
    });
  });

  test("rejects invalid mode", async () => {
    await expect(parseAndValidateRequest(createJsonRequest({
      mode: "inventory_bot",
      message: "hello",
    }))).rejects.toMatchObject({
      code: "invalid_mode",
    });
  });

  test("rejects missing or empty message", async () => {
    await expect(parseAndValidateRequest(createJsonRequest({
      mode: "chat",
    }))).rejects.toMatchObject({
      code: "invalid_message",
    });

    await expect(parseAndValidateRequest(createJsonRequest({
      mode: "chat",
      message: "   ",
    }))).rejects.toMatchObject({
      code: "empty_message",
    });
  });

  test("rejects invalid confirm flag", async () => {
    await expect(parseAndValidateRequest(createJsonRequest({
      mode: "chat",
      message: "hello",
      confirm: "yes",
    }))).rejects.toMatchObject({
      code: "invalid_confirm",
    });
  });

  test("rejects malformed pending_action", async () => {
    await expect(parseAndValidateRequest(createJsonRequest({
      mode: "chat",
      message: "confirm this",
      confirm: true,
      pending_action: "nope",
    }))).rejects.toMatchObject({
      code: "invalid_pending_action",
    });
  });

  test("rejects invalid context", async () => {
    await expect(parseAndValidateRequest(createJsonRequest({
      mode: "chat",
      message: "hello",
      context: [],
    }))).rejects.toMatchObject({
      code: "invalid_context",
    });
  });

  test("rejects confirm without pending_action", async () => {
    await expect(parseAndValidateRequest(createJsonRequest({
      mode: "chat",
      message: "confirm",
      confirm: true,
    }))).rejects.toMatchObject({
      code: "missing_pending_action",
    });
  });
});
