import { BarChart3, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useTable, useSpacetimeDB } from 'spacetimedb/react';
import { tables, DbConnection } from '../api/stdb';
import type { DailyMetrics as DailyMetricsType } from '../module_bindings/types';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface-2/50 rounded-lg p-2 text-center">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[0.6rem] text-text-muted">{label}</p>
      {sub && <p className="text-[0.55rem] text-text-muted/60">{sub}</p>}
    </div>
  );
}

export default function DailyMetrics() {
  const { isActive } = useSpacetimeDB<DbConnection>();
  const [rows] = useTable<DbConnection, DailyMetricsType>(tables.dailyMetrics);

  const sorted = [...(rows ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const today = sorted[0];
  const yesterday = sorted[1];

  const trend = today && yesterday
    ? today.promptfooScore > yesterday.promptfooScore ? 'up'
    : today.promptfooScore < yesterday.promptfooScore ? 'down' : 'flat'
    : null;

  return (
    <div className="glass-panel p-4 h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <BarChart3 size={18} className="text-primary" />
        <h3 className="font-semibold text-sm">Daily Metrics</h3>
        {today && (
          <span className="ml-auto text-xs text-text-muted">{today.date}</span>
        )}
      </div>
      {!isActive ? (
        <p className="text-xs text-text-muted">Connecting to STDB...</p>
      ) : !today ? (
        <div className="flex flex-col items-center justify-center h-full text-text-muted">
          <BarChart3 size={28} className="mb-2 opacity-30" />
          <p className="text-xs">No metrics recorded yet</p>
          <p className="text-[0.65rem] opacity-60">Tool call stats, latency, eval scores</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 overflow-y-auto flex-1">
          {/* Score + trend */}
          <div className="flex items-center justify-center gap-2">
            <span className="text-3xl font-bold">{today.promptfooScore.toFixed(0)}%</span>
            {trend === 'up' && <TrendingUp size={18} className="text-success" />}
            {trend === 'down' && <TrendingDown size={18} className="text-danger" />}
            {trend === 'flat' && <Minus size={18} className="text-text-muted" />}
          </div>
          <p className="text-center text-[0.65rem] text-text-muted">Promptfoo Eval Score</p>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Total Calls" value={String(Number(today.totalToolCalls))} />
            <Stat
              label="Success Rate"
              value={Number(today.totalToolCalls) > 0
                ? `${((Number(today.successfulCalls) / Number(today.totalToolCalls)) * 100).toFixed(0)}%`
                : '—'}
            />
            <Stat label="Avg Latency" value={`${today.avgLatencyMs.toFixed(0)}ms`} />
            <Stat
              label="Failed"
              value={String(Number(today.failedCalls))}
              sub={today.topFailedTool || undefined}
            />
          </div>

          {/* Recent history */}
          {sorted.length > 1 && (
            <div className="mt-auto">
              <p className="text-[0.6rem] text-text-muted mb-1">Recent</p>
              <div className="flex gap-1">
                {sorted.slice(0, 7).map(d => {
                  const score = d.promptfooScore;
                  const color = score >= 80 ? 'bg-success' : score >= 60 ? 'bg-warning' : 'bg-danger';
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
                      <div
                        className={`w-full rounded-sm ${color}`}
                        style={{ height: `${Math.max(4, score * 0.4)}px`, opacity: 0.7 }}
                        title={`${d.date}: ${score.toFixed(0)}%`}
                      />
                      <span className="text-[0.45rem] text-text-muted">{d.date.slice(-2)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
