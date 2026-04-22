import { useState } from 'react';
import { Send, Trash2, CheckCircle, Clock, AlertCircle } from 'lucide-react';

const initialMessages = [
  {
    id: '1',
    tenant: 'DEMO001',
    customer: '+852 9123 4567',
    text: '請問元朗 Yoho 辦公室幾點開門？',
    ai_suggestion: '您好！元朗 Yoho 辦公室營業時間為週一至週五，09:00 - 18:00。歡迎隨時過來！',
    timestamp: '14:30',
    priority: 'medium',
  },
  {
    id: '2',
    tenant: 'DEMO001',
    customer: '+852 6543 2100',
    text: '我想投訴之前的服務進度太慢了。',
    ai_suggestion: '非常抱歉讓您久候。我已將您的個案標記為緊急，專員將在 1 小時內聯絡您處理。',
    timestamp: '15:10',
    priority: 'high',
  },
];

const PlexusDashboard = () => {
  const [messages] = useState(initialMessages);

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
      <aside className="w-72 bg-slate-900 text-slate-300 p-6 flex flex-col">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-white font-bold">P</div>
          <h1 className="text-xl font-bold text-white tracking-tight">Plexus AI</h1>
        </div>

        <nav className="flex-1 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">主要功能</p>
          <button className="w-full flex items-center gap-3 p-3 bg-blue-600 text-white rounded-xl shadow-lg transition">
            <Clock size={18} /> 待審核訊息
          </button>
          <button className="w-full flex items-center gap-3 p-3 hover:bg-slate-800 rounded-xl transition">
            <CheckCircle size={18} /> 已完成發送
          </button>
        </nav>

        <div className="mt-auto p-4 bg-slate-800 rounded-2xl">
          <p className="text-xs text-slate-400 mb-2">系統狀態</p>
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Zeabur Node Online
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between">
          <h2 className="text-lg font-semibold">待處理隊列 (Pending Queue)</h2>
          <div className="flex items-center gap-4 text-sm text-slate-500">
            <span>管理員: {import.meta.env.PROD ? 'Production Mode' : 'Dev'}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          {messages.map((msg) => (
            <div key={msg.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-bold uppercase tracking-widest">{msg.tenant}</span>
                  <span className="text-slate-500 font-medium">{msg.customer}</span>
                </div>
                <div className="flex items-center gap-2">
                  {msg.priority === 'high' && (
                    <span className="flex items-center gap-1 text-red-500 text-xs font-bold bg-red-50 px-2 py-1 rounded">
                      <AlertCircle size={14} /> 緊急
                    </span>
                  )}
                  <span className="text-xs text-slate-400">{msg.timestamp}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">客戶原訊</label>
                  <div className="p-4 bg-slate-50 rounded-xl text-slate-700 border border-slate-100 italic">
                    "{msg.text}"
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest">AI 擬稿內容 (可編輯)</label>
                  <textarea
                    className="w-full p-4 bg-blue-50/50 border border-blue-100 rounded-xl text-slate-700 focus:ring-2 focus:ring-blue-200 outline-none transition"
                    rows={3}
                    defaultValue={msg.ai_suggestion}
                  />
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-slate-50 flex justify-end gap-3">
                <button className="p-2 text-slate-400 hover:text-red-500 transition">
                  <Trash2 size={20} />
                </button>
                <button className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-semibold shadow-lg shadow-blue-200 transition active:scale-95">
                  <Send size={18} /> 確認發送至 WhatsApp
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default PlexusDashboard;
