# Laundry WhatsApp Chatbot (Node.js)

A deployable laundry booking chatbot backend for WhatsApp-style conversations.

## Features

- Conversational appointment booking flow (name, service, quantity, date, time).
- Invoice generation at booking confirmation.
- Email notification trigger to `josephluwizhi58@gmail.com` after scheduling.
- HTTP endpoints for generic chat clients and Twilio WhatsApp webhooks.

## API Endpoints

- `GET /health` → health check.
- `POST /webhook` (JSON):
  - Request: `{ "sessionId": "user-123", "message": "hi" }`
  - Response: `{ "reply": "...", ... }`
- `POST /whatsapp/webhook` (`application/x-www-form-urlencoded` from Twilio):
  - Reads `From` and `Body`
  - Returns TwiML XML response with bot message.

## Quick start

```bash
node app.js
```

Server runs on `PORT` (default `3000`).

## Local test calls

```bash
curl http://localhost:3000/health

curl -X POST http://localhost:3000/webhook \
  -H 'content-type: application/json' \
  -d '{"sessionId":"demo","message":"hi"}'
```

## Run tests

```bash
node --test
```

## Deploy (Render/Railway/Fly.io)

1. Push this repository to GitHub.
2. Create a new Node.js web service.
3. Set start command to:
   - `node app.js`
4. Expose HTTP port using environment variable `PORT` (platforms usually set this automatically).
5. Configure your WhatsApp provider webhook URL to:
   - `https://<your-domain>/whatsapp/webhook`

Once deployed, the bot can process inbound WhatsApp messages and complete bookings with invoice output.
