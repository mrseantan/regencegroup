const crypto = require('crypto');

function verifyStripeSignature(payload, sigHeader, secret) {
  const parts     = sigHeader.split(',');
  const timestamp = parts.find(p => p.startsWith('t=')).split('=')[1];
  const signature = parts.find(p => p.startsWith('v1=')).split('=')[1];
  const signed    = `${timestamp}.${payload}`;
  const expected  = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature,'hex'), Buffer.from(expected,'hex'));
}

async function getGoogleAccessToken() {
  const email      = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n');
  const now        = Math.floor(Date.now() / 1000);
  const header     = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload    = Buffer.from(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');
  const sigInput = `${header}.${payload}`;
  const sign     = crypto.createSign('RSA-SHA256');
  sign.update(sigInput);
  const signature = sign.sign(privateKey, 'base64url');
  const jwt = `${sigInput}.${signature}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString()
  });
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function updateSheet(rowIndex, statusValue, quotationValue) {
  const token    = await getGoogleAccessToken();
  const SHEET_ID = process.env.SHEET_ID;
  // Update O (status) and I (quotation Y/N) in one batch request
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [
          { range: `Repair Job!O${rowIndex}`, values: [[statusValue]] },
          { range: `Repair Job!I${rowIndex}`, values: [[quotationValue]] }
        ]
      })
    }
  );
  if (!res.ok) throw new Error(`Sheet update failed: ${await res.text()}`);
  return res.json();
}

async function sendEmail(subject, html, recipients) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) { console.log('No RESEND_API_KEY — skipping email'); return; }
  // Use resend.dev sandbox domain if custom domain not verified
  const fromDomain = process.env.EMAIL_FROM_DOMAIN || 'onboarding@resend.dev';
  for (const to of recipients) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `Regence Group <${fromDomain}>`, to: [to], subject, html })
    });
    const data = await res.json();
    if (!res.ok) console.error('Resend error:', data);
  }
}

function emailTemplate(rows) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px">
    <h2 style="color:#1A1814;margin-bottom:8px;font-family:Georgia,serif">${rows[0]}</h2>
    <p style="color:#7A7568;margin-bottom:24px;font-size:14px">${rows[1]}</p>
    <table style="width:100%;border-collapse:collapse">
      ${rows.slice(2).map(([label, value, color]) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;width:40%;font-size:13px">${label}</td>
        <td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:${color||'#1A1814'};font-weight:bold;font-size:13px">${value}</td>
      </tr>`).join('')}
    </table>
    <p style="margin-top:32px;font-size:11px;color:#B8A06A;letter-spacing:0.1em;text-transform:uppercase">Regence Group · After-Sales System</p>
  </div>`;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sigHeader     = event.headers['stripe-signature'];
  if (!webhookSecret || !sigHeader) return { statusCode: 400, body: 'Missing webhook config' };

  let verified = false;
  try { verified = verifyStripeSignature(event.body, sigHeader, webhookSecret); }
  catch (e) { console.error('Sig error:', e); return { statusCode: 400, body: 'Invalid signature' }; }
  if (!verified) return { statusCode: 400, body: 'Invalid signature' };

  let stripeEvent;
  try { stripeEvent = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  if (stripeEvent.type !== 'checkout.session.completed') return { statusCode: 200, body: 'Event ignored' };

  const session  = stripeEvent.data.object;
  const meta     = session.metadata || {};
  const rowIndex = parseInt(meta.row_index);
  const jobNum   = meta.job_number   || 'Unknown';
  const custName = meta.customer_name || 'Customer';
  const custEmail = meta.customer_email || '';
  const brand    = meta.brand        || 'Unknown';
  const amount   = session.amount_total ? `SGD ${(session.amount_total / 100).toFixed(2)}` : meta.amount || 'Unknown';
  const newStatus = 'Quotation accepted; Repair begun';
  const recipients = [process.env.NOTIFY_EMAIL, process.env.NOTIFY_MANAGER_EMAIL].filter(Boolean);

  if (rowIndex > 1) {
    try { await updateSheet(rowIndex, newStatus, 'Y'); }
    catch (e) { console.error('Sheet update error:', e); }
  }

  // Get full row details from metadata
  const savRepairNo = meta.sav_repair_no || '—';
  const custPhone   = meta.customer_phone || '—';

  const html = emailTemplate([
    'Payment Received — Repair Authorised',
    'A repair quotation has been paid. The Google Sheet has been updated automatically.',
    ['Repair Job No.', jobNum],
    ['SAV Repair No.', savRepairNo],
    ['Customer Name', custName],
    ['Customer Phone', custPhone],
    ['Customer Email', custEmail || '—'],
    ['Brand', brand],
    ['Amount Paid', amount, '#8C7245'],
    ['New Status', newStatus, '#2D6A4F']
  ]);

  try { await sendEmail(`Payment Received — Job ${jobNum} (${brand})`, html, recipients); }
  catch (e) { console.error('Email error:', e); }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
