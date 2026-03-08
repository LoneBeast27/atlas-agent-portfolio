import { schema, table, t } from 'spacetimedb/server';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Atlas AIOS — SpacetimeDB Module
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const spacetimedb = schema({
  serviceHealth: table({ public: true }, {
    serviceName: t.string(),
    status: t.string(),
    lastSeen: t.u64(),
  }),

  systemEvent: table({ public: true }, {
    id: t.u64(),
    timestamp: t.u64(),
    severity: t.string(),
    service: t.string(),
    payload: t.string(),
  }),

  healingAction: table({ public: true }, {
    id: t.u64(),
    eventId: t.u64(),
    timestamp: t.u64(),
    service: t.string(),
    action: t.string(),
    result: t.string(),
    details: t.string(),
  }),

  discoveryFeed: table({ public: true }, {
    title: t.string(),
    category: t.string(),
    content: t.string(),
    timestamp: t.u64(),
  }),

  // Phase 5: Architect self-improvement tables
  architectProposal: table({ public: true }, {
    id: t.u64(),
    timestamp: t.u64(),
    category: t.string(),   // "safe", "risky", "blocked"
    toolAffected: t.string(),
    description: t.string(),
    diff: t.string(),       // proposed change content
    status: t.string(),     // "pending", "applied", "reverted", "rejected"
    evalScoreBefore: t.f64(),
    evalScoreAfter: t.f64(),
    appliedAt: t.u64(),
  }),

  dailyMetrics: table({ public: true }, {
    date: t.string(),       // "2026-03-07" format
    totalToolCalls: t.u64(),
    successfulCalls: t.u64(),
    failedCalls: t.u64(),
    avgLatencyMs: t.f64(),
    promptfooScore: t.f64(),
    topFailedTool: t.string(),
  }),

  // v2: Widget layout persistence
  widgetLayout: table({ public: true }, {
    widgetId: t.string(),      // "service-health", "healing-log", etc.
    gridX: t.u32(),
    gridY: t.u32(),
    gridW: t.u32(),
    gridH: t.u32(),
    visible: t.bool(),
    config: t.string(),        // JSON blob for widget-specific settings
  }),

  // v2: Gateway data cache (written by API gateway, read by frontend)
  gatewaySnapshot: table({ public: true }, {
    source: t.string(),        // "prometheus", "n8n", "containers", etc.
    data: t.string(),          // JSON snapshot of latest poll
    fetchedAt: t.u64(),
    status: t.string(),        // "ok", "error", "timeout"
  }),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Reducers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const log_event = spacetimedb.reducer(
  { name: 'log_event' },
  { severity: t.string(), service: t.string(), payload: t.string() },
  (ctx, { severity, service, payload }) => {
    const ts = ctx.timestamp.microsSinceUnixEpoch;
    ctx.db.systemEvent.insert({ id: ts, timestamp: ts, severity, service, payload });
    console.log(`[${severity.toUpperCase()}] ${service}: ${payload}`);
  }
);

export const update_health = spacetimedb.reducer(
  { name: 'update_health' },
  { serviceName: t.string(), status: t.string() },
  (ctx, { serviceName, status }) => {
    for (const row of ctx.db.serviceHealth.iter()) {
      if (row.serviceName === serviceName) {
        ctx.db.serviceHealth.delete(row);
        break;
      }
    }
    ctx.db.serviceHealth.insert({
      serviceName,
      status,
      lastSeen: ctx.timestamp.microsSinceUnixEpoch,
    });
  }
);

export const record_healing = spacetimedb.reducer(
  { name: 'record_healing' },
  {
    eventId: t.u64(),
    service: t.string(),
    action: t.string(),
    result: t.string(),
    details: t.string(),
  },
  (ctx, { eventId, service, action, result, details }) => {
    const ts = ctx.timestamp.microsSinceUnixEpoch;
    ctx.db.healingAction.insert({ id: ts, eventId, timestamp: ts, service, action, result, details });
    console.log(`[HEAL] ${service}: ${action} -> ${result}`);
  }
);

export const trigger_reboot = spacetimedb.reducer(
  { name: 'trigger_reboot' },
  { service: t.string() },
  (ctx, { service }) => {
    const ts = ctx.timestamp.microsSinceUnixEpoch;
    ctx.db.systemEvent.insert({
      id: ts, timestamp: ts, severity: 'critical', service,
      payload: JSON.stringify({ action: 'reboot', requestedBy: ctx.sender.toHexString() }),
    });
  }
);

export const request_music = spacetimedb.reducer(
  { name: 'request_music' },
  { request: t.string() },
  (ctx, { request }) => {
    const ts = ctx.timestamp.microsSinceUnixEpoch;
    ctx.db.systemEvent.insert({
      id: ts, timestamp: ts, severity: 'info', service: 'music',
      payload: JSON.stringify({ action: 'music_request', request, requestedBy: ctx.sender.toHexString() }),
    });
  }
);

export const add_discovery = spacetimedb.reducer(
  { name: 'add_discovery' },
  { title: t.string(), category: t.string(), content: t.string() },
  (ctx, { title, category, content }) => {
    ctx.db.discoveryFeed.insert({
      title, category, content,
      timestamp: ctx.timestamp.microsSinceUnixEpoch,
    });
  }
);

// Phase 5: Architect proposal reducers
export const submit_proposal = spacetimedb.reducer(
  { name: 'submit_proposal' },
  {
    category: t.string(),
    toolAffected: t.string(),
    description: t.string(),
    diff: t.string(),
    evalScoreBefore: t.f64(),
  },
  (ctx, { category, toolAffected, description, diff, evalScoreBefore }) => {
    const ts = ctx.timestamp.microsSinceUnixEpoch;
    ctx.db.architectProposal.insert({
      id: ts, timestamp: ts, category, toolAffected, description, diff,
      status: category === 'blocked' ? 'rejected' : 'pending',
      evalScoreBefore, evalScoreAfter: 0, appliedAt: BigInt(0),
    });
    console.log(`[ARCHITECT] ${category} proposal: ${description}`);
  }
);

export const apply_proposal = spacetimedb.reducer(
  { name: 'apply_proposal' },
  { proposalId: t.u64(), evalScoreAfter: t.f64() },
  (ctx, { proposalId, evalScoreAfter }) => {
    for (const row of ctx.db.architectProposal.iter()) {
      if (row.id === proposalId) {
        ctx.db.architectProposal.delete(row);
        ctx.db.architectProposal.insert({
          ...row,
          status: evalScoreAfter >= row.evalScoreBefore ? 'applied' : 'reverted',
          evalScoreAfter,
          appliedAt: ctx.timestamp.microsSinceUnixEpoch,
        });
        break;
      }
    }
  }
);

export const record_daily_metrics = spacetimedb.reducer(
  { name: 'record_daily_metrics' },
  {
    date: t.string(),
    totalToolCalls: t.u64(),
    successfulCalls: t.u64(),
    failedCalls: t.u64(),
    avgLatencyMs: t.f64(),
    promptfooScore: t.f64(),
    topFailedTool: t.string(),
  },
  (ctx, metrics) => {
    // Upsert: delete old entry for this date if exists
    for (const row of ctx.db.dailyMetrics.iter()) {
      if (row.date === metrics.date) {
        ctx.db.dailyMetrics.delete(row);
        break;
      }
    }
    ctx.db.dailyMetrics.insert(metrics);
    console.log(`[METRICS] ${metrics.date}: ${metrics.totalToolCalls} calls, ${metrics.promptfooScore}% score`);
  }
);

// v2: Widget layout reducers
export const save_widget_layout = spacetimedb.reducer(
  { name: 'save_widget_layout' },
  {
    widgetId: t.string(),
    gridX: t.u32(),
    gridY: t.u32(),
    gridW: t.u32(),
    gridH: t.u32(),
    visible: t.bool(),
    config: t.string(),
  },
  (ctx, layout) => {
    for (const row of ctx.db.widgetLayout.iter()) {
      if (row.widgetId === layout.widgetId) {
        ctx.db.widgetLayout.delete(row);
        break;
      }
    }
    ctx.db.widgetLayout.insert(layout);
  }
);

export const reset_layout = spacetimedb.reducer(
  { name: 'reset_layout' },
  {},
  (ctx) => {
    const rows = [...ctx.db.widgetLayout.iter()];
    for (const row of rows) {
      ctx.db.widgetLayout.delete(row);
    }
    console.log(`[LAYOUT] Reset — cleared ${rows.length} widget positions`);
  }
);

// v2: Gateway snapshot reducer (called by API gateway to cache poll results)
export const update_gateway_snapshot = spacetimedb.reducer(
  { name: 'update_gateway_snapshot' },
  { source: t.string(), data: t.string(), status: t.string() },
  (ctx, { source, data, status }) => {
    for (const row of ctx.db.gatewaySnapshot.iter()) {
      if (row.source === source) {
        ctx.db.gatewaySnapshot.delete(row);
        break;
      }
    }
    ctx.db.gatewaySnapshot.insert({
      source, data, status,
      fetchedAt: ctx.timestamp.microsSinceUnixEpoch,
    });
  }
);

export default spacetimedb;
