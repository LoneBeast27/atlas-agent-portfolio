import { Database } from 'lucide-react';
import { api, type KnowledgeStats as KnowledgeStatsType } from '../api/gateway';
import { useStdbOrFallback } from '../api/stdb';

export default function KnowledgeStats() {
  const { data, loading } = useStdbOrFallback<KnowledgeStatsType>('qdrant', api.knowledge, 300000);

  return (
    <div className="glass-panel p-4 h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <Database size={18} className="text-primary" />
        <h3 className="font-semibold text-sm">Knowledge Base</h3>
      </div>
      {loading || !data ? (
        <p className="text-xs text-text-muted">Loading...</p>
      ) : (
        <>
          <div className="flex gap-4 mb-3 text-xs">
            <div>
              <span className="text-2xl font-bold text-primary">{data.total_vectors.toLocaleString()}</span>
              <p className="text-text-muted">vectors</p>
            </div>
            <div>
              <span className="text-2xl font-bold">{data.collection_count}</span>
              <p className="text-text-muted">collections</p>
            </div>
          </div>
          <div className="space-y-1.5 overflow-y-auto flex-1 pr-1">
            {data.collections.map(col => (
              <div key={col.name} className="flex items-center justify-between text-xs p-2 rounded-lg bg-surface-2/30">
                <span className="font-medium">{col.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-text-muted">{col.vectors.toLocaleString()} vec</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${col.status === 'green' ? 'bg-success' : 'bg-warning'}`} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
