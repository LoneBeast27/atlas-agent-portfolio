import { Brain, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { useTable, useSpacetimeDB } from 'spacetimedb/react';
import { tables, DbConnection } from '../api/stdb';
import type { ArchitectProposal } from '../module_bindings/types';

const statusIcon = (status: string) => {
  switch (status) {
    case 'applied': return <CheckCircle size={12} className="text-success shrink-0" />;
    case 'reverted': return <AlertTriangle size={12} className="text-warning shrink-0" />;
    case 'rejected': return <XCircle size={12} className="text-danger shrink-0" />;
    default: return <Clock size={12} className="text-text-muted shrink-0" />;
  }
};

const categoryColor = (cat: string) => {
  switch (cat) {
    case 'safe': return 'text-success';
    case 'risky': return 'text-warning';
    case 'blocked': return 'text-danger';
    default: return 'text-text-muted';
  }
};

export default function ArchitectProposals() {
  const { isActive } = useSpacetimeDB<DbConnection>();
  const [rows] = useTable<DbConnection, ArchitectProposal>(tables.architectProposal);

  const sorted = [...(rows ?? [])].sort((a, b) => Number(b.timestamp - a.timestamp));
  const pending = sorted.filter(p => p.status === 'pending').length;

  return (
    <div className="glass-panel p-4 h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <Brain size={18} className="text-primary" />
        <h3 className="font-semibold text-sm">Architect Proposals</h3>
        {isActive && pending > 0 && (
          <span className="ml-auto text-xs text-warning">{pending} pending</span>
        )}
        {isActive && pending === 0 && sorted.length > 0 && (
          <span className="ml-auto text-xs text-text-muted">{sorted.length} total</span>
        )}
      </div>
      <div className="space-y-2 overflow-y-auto flex-1 pr-1">
        {!isActive ? (
          <p className="text-xs text-text-muted">Connecting to STDB...</p>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <Brain size={32} className="mb-2 opacity-30" />
            <p className="text-xs">No proposals yet</p>
            <p className="text-[0.65rem] opacity-60">Daily review runs at 3 AM</p>
          </div>
        ) : (
          sorted.slice(0, 30).map(p => (
            <div key={String(p.id)} className="p-2 rounded-lg bg-surface-2/50 text-xs">
              <div className="flex items-center gap-2 mb-1">
                {statusIcon(p.status)}
                <span className="font-medium truncate flex-1">{p.description}</span>
                <span className={`text-[0.6rem] uppercase ${categoryColor(p.category)}`}>{p.category}</span>
              </div>
              <div className="flex justify-between text-text-muted text-[0.6rem]">
                <span>{p.toolAffected}</span>
                <span>
                  {p.evalScoreBefore > 0 && `${p.evalScoreBefore.toFixed(0)}%`}
                  {p.evalScoreAfter > 0 && ` → ${p.evalScoreAfter.toFixed(0)}%`}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
