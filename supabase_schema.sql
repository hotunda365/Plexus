-- 1. 建立甲方客戶表 (Tenants)
CREATE TABLE IF NOT EXISTS px_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  org_code TEXT UNIQUE, -- 例如 'C001'，方便 IT 員辨識
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 建立接駁中樞表 (Connection Depot)
CREATE TABLE IF NOT EXISTS px_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES px_tenants(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('whatsapp', 'facebook', 'instagram')),
  phone_number_id TEXT UNIQUE, -- Meta 給的識別碼
  access_token TEXT NOT NULL,  -- 永久 Token
  verify_token TEXT,           -- Webhook 驗證用
  connection_status TEXT DEFAULT 'disconnected', -- 🔴/🟢 監控位
  last_heartbeat TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 建立訊息紀錄表 (HITL 橋樑)
CREATE TABLE IF NOT EXISTS px_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES px_tenants(id),
  connection_id UUID REFERENCES px_connections(id),
  customer_phone TEXT,
  raw_message TEXT,
  ai_suggestion TEXT,
  final_response TEXT,
  status TEXT DEFAULT 'pending_review',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 插入一個測試甲方 (你的第一個測試客戶)
INSERT INTO px_tenants (name, org_code) 
VALUES ('Plexus Demo Client', 'DEMO001');
