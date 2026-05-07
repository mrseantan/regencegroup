const crypto = require('crypto');

// Verify Stripe webhook signature
function verifyStripeSignature(payload, sigHeader, secret) {
  const parts     = sigHeader.split(',');
  const timestamp = parts.find(p => p.startsWith('t=')).split('=')[1];
  const signature = parts.find(p => p.startsWith('v1=')).split('=')[1];
  const signed    = `${timestamp}.${payload}`;
  const expected  = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// Get Google auth token via service account JWT
async function getGoogleAccessToken() {
  const email      = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n');

  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');

  const sigInput = `${header}.${payload}`;

  // Sign with RS256
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(sigInput);
  const signature = sign.sign(privateKey, 'base64url');

  const jwt = `${sigInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    }).toString()
  });

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// Update Google Sheet status column (N = column index 14, 1-indexed = column O)
async function updateSheetStatus(rowIndex, newStatus) {
  const token   = await getGoogleAccessToken();
  const SHEET_ID = process.env.SHEET_ID;
  // Column N is status (0-indexed=13, sheets A=1 so N=14)
  const range   = `Repair Job!O${rowIndex}`;

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [[newStatus]] })
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheet update failed: ${err}`);
  }
  return res.json();
}

// Send email via Netlify's built-in email or a simple fetch to a mail API
async function sendNotificationEmail(subject, bodyHtml, recipients) {
  // Using Resend (free tier: 3000 emails/month)
  // Set RESEND_API_KEY in Netlify env vars
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    console.log('No RESEND_API_KEY set — skipping email');
    return;
  }

  for (const to of recipients) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Regence Group <noreply@regencegroup.com>',
        to: [to],
        subject,
        html: bodyHtml
      })
    });
  }
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sigHeader     = event.headers['stripe-signature'];

  if (!webhookSecret || !sigHeader) {
    return { statusCode: 400, body: 'Missing webhook secret or signature' };
  }

  let verified = false;
  try {
    verified = verifyStripeSignature(event.body, sigHeader, webhookSecret);
  } catch (e) {
    console.error('Signature verification failed:', e);
    return { statusCode: 400, body: 'Invalid signature' };
  }

  if (!verified) return { statusCode: 400, body: 'Invalid signature' };

  let stripeEvent;
  try { stripeEvent = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  // Only handle completed checkout sessions
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Event ignored' };
  }

  const session  = stripeEvent.data.object;
  const meta     = session.metadata || {};
  const rowIndex = parseInt(meta.row_index);
  const jobNum   = meta.job_number   || 'Unknown';
  const custName = meta.customer_name || 'Customer';
  const custEmail = meta.customer_email || '';
  const brand    = meta.brand        || 'Unknown';
  const amount   = meta.amount       || session.amount_total
    ? `SGD ${(session.amount_total / 100).toFixed(2)}`
    : 'Unknown';

  const newStatus = 'Quotation accepted; Repair begun';

  // 1 — Update Google Sheet
  if (rowIndex && rowIndex > 1) {
    try {
      await updateSheetStatus(rowIndex, newStatus);
      console.log(`Updated row ${rowIndex} to: ${newStatus}`);
    } catch (e) {
      console.error('Sheet update error:', e);
    }
  }

  // 2 — Notify team and manager
  const teamEmail    = process.env.NOTIFY_EMAIL;
  const managerEmail = process.env.NOTIFY_MANAGER_EMAIL;
  const recipients   = [teamEmail, managerEmail].filter(Boolean);

  const teamHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px">
      <h2 style="color:#1A1814;margin-bottom:8px">Payment Received</h2>
      <p style="color:#7A7568;margin-bottom:24px">A repair quotation has been paid. The job status has been automatically updated.</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;width:40%">Job Number</td><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-weight:bold">${jobNum}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#7A7568">Customer</td><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#1A1814">${custName}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#7A7568">Customer Email</td><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#1A1814">${custEmail || '—'}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#7A7568">Brand</td><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#1A1814">${brand}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#7A7568">Amount Paid</td><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-weight:bold">${amount}</td></tr>
        <tr><td style="padding:10px 0;color:#7A7568">New Status</td><td style="padding:10px 0;color:#2D6A4F;font-weight:bold">${newStatus}</td></tr>
      </table>
      <p style="margin-top:24px;color:#7A7568;font-size:13px">The Google Sheet has been updated automatically. The repair can now proceed.</p>
      <p style="margin-top:32px;font-size:11px;color:#B8A06A;letter-spacing:0.1em;text-transform:uppercase">Regence Group · After-Sales System</p>
    </div>
  `;

  try {
    await sendNotificationEmail(
      `Payment Received — Job ${jobNum} (${brand})`,
      teamHtml,
      recipients
    );
  } catch (e) {
    console.error('Email error:', e);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
