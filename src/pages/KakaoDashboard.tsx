import React, { useEffect, useRef, useState } from 'react';
import { Bot, Database, Download, Power, RefreshCw, Wifi, WifiOff } from 'lucide-react';

interface KakaoStatus {
  webhookEnabled: boolean;
  autoreplyEnabled: boolean;
  openaiKeyPresent: boolean;
  todayLogCount: number;
  webhookUrl: string;
}

interface KakaoDbStats {
  dbEnabled: boolean;
  totalUsers: number;
  totalMessages: number;
  inboundToday: number;
  topIntents: Array<{ intent: string; count: number }>;
}

interface KakaoLogEntry {
  id: string;
  conv_id: string;
  ts: string;
  speaker: 'operator' | 'menu' | 'customer';
  user_id: string;
  text: string;
  labels: string[];
}

const SPEAKER_COLOR: Record<string, string> = {
  operator: 'text-blue-400',
  menu: 'text-purple-400',
  customer: 'text-emerald-400',
};

export default function KakaoDashboard() {
  const [status, setStatus] = useState<KakaoStatus | null>(null);
  const [dbStats, setDbStats] = useState<KakaoDbStats | null>(null);
  const [logs, setLogs] = useState<KakaoLogEntry[]>([]);
  const [toggling, setToggling] = useState<'webhook' | 'autoreply' | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  async function fetchStatus() {
    try {
      const r = await fetch('/api/kakao/status');
      if (r.ok) setStatus(await r.json());
    } catch { /* server unreachable */ }
  }

  async function fetchDbStats() {
    try {
      const r = await fetch('/api/kakao/db-stats');
      if (r.ok) setDbStats(await r.json());
    } catch { /* server unreachable */ }
  }

  async function fetchLogs() {
    try {
      const r = await fetch('/api/kakao/logs?limit=100');
      if (r.ok) setLogs(await r.json());
    } catch { /* server unreachable */ }
  }

  useEffect(() => {
    fetchStatus();
    fetchDbStats();
    fetchLogs();
    const interval = setInterval(() => { fetchStatus(); fetchDbStats(); fetchLogs(); }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  async function toggle(field: 'webhook' | 'autoreply') {
    if (!status || toggling) return;
    setToggling(field);
    const body =
      field === 'webhook'
        ? { webhookEnabled: !status.webhookEnabled }
        : { autoreplyEnabled: !status.autoreplyEnabled };
    try {
      const r = await fetch('/api/kakao/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) { const data = await r.json(); setStatus((prev) => prev ? { ...prev, ...data } : prev); }
    } catch { /* ignore */ }
    setToggling(null);
  }

  const webhookOn = status?.webhookEnabled ?? false;
  const autoreplyOn = status?.autoreplyEnabled ?? false;

  return (
    <div className="p-8 space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest mb-1">Kakao Channel</h2>
          <p className="text-white/40 text-sm">@shareplan · Open Builder skill webhook</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {status ? (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Wifi className="w-3.5 h-3.5" /> Server reachable
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-red-400">
              <WifiOff className="w-3.5 h-3.5" /> Unreachable
            </span>
          )}
          <span className="opacity-30">·</span>
          <span className="opacity-40">{status?.todayLogCount ?? '—'} messages today</span>
        </div>
      </div>

      {/* Kill-switch cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Webhook toggle */}
        <div className={`p-6 rounded-2xl border transition-colors ${webhookOn ? 'bg-emerald-900/20 border-emerald-500/30' : 'bg-white/5 border-white/10'}`}>
          <div className="flex items-start justify-between mb-4">
            <div className={`p-2.5 rounded-xl ${webhookOn ? 'bg-emerald-500/20' : 'bg-white/10'}`}>
              <Power className={`w-5 h-5 ${webhookOn ? 'text-emerald-400' : 'text-white/40'}`} />
            </div>
            <button
              onClick={() => toggle('webhook')}
              disabled={toggling !== null}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                webhookOn
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-white/10 hover:bg-white/20 text-white/70'
              } disabled:opacity-50`}
            >
              {toggling === 'webhook' ? '…' : webhookOn ? 'Disable' : 'Enable'}
            </button>
          </div>
          <h3 className="font-semibold text-white mb-1">Webhook</h3>
          <p className="text-xs text-white/40 leading-relaxed">
            {webhookOn
              ? 'Routing Kakao payloads to Express. JSONL logging active.'
              : 'Returning 503. No messages logged or replied to.'}
          </p>
          {status && (
            <p className="mt-3 text-[10px] font-mono text-white/25 break-all">{status.webhookUrl}</p>
          )}
        </div>

        {/* Auto-reply toggle */}
        <div className={`p-6 rounded-2xl border transition-colors ${autoreplyOn ? 'bg-blue-900/20 border-blue-500/30' : 'bg-white/5 border-white/10'}`}>
          <div className="flex items-start justify-between mb-4">
            <div className={`p-2.5 rounded-xl ${autoreplyOn ? 'bg-blue-500/20' : 'bg-white/10'}`}>
              <Bot className={`w-5 h-5 ${autoreplyOn ? 'text-blue-400' : 'text-white/40'}`} />
            </div>
            <button
              onClick={() => toggle('autoreply')}
              disabled={toggling !== null || !status?.openaiKeyPresent}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                autoreplyOn
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-white/10 hover:bg-white/20 text-white/70'
              } disabled:opacity-50`}
            >
              {toggling === 'autoreply' ? '…' : autoreplyOn ? 'Disable' : 'Enable'}
            </button>
          </div>
          <h3 className="font-semibold text-white mb-1">AI Auto-Reply</h3>
          <p className="text-xs text-white/40 leading-relaxed">
            {!status?.openaiKeyPresent
              ? 'OPENAI_API_KEY not set — add to .env to enable.'
              : autoreplyOn
              ? 'gpt-4o-mini generating replies within 2.4s timeout.'
              : 'Webhook logs messages but replies with neutral ACK only.'}
          </p>
          {autoreplyOn && (
            <p className="mt-3 text-[10px] text-amber-400/70">Dev channel only until operator validates reply quality.</p>
          )}
        </div>
      </div>

      {/* KB Export */}
      <div className="flex items-center justify-between p-4 rounded-xl border border-white/10 bg-white/5">
        <div>
          <p className="text-sm font-medium text-white">Knowledge Base Export</p>
          <p className="text-xs text-white/40 mt-0.5">knowledge-base-import.xlsx · 20 FAQ entries · ready for Kakao Channel Partner Center import</p>
        </div>
        <a
          href="/api/kakao/kb-export"
          download
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors"
        >
          <Download className="w-4 h-4" />
          Download
        </a>
      </div>

      {/* PostgreSQL DB stats */}
      <div className={`p-5 rounded-2xl border transition-colors ${dbStats?.dbEnabled ? 'bg-violet-900/20 border-violet-500/30' : 'bg-white/5 border-white/10'}`}>
        <div className="flex items-center gap-2 mb-4">
          <Database className={`w-4 h-4 ${dbStats?.dbEnabled ? 'text-violet-400' : 'text-white/30'}`} />
          <span className="text-sm font-semibold text-white">PostgreSQL Persistence</span>
          <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold ${dbStats?.dbEnabled ? 'bg-violet-500/20 text-violet-300' : 'bg-white/10 text-white/30'}`}>
            {dbStats?.dbEnabled ? 'enabled' : 'disabled'}
          </span>
        </div>
        {dbStats?.dbEnabled ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total users', value: dbStats.totalUsers },
                { label: 'Total messages', value: dbStats.totalMessages },
                { label: 'Inbound today', value: dbStats.inboundToday },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white/5 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-white">{value.toLocaleString()}</p>
                  <p className="text-[10px] text-white/40 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
            {dbStats.topIntents.length > 0 && (
              <div>
                <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2">Top intents</p>
                <div className="flex flex-wrap gap-1.5">
                  {dbStats.topIntents.map(({ intent, count }) => (
                    <span key={intent} className="text-[10px] bg-violet-500/15 text-violet-300 px-2 py-0.5 rounded-full">
                      {intent} · {count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-white/30">Set <code className="bg-white/10 px-1 rounded">KAKAO_DB_ENABLED=true</code> and <code className="bg-white/10 px-1 rounded">KAKAO_DB_*</code> credentials in <code className="bg-white/10 px-1 rounded">.env</code> to persist messages to the <code className="bg-white/10 px-1 rounded">shareplan</code> schema.</p>
        )}
      </div>

      {/* Live log terminal */}
      <div className="rounded-2xl overflow-hidden border border-white/10 bg-[#1a1a1a]">
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#252525] border-b border-white/10">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/70" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
            <span className="w-3 h-3 rounded-full bg-green-500/70" />
            <span className="ml-2 text-xs text-white/40 font-mono">artifacts/kakao-history/today.jsonl</span>
          </div>
          <button
            onClick={fetchLogs}
            className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="h-80 overflow-y-auto p-4 space-y-1 font-mono text-xs">
          {logs.length === 0 ? (
            <p className="text-white/25 italic">No webhook payloads logged today…</p>
          ) : (
            [...logs].reverse().map((entry) => (
              <div key={entry.id} className="flex gap-3 hover:bg-white/5 -mx-4 px-4 py-0.5 rounded">
                <span className="text-white/25 flex-shrink-0 w-20">
                  {new Date(entry.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={`flex-shrink-0 w-16 font-bold ${SPEAKER_COLOR[entry.speaker] ?? 'text-white/50'}`}>
                  {entry.speaker}
                </span>
                <span className="text-white/70 break-all whitespace-pre-wrap">{entry.text}</span>
                {(entry.labels?.length ?? 0) > 0 && (
                  <div className="flex gap-1 flex-shrink-0">
                    {entry.labels.map((l) => (
                      <span key={l} className="text-[10px] bg-white/10 text-white/40 px-1.5 py-0.5 rounded">
                        {l}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
