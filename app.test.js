const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  DEFAULT_NOTIFICATION_EMAIL,
  createInvoice,
  createLaundryAgent,
  createServer,
  notifyAppointmentBooked,
} = require('./app');

function makeRequest({ port, method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        });
      },
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('createInvoice calculates totals from service and quantity', () => {
  const invoice = createInvoice({
    id: 'APT-1',
    customerName: 'Alex',
    serviceType: 'wash-fold',
    quantity: 3,
  });

  assert.equal(invoice.invoiceNumber, 'INV-APT-1');
  assert.equal(invoice.total, 18);
  assert.equal(invoice.lineItems[0].description, 'Wash & Fold (3 kg)');
});

test('notifyAppointmentBooked sends to required notification email', async () => {
  let captured;
  const sendEmail = async (payload) => {
    captured = payload;
    return { accepted: true };
  };

  await notifyAppointmentBooked(
    sendEmail,
    {
      id: 'APT-2',
      customerName: 'Sam',
      serviceType: 'ironing',
      quantity: 2,
      date: '2026-03-10',
      time: '10:00',
    },
    {
      invoiceNumber: 'INV-APT-2',
      total: 8,
    },
  );

  assert.equal(captured.to, DEFAULT_NOTIFICATION_EMAIL);
  assert.match(captured.subject, /APT-2/);
  assert.match(captured.text, /Customer: Sam/);
});

test('agent guides booking flow and emits appointment + invoice', async () => {
  const emails = [];
  const agent = createLaundryAgent({
    sendEmail: async (payload) => {
      emails.push(payload);
      return { queued: true };
    },
  });

  await agent.handleMessage('s1', 'hello');
  await agent.handleMessage('s1', 'Casey');
  await agent.handleMessage('s1', 'dry-clean');
  await agent.handleMessage('s1', '4');
  await agent.handleMessage('s1', '2026-05-01');
  const finalResponse = await agent.handleMessage('s1', '09:15');

  assert.match(finalResponse.reply, /Appointment booked/);
  assert.equal(finalResponse.appointment.customerName, 'Casey');
  assert.equal(finalResponse.invoice.invoiceNumber, `INV-${finalResponse.appointment.id}`);
  assert.equal(emails[0].to, DEFAULT_NOTIFICATION_EMAIL);
});

test('http server handles health and webhook endpoints', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const health = await makeRequest({ port, method: 'GET', path: '/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(JSON.parse(health.body), { ok: true });

  const start = await makeRequest({
    port,
    method: 'POST',
    path: '/webhook',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'u1', message: 'hi' }),
  });
  assert.equal(start.statusCode, 200);
  assert.match(JSON.parse(start.body).reply, /Laundry WhatsApp Agent/);

  await new Promise((resolve) => server.close(resolve));
});
