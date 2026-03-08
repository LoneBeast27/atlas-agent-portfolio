import { Cpu, HardDrive } from 'lucide-react';
import { api, type SystemMetrics as SystemMetricsType } from '../api/gateway';
import { useStdbOrFallback } from '../api/stdb';

function Gauge({ label, value, unit = '%', color = 'primary' }: { label: string; value: number | null; unit?: string; color?: string }) {
  const pct = value ?? 0;
  const colorMap: Record<string, string> = {
    primary: '#6366f1',
    success: '#22c55e',
    warning: '#f59e0b',
    danger: '#ef4444',
  };
  const autoColor = pct > 90 ? 'danger' : pct > 75 ? 'warning' : color;
  const strokeColor = colorMap[autoColor] ?? colorMap.primary;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-16 h-16">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15.5" fill="none"
            stroke={strokeColor} strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${pct * 0.975} 97.5`}
            style={{ transition: 'stroke-dasharray 500ms ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold">{value !== null ? Math.round(value) : '—'}</span>
        </div>
      </div>
      <span className="text-[0.65rem] text-text-muted">{label}</span>
    </div>
  );
}

export default function SystemMetrics() {
  const { data, loading } = useStdbOrFallback<SystemMetricsType>('prometheus', api.metrics, 30000);

  return (
    <div className="glass-panel p-4 h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <Cpu size={18} className="text-primary" />
        <h3 className="font-semibold text-sm">System Metrics</h3>
      </div>
      {loading || !data ? (
        <p className="text-xs text-text-muted">Loading...</p>
      ) : (
        <div className="flex flex-wrap justify-around gap-3 flex-1 items-center">
          <Gauge label="CPU" value={data.cpu_percent} />
          <Gauge label="RAM" value={data.memory.percent} />
          <Gauge label="VRAM" value={data.gpu_vram.percent} color="warning" />
          <Gauge label="SSD" value={data.disk.speed_drive_percent} />
          <Gauge label="HDD" value={data.disk.hdd_percent} />
        </div>
      )}
    </div>
  );
}
