import { Hono } from 'hono';
import { config, apiFetch } from '../lib/clients';

const app = new Hono();

// Uptime Kuma push API — uses the /api/status-page/ endpoint (public, no auth needed)
// If a status page named "default" exists, we can read from it.
// Otherwise fall back to the /metrics endpoint.

interface KumaHeartbeat {
  monitorID: number;
  status: number; // 0=down, 1=up, 2=pending
  time: string;
  msg: string;
  ping: number;
}

interface KumaStatusPage {
  ok: boolean;
  heartbeatList: Record<string, KumaHeartbeat[]>;
  uptimeList: Record<string, number>;
  config: { slug: string; title: string };
}

app.get('/monitors', async (c) => {
  try {
    // Try the public status page API first (no auth needed)
    const statusPage = await apiFetch<KumaStatusPage>(
      `${config.uptimeKuma.url}/api/status-page/default`,
      { timeout: 5000 }
    ).catch(() => null);

    if (statusPage?.ok) {
      const monitors = Object.entries(statusPage.heartbeatList).map(([id, beats]) => {
        const latest = beats[beats.length - 1];
        return {
          id: parseInt(id),
          status: latest?.status === 1 ? 'up' : latest?.status === 0 ? 'down' : 'pending',
          ping: latest?.ping ?? null,
          last_check: latest?.time ?? null,
          message: latest?.msg ?? '',
        };
      });

      const uptime = statusPage.uptimeList ?? {};

      return c.json({
        monitors,
        total: monitors.length,
        up: monitors.filter(m => m.status === 'up').length,
        down: monitors.filter(m => m.status === 'down').length,
        uptime_averages: uptime,
        source: 'status-page',
      });
    }

    // Fallback: just report that Uptime Kuma is reachable
    return c.json({
      monitors: [],
      total: 0,
      up: 0,
      down: 0,
      source: 'unavailable',
      note: 'Create a public status page named "default" in Uptime Kuma to enable monitor data',
    });
  } catch (err) {
    return c.json({ error: 'Failed to reach Uptime Kuma', detail: String(err) }, 502);
  }
});

export default app;
