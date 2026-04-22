import {
  AppError,
  AuthContext,
  CopilotRequest,
  CopilotResult,
  ConfirmationRequiredData,
  OpenAIFunctionToolDefinition,
  OpenAIRuntimeEnv,
  PendingActionData,
  PricingInsightsData,
  PricingRecommendation,
  ToolCall,
  ToolRuntime,
  isPlainObject,
} from "./types.ts";
import { buildChatPrompt, buildPricingInsightsPrompt } from "./prompts.ts";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const PRICING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "assumptions", "recommendations"],
  properties: {
    summary: { type: "string" },
    assumptions: {
      type: "array",
      items: { type: "string" },
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "item_name",
          "action",
          "reason",
          "suggested_price",
          "price_change_percent",
          "confidence",
          "risk",
        ],
        properties: {
          item_name: { type: "string" },
          action: {
            type: "string",
            enum: ["increase", "decrease", "hold", "investigate"],
          },
          reason: { type: "string" },
          suggested_price: { type: "number" },
          price_change_percent: { type: "number" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          risk: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
  },
} as const;

type OpenAIResponsePayload = {
  id?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

function extractOutputText(payload: OpenAIResponsePayload | null): string {
  if (!payload) {
    return "";
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!Array.isArray(item.content)) {
        continue;
      }

      for (const part of item.content) {
        if (
          (part.type === "output_text" || part.type === "text") &&
          typeof part.text === "string" &&
          part.text.trim()
        ) {
          return part.text.trim();
        }
      }
    }
  }

  return "";
}

function mapOpenAIError(status: number, payload: OpenAIResponsePayload | null): AppError {
  if (status === 429) {
    return new AppError(
      "openai_rate_limited",
      "The AI provider is rate limiting requests. Please try again shortly.",
      503,
    );
  }

  if (status === 401 || status === 403) {
    return new AppError(
      "openai_auth_error",
      "The AI provider rejected server credentials.",
      502,
    );
  }

  if (status >= 500) {
    return new AppError(
      "openai_unavailable",
      "The AI provider is temporarily unavailable. Please try again shortly.",
      503,
    );
  }

  return new AppError(
    "openai_bad_request",
    "The AI provider rejected the request.",
    502,
  );
}

