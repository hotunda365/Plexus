import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Building2,
  Clock3,
  LoaderCircle,
  MessageSquareText,
  Phone,
  RefreshCw,
  Send,
  ShieldCheck,
  Siren,
  Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

type Priority = 'low' | 'medium' | 'high';
type Status = 'pending' | 'pending_review' | 'sent' | 'ignored' | 'send_failed' | string;

type ReviewMessage = {
  id: string;
  tenant: string;
  tenantCode: string;
  customer: string;
  text: string;
  aiSuggestion: string;
  finalResponse: string;
  status: Status;
  timestamp: string;
  createdAt: string | null;
  priority: Priority;
};

type SupabaseMessageRow = {
  id: string;
  tenant_id?:
    | {
        name?: string | null;
        org_code?: string | null;
      }
    | {
        name?: string | null;
        org_code?: string | null;
      }[]
    | null;
  customer_phone?: string | null;
  raw_message?: string | null;
  content?: string | null;
  ai_suggestion?: string | null;
  final_response?: string | null;
  status?: string | null;
  created_at?: string | null;
  createdAt: string | null;
};

function inferPriority(text: string): Priority {
  const normalized = text.toLowerCase();
  if (/投訴|complain|urgent|緊急|退款|slow|慢|爛|差/.test(normalized)) {
    return 'high';
  }
  if (/請問|hello|查詢|價錢|時間|地址/.test(normalized)) {
    return 'medium';
  }
  return 'low';
}

