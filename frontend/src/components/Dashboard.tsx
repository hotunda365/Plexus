import { useEffect, useMemo, useState } from 'react';
import { Send, CheckCircle, Clock, AlertCircle, LoaderCircle, RefreshCw, PanelLeftClose, Trash2, Smartphone } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Priority = 'low' | 'medium' | 'high';
type Status = 'pending' | 'pending_review' | 'sent' | 'rejected' | 'send_failed' | string;

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

const statusLabel: Record<string, string> = {
  pending: '待審核',
  pending_review: '待審核',
  sent: '已發送',
  send_failed: '發送失敗',
  rejected: '已拒絕',
};

function statusBadge(status: Status) {
  if (status === 'sent') {
    return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20';
  }
  if (status === 'rejected') {
    return 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/20';
  }
  if (status === 'send_failed') {
    return 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/20';
  }
  return 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/20';
}

type SupabaseMessageRow = {
  id: string;
  customer_phone: string | null;
  raw_message: string | null;
  ai_suggestion: string | null;
  final_response: string | null;
  status: string | null;
  created_at: string | null;
  tenant_id: {
    name: string | null;
    org_code: string | null;
  }[] | null;
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

function formatTime(timestamp: string | null): string {
  if (!timestamp) {
    return 'N/A';
  }

  const date = new Date(timestamp);
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
  const text = row.raw_message || '';
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
    timestamp: formatTime(row.created_at),
    createdAt: row.created_at,
    priority: inferPriority(text),
  };
}

