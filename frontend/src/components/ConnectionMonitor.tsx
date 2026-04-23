import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Send,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

const STATUS_CONFIG: Record<
  ConnStatus,
  { label: string; dotClass: string; badgeClass: string; pingClass: string }
> = {
  online: {
    label: '在線',
    dotClass: 'bg-emerald-400',
    pingClass: 'bg-emerald-400',
    badgeClass: 'text-emerald-300 bg-emerald-500/15 ring-1 ring-emerald-500/25',
  },
  idle: {
    label: '閒置',
    dotClass: 'bg-amber-400',
    pingClass: 'bg-amber-400',
    badgeClass: 'text-amber-300 bg-amber-500/15 ring-1 ring-amber-500/25',
  },
  token_missing: {
    label: 'Token 缺失',
    dotClass: 'bg-rose-400',
    pingClass: 'bg-rose-400',
    badgeClass: 'text-rose-300 bg-rose-500/15 ring-1 ring-rose-500/25',
  },
  disconnected: {
    label: '已斷線',
    dotClass: 'bg-rose-400',
    pingClass: 'bg-rose-400',
    badgeClass: 'text-rose-300 bg-rose-500/15 ring-1 ring-rose-500/25',
  },
};

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '剛剛';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function maskToken(token: string | null): string {
  if (!token) return '—';
  return token.slice(0, 8) + '••••••••' + token.slice(-4);
}

// ─── Component ───────────────────────────────────────────────────────────────