async function requestOpenAI(
  env: OpenAIRuntimeEnv,
  body: Record<string, unknown>,
  options: { allowEmptyText?: boolean } = {},
): Promise<{ text: string; requestId: string | null; payload: OpenAIResponsePayload | null }> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.apiKey}`,
      "Content-Type": "application/json",
      "X-Client-Request-Id": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });

  const requestId = response.headers.get("x-request-id");
  const payload = await response.json().catch(() => null) as OpenAIResponsePayload | null;

  if (!response.ok) {
    console.error("[copilot] openai request failed", {
      status: response.status,
      requestId,
      error: payload?.error,
    });
    throw mapOpenAIError(response.status, payload);
  }

  const text = extractOutputText(payload);
  if (!text && !options.allowEmptyText) {
    console.error("[copilot] openai returned empty output", { requestId });
    throw new AppError(
      "empty_model_response",
      "The AI provider returned an empty response.",
      502,
    );
  }

  return { text, requestId, payload };
}

function extractFunctionCalls(payload: OpenAIResponsePayload | null): ToolCall[] {
  if (!payload || !Array.isArray(payload.output)) {
    return [];
  }

  return payload.output
    .filter((item) =>
      item.type === "function_call" &&
      typeof item.call_id === "string" &&
      typeof item.name === "string"
    )
    .map((item) => ({
      callId: item.call_id as string,
      name: item.name as string,
      argumentsJson: typeof item.arguments === "string" ? item.arguments : "{}",
    }));
}

function buildToolOutputItems(
  calls: Awaited<ReturnType<ToolRuntime["execute"]>>[],
): Array<{ type: "function_call_output"; call_id: string; output: string }> {
  return calls.map((call) => ({
    type: "function_call_output",
    call_id: call.callId,
    output: JSON.stringify(call.result),
  }));
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizePricingRecommendation(value: unknown): PricingRecommendation | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const itemName = typeof value.item_name === "string" ? value.item_name.trim() : "";
  const action = value.action;
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  const suggestedPrice = typeof value.suggested_price === "number" && Number.isFinite(value.suggested_price)
    ? value.suggested_price
    : null;
  const percent = typeof value.price_change_percent === "number" && Number.isFinite(value.price_change_percent)
    ? value.price_change_percent
    : null;
  const confidence = value.confidence;
  const risk = value.risk;

  if (!itemName || !reason || suggestedPrice === null || percent === null) {
    return null;
  }

  if (
    action !== "increase" &&
    action !== "decrease" &&
    action !== "hold" &&
    action !== "investigate"
  ) {
    return null;
  }

  if (confidence !== "low" && confidence !== "medium" && confidence !== "high") {
    return null;
  }

  if (risk !== "low" && risk !== "medium" && risk !== "high") {
    return null;
  }

  return {
    item_name: itemName,
    action,
    reason,
    suggested_price: Number(suggestedPrice.toFixed(2)),
    price_change_percent: Number(percent.toFixed(2)),
    confidence,
    risk,
  };
}

function parsePricingInsights(text: string): PricingInsightsData | null {
  const normalizedText = stripCodeFences(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedText);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) {
    return null;
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const assumptions = Array.isArray(parsed.assumptions)
    ? parsed.assumptions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
      .map(normalizePricingRecommendation)
      .filter((item): item is PricingRecommendation => item !== null)
    : [];

  if (!summary && recommendations.length === 0) {
    return null;
  }

  return {
    summary: summary || "Pricing analysis completed.",
    assumptions,
    recommendations,
  };
}

function formatPricingReply(data: PricingInsightsData): string {
  const lines = [data.summary];

  const topRecommendations = data.recommendations.slice(0, 3);
  for (const recommendation of topRecommendations) {
    const change = recommendation.price_change_percent > 0
      ? `+${recommendation.price_change_percent}%`
      : `${recommendation.price_change_percent}%`;
    lines.push(
      `- ${recommendation.item_name}: ${recommendation.action} (${change}) — ${recommendation.reason}`,
    );
  }

  if (topRecommendations.length === 0 && data.assumptions.length > 0) {
    lines.push(`- Limitation: ${data.assumptions[0]}`);
  }

  return lines.join("\n");
}

function buildConfirmationReply(
  modelReply: string,
  pendingAction?: PendingActionData,
): string {
  if (!pendingAction) {
    return modelReply;
  }

  if (!modelReply) {
    return `I can do that, but I need confirmation before making changes.\n\nPending action: ${pendingAction.summary}`;
  }

  if (/confirm/i.test(modelReply)) {
    return modelReply;
  }

  return `${modelReply}\n\nPlease confirm before I make that change.`;
}

export async function generateChatResponse(
  env: OpenAIRuntimeEnv,
  request: CopilotRequest,
  auth: AuthContext,
  toolRuntime?: ToolRuntime,
): Promise<CopilotResult<ConfirmationRequiredData | undefined>> {
  const prompt = buildChatPrompt(request, auth);
  const tools: OpenAIFunctionToolDefinition[] = (toolRuntime?.definitions || []).map((tool) => ({
    ...tool,
    strict: undefined,
  }));
  let pendingAction: PendingActionData | undefined;

  let response = await requestOpenAI(env, {
    model: env.model,
    input: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    tools,
    max_output_tokens: 500,
  }, { allowEmptyText: tools.length > 0 });

  for (let step = 0; step < 5; step += 1) {
    const functionCalls = extractFunctionCalls(response.payload);
    if (!functionCalls.length) {
      if (!response.text && !pendingAction) {
        throw new AppError(
          "empty_model_response",
          "The AI provider returned an empty response.",
          502,
        );
      }

      return {
        reply: buildConfirmationReply(response.text, pendingAction),
        data: pendingAction
          ? {
            requires_confirmation: true,
            pending_action: pendingAction,
          }
          : undefined,
        model: env.model,
      };
    }

    if (!toolRuntime || !response.payload?.id) {
      throw new AppError(
        "tool_runtime_unavailable",
        "Tool execution is unavailable for this request.",
        502,
      );
    }

    const toolResults = await Promise.all(
      functionCalls.map((call) => toolRuntime.execute(call, request, auth)),
    );

    const pendingActions = toolResults
      .map((result) => result.pendingAction)
      .filter((result): result is PendingActionData => Boolean(result));

    if (pendingActions.length > 0) {
      if (pendingActions.length > 1) {
        console.warn("[copilot] multiple pending actions proposed in a single response", {
          count: pendingActions.length,
          toolNames: pendingActions.map((action) => action.tool_name),
        });
      }

      if (!pendingAction) {
        pendingAction = pendingActions[0];
      } else {
        console.warn("[copilot] preserving earlier pending action and ignoring additional proposal", {
          existingTool: pendingAction.tool_name,
          ignoredTools: pendingActions.map((action) => action.tool_name),
        });
      }
    }

    response = await requestOpenAI(env, {
      model: env.model,
      previous_response_id: response.payload.id,
      input: buildToolOutputItems(toolResults),
      tools,
      max_output_tokens: 500,
    }, { allowEmptyText: true });
  }

  throw new AppError(
    "tool_loop_exceeded",
    "Copilot exceeded the maximum tool-call loop for this request.",
    502,
    false,
  );
}

export async function generatePricingInsights(
  env: OpenAIRuntimeEnv,
  request: CopilotRequest,
  auth: AuthContext,
): Promise<CopilotResult<PricingInsightsData | null>> {
  const prompt = buildPricingInsightsPrompt(request, auth);
  const { text } = await requestOpenAI(env, {
    model: env.model,
    input: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "pricing_insights",
        strict: true,
        schema: PRICING_SCHEMA,
      },
    },
    max_output_tokens: 800,
  });

  const data = parsePricingInsights(text);
  if (!data) {
    return {
      reply: text,
      data: null,
      model: env.model,
    };
  }

  return {
    reply: formatPricingReply(data),
    data,
    model: env.model,
  };
}