function formatTimestamp(input?: string | null): string {
  if (!input) {
    return 'N/A';
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return new Intl.DateTimeFormat('zh-HK', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function mapMessage(row: SupabaseMessageRow): ReviewMessage {
  const text = row.raw_message || row.content || '';
  const aiSuggestion = row.ai_suggestion || '';
  const tenant = Array.isArray(row.tenant_id) ? row.tenant_id[0] : row.tenant_id;

  return {
    id: row.id,
    tenant: tenant?.name || 'Unknown Tenant',
    tenantCode: tenant?.org_code || 'N/A',
    customer: row.customer_phone || 'Unknown',
    text,
    aiSuggestion,
    finalResponse: row.final_response || aiSuggestion,
    status: row.status || 'pending',
    timestamp: formatTimestamp(row.created_at),
    createdAt: row.created_at || null,
    priority: inferPriority(text),
  };
}

type HealthPayload = {
  ok?: boolean;
};

const PlexusDashboard = () => {
  const [messages, setMessages] = useState<ReviewMessage[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [sendingId, setSendingId] = useState('');
  const [ignoringId, setIgnoringId] = useState('');
  const [isStatusLoading, setIsStatusLoading] = useState(true);
  const [isSystemOnline, setIsSystemOnline] = useState(false);

  const loadMessages = async () => {
    setIsLoading(true);
    setError('');

    try {
      const { data, error: fetchError } = await supabase
        .from('px_messages')
        .select('id, tenant_id(name, org_code), customer_phone, raw_message, ai_suggestion, final_response, status, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      const nextMessages = ((data || []) as SupabaseMessageRow[]).map(mapMessage);
      setMessages(nextMessages);
      setDrafts((current) => {
        const merged = { ...current };
        for (const message of nextMessages) {
          if (!merged[message.id]) {
            merged[message.id] = message.finalResponse || message.aiSuggestion;
          }
        }
        return merged;
      });
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const loadHealth = async () => {
    setIsStatusLoading(true);

    try {
      const response = await fetch('/health');
      const payload = (await response.json()) as HealthPayload;
      setIsSystemOnline(Boolean(response.ok && payload.ok));
    } catch {
      setIsSystemOnline(false);
    } finally {
      setIsStatusLoading(false);
    }
  };

  useEffect(() => {
    loadMessages();
    loadHealth();

    const subscription = supabase
      .channel('public:px_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'px_messages' }, () => {
        loadMessages();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  const pendingMessages = useMemo(() => messages.filter((message) => message.status === 'pending' || message.status === 'pending_review'), [messages]);
  const highPriorityCount = useMemo(() => pendingMessages.filter((message) => message.priority === 'high').length, [pendingMessages]);

  const handleDraftChange = (messageId: string, value: string) => {
    setDrafts((current) => ({
      ...current,
      [messageId]: value,
    }));
  };

  const handleApprove = async (messageId: string) => {
    const finalResponse = drafts[messageId]?.trim();
    if (!finalResponse) {
      setError('請先輸入要發送的內容。');
      return;
    }

    setSendingId(messageId);
    setError('');

    try {
      const response = await fetch(`/api/messages/${messageId}/approve-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ finalResponse }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Failed to send WhatsApp message');
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                finalResponse,
                status: 'sent',
              }
            : message,
        ),
      );
      setMessages((current) => current.filter((message) => message.id !== messageId));
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Unknown error');
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                status: 'send_failed',
              }
            : message,
        ),
      );
    } finally {
      setSendingId('');
    }
  };

  const handleIgnore = async (messageId: string) => {
    setIgnoringId(messageId);
    setError('');

    try {
      const response = await fetch(`/api/messages/${messageId}/ignore`, {
        method: 'POST',
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Failed to ignore message');
      }

      setMessages((current) => current.filter((message) => message.id !== messageId));
    } catch (ignoreError) {
      setError(ignoreError instanceof Error ? ignoreError.message : 'Unknown error');
    } finally {
      setIgnoringId('');
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.16),_transparent_26%),linear-gradient(180deg,_#04111d_0%,_#0b1727_48%,_#07101c_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col lg:flex-row">
        <aside className="w-full border-b border-white/10 bg-slate-950/80 px-5 py-6 backdrop-blur-xl lg:w-80 lg:border-b-0 lg:border-r lg:px-7">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/10 ring-1 ring-cyan-300/20">
              <ShieldCheck className="text-cyan-300" size={24} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-cyan-300/80">Plexus AI</p>
              <h1 className="text-xl font-semibold text-white">專業管理後台</h1>
            </div>
          </div>

          <nav className="mt-8 space-y-3">
            <div className="rounded-3xl bg-cyan-400 px-4 py-4 text-slate-950 shadow-lg shadow-cyan-950/30">
              <div className="flex items-center gap-3 text-sm font-semibold">
                <MessageSquareText size={18} /> 待處理隊列
              </div>
              <div className="mt-2 text-3xl font-bold">{pendingMessages.length}</div>
              <div className="mt-1 text-xs font-medium text-slate-800/80">只顯示 pending / pending_review 訊息</div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-slate-200">
              <div className="flex items-center gap-3 text-sm font-semibold">
                <Siren size={18} className="text-rose-300" /> 高優先等級
              </div>
              <div className="mt-2 text-2xl font-semibold">{highPriorityCount}</div>
              <div className="mt-1 text-xs text-slate-400">含投訴、緊急、退款等語意</div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-slate-200">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">System Status</div>
              <div className="mt-4 flex items-center gap-3 text-sm font-medium">
                <span className="relative flex h-3 w-3">
                  <span className={`absolute inline-flex h-full w-full rounded-full opacity-70 ${isSystemOnline ? 'animate-ping bg-emerald-400' : 'bg-amber-400'}`}></span>
                  <span className={`relative inline-flex h-3 w-3 rounded-full ${isSystemOnline ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                </span>
                {isStatusLoading ? '檢查 Zeabur 連線...' : isSystemOnline ? 'Zeabur API 正常' : 'Zeabur API 未回應'}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl bg-slate-900/80 p-3">
                  <div className="text-xs text-slate-500">資料表</div>
                  <div className="mt-1 font-medium">px_messages</div>
                </div>
                <div className="rounded-2xl bg-slate-900/80 p-3">
                  <div className="text-xs text-slate-500">環境</div>
                  <div className="mt-1 font-medium">{import.meta.env.PROD ? 'Production' : 'Development'}</div>
                </div>
              </div>
            </div>
          </nav>
        </aside>

        <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <div className="rounded-[30px] border border-white/10 bg-slate-900/55 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <header className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">Review Center</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Plexus AI 待處理訊息中心</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">從 pending 佇列讀取訊息，人工校對 AI 回覆後一鍵送出 WhatsApp，或直接忽略並從清單移除。</p>
              </div>
              <button
                className="inline-flex items-center justify-center gap-2 self-start rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
                onClick={() => {
                  loadMessages();
                  loadHealth();
                }}
                disabled={isLoading}
              >
                <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                重新整理
              </button>
            </header>

            <div className="grid gap-4 border-b border-white/10 px-5 py-5 sm:grid-cols-3 sm:px-6 lg:px-8">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <Clock3 size={16} className="text-cyan-300" /> 待處理總數
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">{pendingMessages.length}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <Activity size={16} className="text-emerald-300" /> 送出通道
                </div>
                <div className="mt-3 text-lg font-semibold text-white">WhatsApp API</div>
                <div className="mt-1 text-xs text-slate-500">確認發送後同步更新狀態為 sent</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <Building2 size={16} className="text-violet-300" /> 租戶維度
                </div>
                <div className="mt-3 text-lg font-semibold text-white">Tenant Ready</div>
                <div className="mt-1 text-xs text-slate-500">卡片顯示電話、時間、Tenant 與 AI 建議</div>
              </div>
            </div>

            <div className="px-5 py-5 sm:px-6 lg:px-8">
              {error ? <div className="mb-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

              {isLoading ? (
                <div className="flex min-h-[320px] items-center justify-center text-slate-300">
                  <LoaderCircle className="mr-3 animate-spin" size={22} /> 載入待處理訊息中...
                </div>
              ) : pendingMessages.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-white/10 bg-slate-950/40 px-6 py-16 text-center text-slate-400">
                  目前沒有待處理訊息。
                </div>
              ) : (
                <div className="space-y-5">
                  {pendingMessages.map((msg) => {
                    const isSending = sendingId === msg.id;
                    const isIgnoring = ignoringId === msg.id;

                    return (
                      <article key={msg.id} className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/70">
                        <div className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 lg:flex-row lg:items-start lg:justify-between lg:px-6">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="rounded-full bg-cyan-500/15 px-3 py-1 font-bold uppercase tracking-[0.24em] text-cyan-200">{msg.tenantCode}</span>
                              {msg.priority === 'high' ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-3 py-1 font-semibold text-rose-300 ring-1 ring-rose-500/20">
                                  <AlertCircle size={14} /> 緊急
                                </span>
                              ) : null}
                            </div>
                            <h3 className="text-lg font-semibold text-white">{msg.tenant}</h3>
                            <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
                              <div className="inline-flex items-center gap-2 rounded-2xl bg-white/5 px-3 py-2">
                                <Phone size={15} className="text-cyan-300" /> {msg.customer}
                              </div>
                              <div className="inline-flex items-center gap-2 rounded-2xl bg-white/5 px-3 py-2">
                                <Clock3 size={15} className="text-cyan-300" /> {msg.timestamp}
                              </div>
                              <div className="inline-flex items-center gap-2 rounded-2xl bg-white/5 px-3 py-2">
                                <Building2 size={15} className="text-cyan-300" /> Tenant {msg.tenantCode}
                              </div>
                            </div>
                          </div>
                          <div className="rounded-2xl bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-200 ring-1 ring-sky-500/20">
                            狀態: 待人工確認
                          </div>
                        </div>

                        <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:px-6">
                          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
                            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">客戶訊息</div>
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-200">{msg.text || '沒有原始訊息內容'}</p>
                          </section>

                          <section className="rounded-3xl border border-cyan-400/10 bg-cyan-500/5 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-300/80">AI 建議回覆</div>
                              <span className="text-xs text-slate-500">Textarea 可直接編輯</span>
                            </div>
                            <textarea
                              className="mt-3 min-h-44 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm leading-7 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/20"
                              value={drafts[msg.id] ?? msg.finalResponse ?? msg.aiSuggestion}
                              onChange={(event) => handleDraftChange(msg.id, event.target.value)}
                              placeholder="輸入要送出的 WhatsApp 回覆內容"
                            />
                          </section>
                        </div>

                        <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
                          <div className="text-xs text-slate-500">Message ID: {msg.id}</div>
                          <div className="flex flex-col gap-3 sm:flex-row">
                            <button
                              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-5 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => handleIgnore(msg.id)}
                              disabled={isIgnoring || isSending}
                            >
                              {isIgnoring ? <LoaderCircle className="animate-spin" size={18} /> : <Trash2 size={18} />}
                              忽略
                            </button>
                            <button
                              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
                              onClick={() => handleApprove(msg.id)}
                              disabled={isSending || isIgnoring}
                            >
                              {isSending ? <LoaderCircle className="animate-spin" size={18} /> : <Send size={18} />}
                              確認發送
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default PlexusDashboard;
