import { Zap, Music, RotateCcw, Play, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/gateway';
import { getStdbConnection } from '../api/stdb';

export default function QuickActions() {
  const [musicReq, setMusicReq] = useState('');
  const [feedback, setFeedback] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [healing, setHealing] = useState(false);
  const [probing, setProbing] = useState(false);

  const showFeedback = (msg: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ msg, type });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleMusicRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!musicReq.trim()) return;
    const conn = getStdbConnection();
    if (conn) {
      try {
        conn.reducers.requestMusic({ request: musicReq.trim() });
        showFeedback(`Requested: ${musicReq}`);
      } catch (err) {
        showFeedback(`Failed: ${err}`, 'error');
      }
    } else {
      showFeedback('STDB disconnected', 'error');
    }
    setMusicReq('');
  };

  const handleHeal = async () => {
    setHealing(true);
    try {
      const res = await api.heal();
      if (res.healed === 0) {
        showFeedback('No unhealthy containers found');
      } else {
        const ok = res.results.filter(r => r.success).length;
        showFeedback(`Healed ${ok}/${res.healed} containers`);
      }
    } catch (err) {
      showFeedback(`Heal failed: ${err}`, 'error');
    } finally {
      setHealing(false);
    }
  };

  const handleProbe = async () => {
    setProbing(true);
    try {
      await api.probe();
      showFeedback('Full sync complete');
    } catch (err) {
      showFeedback(`Probe failed: ${err}`, 'error');
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="glass-panel p-4 h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <Zap size={18} className="text-warning" />
        <h3 className="font-semibold text-sm">Quick Actions</h3>
      </div>

      {feedback && (
        <div className={`mb-2 px-3 py-1.5 rounded-lg text-xs ${
          feedback.type === 'success' ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
        }`}>
          {feedback.msg}
        </div>
      )}

      {/* Music Request */}
      <form onSubmit={handleMusicRequest} className="mb-3">
        <label className="text-xs text-text-muted mb-1 block">Music Request</label>
        <div className="flex gap-1.5">
          <input
            type="text"
            placeholder="Artist or album..."
            value={musicReq}
            onChange={e => setMusicReq(e.target.value)}
            className="flex-1 bg-surface-2/80 border border-surface-3 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-primary transition-colors text-white placeholder-text-muted/50"
          />
          <button type="submit" className="p-1.5 bg-primary/20 hover:bg-primary/30 text-primary rounded-lg transition-colors">
            <Music size={14} />
          </button>
        </div>
      </form>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2 mt-auto">
        <button
          onClick={handleHeal}
          disabled={healing}
          className="flex items-center gap-1.5 justify-center px-3 py-2 rounded-lg bg-surface-2/50 hover:bg-surface-2 text-xs transition-colors disabled:opacity-50"
        >
          {healing ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
          <span>Run Healer</span>
        </button>
        <button
          onClick={handleProbe}
          disabled={probing}
          className="flex items-center gap-1.5 justify-center px-3 py-2 rounded-lg bg-surface-2/50 hover:bg-surface-2 text-xs transition-colors disabled:opacity-50"
        >
          {probing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          <span>Run Probe</span>
        </button>
      </div>
    </div>
  );
}
