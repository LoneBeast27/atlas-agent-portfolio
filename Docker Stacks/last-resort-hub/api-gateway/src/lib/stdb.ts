// SpacetimeDB HTTP client for the gateway
// Pushes data snapshots into STDB so the frontend can read via WebSocket subscriptions

const STDB_URL = process.env.STDB_URI ?? 'http://stdb:3000';
const STDB_MODULE = process.env.STDB_MODULE ?? 'atlas-hub-v2';
const BASE = `${STDB_URL}/v1/database/${STDB_MODULE}`;

let token: string | null = null;

async function ensureToken(): Promise<string> {
  if (token) return token;
  try {
    const res = await fetch(`${STDB_URL}/v1/identity`, { method: 'POST' });
    if (!res.ok) throw new Error(`Identity ${res.status}`);
    const data = await res.json() as { token: string };
    token = data.token;
    console.log('[STDB] Acquired identity token');
    return token;
  } catch (err) {
    console.error('[STDB] Failed to acquire token:', err);
    throw err;
  }
}

async function callReducer(name: string, args: unknown[]): Promise<boolean> {
  try {
    const t = await ensureToken();
    const res = await fetch(`${BASE}/call/${name}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${t}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[STDB] Reducer ${name} failed: ${res.status} ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[STDB] Reducer ${name} error:`, err);
    return false;
  }
}

// Public API for pushing data into STDB

export async function pushSnapshot(source: string, data: unknown, status: string = 'ok') {
  return callReducer('update_gateway_snapshot', [
    source,
    JSON.stringify(data),
    status,
  ]);
}

export async function pushServiceHealth(serviceName: string, healthStatus: string) {
  return callReducer('update_health', [serviceName, healthStatus]);
}

export async function pushEvent(severity: string, service: string, payload: string) {
  return callReducer('log_event', [severity, service, payload]);
}

export async function pushHealing(eventId: bigint, service: string, action: string, result: string, details: string) {
  return callReducer('record_healing', [eventId, service, action, result, details]);
}
