import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Responsive, type Layout, type Layouts } from 'react-grid-layout';
import { Settings, X, RotateCcw, Shield, Save, FolderOpen, Trash2 } from 'lucide-react';
import { useTable, useSpacetimeDB } from 'spacetimedb/react';
import { WIDGET_REGISTRY, getDefaultLayouts } from './widgets';
import { tables, DbConnection, getStdbConnection } from './api/stdb';
import type { WidgetLayout } from './module_bindings/types';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const LAYOUT_KEY = 'lrh-layout';
const HIDDEN_KEY = 'lrh-hidden';
const PRESETS_KEY = 'lrh-presets';

interface LayoutPreset {
  name: string;
  layout: Layout[];
  hidden: string[];
}

function loadPresets(): LayoutPreset[] {
  try {
    const saved = localStorage.getItem(PRESETS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function savePresets(presets: LayoutPreset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

function loadLayoutFromLocal(): Layout[] {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY);
    return saved ? JSON.parse(saved) : getDefaultLayouts();
  } catch {
    return getDefaultLayouts();
  }
}

function loadHiddenFromLocal(): Set<string> {
  try {
    const saved = localStorage.getItem(HIDDEN_KEY);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  } catch {
    return new Set();
  }
}

/** Convert STDB widgetLayout rows to react-grid-layout Layout[] + hidden set */
function stdbToLayout(rows: WidgetLayout[]): { layout: Layout[]; hidden: Set<string> } {
  const layout: Layout[] = [];
  const hidden = new Set<string>();
  const defaults = getDefaultLayouts();
  const defaultMap = new Map(defaults.map(l => [l.i, l]));

  for (const row of rows) {
    layout.push({
      i: row.widgetId,
      x: row.gridX,
      y: row.gridY,
      w: row.gridW,
      h: row.gridH,
      minW: defaultMap.get(row.widgetId)?.minW,
      minH: defaultMap.get(row.widgetId)?.minH,
    });
    if (!row.visible) hidden.add(row.widgetId);
  }

  // Add any new widgets not yet in STDB
  for (const def of defaults) {
    if (!layout.find(l => l.i === def.i)) {
      layout.push(def);
    }
  }

  return { layout, hidden };
}

/** Push current layout to STDB via save_widget_layout reducer */
function saveLayoutToStdb(layout: Layout[], hidden: Set<string>) {
  const conn = getStdbConnection();
  if (!conn) return;
  for (const l of layout) {
    conn.reducers.saveWidgetLayout({
      widgetId: l.i,
      gridX: l.x,
      gridY: l.y,
      gridW: l.w,
      gridH: l.h,
      visible: !hidden.has(l.i),
      config: '{}',
    });
  }
}

/** Save layout to localStorage as fallback */
function saveLayoutToLocal(layout: Layout[], hidden: Set<string>) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
}

function buildLayouts(base: Layout[]): Layouts {
  return {
    lg: base,
    md: base.map(l => ({ ...l, w: Math.min(l.w, 6), x: l.x % 6 })),
    sm: base.map(l => ({ ...l, w: 1, x: 0 })),
  };
}

export default function App() {
  const { isActive } = useSpacetimeDB<DbConnection>();
  const [stdbLayoutRows] = useTable<DbConnection, WidgetLayout>(tables.widgetLayout);

  const [layout, setLayout] = useState<Layout[]>(loadLayoutFromLocal);
  const [hidden, setHidden] = useState<Set<string>>(loadHiddenFromLocal);
  const [editing, setEditing] = useState(false);
  const [rowHeight, setRowHeight] = useState(Math.max(40, Math.floor(window.innerHeight / 16)));
  const [presets, setPresets] = useState<LayoutPreset[]>(loadPresets);
  const [presetMenu, setPresetMenu] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [gridWidth, setGridWidth] = useState(window.innerWidth - 32);
  const [stdbLayoutLoaded, setStdbLayoutLoaded] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Hydrate layout from STDB on first connect (one-time)
  useEffect(() => {
    if (stdbLayoutLoaded || !isActive || !stdbLayoutRows || stdbLayoutRows.length === 0) return;
    const { layout: stdbLayout, hidden: stdbHidden } = stdbToLayout(stdbLayoutRows);
    setLayout(stdbLayout);
    setHidden(stdbHidden);
    saveLayoutToLocal(stdbLayout, stdbHidden);
    setStdbLayoutLoaded(true);
  }, [isActive, stdbLayoutRows, stdbLayoutLoaded]);

  useEffect(() => {
    const onResize = () => setRowHeight(Math.max(40, Math.floor(window.innerHeight / 16)));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Manual width tracking — replaces WidthProvider to prevent cascade
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    let raf: number;
    const ro = new ResizeObserver((entries) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = entries[0]?.contentRect.width;
        if (w && w > 0) setGridWidth(w);
      });
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  // Save to both STDB + localStorage on drag/resize
  const onDragStop = useCallback((_layout: Layout[]) => {
    setLayout(_layout);
    saveLayoutToLocal(_layout, hidden);
    saveLayoutToStdb(_layout, hidden);
  }, [hidden]);

  const onResizeStop = useCallback((_layout: Layout[]) => {
    setLayout(_layout);
    saveLayoutToLocal(_layout, hidden);
    saveLayoutToStdb(_layout, hidden);
  }, [hidden]);

  const noop = useCallback(() => {}, []);

  const toggleWidget = useCallback((id: string) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveLayoutToLocal(layout, next);
      saveLayoutToStdb(layout, next);
      return next;
    });
  }, [layout]);

  const resetLayout = useCallback(() => {
    const defaults = getDefaultLayouts();
    setLayout(defaults);
    setHidden(new Set());
    saveLayoutToLocal(defaults, new Set());
    // Clear STDB layout rows, then push defaults
    const conn = getStdbConnection();
    if (conn) {
      conn.reducers.resetLayout({});
      setTimeout(() => saveLayoutToStdb(defaults, new Set()), 200);
    }
  }, []);

  const savePreset = useCallback(() => {
    if (!presetName.trim()) return;
    const preset: LayoutPreset = { name: presetName.trim(), layout, hidden: [...hidden] };
    const updated = [...presets.filter(p => p.name !== preset.name), preset];
    setPresets(updated);
    savePresets(updated);
    setSavingPreset(false);
    setPresetName('');
  }, [presetName, layout, hidden, presets]);

  const loadPreset = useCallback((preset: LayoutPreset) => {
    setLayout(preset.layout);
    const hiddenSet = new Set(preset.hidden);
    setHidden(hiddenSet);
    saveLayoutToLocal(preset.layout, hiddenSet);
    saveLayoutToStdb(preset.layout, hiddenSet);
    setPresetMenu(false);
  }, []);

  const deletePreset = useCallback((name: string) => {
    const updated = presets.filter(p => p.name !== name);
    setPresets(updated);
    savePresets(updated);
  }, [presets]);

  const visibleWidgets = useMemo(
    () => WIDGET_REGISTRY.filter(w => !hidden.has(w.id)),
    [hidden]
  );
  const visibleLayout = useMemo(
    () => layout.filter(l => !hidden.has(l.i)),
    [layout, hidden]
  );
  const layouts = useMemo(() => buildLayouts(visibleLayout), [visibleLayout]);

  return (
    <div className="min-h-screen p-[1vw]">
      {/* Header */}
      <header className="flex items-center justify-between mb-[1vh] px-[0.5vw]">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/20 text-primary rounded-xl">
            <Shield size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Last Resort Hub</h1>
            <p className="text-xs text-text-muted flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-success animate-pulse' : 'bg-warning'}`} />
              {isActive ? 'STDB Connected' : 'REST Fallback'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 relative">
          {editing && (
            <>
              {/* Save Preset */}
              {savingPreset ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={presetName}
                    onChange={e => setPresetName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') savePreset(); if (e.key === 'Escape') setSavingPreset(false); }}
                    placeholder="Preset name..."
                    className="px-2 py-1 rounded-lg bg-surface-2 text-xs w-28 outline-none border border-surface-3 focus:border-primary"
                  />
                  <button onClick={savePreset} className="px-2 py-1.5 rounded-lg bg-success/20 text-success text-xs hover:bg-success/30">Save</button>
                  <button onClick={() => setSavingPreset(false)} className="px-2 py-1.5 rounded-lg bg-surface-2/50 text-text-muted text-xs hover:bg-surface-2">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setSavingPreset(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2/50 hover:bg-surface-2 text-xs transition-colors"
                >
                  <Save size={12} />
                  Save Preset
                </button>
              )}

              {/* Load Preset */}
              <div className="relative">
                <button
                  onClick={() => setPresetMenu(!presetMenu)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2/50 hover:bg-surface-2 text-xs transition-colors"
                >
                  <FolderOpen size={12} />
                  Presets{presets.length > 0 && ` (${presets.length})`}
                </button>
                {presetMenu && (
                  <div className="absolute right-0 top-full mt-1 w-52 glass-panel p-2 z-50 shadow-lg">
                    {presets.length === 0 ? (
                      <p className="text-xs text-text-muted px-2 py-1">No saved presets</p>
                    ) : (
                      presets.map(p => (
                        <div key={p.name} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-surface-2/50 group">
                          <button onClick={() => loadPreset(p)} className="text-xs flex-1 text-left">{p.name}</button>
                          <button onClick={() => deletePreset(p.name)} className="opacity-0 group-hover:opacity-100 text-error/60 hover:text-error transition-opacity">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={resetLayout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2/50 hover:bg-surface-2 text-xs transition-colors"
              >
                <RotateCcw size={12} />
                Reset
              </button>
            </>
          )}
          <button
            onClick={() => { setEditing(!editing); setPresetMenu(false); setSavingPreset(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
              editing
                ? 'bg-primary text-white'
                : 'bg-surface-2/50 hover:bg-surface-2 text-text-muted'
            }`}
          >
            {editing ? <X size={12} /> : <Settings size={12} />}
            {editing ? 'Done' : 'Edit Layout'}
          </button>
        </div>
      </header>

      {/* Widget Picker (visible in edit mode) */}
      {editing && (
        <div className="mx-[0.5vw] mb-[1vh] p-3 glass-panel">
          <h4 className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wider">Widgets</h4>
          <div className="flex flex-wrap gap-2">
            {WIDGET_REGISTRY.map(w => (
              <button
                key={w.id}
                onClick={() => toggleWidget(w.id)}
                className={`px-3 py-1 rounded-full text-xs transition-colors border ${
                  hidden.has(w.id)
                    ? 'border-surface-3 text-text-muted opacity-50'
                    : 'border-primary/30 bg-primary/10 text-primary'
                }`}
              >
                {w.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Responsive Grid */}
      <div ref={gridRef} className={editing ? 'grid-editing' : 'grid-locked'}>
        <Responsive
          width={gridWidth}
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 768, sm: 0 }}
          cols={{ lg: 12, md: 6, sm: 1 }}
          rowHeight={rowHeight}
          margin={[12, 12]}
          containerPadding={[8, 8]}
          isDraggable
          isResizable
          draggableHandle=".widget-drag-handle"
          onDragStop={onDragStop}
          onResizeStop={onResizeStop}
          onLayoutChange={noop}
          compactType="vertical"
          useCSSTransforms
        >
          {visibleWidgets.map(widget => {
            const Widget = widget.component;
            return (
              <div key={widget.id}>
                <div className="widget-drag-handle" />
                <Widget />
              </div>
            );
          })}
        </Responsive>
      </div>
    </div>
  );
}
