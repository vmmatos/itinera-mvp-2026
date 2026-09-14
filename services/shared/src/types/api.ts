export interface ApiResponse<T = unknown> {
  success: true;
  data: T;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
}

export interface ReadyResponse {
  status: 'ready' | 'not_ready';
  service: string;
  timestamp: string;
  checks?: Record<string, boolean>;
}

export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}
