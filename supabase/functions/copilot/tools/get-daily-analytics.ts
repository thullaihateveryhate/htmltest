import { ToolHandler, isPlainObject } from "../types.ts";
import { expectObjectArgs, ok, optionalDateArg } from "./common.ts";

const TOOL_NAME = "get_daily_analytics";

export const getDailyAnalyticsTool: ToolHandler = {
  name: TOOL_NAME,
  definition: {
    type: "function",
    name: TOOL_NAME,
    description:
      "Get daily order analytics for a specific business date, including totals and breakdowns by service period, dining option, source, hour, and server.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        p_business_date: {
          type: "string",
          description: "Optional business date in YYYY-MM-DD format. If omitted, the backend uses the latest date with data.",
        },
      },
      required: [],
    },
  },

  async execute(args, context) {
    const objectArgs = expectObjectArgs(args);
    const p_business_date = optionalDateArg(objectArgs, "p_business_date");
    const rpcArgs = p_business_date ? { p_business_date } : {};

    const raw = await context.supabase.rpc(TOOL_NAME, rpcArgs);
    const analytics = isPlainObject(raw) ? raw : { status: "no_data" };

    return ok(TOOL_NAME, {
      analytics,
    });
  },
};
