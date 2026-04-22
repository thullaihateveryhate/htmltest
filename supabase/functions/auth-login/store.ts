import { AuthLoginEnv, AuthLoginError, GuardState } from "./types.ts";

type PostgrestErrorPayload = {
  message?: string;
};

function buildServiceHeaders(env: AuthLoginEnv, withJsonBody = false): Headers {
  const headers = new Headers({
    "apikey": env.supabaseServiceRoleKey,
    "Authorization": `Bearer ${env.supabaseServiceRoleKey}`,
    "Accept": "application/json",
  });

  if (withJsonBody) {
    headers.set("Content-Type", "application/json");
    headers.set("Prefer", "resolution=merge-duplicates,return=minimal");
  }

  return headers;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function mapPostgrestError(payload: unknown): string {
  if (payload && typeof payload === "object" && "message" in payload && typeof (payload as PostgrestErrorPayload).message === "string") {
    return (payload as PostgrestErrorPayload).message as string;
  }

  return "PostgREST request failed.";
}

export async function fetchGuardStates(env: AuthLoginEnv, scopeKeys: string[]): Promise<GuardState[]> {
  if (scopeKeys.length === 0) {
    return [];
  }

  const url = new URL(`${env.supabaseUrl}/rest/v1/auth_bruteforce_guards`);
  url.searchParams.set(
    "select",
    "scope_key,flow,scope_type,failed_attempts,challenge_required,lock_until,last_failed_at,last_success_at,created_at,updated_at",
  );
  url.searchParams.set("scope_key", `in.(${scopeKeys.join(",")})`);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildServiceHeaders(env),
  });

  const parsed = await parseResponse(response);
  if (!response.ok) {
    throw new AuthLoginError(
      "guard_fetch_failed",
      mapPostgrestError(parsed),
      502,
      false,
    );
  }

  return Array.isArray(parsed) ? parsed as GuardState[] : [];
}

export async function upsertGuardStates(env: AuthLoginEnv, states: GuardState[]): Promise<void> {
  if (!states.length) {
    return;
  }

  const response = await fetch(`${env.supabaseUrl}/rest/v1/auth_bruteforce_guards?on_conflict=scope_key`, {
    method: "POST",
    headers: buildServiceHeaders(env, true),
    body: JSON.stringify(states),
  });

  const parsed = await parseResponse(response);
  if (!response.ok) {
    throw new AuthLoginError(
      "guard_upsert_failed",
      mapPostgrestError(parsed),
      502,
      false,
    );
  }
}
