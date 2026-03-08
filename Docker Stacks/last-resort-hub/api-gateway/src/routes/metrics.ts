import { Hono } from 'hono';
import { config, apiFetch } from '../lib/clients';

const app = new Hono();

interface PromResult {
  data: { result: Array<{ value: [number, string] }> };
}

async function promQuery(query: string): Promise<number | null> {
  try {
    const url = `${config.prometheus.url}/api/v1/query?query=${encodeURIComponent(query)}`;
    const res = await apiFetch<PromResult>(url);
    const val = res.data?.result?.[0]?.value?.[1];
    return val !== undefined ? parseFloat(val) : null;
  } catch {
    return null;
  }
}

app.get('/system', async (c) => {
  const [cpuPct, memUsed, memTotal, diskSpeedPct, diskHddPct] = await Promise.all([
    // CPU usage across all cores (last 5m avg)
    promQuery('100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'),
    // Memory used in bytes
    promQuery('node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes'),
    // Memory total in bytes
    promQuery('node_memory_MemTotal_bytes'),
    // Disk usage for Speed Drive (C:) — adjust mountpoint as needed
    promQuery('100 - ((node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100)'),
    // Disk usage for HDD (B:)
    promQuery('100 - ((node_filesystem_avail_bytes{mountpoint="/mnt/b"} / node_filesystem_size_bytes{mountpoint="/mnt/b"}) * 100)'),
  ]);

  // GPU VRAM — try nvidia_smi_exporter metric if available
  const gpuUsed = await promQuery('nvidia_smi_memory_used_bytes');
  const gpuTotal = await promQuery('nvidia_smi_memory_total_bytes');

  const toGb = (bytes: number | null) => bytes !== null ? Math.round((bytes / 1073741824) * 10) / 10 : null;

  return c.json({
    cpu_percent: cpuPct !== null ? Math.round(cpuPct * 10) / 10 : null,
    memory: {
      used_gb: toGb(memUsed),
      total_gb: toGb(memTotal),
      percent: memUsed && memTotal ? Math.round((memUsed / memTotal) * 1000) / 10 : null,
    },
    gpu_vram: {
      used_gb: toGb(gpuUsed),
      total_gb: toGb(gpuTotal),
      percent: gpuUsed && gpuTotal ? Math.round((gpuUsed / gpuTotal) * 1000) / 10 : null,
    },
    disk: {
      speed_drive_percent: diskSpeedPct !== null ? Math.round(diskSpeedPct * 10) / 10 : null,
      hdd_percent: diskHddPct !== null ? Math.round(diskHddPct * 10) / 10 : null,
    },
  });
});

export default app;
