export type ClientMonitoringEventType =
  | "csv_upload_attempted"
  | "csv_upload_completed"
  | "csv_validation_failure"
  | "inventory_receive_action"
  | "inventory_receive_rejected"
  | "inventory_count_submission"
  | "inventory_count_rejected"
  | "suspicious_input_detected";

export type MonitoringClientSource = "frontend" | "kiosk";

export interface MonitoringEnv {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

export interface MonitoringAuthContext {
  bearerToken: string | null;
  hasAuth: boolean;
  authState: "anonymous" | "token_present" | "invalid_header";
  userId: string | null;
}

export interface ValidatedMonitoringRequest {
  eventType: ClientMonitoringEventType;
  source: MonitoringClientSource;
  route: string | null;
  flow: string | null;
  requestId: string | null;
  clientToken: string | null;
  metadata: Record<string, unknown>;
}

export class MonitoringError extends Error {
  code: string;
  status: number;
  expose: boolean;

  constructor(code: string, message: string, status = 500, expose = status < 500) {
    super(message);
    this.name = "MonitoringError";
    this.code = code;
    this.status = status;
    this.expose = expose;
  }
}
