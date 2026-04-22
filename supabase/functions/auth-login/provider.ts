import { AuthLoginEnv, AuthLoginError, PasswordGrantResult } from "./types.ts";

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function attemptPasswordGrant(
  env: AuthLoginEnv,
  email: string,
  password: string,
): Promise<PasswordGrantResult> {
  const response = await fetch(`${env.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "apikey": env.supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const parsed = await parseResponse(response);

  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      return { ok: false };
    }

    throw new AuthLoginError(
      "upstream_auth_failed",
      "Supabase Auth is unavailable.",
      502,
      false,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AuthLoginError(
      "invalid_auth_response",
      "Supabase Auth returned an invalid response.",
      502,
      false,
    );
  }

  return {
    ok: true,
    session: parsed as Record<string, unknown>,
  };
}
