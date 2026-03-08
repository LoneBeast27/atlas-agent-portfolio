import { Workflow, CheckCircle, XCircle, Clock, Play, Power, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { api, type WorkflowsResponse } from '../api/gateway';
import { useStdbOrFallback } from '../api/stdb';

export default function WorkflowStatus() {
  const { data, loading, error } = useStdbOrFallback<WorkflowsResponse>('n8n', api.workflows, 60000);
  const [showWorkflows, setShowWorkflows] = useState(false);
  const [triggering, setTriggering] = useState<string | null>(null);

  const triggerWorkflow = async (id: string) => {
    setTriggering(id);
    try {
      await api.triggerWorkflow(id);
    } catch (err) {
      console.error('Failed to trigger workflow:', err);
    } finally {
      setTimeout(() => setTriggering(null), 1000);
    }
  };

  return (
    <div className="glass-panel p-4 h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <Workflow size={18} className="text-primary" />
        <h3 className="font-semibold text-sm">n8n Workflows</h3>
        {data && (
          <span className="ml-auto text-xs text-text-muted">{data.active_count}/{data.total_count}</span>
        )}
      </div>
      {loading || !data ? (
        <p className="text-xs text-text-muted">Loading...</p>
      ) : error ? (
        <p className="text-xs text-danger">Failed to connect</p>
      ) : (
        <>
          {/* Stats + toggle */}
          <div className="flex gap-4 mb-3 text-xs items-center">
            <span className="text-success flex items-center gap-1">
              <Power size={12} /> {data.active_count} active
            </span>
            {data.failed_last_24h > 0 && (
              <span className="text-danger flex items-center gap-1">
                <XCircle size={12} /> {data.failed_last_24h} failed
              </span>
            )}
            <button
              onClick={() => setShowWorkflows(!showWorkflows)}
              className="ml-auto flex items-center gap-1 text-text-muted hover:text-primary transition-colors"
            >
              {showWorkflows ? 'Executions' : 'Workflows'}
              {showWorkflows ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>

          <div className="space-y-1.5 overflow-y-auto flex-1 pr-1">
            {showWorkflows ? (
              /* Workflow list with trigger buttons */
              (data.workflows ?? []).map(wf => (
                <div key={wf.id} className="flex items-center gap-2 text-xs p-1.5 rounded bg-surface-2/30">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${wf.active ? 'bg-success' : 'bg-surface-3'}`} />
                  <span className="truncate flex-1">{wf.name}</span>
                  <button
                    onClick={() => triggerWorkflow(wf.id)}
                    disabled={triggering !== null}
                    className="p-1 hover:bg-surface-3 rounded text-text-muted hover:text-success transition-colors shrink-0"
                    title="Trigger workflow"
                  >
                    <Play size={11} className={triggering === wf.id ? 'text-success animate-pulse' : ''} />
                  </button>
                </div>
              ))
            ) : (
              /* Recent executions */
              data.recent_executions.map(ex => (
                <div key={ex.id} className="flex items-center gap-2 text-xs p-1.5 rounded bg-surface-2/30">
                  {ex.status === 'success' ? (
                    <CheckCircle size={12} className="text-success shrink-0" />
                  ) : ex.status === 'error' ? (
                    <XCircle size={12} className="text-danger shrink-0" />
                  ) : (
                    <Clock size={12} className="text-text-muted shrink-0" />
                  )}
                  <span className="truncate flex-1">{ex.workflow}</span>
                  <span className="text-text-muted shrink-0">
                    {new Date(ex.finished_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
