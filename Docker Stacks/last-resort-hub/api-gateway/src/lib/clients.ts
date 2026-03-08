// Pre-configured API clients for external services

const env = (key: string, fallback = '') => process.env[key] ?? fallback;

export const config = {
  prometheus: { url: env('PROMETHEUS_URL', 'http://prometheus:9090') },
  n8n: { url: env('N8N_URL', 'http://n8n:5678'), apiKey: env('N8N_API_KEY') },
  qdrant: { url: env('QDRANT_URL', 'http://qdrant:6333'), apiKey: env('QDRANT_API_KEY') },
  uptimeKuma: { url: env('UPTIME_KUMA_URL', 'http://uptime-kuma:3001') },
  docker: { socketPath: env('DOCKER_HOST', '/var/run/docker.sock') },
} as const;

type FetchOpts = { headers?: Record<string, string>; timeout?: number };

export async function apiFetch<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? 5000);
  try {
    const res = await fetch(url, { headers: opts.headers, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}
