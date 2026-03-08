// SpacetimeDB client connection for Last Resort Hub
import { SpacetimeDBProvider, useTable, useSpacetimeDB } from 'spacetimedb/react';
import { DbConnection, tables } from '../module_bindings';
import type { GatewaySnapshot } from '../module_bindings/types';
import { useState, useEffect, useRef, useCallback } from 'react';

const STDB_URI = import.meta.env.VITE_STDB_URI ?? 'ws://localhost:3004';
const STDB_MODULE = 'atlas-hub-v3';

const TOKEN_KEY = 'stdb_token';

// Module-level connection ref for imperative reducer calls
let activeConn: DbConnection | null = null;

/** Get the current STDB connection (null if disconnected) */
export function getStdbConnection(): DbConnection | null {
  return activeConn;
}

const connectionBuilder = DbConnection.builder()
  .withUri(STDB_URI)
  .withModuleName(STDB_MODULE)
  .withToken(localStorage.getItem(TOKEN_KEY) ?? undefined)
  .onConnect((conn, _identity, token) => {
    activeConn = conn;
    if (token) localStorage.setItem(TOKEN_KEY, token);
    // Subscribe to all public tables
    conn.subscriptionBuilder()
      .onError((_ctx, err) => console.error('[STDB] Subscription error:', err))
      .subscribe([
        'SELECT * FROM healing_action',
        'SELECT * FROM architect_proposal',
        'SELECT * FROM discovery_feed',
        'SELECT * FROM daily_metrics',
        'SELECT * FROM service_health',
        'SELECT * FROM system_event',
        'SELECT * FROM gateway_snapshot',
        'SELECT * FROM widget_layout',
      ]);
  })
  .onConnectError((_ctx, err) => {
    console.error('[STDB] Connection error:', err);
  })
  .onDisconnect((_ctx, err) => {
    activeConn = null;
    if (err) console.warn('[STDB] Disconnected:', err);
  });

export function StdbProvider({ children }: { children: React.ReactNode }) {
  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      {children}
    </SpacetimeDBProvider>
  );
}

// Re-export for widget use
export { tables, DbConnection };
export type { ReducerEventContext, SubscriptionEventContext } from '../module_bindings';

/**
 * STDB-first data hook with gateway REST fallback.
 *
 * Reads from gatewaySnapshot table (STDB, real-time) first.
 * Falls back to polling the gateway REST API if:
 *   - STDB is disconnected
 *   - No snapshot exists for this source
 *   - Snapshot is stale (older than maxAge)
 *
 * This gives redundancy: if STDB dies, widgets keep working via REST.
 * If the gateway dies, widgets show last-known data from STDB.
 */
export function useStdbOrFallback<T>(
  source: string,
  fetcher: () => Promise<T>,
  fallbackIntervalMs: number = 30000,
  maxAgeMs: number = 120000, // 2 min staleness threshold
) {
  const { isActive } = useSpacetimeDB<DbConnection>();
  const [snapshots] = useTable<DbConnection, GatewaySnapshot>(tables.gatewaySnapshot);

  // REST fallback state
  const [fallbackData, setFallbackData] = useState<T | null>(null);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Find our snapshot from STDB
  const snapshot = (snapshots ?? []).find(s => s.source === source);
  const snapshotData = snapshot?.status === 'ok' && snapshot.data
    ? (() => { try { return JSON.parse(snapshot.data) as T; } catch { return null; } })()
    : null;
  const snapshotAge = snapshot ? Date.now() - Number(snapshot.fetchedAt) / 1000 : Infinity;
  const snapshotFresh = snapshotAge < maxAgeMs;

  // Use STDB data if available and fresh
  const useStdb = isActive && snapshotData !== null && snapshotFresh;

  // REST fallback polling — only active when STDB data is unavailable
  useEffect(() => {
    if (useStdb) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function run() {
      try {
        const result = await fetcherRef.current();
        if (!cancelled) { setFallbackData(result); setFallbackError(null); }
      } catch (err) {
        if (!cancelled) setFallbackError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    const id = setInterval(run, fallbackIntervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [useStdb, fallbackIntervalMs]);

  const data = useStdb ? snapshotData : fallbackData;
  const error = useStdb ? (snapshot?.status === 'error' ? 'STDB snapshot error' : null) : fallbackError;
  const dataSource: 'stdb' | 'rest' | 'none' = useStdb ? 'stdb' : fallbackData ? 'rest' : 'none';

  const refresh = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setFallbackData(result);
      setFallbackError(null);
    } catch (err) {
      setFallbackError(String(err));
    }
  }, []);

  return { data, error, loading, refresh, dataSource };
}
