# WhatsApp Bridge Server

Node.js server that supports:
- WhatsApp Business Cloud API
- Personal WhatsApp via whatsapp-web.js
- Single account per connector (one cloud + one personal)
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

Optional legacy JSON format is still accepted, but only the first item is used.

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
  "accountId": "cloud-default",
  "to": "852XXXXXXXX",
  "text": "Hello from Cloud API"
}
```

```json
{
  "connector": "personal",
  "accountId": "personal-default",
  "to": "852XXXXXXXX",
  "text": "Hello from Personal WhatsApp"
}
```

### Query stored data

- `GET /messages?limit=100`
- `GET /events?limit=100`
- `GET /messages?limit=100&accountId=personal-default`
- `GET /events?limit=100&accountId=cloud-default`

## Dashboard UI

After starting server, open:

`http://localhost:3000`

Features:
- Health and account status view
- Message and event tables
- Send message form (connector + accountId)
- Personal WhatsApp QR panel for connection
- Business API Key menu to configure the single Cloud account

## New APIs

- `GET /accounts/personal/:accountId/qr`
- `GET /settings/cloud-accounts`
- `POST /settings/cloud-accounts`

Example body for `POST /settings/cloud-accounts`:

```json
{
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

## Zeabur Deploy

Recommended runtime settings on Zeabur:

- Start command: `npm start`
- Node version: `20+`

Required environment variables:

- `PORT` provided by Zeabur automatically
- `BASE_URL` set to your Zeabur service URL
- `DATABASE_URL` set to your Zeabur PostgreSQL connection string
- `CONNECTOR_MODE=cloud | personal | both`

Notes for Zeabur:

- `npm start` will run `prisma db push` automatically before starting the server.
- Personal WhatsApp via `whatsapp-web.js` may be unstable on serverless/container platforms because it depends on Chromium session persistence. For stable production deployment, prefer the Cloud API connector.
