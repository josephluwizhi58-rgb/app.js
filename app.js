#!/usr/bin/env node

const http = require('node:http');
const { URLSearchParams } = require('node:url');

const DEFAULT_NOTIFICATION_EMAIL = 'josephluwizhi58@gmail.com';

const SERVICE_CATALOG = {
  'wash-fold': { label: 'Wash & Fold', unitPrice: 6 },
  'dry-clean': { label: 'Dry Cleaning', unitPrice: 12 },
  ironing: { label: 'Ironing', unitPrice: 4 },
};

function normalizeText(value) {
  return String(value || '').trim();
}

function parseNumber(value) {
  const parsed = Number.parseFloat(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseService(value) {
  const normalized = normalizeText(value).toLowerCase().replace(/\s+/g, '-');
  return SERVICE_CATALOG[normalized] ? normalized : null;
}

function formatCurrency(amount) {
  return `$${amount.toFixed(2)}`;
}

function createInvoice(appointment) {
  const service = SERVICE_CATALOG[appointment.serviceType];
  const subtotal = appointment.quantity * service.unitPrice;

  return {
    invoiceNumber: `INV-${appointment.id}`,
    customerName: appointment.customerName,
    lineItems: [
      {
        description: `${service.label} (${appointment.quantity} kg)`,
        quantity: appointment.quantity,
        unitPrice: service.unitPrice,
        total: subtotal,
      },
    ],
    subtotal,
    total: subtotal,
    currency: 'USD',
    summary: `${service.label} x ${appointment.quantity} kg = ${formatCurrency(subtotal)}`,
  };
}

async function notifyAppointmentBooked(sendEmail, appointment, invoice) {
  const subject = `New Laundry Appointment ${appointment.id}`;
  const body = [
    `Customer: ${appointment.customerName}`,
    `Service: ${SERVICE_CATALOG[appointment.serviceType].label}`,
    `Quantity: ${appointment.quantity} kg`,
    `Date: ${appointment.date}`,
    `Time: ${appointment.time}`,
    `Invoice: ${invoice.invoiceNumber}`,
    `Total: ${formatCurrency(invoice.total)}`,
  ].join('\n');

  return sendEmail({
    to: DEFAULT_NOTIFICATION_EMAIL,
    subject,
    text: body,
  });
}

function createEmailSender() {
  return async (payload) => {
    console.log(`(email queued) to=${payload.to} subject="${payload.subject}"`);
    return { queued: true, to: payload.to };
  };
}

function createLaundryAgent({ sendEmail = createEmailSender() } = {}) {
  const sessions = new Map();

  function getSession(sessionId) {
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { step: 'start', data: {} });
    }
    return sessions.get(sessionId);
  }

  async function handleMessage(sessionId, messageText) {
    const session = getSession(sessionId);
    const text = normalizeText(messageText);

    if (!text && session.step !== 'start') {
      return { reply: 'Please provide the requested detail so I can continue your booking.' };
    }

    if (session.step === 'start') {
      session.step = 'name';
      return {
        reply:
          'Hi 👋 I am your Laundry WhatsApp Agent. I can book your appointment and issue your invoice. What is your full name?',
      };
    }

    if (session.step === 'name') {
      session.data.customerName = text;
      session.step = 'service';
      return { reply: 'Great. Choose a service: wash-fold, dry-clean, or ironing.' };
    }

    if (session.step === 'service') {
      const serviceType = parseService(text);
      if (!serviceType) {
        return { reply: 'I did not recognize that service. Please choose wash-fold, dry-clean, or ironing.' };
      }

      session.data.serviceType = serviceType;
      session.step = 'quantity';
      return { reply: 'How many kilograms of laundry should we handle?' };
    }

    if (session.step === 'quantity') {
      const quantity = parseNumber(text);
      if (!quantity || quantity <= 0) {
        return { reply: 'Please provide a valid quantity in kilograms, for example: 4.5' };
      }

      session.data.quantity = quantity;
      session.step = 'date';
      return { reply: 'What date would you like? Use format YYYY-MM-DD.' };
    }

    if (session.step === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return { reply: 'Date format should be YYYY-MM-DD.' };
      }

      session.data.date = text;
      session.step = 'time';
      return { reply: 'What time should we schedule? Use 24-hour HH:MM.' };
    }

    if (session.step === 'time') {
      if (!/^\d{2}:\d{2}$/.test(text)) {
        return { reply: 'Time format should be HH:MM (24-hour).' };
      }

      session.data.time = text;
      const appointment = {
        id: `APT-${Date.now()}`,
        customerName: session.data.customerName,
        serviceType: session.data.serviceType,
        quantity: session.data.quantity,
        date: session.data.date,
        time: session.data.time,
      };

      const invoice = createInvoice(appointment);
      const emailNotification = await notifyAppointmentBooked(sendEmail, appointment, invoice);

      sessions.delete(sessionId);

      return {
        reply: [
          `✅ Appointment booked for ${appointment.customerName}.`,
          `Service: ${SERVICE_CATALOG[appointment.serviceType].label}`,
          `Date/Time: ${appointment.date} at ${appointment.time}`,
          `Invoice ${invoice.invoiceNumber}: ${invoice.summary}`,
          `A booking email has been sent to ${DEFAULT_NOTIFICATION_EMAIL}.`,
        ].join('\n'),
        appointment,
        invoice,
        emailNotification,
      };
    }

    return { reply: 'Let us start again. Please say hi to begin booking.' };
  }

  return { handleMessage };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('request body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function createServer({ agent = createLaundryAgent() } = {}) {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/webhook') {
      try {
        const raw = await readRequestBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const sessionId = normalizeText(body.sessionId) || 'anonymous';
        const message = normalizeText(body.message);
        const response = await agent.handleMessage(sessionId, message);
        return sendJson(res, 200, response);
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
    }

    if (req.method === 'POST' && req.url === '/whatsapp/webhook') {
      try {
        const raw = await readRequestBody(req);
        const form = new URLSearchParams(raw);
        const sessionId = form.get('From') || 'whatsapp-user';
        const message = form.get('Body') || '';
        const response = await agent.handleMessage(sessionId, message);
        const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${response.reply}</Message></Response>`;
        res.writeHead(200, { 'content-type': 'text/xml' });
        res.end(twiml);
        return;
      } catch (error) {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Error: ${error.message}</Message></Response>`;
        res.writeHead(400, { 'content-type': 'text/xml' });
        res.end(twiml);
        return;
      }
    }

    return sendJson(res, 404, { error: 'Not found' });
  });
}

function startServer({ port = Number(process.env.PORT) || 3000 } = {}) {
  const server = createServer();
  server.listen(port, () => {
    console.log(`Laundry WhatsApp agent listening on port ${port}`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  DEFAULT_NOTIFICATION_EMAIL,
  SERVICE_CATALOG,
  createEmailSender,
  createInvoice,
  createLaundryAgent,
  createServer,
  notifyAppointmentBooked,
  startServer,
};
