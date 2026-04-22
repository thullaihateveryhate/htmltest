import { MonitoringEnv, MonitoringError } from "./types.ts";

export function getEnv(): MonitoringEnv {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const supabaseServiceRoleKey = (
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    Deno.env.get("SUPABASE_SERVICE_KEY")?.trim() ||
    ""
  );

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new MonitoringError(
      "missing_monitoring_env",
      "Server configuration is missing monitoring database credentials.",
      500,
      false,
    );
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
  };
}
