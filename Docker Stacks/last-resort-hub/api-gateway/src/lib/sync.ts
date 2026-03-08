// Background sync: polls all data sources and pushes snapshots into STDB
// This makes STDB the "central nervous system" — frontend reads from STDB first,
// falls back to gateway REST if STDB is unavailable.

import { config, apiFetch } from './clients';
import { pushSnapshot, pushServiceHealth, pushEvent } from './stdb';

// Track previous container states for change detection
let prevContainerStates = new Map<string, string>();

async function syncContainers() {
  try {
    const dockerUrl = config.docker.socketPath.startsWith('/')
      ? 'http://localhost/containers/json?all=true'
      : `${config.docker.socketPath}/containers/json?all=true`;

    const res = await fetch(dockerUrl, {
      // @ts-ignore - Bun unix socket support
      unix: config.docker.socketPath.startsWith('/') ? config.docker.socketPath : undefined,
    });
    const containers = await res.json() as Array<{
      Id: string; Names: string[]; State: string; Status: string;
      Labels: Record<string, string>;
    }>;

    const getStack = (labels: Record<string, string>): string => {
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
    };

    const formatUptime = (status: string): string => {
      const match = status.match(/Up\s+(.+?)(?:\s+\(|$)/);
      return match ? match[1].trim() : status;
    };

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

    // Push each container's health into serviceHealth table
    for (const c of mapped) {
      await pushServiceHealth(c.name, c.health);

      // Detect state changes and log events
      const prev = prevContainerStates.get(c.id);
      if (prev && prev !== c.health) {
        const severity = c.health === 'unhealthy' ? 'warning'
          : c.health === 'running' || c.health === 'healthy' ? 'info' : 'error';
        await pushEvent(severity, c.name, JSON.stringify({
          change: `${prev} → ${c.health}`,
          container: c.name,
        }));
      }
      prevContainerStates.set(c.id, c.health);
    }

    // Push full container list as a snapshot (matches ContainersResponse shape)
    const running = mapped.filter(c => c.status === 'running');
    const stopped = mapped.filter(c => c.status !== 'running');
    await pushSnapshot('containers', {
      containers: mapped,
      total: mapped.length,
      healthy: running.filter(c => c.health === 'healthy' || c.health === 'running').length,
      degraded: running.filter(c => c.health === 'unhealthy').length,
      stopped: stopped.length,
    });
  } catch (err) {
    console.error('[Sync] Containers failed:', err);
    await pushSnapshot('containers', null, 'error');
  }
}

async function syncMetrics() {
  try {
    const promQuery = async (query: string): Promise<number | null> => {
      try {
        const url = `${config.prometheus.url}/api/v1/query?query=${encodeURIComponent(query)}`;
        const res = await apiFetch<{ data: { result: Array<{ value: [number, string] }> } }>(url);
        const val = res.data?.result?.[0]?.value?.[1];
        return val !== undefined ? parseFloat(val) : null;
      } catch { return null; }
    };

    const [cpu, memUsed, memTotal, diskSpeed, diskHdd, gpuUsed, gpuTotal] = await Promise.all([
      promQuery('100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'),
      promQuery('node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes'),
      promQuery('node_memory_MemTotal_bytes'),
      promQuery('100 - ((node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100)'),
      promQuery('100 - ((node_filesystem_avail_bytes{mountpoint="/mnt/b"} / node_filesystem_size_bytes{mountpoint="/mnt/b"}) * 100)'),
      promQuery('nvidia_smi_memory_used_bytes'),
      promQuery('nvidia_smi_memory_total_bytes'),
    ]);

    const toGb = (b: number | null) => b !== null ? Math.round((b / 1073741824) * 10) / 10 : null;

    await pushSnapshot('prometheus', {
      cpu_percent: cpu !== null ? Math.round(cpu * 10) / 10 : null,
      memory: {
        used_gb: toGb(memUsed), total_gb: toGb(memTotal),
        percent: memUsed && memTotal ? Math.round((memUsed / memTotal) * 1000) / 10 : null,
      },
      gpu_vram: {
        used_gb: toGb(gpuUsed), total_gb: toGb(gpuTotal),
        percent: gpuUsed && gpuTotal ? Math.round((gpuUsed / gpuTotal) * 1000) / 10 : null,
      },
      disk: {
        speed_drive_percent: diskSpeed !== null ? Math.round(diskSpeed * 10) / 10 : null,
        hdd_percent: diskHdd !== null ? Math.round(diskHdd * 10) / 10 : null,
      },
    });
  } catch (err) {
    console.error('[Sync] Metrics failed:', err);
    await pushSnapshot('prometheus', null, 'error');
  }
}

async function syncWorkflows() {
  try {
    const n8nHeaders = () => ({ 'X-N8N-API-KEY': config.n8n.apiKey });

    const [workflows, executions] = await Promise.all([
      apiFetch<{ data: Array<{ id: string; name: string; active: boolean }> }>(
        `${config.n8n.url}/api/v1/workflows`, { headers: n8nHeaders() }
      ),
      apiFetch<{ data: Array<{ id: string; workflowId: string; status: string; stoppedAt: string; workflowData?: { name?: string } }> }>(
        `${config.n8n.url}/api/v1/executions?limit=20`, { headers: n8nHeaders() }
      ),
    ]);

    const nameMap = new Map<string, string>();
    for (const w of workflows.data ?? []) nameMap.set(w.id, w.name);

    const active = (workflows.data ?? []).filter(w => w.active);
    const oneDayAgo = Date.now() - 86400000;
    const failedLast24h = (executions.data ?? []).filter(
      ex => ex.status === 'error' && new Date(ex.stoppedAt).getTime() > oneDayAgo
    ).length;

    await pushSnapshot('n8n', {
      active_count: active.length,
      total_count: workflows.data?.length ?? 0,
      workflows: (workflows.data ?? []).map(w => ({ id: w.id, name: w.name, active: w.active })),
      recent_executions: (executions.data ?? []).slice(0, 10).map(ex => ({
        id: ex.id, workflowId: ex.workflowId,
        workflow: nameMap.get(ex.workflowId) ?? ex.workflowData?.name ?? `Workflow ${ex.workflowId}`,
        status: ex.status, finished_at: ex.stoppedAt,
      })),
      failed_last_24h: failedLast24h,
    });
  } catch (err) {
    console.error('[Sync] Workflows failed:', err);
    await pushSnapshot('n8n', null, 'error');
  }
}

async function syncKnowledge() {
  try {
    const qdrantHeaders = () => ({ 'api-key': config.qdrant.apiKey });
    const list = await apiFetch<{ result: { collections: Array<{ name: string }> } }>(
      `${config.qdrant.url}/collections`, { headers: qdrantHeaders() }
    );

    const collections = await Promise.all(
      (list.result?.collections ?? []).map(async (col) => {
        try {
          const info = await apiFetch<{ result: { status: string; points_count: number; segments_count: number; vectors_count: number } }>(
            `${config.qdrant.url}/collections/${col.name}`, { headers: qdrantHeaders() }
          );
          return { name: col.name, status: info.result.status, vectors: info.result.vectors_count ?? info.result.points_count ?? 0, segments: info.result.segments_count ?? 0 };
        } catch {
          return { name: col.name, status: 'error', vectors: 0, segments: 0 };
        }
      })
    );

    await pushSnapshot('qdrant', {
      collections,
      total_vectors: collections.reduce((s, c) => s + c.vectors, 0),
      collection_count: collections.length,
    });
  } catch (err) {
    console.error('[Sync] Knowledge failed:', err);
    await pushSnapshot('qdrant', null, 'error');
  }
}

async function syncUptime() {
  try {
    const statusPage = await apiFetch<{ ok: boolean; heartbeatList: Record<string, Array<{ status: number; ping: number; time: string; msg: string }>>; uptimeList: Record<string, number> }>(
      `${config.uptimeKuma.url}/api/status-page/default`, { timeout: 5000 }
    ).catch(() => null);

    if (statusPage?.ok) {
      const monitors = Object.entries(statusPage.heartbeatList).map(([id, beats]) => {
        const latest = beats[beats.length - 1];
        return {
          id: parseInt(id),
          status: latest?.status === 1 ? 'up' : latest?.status === 0 ? 'down' : 'pending',
          ping: latest?.ping ?? null,
          last_check: latest?.time ?? null,
        };
      });

      await pushSnapshot('uptime', {
        monitors, total: monitors.length,
        up: monitors.filter(m => m.status === 'up').length,
        down: monitors.filter(m => m.status === 'down').length,
        source: 'status-page',
      });
    } else {
      await pushSnapshot('uptime', { monitors: [], total: 0, up: 0, down: 0, source: 'unavailable' });
    }
  } catch (err) {
    console.error('[Sync] Uptime failed:', err);
    await pushSnapshot('uptime', null, 'error');
  }
}

// Main sync loop
async function syncAll() {
  const start = Date.now();
  await Promise.allSettled([
    syncContainers(),
    syncMetrics(),
    syncWorkflows(),
    syncKnowledge(),
    syncUptime(),
  ]);
  console.log(`[Sync] Complete in ${Date.now() - start}ms`);
}

const SYNC_INTERVAL = 30_000; // 30 seconds

/** Force an immediate sync cycle (used by /probe endpoint) */
export async function forceSyncAll() {
  return syncAll();
}

export function startSync() {
  console.log(`[Sync] Starting background sync (every ${SYNC_INTERVAL / 1000}s)`);
  // Initial sync after a short delay to let STDB warm up
  setTimeout(() => {
    syncAll();
    setInterval(syncAll, SYNC_INTERVAL);
  }, 3000);
}
