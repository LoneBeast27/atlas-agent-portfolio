import { Hono } from 'hono';
import { config, apiFetch } from '../lib/clients';

const app = new Hono();

interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string;
}

interface N8nExecution {
  id: string;
  workflowId: string;
  finished: boolean;
  stoppedAt: string;
  status: string;
  workflowData?: { name?: string };
}

const n8nHeaders = () => ({ 'X-N8N-API-KEY': config.n8n.apiKey });

app.get('/', async (c) => {
  try {
    const [workflows, executions] = await Promise.all([
      apiFetch<{ data: N8nWorkflow[] }>(`${config.n8n.url}/api/v1/workflows`, { headers: n8nHeaders() }),
      apiFetch<{ data: N8nExecution[] }>(`${config.n8n.url}/api/v1/executions?limit=20`, { headers: n8nHeaders() }),
    ]);

    const active = workflows.data?.filter(w => w.active) ?? [];
    const recent = (executions.data ?? []).slice(0, 10).map(ex => ({
      id: ex.id,
      workflow: ex.workflowData?.name ?? `Workflow ${ex.workflowId}`,
      status: ex.status,
      finished_at: ex.stoppedAt,
    }));

    const oneDayAgo = Date.now() - 86400000;
    const failedLast24h = (executions.data ?? []).filter(
      ex => ex.status === 'error' && new Date(ex.stoppedAt).getTime() > oneDayAgo
    ).length;

    // Build a name lookup from workflow list
    const nameMap = new Map<string, string>();
    for (const w of workflows.data ?? []) nameMap.set(w.id, w.name);

    // Re-map executions with real names
    const recentWithNames = (executions.data ?? []).slice(0, 10).map(ex => ({
      id: ex.id,
      workflowId: ex.workflowId,
      workflow: nameMap.get(ex.workflowId) ?? ex.workflowData?.name ?? `Workflow ${ex.workflowId}`,
      status: ex.status,
      finished_at: ex.stoppedAt,
    }));

    return c.json({
      active_count: active.length,
      total_count: workflows.data?.length ?? 0,
      workflows: (workflows.data ?? []).map(w => ({ id: w.id, name: w.name, active: w.active })),
      recent_executions: recentWithNames,
      failed_last_24h: failedLast24h,
    });
  } catch (err) {
    return c.json({ error: 'Failed to reach n8n', detail: String(err) }, 502);
  }
});

// Trigger a workflow by ID
app.post('/:id/activate', async (c) => {
  const id = c.req.param('id');
  try {
    const res = await fetch(`${config.n8n.url}/api/v1/workflows/${id}/activate`, {
      method: 'POST',
      headers: n8nHeaders(),
    });
    const data = await res.json();
    return c.json(data);
  } catch (err) {
    return c.json({ error: 'Failed to trigger workflow', detail: String(err) }, 502);
  }
});

export default app;
