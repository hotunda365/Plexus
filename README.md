# WhatsApp Bridge Server

Node.js server that supports:
- WhatsApp Business Cloud API
- Personal WhatsApp via whatsapp-web.js
- Multi-account for both connectors
- Persisting inbound/outbound messages and events into database (Prisma + SQLite by default)
- Built-in web dashboard for status and message/event viewing

## 1) Install

```bash
npm install
```

## 2) Configure

Copy `.env.example` to `.env` and fill values:

```bash
cp .env.example .env
```

Important fields:
- `CONNECTOR_MODE=cloud | personal | both`
- `WA_CLOUD_PHONE_NUMBER_ID`, `WA_CLOUD_ACCESS_TOKEN`, `WA_CLOUD_VERIFY_TOKEN`

For multi-account setup (recommended), use JSON arrays:

```env
WA_CLOUD_ACCOUNTS_JSON=[{"accountId":"cloud-hk","phoneNumberId":"123","accessToken":"EA...","verifyToken":"vt-hk"}]
WA_PERSONAL_ACCOUNTS_JSON=[{"accountId":"personal-1","sessionDir":".wwebjs_auth/p1"},{"accountId":"personal-2","sessionDir":".wwebjs_auth/p2"}]
```

## 3) Init DB

```bash
npm run db:push
```

## 4) Run

```bash
npm run dev
```

## API

### Health

`GET /health`

### Accounts

`GET /accounts`

### WhatsApp Cloud webhook

- `GET /webhook/whatsapp` for verify challenge
- `POST /webhook/whatsapp` for incoming webhook events
- `GET /webhook/whatsapp/:accountId` for account-specific verify
- `POST /webhook/whatsapp/:accountId` for account-specific events

### Send message

`POST /messages/send`

Body examples:

```json
{
  "connector": "cloud",
  "accountId": "cloud-hk",
  "to": "852XXXXXXXX",
  "text": "Hello from Cloud API"
}
```

```json
{
  "connector": "personal",
  "accountId": "personal-1",
  "to": "852XXXXXXXX",
  "text": "Hello from Personal WhatsApp"
}
```

### Query stored data

- `GET /messages?limit=100`
- `GET /events?limit=100`
- `GET /messages?limit=100&accountId=personal-1`
- `GET /events?limit=100&accountId=cloud-hk`

## Dashboard UI

After starting server, open:

`http://localhost:3000`

Features:
- Health and account status view
- Message and event tables with `accountId` filter
- Send message form (connector + accountId)
- Personal WhatsApp QR panel for connection
- Business API Key menu to add/update Cloud accounts

## New APIs

- `GET /accounts/personal/:accountId/qr`
- `GET /settings/cloud-accounts`
- `POST /settings/cloud-accounts`

Example body for `POST /settings/cloud-accounts`:

```json
{
  "accountId": "cloud-hk",
  "displayName": "HK WhatsApp Business",
  "phoneNumberId": "1234567890",
  "accessToken": "EA...",
  "verifyToken": "my_verify_token"
}
```

## Notes

- Personal WhatsApp login requires scanning QR in terminal on first run.
- Using personal WhatsApp automation may violate WhatsApp Terms for some use cases. For production, prefer official WhatsApp Business Cloud API.
- For production DB, switch Prisma datasource to PostgreSQL/MySQL and update `DATABASE_URL`.