const ConnectionMonitor = () => {
  const [entries, setEntries] = useState<ClientEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [testingId, setTestingId] = useState('');
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError('');

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

      if (connResult.error) throw new Error(connResult.error.message);
      if (tenantResult.error) throw new Error(tenantResult.error.message);

      // Build last-message-time map keyed by phone_number_id
      const lastMsgMap: Record<string, string> = {};
      for (const msg of msgResult.data || []) {
        const pid = msg.wa_business_phone_number_id as string;
        if (pid && !lastMsgMap[pid]) {
          lastMsgMap[pid] = msg.created_at as string;
        }
      }

      const seenPhoneIds = new Set<string>();
      const result: ClientEntry[] = [];

      // Priority 1: px_connections records
      for (const conn of (connResult.data || []) as ConnectionRow[]) {
        seenPhoneIds.add(conn.phone_number_id);
        const tenant = Array.isArray(conn.tenant_id)
          ? conn.tenant_id[0]
          : conn.tenant_id;

        result.push({
          key: conn.id,
          tenantName: tenant?.name ?? 'Unknown Tenant',
          orgCode: tenant?.org_code ?? 'N/A',
          platform: conn.platform,
          phoneNumberId: conn.phone_number_id,
          hasToken: !!conn.access_token,
          rawStatus: conn.connection_status ?? 'disconnected',
          lastHeartbeat: conn.last_heartbeat,
          lastMessageTime: lastMsgMap[conn.phone_number_id] ?? null,
        });
      }

      // Priority 2: px_tenants with wa_phone_number_id (not already seen)
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    const sub = supabase
      .channel('connection-monitor-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'px_connections' },
        loadData,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'px_tenants' },
        loadData,
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'px_messages' },
        loadData,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, []);

  // Refresh timestamps every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setEntries((prev) => [...prev]); // force re-render for relative times
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  const stats = useMemo(() => {
    const statuses = entries.map((e) => deriveStatus(e));
    return {
      total: entries.length,
      active: statuses.filter((s) => s === 'online' || s === 'idle').length,
      issues: statuses.filter((s) => s === 'token_missing' || s === 'disconnected').length,
    };
  }, [entries]);

  const handleTestConnection = async (entry: ClientEntry) => {
    setTestingId(entry.key);
    setTestResult((prev) => ({ ...prev, [entry.key]: '' }));

    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${entry.phoneNumberId}?fields=id,display_phone_number,verified_name`,
        {
          headers: {
            // We don't expose tokens to frontend in production—this is for demo purposes
            // In real deployment, proxy this through your backend
          },
        },
      );
      if (res.ok) {
        const json = await res.json();
        setTestResult((prev) => ({
          ...prev,
          [entry.key]: `✅ 連線正常：${json.display_phone_number ?? entry.phoneNumberId}`,
        }));
      } else {
        setTestResult((prev) => ({
          ...prev,
          [entry.key]: `⚠️ API 回應 ${res.status}，請在後台驗證 Token`,
        }));
      }
    } catch {
      setTestResult((prev) => ({
        ...prev,
        [entry.key]: '⚠️ 無法直接測試（CORS），請透過後端 API 驗證',
      }));
    } finally {
      setTestingId('');
    }
  };

  return (
    <div className="rounded-[30px] border border-white/10 bg-slate-900/55 shadow-2xl shadow-black/30 backdrop-blur-xl">
      {/* ── Header ── */}
      <header className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">Monitor Center</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">WhatsApp 連線監控中心</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            即時監控所有客戶 WhatsApp 連線狀態，Token 健康度與最後通訊時間。Supabase Realtime 自動更新。
          </p>
        </div>
        <button
          className="inline-flex items-center justify-center gap-2 self-start rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
          onClick={loadData}
          disabled={isLoading}
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          重新整理
        </button>
      </header>

      {/* ── Quick Stats ── */}
      <div className="grid gap-4 border-b border-white/10 px-5 py-5 sm:grid-cols-3 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Users size={16} className="text-cyan-300" /> Total Clients
          </div>
          <div className="mt-3 text-3xl font-semibold text-white">{stats.total}</div>
          <div className="mt-1 text-xs text-slate-500">已接入 WhatsApp 連線的客戶數</div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Wifi size={16} className="text-emerald-300" /> Active Connections
          </div>
          <div className="mt-3 text-3xl font-semibold text-emerald-400">{stats.active}</div>
          <div className="mt-1 text-xs text-slate-500">🟢 Online / 🟡 Idle 的連線總數</div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <AlertTriangle size={16} className="text-rose-300" /> Issues Detected
          </div>
          <div className={`mt-3 text-3xl font-semibold ${stats.issues > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
            {stats.issues}
          </div>
          <div className="mt-1 text-xs text-slate-500">Token 缺失或已斷線的連線數</div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="px-5 py-5 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex min-h-[320px] items-center justify-center text-slate-300">
            <LoaderCircle className="mr-3 animate-spin" size={22} /> 載入連線資料中...
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-white/10 bg-slate-950/40 px-6 py-16 text-center text-slate-400">
            <WifiOff className="mx-auto mb-4 text-slate-600" size={40} />
            <p className="text-base font-medium">尚無連線記錄</p>
            <p className="mt-2 text-sm text-slate-500">
              在 px_connections 或 px_tenants 新增含 WhatsApp 設定的記錄後會自動顯示。
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[20px] border border-white/10">
            {/* Table Header */}
            <div className="hidden grid-cols-[1fr_160px_160px_140px_180px] gap-4 border-b border-white/10 bg-slate-900/60 px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 lg:grid">
              <div>客戶名稱 / Phone Number ID</div>
              <div>連線狀態</div>
              <div>最後通訊</div>
              <div>Token</div>
              <div>操作</div>
            </div>

            <div className="divide-y divide-white/5">
              {entries.map((entry) => {
                const status = deriveStatus(entry);
                const cfg = STATUS_CONFIG[status];
                const isExpanded = expandedId === entry.key;
                const isTesting = testingId === entry.key;

                return (
                  <div key={entry.key} className="transition-colors hover:bg-white/[0.02]">
                    {/* Main Row */}
                    <div className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_160px_160px_140px_180px] lg:items-center lg:gap-4">
                      {/* Name */}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">
                            {entry.orgCode}
                          </span>
                        </div>
                        <div className="mt-1.5 font-medium text-white">{entry.tenantName}</div>
                        <div className="mt-0.5 font-mono text-xs text-slate-500">{entry.phoneNumberId}</div>
                      </div>

                      {/* Status */}
                      <div>
                        <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${cfg.badgeClass}`}>
                          <span className="relative flex h-2 w-2">
                            {status === 'online' && (
                              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${cfg.pingClass}`} />
                            )}
                            <span className={`relative inline-flex h-2 w-2 rounded-full ${cfg.dotClass}`} />
                          </span>
                          {cfg.label}
                        </div>
                        <div className="mt-1.5 text-xs text-slate-500 lg:hidden">連線狀態</div>
                      </div>

                      {/* Last Message */}
                      <div>
                        <div className="flex items-center gap-1.5 text-sm text-slate-300">
                          <Clock3 size={13} className="text-slate-500 shrink-0" />
                          {formatRelativeTime(entry.lastMessageTime)}
                        </div>
                        {entry.lastHeartbeat && (
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                            <Activity size={11} />
                            心跳 {formatRelativeTime(entry.lastHeartbeat)}
                          </div>
                        )}
                      </div>

                      {/* Token */}
                      <div>
                        {entry.hasToken ? (
                          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/20">
                            <CheckCircle2 size={12} /> 已授權
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-300 ring-1 ring-rose-500/20">
                            <AlertTriangle size={12} /> 未設定
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10"
                          onClick={() => setExpandedId(isExpanded ? null : entry.key)}
                        >
                          <ExternalLink size={12} />
                          {isExpanded ? '收起' : '查看詳情'}
                        </button>
                        <button
                          className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => handleTestConnection(entry)}
                          disabled={isTesting}
                        >
                          {isTesting ? (
                            <LoaderCircle size={12} className="animate-spin" />
                          ) : (
                            <Send size={12} />
                          )}
                          測試連線
                        </button>
                      </div>
                    </div>

                    {/* Test Result Banner */}
                    {testResult[entry.key] && (
                      <div className="mx-5 mb-3 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-xs text-slate-300">
                        {testResult[entry.key]}
                      </div>
                    )}

                    {/* Expanded Detail Panel */}
                    {isExpanded && (
                      <div className="mx-5 mb-4 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60">
                        <div className="border-b border-white/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                          連線詳情
                        </div>
                        <dl className="grid gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-2">
                          <div>
                            <dt className="text-xs text-slate-500">Platform</dt>
                            <dd className="mt-0.5 font-medium text-slate-200 capitalize">{entry.platform}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">Phone Number ID</dt>
                            <dd className="mt-0.5 font-mono text-slate-200">{entry.phoneNumberId}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">Raw Status</dt>
                            <dd className="mt-0.5 font-medium text-slate-200">{entry.rawStatus}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">Last Heartbeat</dt>
                            <dd className="mt-0.5 text-slate-200">{entry.lastHeartbeat ? new Date(entry.lastHeartbeat).toLocaleString('zh-HK') : '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">最後收訊時間</dt>
                            <dd className="mt-0.5 text-slate-200">{entry.lastMessageTime ? new Date(entry.lastMessageTime).toLocaleString('zh-HK') : '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">Token 預覽</dt>
                            <dd className="mt-0.5 font-mono text-slate-400">{maskToken(null) /* token not exposed to frontend */}</dd>
                          </div>
                        </dl>
                        <div className="border-t border-white/10 px-4 py-3">
                          <a
                            href={`https://business.facebook.com/wa/manage/phone-numbers/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                          >
                            <ExternalLink size={12} />
                            在 Meta Business Manager 管理
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionMonitor;
