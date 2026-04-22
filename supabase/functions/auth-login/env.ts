import { AuthLoginEnv, AuthLoginError } from "./types.ts";

export function getEnv(): AuthLoginEnv {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
  const supabaseServiceRoleKey = (
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    Deno.env.get("SUPABASE_SERVICE_KEY")?.trim() ||
    ""
  );
  const challengeSecret = (
    Deno.env.get("AUTH_BRUTE_FORCE_SECRET")?.trim() ||
    supabaseServiceRoleKey
  );
  const kioskDemoEmail = Deno.env.get("KIOSK_DEMO_EMAIL")?.trim() || null;
  const kioskDemoPassword = Deno.env.get("KIOSK_DEMO_PASSWORD")?.trim() || null;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new AuthLoginError(
      "missing_auth_login_env",
      "Server configuration is missing Supabase login-proxy credentials.",
      500,
      false,
    );
  }

  if (!challengeSecret) {
    throw new AuthLoginError(
      "missing_auth_login_secret",
      "Server configuration is missing the brute-force challenge secret.",
      500,
      false,
    );
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    challengeSecret,
    kioskDemoEmail,
    kioskDemoPassword,
  };
}
