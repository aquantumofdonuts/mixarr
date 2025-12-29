// Use empty string for relative URLs - requests go through Next.js rewrites to internal API
const API_URL = '';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  headers?: Record<string, string>;
}

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, headers = {} } = options;

  const config: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    credentials: 'include',
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(`${API_URL}${endpoint}`, config);
    
    // Check content type before parsing - handles HTML error pages from proxies
    const contentType = res.headers.get('content-type') || '';
    let data: unknown;
    
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      // Non-JSON response (likely HTML error page from Caddy/proxy)
      const text = await res.text();
      data = { error: `Server error (${res.status}): ${text.substring(0, 100)}` };
    }

    if (!res.ok) {
      return {
        data: null,
        error: (data as { error?: string }).error || `HTTP ${res.status}`,
        status: res.status,
      };
    }

    return { data: data as T, error: null, status: res.status };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Network error',
      status: 0,
    };
  }
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint, { method: 'GET' }),
  post: <T>(endpoint: string, body?: unknown) => request<T>(endpoint, { method: 'POST', body }),
  put: <T>(endpoint: string, body?: unknown) => request<T>(endpoint, { method: 'PUT', body }),
  delete: <T>(endpoint: string) => request<T>(endpoint, { method: 'DELETE' }),
  patch: <T>(endpoint: string, body?: unknown) => request<T>(endpoint, { method: 'PATCH', body }),
};

// Type-safe API endpoints
export const endpoints = {
  // Auth
  auth: {
    me: '/api/auth/me',
    login: '/api/auth/login',
    logout: '/api/auth/logout',
    register: '/api/auth/register',
    changePassword: '/api/auth/password',
  },
  // Connections
  connections: {
    list: '/api/connections',
    get: (id: number) => `/api/connections/${id}`,
    test: (id: number) => `/api/connections/${id}/test`,
  },
  // Search
  search: {
    artist: '/api/search/artist',
    lidarr: '/api/search/lidarr',
    add: '/api/search/add',
  },
  // Subscriptions
  subscriptions: {
    list: '/api/subscriptions',
    get: (id: number) => `/api/subscriptions/${id}`,
    run: (id: number) => `/api/jobs/run/subscription/${id}`,
    history: (id: number) => `/api/subscriptions/${id}/history`,
  },
  // Imports
  imports: {
    list: '/api/imports',
    get: (id: number) => `/api/imports/${id}`,
    reviewQueue: '/api/imports/review/queue',
    reviewItem: (id: number) => `/api/imports/review/${id}`,
    reviewBulk: '/api/imports/review/bulk',
  },
  // Jobs
  jobs: {
    list: '/api/jobs',
    get: (id: string) => `/api/jobs/${id}`,
    cancel: (id: string) => `/api/jobs/${id}/cancel`,
  },
  // Settings
  settings: {
    list: '/api/settings',
    update: '/api/settings',
  },
};
