import { Radio } from 'lucide-react';
import { useTable, useSpacetimeDB } from 'spacetimedb/react';
import { tables, DbConnection } from '../api/stdb';
import type { DiscoveryFeed as DiscoveryFeedType } from '../module_bindings/types';

const categoryColors: Record<string, string> = {
  insight: 'text-primary',
  warning: 'text-warning',
  discovery: 'text-success',
  error: 'text-danger',
};

export default function DiscoveryFeed() {
  const { isActive } = useSpacetimeDB<DbConnection>();
  const [rows] = useTable<DbConnection, DiscoveryFeedType>(tables.discoveryFeed);

  const sorted = [...(rows ?? [])].sort((a, b) => Number(b.timestamp - a.timestamp));

  return (
    <div className="glass-panel p-4 h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <Radio size={18} className="text-primary" />
        <h3 className="font-semibold text-sm">Discovery Feed</h3>
        {isActive && sorted.length > 0 && (
          <span className="ml-auto text-xs text-text-muted">{sorted.length} items</span>
        )}
      </div>
      <div className="space-y-2 overflow-y-auto flex-1 pr-1">
        {!isActive ? (
          <p className="text-xs text-text-muted">Connecting to STDB...</p>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <Radio size={28} className="mb-2 opacity-30" />
            <p className="text-xs">No discoveries yet</p>
            <p className="text-[0.65rem] opacity-60">Events will appear here in real-time</p>
          </div>
        ) : (
          sorted.slice(0, 50).map((item, i) => (
            <div key={`${item.title}-${i}`} className="p-2 rounded-lg bg-surface-2/50 text-xs">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[0.6rem] uppercase font-medium ${categoryColors[item.category] ?? 'text-text-muted'}`}>
                  {item.category}
                </span>
                <span className="font-medium truncate flex-1">{item.title}</span>
                <span className="text-text-muted text-[0.6rem] shrink-0">
                  {new Date(Number(item.timestamp) / 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {item.content && <p className="text-text-muted text-[0.65rem] line-clamp-2">{item.content}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