const PlexusDashboard = () => {
  const [messages, setMessages] = useState<ReviewMessage[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  const [sendingId, setSendingId] = useState('');
  const [rejectingId, setRejectingId] = useState('');

  const loadMessages = async () => {
    setIsLoading(true);
    setError('');

    try {
      const { data, error: fetchError } = await supabase
        .from('px_messages')
        .select('id, customer_phone, raw_message, ai_suggestion, final_response, status, created_at, tenant_id(name, org_code)')
        .in('status', ['pending', 'pending_review'])
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

  useEffect(() => {
    loadMessages();
  }, []);

  const pendingMessages = useMemo(
    () => messages.filter((message) => message.status === 'pending' || message.status === 'pending_review'),
    [messages],
  );
  const completedMessages = useMemo(
    () => messages.filter((message) => message.status !== 'pending' && message.status !== 'pending_review'),
    [messages],
  );
  const visibleMessages = activeTab === 'pending' ? pendingMessages : completedMessages;

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

      const { error: updateError } = await supabase
        .from('px_messages')
        .update({
          final_response: finalResponse,
          status: 'sent',
        })
        .eq('id', messageId);

      if (updateError) {
        throw new Error(updateError.message);
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
      setActiveTab('completed');
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

  const handleReject = async (messageId: string) => {
    setRejectingId(messageId);
    setError('');

    try {
      const { error: updateError } = await supabase
        .from('px_messages')
        .update({ status: 'rejected' })
        .eq('id', messageId);

      if (updateError) {
        throw new Error(updateError.message);
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                status: 'rejected',
              }
            : message,
        ),
      );
      setActiveTab('completed');
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : 'Unknown error');
    } finally {
      setRejectingId('');
    }
  };

  return (
    <div className="min-h-screen bg-[#07111f] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col lg:flex-row">
        <aside className="w-full border-b border-white/10 bg-slate-950/80 px-5 py-6 backdrop-blur lg:w-80 lg:border-b-0 lg:border-r lg:px-7">
          <div className="flex items-center justify-between lg:block">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/20 text-lg font-bold text-cyan-300 ring-1 ring-cyan-400/30">P</div>
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-300/80">Plexus Control</p>
                <h1 className="text-xl font-semibold text-white">IT Admin Dashboard</h1>
              </div>
            </div>
            <div className="rounded-full border border-white/10 p-2 text-slate-400 lg:hidden">
              <PanelLeftClose size={18} />
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-1">
            <button
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition ${
                activeTab === 'pending' ? 'bg-cyan-500 text-slate-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
              onClick={() => setActiveTab('pending')}
            >
              <Clock size={18} />
              <div>
                <div className="text-sm font-semibold">待審核</div>
                <div className="text-xs opacity-80">{pendingMessages.length} 則待處理</div>
              </div>
            </button>
            <button
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition ${
                activeTab === 'completed' ? 'bg-emerald-400 text-slate-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
              onClick={() => setActiveTab('completed')}
            >
              <CheckCircle size={18} />
              <div>
                <div className="text-sm font-semibold">已完成</div>
                <div className="text-xs opacity-80">{completedMessages.length} 則已送出</div>
              </div>
            </button>
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-400">System Status</div>
            <div className="mt-3 flex items-center gap-3 text-sm text-emerald-300">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400"></span>
              </span>
              Zeabur + Supabase Online
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-300">
              <div className="rounded-2xl bg-slate-900/70 p-3">
                <div className="text-xs text-slate-500">當前模式</div>
                <div className="mt-1 font-medium">{import.meta.env.PROD ? 'Production' : 'Development'}</div>
              </div>
              <div className="rounded-2xl bg-slate-900/70 p-3">
                <div className="text-xs text-slate-500">資料來源</div>
                <div className="mt-1 font-medium">px_messages</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-2xl bg-slate-900/60 px-3 py-3 text-xs text-slate-400">
              <Smartphone size={14} className="text-cyan-300" />
              手機版已優化，可直接審核與發送。
            </div>
          </div>
        </aside>

        <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <div className="rounded-[28px] border border-white/10 bg-slate-900/50 shadow-2xl shadow-black/20 backdrop-blur">
            <header className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
              <div>
                <p className="text-xs uppercase tracking-[0.26em] text-cyan-300/80">Review Center</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">{activeTab === 'pending' ? '待處理訊息隊列' : '已完成發送紀錄'}</h2>
                <p className="mt-2 text-sm text-slate-400">直接從 Supabase 讀取 pending 訊息，校對後送出 WhatsApp，或標記為 rejected。</p>
              </div>
              <button
                className="inline-flex items-center justify-center gap-2 self-start rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                onClick={loadMessages}
                disabled={isLoading}
              >
                <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                重新整理
              </button>
            </header>

            <div className="px-5 py-5 sm:px-6 lg:px-8">
              {error ? (
                <div className="mb-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
              ) : null}

              {isLoading ? (
                <div className="flex min-h-[320px] items-center justify-center text-slate-300">
                  <LoaderCircle className="mr-3 animate-spin" size={22} /> 載入訊息中...
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-white/10 bg-slate-950/40 px-6 py-16 text-center text-slate-400">
                  目前沒有{activeTab === 'pending' ? '待審核' : '已完成'}訊息。
                </div>
              ) : (
                <div className="space-y-5">
                  {visibleMessages.map((msg) => {
                    const isSending = sendingId === msg.id;
                    return (
                      <article key={msg.id} className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/70">
                        <div className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-200">{msg.tenantCode}</span>
                            <span className="text-sm font-medium text-slate-200">{msg.tenant}</span>
                            <span className="text-sm text-slate-400">{msg.customer}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {msg.priority === 'high' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-3 py-1 font-semibold text-rose-300 ring-1 ring-rose-500/20">
                                <AlertCircle size={14} /> 緊急
                              </span>
                            ) : null}
                            <span className={`rounded-full px-3 py-1 font-semibold ${statusBadge(msg.status)}`}>
                              {statusLabel[msg.status] || msg.status}
                            </span>
                            <span className="text-slate-500">{msg.timestamp}</span>
                          </div>
                        </div>

                        <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:px-6">
                          <section className="rounded-3xl border border-white/8 bg-slate-900/60 p-4">
                            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">客戶原訊</div>
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-200">{msg.text || '沒有原始訊息內容'}</p>
                          </section>

                          <section className="rounded-3xl border border-cyan-400/10 bg-cyan-500/5 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-300/80">AI 擬稿內容</div>
                              <span className="text-xs text-slate-500">可直接編輯後送出</span>
                            </div>
                            <textarea
                              className="mt-3 min-h-40 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm leading-7 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/20"
                              value={drafts[msg.id] ?? msg.finalResponse ?? msg.aiSuggestion}
                              onChange={(event) => handleDraftChange(msg.id, event.target.value)}
                              disabled={msg.status === 'sent'}
                            />
                          </section>
                        </div>

                        <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
                          <div className="text-xs text-slate-500">Message ID: {msg.id}</div>
                          <div className="flex flex-col gap-3 sm:flex-row">
                            <button
                              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-5 py-3 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => handleReject(msg.id)}
                              disabled={rejectingId === msg.id || sendingId === msg.id || msg.status === 'sent'}
                            >
                              {rejectingId === msg.id ? <LoaderCircle className="animate-spin" size={18} /> : <Trash2 size={18} />}
                              Reject / Delete
                            </button>
                            <button
                              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
                              onClick={() => handleApprove(msg.id)}
                              disabled={isSending || msg.status === 'sent' || msg.status === 'rejected'}
                            >
                              {isSending ? <LoaderCircle className="animate-spin" size={18} /> : <Send size={18} />}
                              {msg.status === 'sent' ? '已送出' : 'Approve & Send'}
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
