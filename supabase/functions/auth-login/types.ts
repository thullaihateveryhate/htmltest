export type LoginFlow = "web_login" | "kiosk_login";
export type ScopeType = "identifier" | "device" | "identifier_device" | "ip";

export interface AuthLoginEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  challengeSecret: string;
  kioskDemoEmail: string | null;
  kioskDemoPassword: string | null;
}

export interface LoginChallenge {
  prompt: string;
  token: string;
  expires_at: string;
}

export interface ValidatedLoginRequest {
  flow: LoginFlow;
  email: string | null;
  password: string | null;
  client_token: string;
  challenge_token?: string;
  challenge_answer?: string;
}

export interface GuardScopeDescriptor {
  scopeKey: string;
  flow: LoginFlow;
  scopeType: ScopeType;
}

export interface GuardState {
  scope_key: string;
  flow: LoginFlow;
  scope_type: ScopeType;
  failed_attempts: number;
  challenge_required: boolean;
  lock_until: string | null;
  last_failed_at: string | null;
  last_success_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface GuardSummary {
  failedAttempts: number;
  challengeRequired: boolean;
  retryAfterMs: number;
  lockedUntil: string | null;
}

export interface PasswordGrantResult {
  ok: boolean;
  session?: Record<string, unknown>;
}

export interface HandlerResponseBody {
  ok: boolean;
  code: string;
  message: string;
  retry_after_ms?: number;
  challenge?: LoginChallenge;
  session?: Record<string, unknown>;
}

export class AuthLoginError extends Error {
  code: string;
  status: number;
  expose: boolean;

  constructor(code: string, message: string, status = 500, expose = status < 500) {
    super(message);
    this.name = "AuthLoginError";
    this.code = code;
    this.status = status;
    this.expose = expose;
  }
}
