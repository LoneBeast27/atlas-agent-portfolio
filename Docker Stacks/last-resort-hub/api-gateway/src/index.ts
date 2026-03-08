import { Hono } from 'hono';
import { cors } from 'hono/cors';
import health from './routes/health';
import metrics from './routes/metrics';
import workflows from './routes/workflows';
import knowledge from './routes/knowledge';
import uptime from './routes/uptime';

const app = new Hono();

// CORS — allow frontend origin
app.use('*', cors({ origin: '*' }));

// Mount routes
app.route('/api/v1/health', health);
app.route('/api/v1/metrics', metrics);
app.route('/api/v1/workflows', workflows);
app.route('/api/v1/knowledge', knowledge);
app.route('/api/v1/uptime', uptime);

// Root health check
app.get('/', (c) => c.json({
  service: 'last-resort-gateway',
  status: 'ok',
  version: '2.0.0',
  endpoints: [
    '/api/v1/health/containers',
    '/api/v1/metrics/system',
    '/api/v1/workflows',
    '/api/v1/knowledge/stats',
    '/api/v1/uptime/monitors',
  ],
}));

import { startSync } from './lib/sync';

const port = parseInt(process.env.GATEWAY_PORT ?? '3005');
console.log(`[Gateway] Starting on :${port}`);

// Start background sync to push data into STDB
startSync();

export default {
  port,
  fetch: app.fetch,
};
