export interface ApiResponse<T = unknown> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
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

export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResponse<T> {
  return {
    success: true,
    data,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}
