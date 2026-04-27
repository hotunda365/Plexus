import { useEffect, useMemo, useState } from 'react';
import { Activity, Clock3, Wifi, WifiOff } from 'lucide-react';
import { supabase } from '../lib/supabase';

// ─── Types (shared logic mirrored from ConnectionMonitor) ─────────────────────

type ConnectionRow = {
  id: string;
  tenant_id:
    | { id: string; name: string; org_code: string | null }
    | { id: string; name: string; org_code: string | null }[]
    | null;
  platform: string;
  phone_number_id: string;
  access_token: string | null;
  connection_status: string | null;
  last_heartbeat: string | null;
  created_at: string;
};

type TenantRow = {
  id: string;
  name: string;
  org_code: string | null;
  status: string | null;
  wa_phone_number_id: string | null;
  wa_access_token: string | null;
  created_at: string;
};

type ConnStatus = 'online' | 'idle' | 'token_missing' | 'disconnected';

type ClientEntry = {
  key: string;
  tenantName: string;
  orgCode: string;
  platform: string;
  phoneNumberId: string;
  hasToken: boolean;
  rawStatus: string;
  lastHeartbeat: string | null;
  lastMessageTime: string | null;
};

function deriveStatus(entry: ClientEntry): ConnStatus {
  if (!entry.hasToken) return 'token_missing';
  if (entry.rawStatus === 'disconnected') return 'disconnected';
  if (
    entry.lastHeartbeat &&
    Date.now() - new Date(entry.lastHeartbeat).getTime() < 5 * 60 * 1000
  ) {
    return 'online';
  }
  if (entry.rawStatus === 'active') return 'idle';
  return 'disconnected';
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '剛剛';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

const STATUS_CONFIG: Record<
  ConnStatus,
  { label: string; dotClass: string; pingClass: string; cardBorder: string; cardBg: string; textClass: string }
> = {
  online: {
    label: 'ONLINE',
    dotClass: 'bg-emerald-400',
    pingClass: 'bg-emerald-400',
    cardBorder: 'border-emerald-500/40',
    cardBg: 'bg-emerald-500/10',
    textClass: 'text-emerald-300',
  },
  idle: {
    label: 'IDLE',
    dotClass: 'bg-amber-400',
    pingClass: 'bg-amber-400',
    cardBorder: 'border-amber-500/40',
    cardBg: 'bg-amber-500/10',
    textClass: 'text-amber-300',
  },
  token_missing: {
    label: 'TOKEN MISSING',
    dotClass: 'bg-rose-400',
    pingClass: 'bg-rose-400',
    cardBorder: 'border-rose-500/40',
    cardBg: 'bg-rose-500/10',
    textClass: 'text-rose-300',
  },
  disconnected: {
    label: 'DISCONNECTED',
    dotClass: 'bg-rose-400',
    pingClass: 'bg-rose-400',
    cardBorder: 'border-rose-500/40',
    cardBg: 'bg-rose-500/10',
    textClass: 'text-rose-300',
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function MonitorPage() {
  const [entries, setEntries] = useState<ClientEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, setTick] = useState(0);

  const loadData = async () => {
    try {
      const [connResult, tenantResult, msgResult] = await Promise.all([
        supabase
          .from('px_connections')
          .select(
            'id, tenant_id(id, name, org_code), platform, phone_number_id, access_token, connection_status, last_heartbeat, created_at',
          )
          .eq('platform', 'whatsapp'),
        supabase
          .from('px_tenants')
          .select('id, name, org_code, status, wa_phone_number_id, wa_access_token, created_at')
          .not('wa_phone_number_id', 'is', null),
        supabase
          .from('px_messages')
          .select('wa_business_phone_number_id, created_at')
          .not('wa_business_phone_number_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(500),
      ]);

      const lastMsgMap: Record<string, string> = {};
      for (const msg of msgResult.data || []) {
        const pid = msg.wa_business_phone_number_id as string;
        if (pid && !lastMsgMap[pid]) lastMsgMap[pid] = msg.created_at as string;
      }

      const seenPhoneIds = new Set<string>();
      const result: ClientEntry[] = [];

      for (const conn of (connResult.data || []) as ConnectionRow[]) {
        seenPhoneIds.add(conn.phone_number_id);
        const tenant = Array.isArray(conn.tenant_id) ? conn.tenant_id[0] : conn.tenant_id;
        result.push({
          key: conn.id,
          tenantName: tenant?.name ?? 'Unknown',
          orgCode: tenant?.org_code ?? 'N/A',
          platform: conn.platform,
          phoneNumberId: conn.phone_number_id,
          hasToken: !!conn.access_token,
          rawStatus: conn.connection_status ?? 'disconnected',
          lastHeartbeat: conn.last_heartbeat,
          lastMessageTime: lastMsgMap[conn.phone_number_id] ?? null,
        });
      }

      for (const tenant of (tenantResult.data || []) as TenantRow[]) {
        const pid = tenant.wa_phone_number_id!;
        if (seenPhoneIds.has(pid)) continue;
        seenPhoneIds.add(pid);
        result.push({
          key: tenant.id,
          tenantName: tenant.name,
          orgCode: tenant.org_code ?? 'N/A',
          platform: 'whatsapp',
          phoneNumberId: pid,
          hasToken: !!tenant.wa_access_token,
          rawStatus: tenant.wa_access_token ? 'active' : 'disconnected',
          lastHeartbeat: null,
          lastMessageTime: lastMsgMap[pid] ?? null,
        });
      }

      setEntries(result);
      setLastUpdated(new Date());
    } catch {
      // silent — monitor page keeps last known state
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    const sub = supabase
      .channel('monitor-page-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'px_connections' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'px_tenants' }, loadData)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'px_messages' }, loadData)
      .subscribe();

    // Re-render every minute for relative timestamps
    const tickTimer = setInterval(() => setTick((t) => t + 1), 60_000);

    return () => {
      supabase.removeChannel(sub);
      clearInterval(tickTimer);
    };
  }, []);

  const stats = useMemo(() => {
    const statuses = entries.map((e) => deriveStatus(e));
    return {
      total: entries.length,
      online: statuses.filter((s) => s === 'online').length,
      idle: statuses.filter((s) => s === 'idle').length,
      issues: statuses.filter((s) => s === 'token_missing' || s === 'disconnected').length,
    };
  }, [entries]);

  const now = new Date();
  const timeStr = now.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('zh-HK', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <div className="min-h-screen bg-[#080c14] text-white flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── Top Bar ── */}
      <header className="flex items-center justify-between border-b border-white/10 bg-slate-950/80 px-8 py-4 backdrop-blur">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/20">
            <Wifi size={20} className="text-cyan-300" />
          </div>
          <div>
            <div className="text-xl font-bold tracking-wide text-white">Plexus AI — 連線監控中心</div>
            <div className="text-xs text-slate-500 tracking-widest uppercase">WhatsApp Connection Monitor</div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-3xl font-mono font-semibold text-white tabular-nums">{timeStr}</div>
          <div className="text-xs text-slate-500 mt-0.5">{dateStr}</div>
        </div>
      </header>

      {/* ── Stats Bar ── */}
      <div className="grid grid-cols-4 gap-px border-b border-white/10 bg-white/5">
        {[
          { label: 'Total Clients', value: stats.total, color: 'text-white', bg: 'bg-slate-900' },
          { label: 'Online', value: stats.online, color: 'text-emerald-400', bg: 'bg-emerald-950/40' },
          { label: 'Idle', value: stats.idle, color: 'text-amber-400', bg: 'bg-amber-950/40' },
          { label: 'Issues', value: stats.issues, color: stats.issues > 0 ? 'text-rose-400' : 'text-slate-500', bg: stats.issues > 0 ? 'bg-rose-950/40' : 'bg-slate-900' },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} px-8 py-6 text-center`}>
            <div className={`text-6xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
            <div className="mt-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Connection Cards ── */}
      <main className="flex-1 overflow-auto px-8 py-8">
        {isLoading ? (
          <div className="flex h-full min-h-[300px] items-center justify-center text-slate-400 text-lg">
            載入中...
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-4 text-slate-500">
            <WifiOff size={56} className="text-slate-700" />
            <p className="text-xl font-medium">尚無連線記錄</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {entries.map((entry) => {
              const status = deriveStatus(entry);
              const cfg = STATUS_CONFIG[status];

              return (
                <div
                  key={entry.key}
                  className={`rounded-3xl border ${cfg.cardBorder} ${cfg.cardBg} p-6 flex flex-col gap-4`}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">
                        {entry.orgCode}
                      </span>
                      <div className="mt-2 text-2xl font-bold text-white leading-tight">{entry.tenantName}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500 break-all">{entry.phoneNumberId}</div>
                    </div>

                    {/* Status Badge */}
                    <div className={`inline-flex shrink-0 items-center gap-2 rounded-full border ${cfg.cardBorder} bg-black/20 px-3 py-1.5 text-xs font-bold ${cfg.textClass}`}>
                      <span className="relative flex h-2.5 w-2.5">
                        {status === 'online' && (
                          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${cfg.pingClass}`} />
                        )}
                        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${cfg.dotClass}`} />
                      </span>
                      {cfg.label}
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-white/10" />

                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="flex items-center gap-1.5 text-slate-500 text-xs uppercase tracking-wider mb-1">
                        <Clock3 size={11} /> 最後訊息
                      </div>
                      <div className="font-semibold text-slate-200">{formatRelativeTime(entry.lastMessageTime)}</div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 text-slate-500 text-xs uppercase tracking-wider mb-1">
                        <Activity size={11} /> 心跳
                      </div>
                      <div className="font-semibold text-slate-200">{formatRelativeTime(entry.lastHeartbeat)}</div>
                    </div>
                  </div>

                  {/* Token status */}
                  <div className={`rounded-xl px-3 py-2 text-xs font-semibold text-center ${entry.hasToken ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                    {entry.hasToken ? '✓ Token 已授權' : '✗ Token 未設定'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-white/10 bg-slate-950/80 px-8 py-3 flex items-center justify-between text-xs text-slate-600">
        <span>Plexus AI — Internal Monitor · {window.location.hostname}</span>
        <span>
          {lastUpdated ? `最後更新：${lastUpdated.toLocaleTimeString('zh-HK')}` : '更新中...'}
          {' · '}Supabase Realtime 即時同步
        </span>
      </footer>
    </div>
  );
}
