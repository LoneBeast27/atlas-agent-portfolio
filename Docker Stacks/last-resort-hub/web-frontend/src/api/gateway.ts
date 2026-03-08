// API client for the Last Resort Gateway

const BASE_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:3005';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${path}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${path}`);
  return res.json();
}

// Types
export interface Container {
  id: string;
  name: string;
  stack: string;
  status: string;
  health: string;
  uptime: string;
}

export interface ContainersResponse {
  containers: Container[];
  total: number;
  healthy: number;
  degraded: number;
  stopped: number;
}

export interface SystemMetrics {
  cpu_percent: number | null;
  memory: { used_gb: number | null; total_gb: number | null; percent: number | null };
  gpu_vram: { used_gb: number | null; total_gb: number | null; percent: number | null };
  disk: { speed_drive_percent: number | null; hdd_percent: number | null };
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
}

export interface WorkflowsResponse {
  active_count: number;
  total_count: number;
  workflows: N8nWorkflow[];
  recent_executions: Array<{ id: string; workflowId: string; workflow: string; status: string; finished_at: string }>;
  failed_last_24h: number;
}

export interface KnowledgeStats {
  collections: Array<{ name: string; status: string; vectors: number; segments: number }>;
  total_vectors: number;
  collection_count: number;
}

export interface UptimeResponse {
  monitors: Array<{ id: number; status: string; ping: number | null; last_check: string | null }>;
  total: number;
  up: number;
  down: number;
  source: string;
}

// API functions
export const api = {
  containers: () => get<ContainersResponse>('/api/v1/health/containers'),
  metrics: () => get<SystemMetrics>('/api/v1/metrics/system'),
  workflows: () => get<WorkflowsResponse>('/api/v1/workflows'),
  knowledge: () => get<KnowledgeStats>('/api/v1/knowledge/stats'),
  uptime: () => get<UptimeResponse>('/api/v1/uptime/monitors'),
  triggerWorkflow: (id: string) => post(`/api/v1/workflows/${id}/activate`),
  containerAction: (id: string, action: 'start' | 'stop' | 'restart') =>
    post<{ success: boolean }>(`/api/v1/health/containers/${id}/${action}`),
  containerLogs: (id: string, tail = 100) =>
    get<{ container: string; lines: string[] }>(`/api/v1/health/containers/${id}/logs?tail=${tail}`),
  heal: () => post<{ healed: number; results: Array<{ name: string; success: boolean; error?: string }> }>('/api/v1/health/heal'),
  probe: () => post<{ success: boolean; message: string }>('/api/v1/health/probe'),
};

// Polling hook — uses ref for fetcher to prevent infinite loops from inline functions
import { useState, useEffect, useRef, useCallback } from 'react';

export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const result = await fetcherRef.current();
        if (!cancelled) { setData(result); setError(null); }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    const id = setInterval(run, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);

  const refresh = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  return { data, error, loading, refresh };
}
