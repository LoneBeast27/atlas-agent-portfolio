import { Server, RotateCcw, Play, Square, ScrollText, X } from 'lucide-react';
import { useState } from 'react';
import { api, type Container } from '../api/gateway';
import { useStdbOrFallback } from '../api/stdb';
import type { ContainersResponse } from '../api/gateway';

const statusColor = (health: string) => {
  if (health === 'healthy' || health === 'running') return 'text-success';
  if (health === 'unhealthy') return 'text-warning';
  return 'text-danger';
};

export default function ServiceHealth() {
  const { data, loading, error, refresh, dataSource } = useStdbOrFallback<ContainersResponse>('containers', api.containers, 15000);
  const [acting, setActing] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ name: string; lines: string[] } | null>(null);

  const containerAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setActing(`${id}-${action}`);
    try {
      await api.containerAction(id, action);
      setTimeout(refresh, 1500); // refresh after container state settles
    } catch (err) {
      console.error(`Failed to ${action} ${id}:`, err);
    } finally {
      setActing(null);
    }
  };

  const viewLogs = async (id: string, name: string) => {
    try {
      const res = await api.containerLogs(id, 50);
      setLogs({ name, lines: res.lines });
    } catch {
      setLogs({ name, lines: ['Failed to fetch logs'] });
    }
  };

  if (loading) return <WidgetShell title="Service Health" icon={<Server size={18} />}>Loading...</WidgetShell>;
  if (error || !data) return <WidgetShell title="Service Health" icon={<Server size={18} />}>Failed to connect</WidgetShell>;

  const stacks = new Map<string, Container[]>();
  data.containers.forEach(c => {
    const list = stacks.get(c.stack) ?? [];
    list.push(c);
    stacks.set(c.stack, list);
  });

  return (
    <WidgetShell
      title="Service Health"
      icon={<Server size={18} />}
      subtitle={`${data.healthy} healthy / ${data.total} total`}
    >
      <div className="flex gap-3 mb-3 text-xs font-medium">
        <span className="text-success">{data.healthy} up</span>
        {data.degraded > 0 && <span className="text-warning">{data.degraded} degraded</span>}
        {data.stopped > 0 && <span className="text-danger">{data.stopped} stopped</span>}
      </div>

      {/* Log viewer overlay */}
      {logs && (
        <div className="absolute inset-0 z-20 bg-surface-1/95 backdrop-blur-sm rounded-2xl p-4 flex flex-col">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <h4 className="text-xs font-semibold">{logs.name} — logs</h4>
            <button onClick={() => setLogs(null)} className="p-1 hover:bg-surface-2 rounded-lg"><X size={14} /></button>
          </div>
          <pre className="flex-1 overflow-auto text-[0.6rem] leading-relaxed text-text-muted font-mono whitespace-pre-wrap">
            {logs.lines.join('\n') || 'No output'}
          </pre>
        </div>
      )}

      <div className="space-y-3 overflow-y-auto flex-1 pr-1">
        {[...stacks.entries()].map(([stack, containers]) => (
          <div key={stack}>
            <h4 className="text-xs text-text-muted uppercase tracking-wider mb-1.5">{stack}</h4>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-1.5">
              {containers.map(c => (
                <div key={c.id} className="group flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-surface-2/50 relative">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(c.health)}`} style={{ backgroundColor: 'currentColor' }} />
                  <span className="truncate flex-1">{c.name}</span>
                  {/* Action buttons on hover */}
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => containerAction(c.id, 'restart')}
                      disabled={acting !== null}
                      className="p-0.5 hover:bg-surface-3 rounded text-text-muted hover:text-warning"
                      title="Restart"
                    >
                      <RotateCcw size={10} className={acting === `${c.id}-restart` ? 'animate-spin' : ''} />
                    </button>
                    {c.status === 'running' ? (
                      <button
                        onClick={() => containerAction(c.id, 'stop')}
                        disabled={acting !== null}
                        className="p-0.5 hover:bg-surface-3 rounded text-text-muted hover:text-danger"
                        title="Stop"
                      >
                        <Square size={10} />
                      </button>
                    ) : (
                      <button
                        onClick={() => containerAction(c.id, 'start')}
                        disabled={acting !== null}
                        className="p-0.5 hover:bg-surface-3 rounded text-text-muted hover:text-success"
                        title="Start"
                      >
                        <Play size={10} />
                      </button>
                    )}
                    <button
                      onClick={() => viewLogs(c.id, c.name)}
                      className="p-0.5 hover:bg-surface-3 rounded text-text-muted hover:text-primary"
                      title="View Logs"
                    >
                      <ScrollText size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}

function WidgetShell({ title, icon, subtitle, children }: { title: string; icon: React.ReactNode; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel p-4 h-full flex flex-col overflow-hidden relative">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <span className="text-primary">{icon}</span>
        <h3 className="font-semibold text-sm">{title}</h3>
        {subtitle && <span className="ml-auto text-xs text-text-muted">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}
