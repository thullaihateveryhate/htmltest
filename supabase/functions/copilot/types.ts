export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

declare global {
  const Deno: {
    env: {
      get(name: string): string | undefined;
    };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
  };
}

export type CopilotMode = "chat" | "pricing_insights";

export interface CopilotRequest {
  mode: CopilotMode;
  message: string;
  context?: JsonObject;
  confirm?: boolean;
  pending_action?: PendingActionInput;
}

export interface AuthContext {
  bearerToken: string | null;
  hasAuth: boolean;
  authState: "anonymous" | "token_present" | "invalid_header";
  userId: string | null;
  claims: Record<string, unknown> | null;
}

export interface PricingRecommendation extends JsonObject {
  item_name: string;
  action: "increase" | "decrease" | "hold" | "investigate";
  reason: string;
  suggested_price: number;
  price_change_percent: number;
  confidence: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
}

export interface PricingInsightsData extends JsonObject {
  summary: string;
  assumptions: string[];
  recommendations: PricingRecommendation[];
}

export interface CopilotSuccessResponse<TData extends JsonValue | undefined = JsonValue | undefined> {
  ok: true;
  mode: CopilotMode;
  reply: string;
  data?: TData;
  meta: {
    provider: "openai";
    model: string;
  };
}

export interface CopilotErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export interface CopilotResult<TData extends JsonValue | undefined = JsonValue | undefined> {
  reply: string;
  data?: TData;
  model: string;
}

export interface OpenAIRuntimeEnv {
  apiKey: string;
  model: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey?: string | null;
  actionSecret: string | null;
}

export interface PendingActionInput {
  tool_name: string;
  arguments: JsonObject;
  summary?: string;
  issued_at?: string;
  expires_at?: string;
  nonce?: string;
  signature?: string;
}

export interface PendingActionProposal {
  tool_name: string;
  arguments: JsonObject;
  summary: string;
}

export interface PendingActionData extends JsonObject {
  tool_name: string;
  arguments: JsonObject;
  summary: string;
  issued_at: string;
  expires_at: string;
  nonce: string;
  signature: string;
}

export interface ConfirmationRequiredData extends JsonObject {
  requires_confirmation: true;
  pending_action: PendingActionData;
}

export interface ExecutedActionPayload extends JsonObject {
  tool_name: string;
  summary: string;
  result: JsonValue | null;
}

export interface ExecutedActionData extends JsonObject {
  executed_action: ExecutedActionPayload;
}

export interface ToolCall {
  callId: string;
  name: string;
  argumentsJson: string;
}

export interface ToolError {
  code: string;
  message: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  tool: string;
  data?: JsonValue;
  error?: ToolError;
}

export interface ToolExecutionEnvelope {
  callId: string;
  name: string;
  result: ToolExecutionResult;
  pendingAction?: PendingActionData;
}

export interface OpenAIFunctionToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: JsonObject;
  strict?: boolean;
}

export interface ToolContext {
  auth: AuthContext;
  request: CopilotRequest;
  supabase: SupabaseGateway;
}

export interface ToolHandler {
  name: string;
  definition: OpenAIFunctionToolDefinition;
  access?: "read" | "write";
  preparePendingAction?(args: unknown, context: ToolContext): Promise<PendingActionProposal>;
  formatSuccessReply?(result: ToolExecutionResult, context: ToolContext): string;
  execute(args: unknown, context: ToolContext): Promise<ToolExecutionResult>;
}

export interface ToolRuntime {
  definitions: OpenAIFunctionToolDefinition[];
  execute(call: ToolCall, request: CopilotRequest, auth: AuthContext): Promise<ToolExecutionEnvelope>;
}

export interface SupabaseQueryOptions {
  select: string;
  filters?: Record<string, string | string[]>;
  limit?: number;
  order?: string;
}

export interface SupabaseGateway {
  authMode: "anonymous" | "user";
  rpc<T extends JsonValue = JsonValue>(
    functionName: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
  select<T extends JsonValue = JsonValue>(
    tableName: string,
    options: SupabaseQueryOptions,
  ): Promise<T>;
}

export class AppError extends Error {
  code: string;
  status: number;
  expose: boolean;

  constructor(
    code: string,
    message: string,
    status = 500,
    expose = status < 500,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.expose = expose;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype || Object.getPrototypeOf(proto) === null;
}
