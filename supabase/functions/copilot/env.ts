import { AppError, OpenAIRuntimeEnv } from "./types.ts";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export function getEnv(): OpenAIRuntimeEnv {
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim() ?? "";
  const model = Deno.env.get("OPENAI_MODEL")?.trim() || DEFAULT_OPENAI_MODEL;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
  const supabaseServiceRoleKey = (
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    Deno.env.get("SUPABASE_SERVICE_KEY")?.trim() ||
    null
  );
  const actionSecret = Deno.env.get("COPILOT_ACTION_SECRET")?.trim() ?? null;

  if (!apiKey) {
    throw new AppError(
      "missing_openai_api_key",
      "Server configuration is missing OPENAI_API_KEY.",
      500,
      false,
    );
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new AppError(
      "missing_supabase_env",
      "Server configuration is missing SUPABASE_URL or SUPABASE_ANON_KEY.",
      500,
      false,
    );
  }

  return { apiKey, model, supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, actionSecret };
}
