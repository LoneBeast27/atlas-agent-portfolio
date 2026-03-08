import { ShieldCheck } from 'lucide-react';
import { useTable, useSpacetimeDB } from 'spacetimedb/react';
import { tables, DbConnection } from '../api/stdb';
import type { HealingAction } from '../module_bindings/types';

export default function HealingLog() {
  const { isActive } = useSpacetimeDB<DbConnection>();
  const [rows] = useTable<DbConnection, HealingAction>(tables.healingAction);

  // Sort by timestamp descending, show most recent first
  const sorted = [...(rows ?? [])].sort((a, b) => Number(b.timestamp - a.timestamp));

  return (
    <div className="glass-panel p-4 h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <ShieldCheck size={18} className="text-success" />
        <h3 className="font-semibold text-sm">Self-Healing Log</h3>
        {!isActive && <span className="ml-auto text-[0.6rem] text-warning">connecting...</span>}
        {isActive && sorted.length > 0 && (
          <span className="ml-auto text-xs text-text-muted">{sorted.length} events</span>
        )}
      </div>
      <div className="space-y-2 overflow-y-auto flex-1 pr-1">
        {!isActive ? (
          <p className="text-xs text-text-muted">Connecting to STDB...</p>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <ShieldCheck size={32} className="mb-2 opacity-30" />
            <p className="text-xs">No healing events</p>
            <p className="text-[0.65rem] opacity-60">All systems nominal</p>
          </div>
        ) : (
          sorted.slice(0, 50).map(event => (
            <div key={String(event.id)} className="p-2 rounded-lg bg-surface-2/50 text-xs">
              <div className="flex justify-between mb-1">
                <span className="font-medium">{event.service}</span>
                <span className="text-text-muted">
                  {new Date(Number(event.timestamp) / 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-text-muted">
                {event.action} — <span className={event.result === 'success' ? 'text-success' : 'text-warning'}>{event.result}</span>
              </p>
              {event.details && <p className="text-[0.6rem] text-text-muted/60 mt-0.5 truncate">{event.details}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
