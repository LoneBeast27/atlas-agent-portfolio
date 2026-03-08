import ServiceHealth from './ServiceHealth';
import SystemMetrics from './SystemMetrics';
import HealingLog from './HealingLog';
import ArchitectProposals from './ArchitectProposals';
import WorkflowStatus from './WorkflowStatus';
import KnowledgeStats from './KnowledgeStats';
import QuickActions from './QuickActions';
import DiscoveryFeed from './DiscoveryFeed';
import DailyMetrics from './DailyMetrics';

export interface WidgetDef {
  id: string;
  title: string;
  component: React.ComponentType;
  defaultLayout: { x: number; y: number; w: number; h: number };
  minW?: number;
  minH?: number;
}

// 12-column grid, row height scales with viewport
export const WIDGET_REGISTRY: WidgetDef[] = [
  { id: 'service-health',       title: 'Service Health',       component: ServiceHealth,       defaultLayout: { x: 0, y: 0, w: 8, h: 4 }, minW: 4, minH: 3 },
  { id: 'system-metrics',       title: 'System Metrics',       component: SystemMetrics,       defaultLayout: { x: 8, y: 0, w: 4, h: 2 }, minW: 3, minH: 2 },
  { id: 'quick-actions',        title: 'Quick Actions',        component: QuickActions,        defaultLayout: { x: 8, y: 2, w: 4, h: 2 }, minW: 3, minH: 2 },
  { id: 'workflow-status',      title: 'n8n Workflows',        component: WorkflowStatus,      defaultLayout: { x: 0, y: 4, w: 4, h: 3 }, minW: 3, minH: 2 },
  { id: 'healing-log',          title: 'Self-Healing Log',     component: HealingLog,          defaultLayout: { x: 4, y: 4, w: 4, h: 3 }, minW: 3, minH: 2 },
  { id: 'architect-proposals',  title: 'Architect Proposals',  component: ArchitectProposals,  defaultLayout: { x: 0, y: 7, w: 4, h: 3 }, minW: 3, minH: 2 },
  { id: 'knowledge-stats',      title: 'Knowledge Base',       component: KnowledgeStats,      defaultLayout: { x: 4, y: 7, w: 4, h: 3 }, minW: 3, minH: 2 },
  { id: 'discovery-feed',       title: 'Discovery Feed',       component: DiscoveryFeed,       defaultLayout: { x: 8, y: 7, w: 4, h: 3 }, minW: 3, minH: 2 },
  { id: 'daily-metrics',        title: 'Daily Metrics',        component: DailyMetrics,        defaultLayout: { x: 0, y: 10, w: 12, h: 2 }, minW: 4, minH: 2 },
];

export function getDefaultLayouts() {
  return WIDGET_REGISTRY.map(w => ({
    i: w.id,
    ...w.defaultLayout,
    minW: w.minW,
    minH: w.minH,
  }));
}
