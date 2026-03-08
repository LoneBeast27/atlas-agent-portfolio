import { Hono } from 'hono';
import { config } from '../lib/clients';
import { forceSyncAll } from '../lib/sync';
import { pushEvent, pushServiceHealth } from '../lib/stdb';

const app = new Hono();

interface DockerContainer {
  Id: string;
  Names: string[];
  State: string;
  Status: string;
  Labels: Record<string, string>;
}

interface DockerStats {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number; online_cpus: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
  memory_stats: { usage: number; limit: number };
}

// Map container names to their stack based on compose project label
function getStack(labels: Record<string, string>): string {
  const project = labels['com.docker.compose.project'] ?? '';
  const map: Record<string, string> = {
    'ai-stack': 'AI Stack', 'aistack': 'AI Stack', 'ai_stack': 'AI Stack',
    'media-stack': 'Media Stack', 'mediastack': 'Media Stack', 'media_stack': 'Media Stack',
    'fundamental-stack': 'Fundamental Stack', 'fundamentalstack': 'Fundamental Stack', 'fundamental_stack': 'Fundamental Stack',
    'ops-stack': 'Ops Stack', 'opsstack': 'Ops Stack', 'ops_stack': 'Ops Stack',
    'game-stack': 'Game Stack', 'gamestack': 'Game Stack', 'game_stack': 'Game Stack',
    'last-resort-hub': 'Last Resort Hub', 'lastresorthub': 'Last Resort Hub', 'last_resort_hub': 'Last Resort Hub',
    'minecraft-stack': 'Minecraft Stack', 'minecraftstack': 'Minecraft Stack', 'minecraft_stack': 'Minecraft Stack',
  };
  return map[project.toLowerCase()] ?? (project || 'Unknown');
}

function formatUptime(status: string): string {
  const match = status.match(/Up\s+(.+?)(?:\s+\(|$)/);
  return match ? match[1].trim() : status;
}

app.get('/containers', async (c) => {
  try {
    const dockerUrl = config.docker.socketPath.startsWith('/')
      ? `http://localhost/containers/json?all=true`
      : `${config.docker.socketPath}/containers/json?all=true`;

    const res = await fetch(dockerUrl, {
      // @ts-ignore - Bun supports unix sockets via `unix` option
      unix: config.docker.socketPath.startsWith('/') ? config.docker.socketPath : undefined,
    });
    const containers: DockerContainer[] = await res.json();

    const mapped = containers.map(ct => ({
      id: ct.Id.slice(0, 12),
      name: ct.Names[0]?.replace(/^\//, '') ?? 'unknown',
      stack: getStack(ct.Labels),
      status: ct.State,
      health: ct.Status.includes('healthy') ? 'healthy'
        : ct.Status.includes('unhealthy') ? 'unhealthy'
        : ct.State === 'running' ? 'running' : ct.State,
      uptime: formatUptime(ct.Status),
    }));

    const running = mapped.filter(c => c.status === 'running');
    const stopped = mapped.filter(c => c.status !== 'running');

    return c.json({
      containers: mapped,
      total: mapped.length,
      healthy: running.filter(c => c.health === 'healthy' || c.health === 'running').length,
      degraded: running.filter(c => c.health === 'unhealthy').length,
      stopped: stopped.length,
    });
  } catch (err) {
    return c.json({ error: 'Failed to connect to Docker', detail: String(err) }, 502);
  }
});

// Container control: start/stop/restart
async function dockerPost(containerId: string, action: string) {
  const dockerUrl = `http://localhost/containers/${containerId}/${action}`;
  const res = await fetch(dockerUrl, {
    method: 'POST',
    // @ts-ignore - Bun supports unix sockets via `unix` option
    unix: config.docker.socketPath.startsWith('/') ? config.docker.socketPath : undefined,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Docker ${action} failed: ${res.status} ${body}`);
  }
  return { ok: true };
}

app.post('/containers/:id/:action', async (c) => {
  const id = c.req.param('id');
  const action = c.req.param('action');
  if (!['start', 'stop', 'restart'].includes(action)) {
    return c.json({ error: 'Invalid action. Use start, stop, or restart.' }, 400);
  }
  try {
    await dockerPost(id, action);
    return c.json({ success: true, container: id, action });
  } catch (err) {
    return c.json({ error: `Failed to ${action} container`, detail: String(err) }, 502);
  }
});

// Container logs
app.get('/containers/:id/logs', async (c) => {
  const id = c.req.param('id');
  const tail = c.req.query('tail') ?? '100';
  try {
    const dockerUrl = `http://localhost/containers/${id}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=true`;
    const res = await fetch(dockerUrl, {
      // @ts-ignore
      unix: config.docker.socketPath.startsWith('/') ? config.docker.socketPath : undefined,
    });
    const raw = await res.text();
    // Docker log stream has 8-byte header per line, strip it
    const lines = raw.split('\n').map(line => line.length > 8 ? line.slice(8) : line).filter(Boolean);
    return c.json({ container: id, lines });
  } catch (err) {
    return c.json({ error: 'Failed to fetch logs', detail: String(err) }, 502);
  }
});

// Self-heal: find unhealthy containers and restart them
app.post('/heal', async (c) => {
  try {
    const dockerUrl = config.docker.socketPath.startsWith('/')
      ? 'http://localhost/containers/json?all=true'
      : `${config.docker.socketPath}/containers/json?all=true`;

    const res = await fetch(dockerUrl, {
      // @ts-ignore
      unix: config.docker.socketPath.startsWith('/') ? config.docker.socketPath : undefined,
    });
    const containers: DockerContainer[] = await res.json();

    const unhealthy = containers.filter(ct => ct.Status.includes('unhealthy'));
    const results: Array<{ name: string; success: boolean; error?: string }> = [];

    for (const ct of unhealthy) {
      const name = ct.Names[0]?.replace(/^\//, '') ?? 'unknown';
      try {
        await dockerPost(ct.Id, 'restart');
        await pushServiceHealth(name, 'restarting');
        await pushEvent('info', name, JSON.stringify({ action: 'heal_restart', trigger: 'manual' }));
        results.push({ name, success: true });
      } catch (err) {
        results.push({ name, success: false, error: String(err) });
      }
    }

    return c.json({ healed: results.length, results });
  } catch (err) {
    return c.json({ error: 'Heal failed', detail: String(err) }, 502);
  }
});

// Force a full data sync cycle
app.post('/probe', async (c) => {
  try {
    await forceSyncAll();
    return c.json({ success: true, message: 'Sync cycle complete' });
  } catch (err) {
    return c.json({ error: 'Probe failed', detail: String(err) }, 502);
  }
});

export default app;
