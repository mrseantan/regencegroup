const crypto = require('crypto');

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
  const sigInput  = `${header}.${payload}`;
  const sign      = crypto.createSign('RSA-SHA256');
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

async function updateSheet(rowIndex) {
  const token    = await getGoogleAccessToken();
  const SHEET_ID = process.env.SHEET_ID;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [
          { range: `Repair Job!O${rowIndex}`, values: [['Quotation rejected; return without repair']] },
          { range: `Repair Job!I${rowIndex}`, values: [['N']] }
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

exports.handler = async function(event) {
  const HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid request' }) }; }

  const { jobNumber, rowIndex, customerName, brand, quotationAmount } = body;
  if (!jobNumber || !rowIndex) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing required fields' }) };

  // 1 — Update sheet
  try { await updateSheet(rowIndex); }
  catch (e) {
    console.error('Sheet update error:', e);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Could not update record' }) };
  }

  // 2 — Email team and manager
  const recipients = [process.env.NOTIFY_EMAIL, process.env.NOTIFY_MANAGER_EMAIL].filter(Boolean);
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px">
    <h2 style="color:#7B2D2D;margin-bottom:8px;font-family:Georgia,serif">Quotation Declined</h2>
    <p style="color:#7A7568;margin-bottom:24px;font-size:14px">A customer has declined their repair quotation. The Google Sheet has been updated automatically.</p>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;width:40%;font-size:13px">Job Number</td><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-weight:bold;font-size:13px">${jobNumber}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:13px">Customer</td><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px">${customerName || '—'}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:13px">Brand</td><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px">${brand || '—'}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:13px">Quotation Amount</td><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px">SGD ${quotationAmount || '—'}</td></tr>
      <tr><td style="padding:10px 0;color:#7A7568;font-size:13px">New Status</td><td style="padding:10px 0;color:#7B2D2D;font-weight:bold;font-size:13px">Quotation rejected — return without repair</td></tr>
    </table>
    <p style="margin-top:16px;font-size:13px;color:#7A7568;line-height:1.7">Please prepare the timepiece for return and update the collection date when ready.</p>
    <p style="margin-top:32px;font-size:11px;color:#B8A06A;letter-spacing:0.1em;text-transform:uppercase">Regence Group · After-Sales System</p>
  </div>`;

  try { await sendEmail(`Quotation Declined — Job ${jobNumber} (${brand || 'Unknown'})`, html, recipients); }
  catch (e) { console.error('Email error:', e); }

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true }) };
};
