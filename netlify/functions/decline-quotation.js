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

  const { jobNumber, rowIndex, customerName, customerEmail, customerPhone, savRepairNo, brand, quotationAmount } = body;
  if (!jobNumber || !rowIndex) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing required fields' }) };

  const savNo   = savRepairNo    || '—';
  const phone   = customerPhone  || '—';
  const email   = customerEmail  || '—';

  // 1 — Update sheet
  try { await updateSheet(rowIndex); }
  catch (e) {
    console.error('Sheet update error:', e);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Could not update record' }) };
  }

  // 2 — Email team and manager
  const recipients = [process.env.NOTIFY_EMAIL, process.env.NOTIFY_MANAGER_EMAIL].filter(Boolean);
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#E8E4DC;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#E8E4DC;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td height="3" style="background:linear-gradient(90deg,#7B2D2D,#a04040,#7B2D2D);font-size:0;">&nbsp;</td></tr>
        <tr><td style="background:#F5F2EC;padding:36px 48px 28px;text-align:center;border-left:0.5px solid rgba(184,160,106,0.3);border-right:0.5px solid rgba(184,160,106,0.3);">
          <p style="font-family:Georgia,serif;font-size:22px;letter-spacing:0.18em;text-transform:uppercase;color:#1A1814;margin:0 0 4px;">Regence<span style="color:#B8A06A;">.</span></p>
          <p style="font-size:9px;letter-spacing:0.3em;text-transform:uppercase;color:#7A7568;margin:0;">After-Sales System</p>
        </td></tr>
        <tr><td style="background:#FDFCFA;padding:40px 48px;border-left:0.5px solid rgba(184,160,106,0.3);border-right:0.5px solid rgba(184,160,106,0.3);">
          <p style="font-size:9px;letter-spacing:0.3em;text-transform:uppercase;color:#7B2D2D;margin:0 0 12px;opacity:0.8;">Action Required</p>
          <h2 style="font-family:Georgia,serif;font-size:24px;color:#1A1814;margin:0 0 16px;line-height:1.2;">Quotation Declined — Job ${jobNumber}</h2>
          <p style="font-size:13px;color:#7A7568;line-height:1.9;margin:0 0 28px;">A customer has declined their repair quotation. The Google Sheet has been updated automatically. Please prepare the timepiece for return.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;border:0.5px solid rgba(184,160,106,0.25);margin-bottom:24px;">
            <tr><td style="padding:14px 24px;border-bottom:0.5px solid rgba(184,160,106,0.2);">
              <p style="font-size:9px;letter-spacing:0.3em;text-transform:uppercase;color:#B8A06A;margin:0;">Job Details</p>
            </td></tr>
            <tr><td style="padding:10px 24px;border-bottom:0.5px solid rgba(184,160,106,0.12);"><table width="100%"><tr><td style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#7A7568;">Repair Job No.</td><td align="right" style="font-family:Georgia,serif;font-size:17px;color:#1A1814;">${jobNumber}</td></tr></table></td></tr>
            <tr><td style="padding:10px 24px;border-bottom:0.5px solid rgba(184,160,106,0.12);"><table width="100%"><tr><td style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#7A7568;">SAV Repair No.</td><td align="right" style="font-family:Georgia,serif;font-size:17px;color:#1A1814;">${savNo}</td></tr></table></td></tr>
            <tr><td style="padding:10px 24px;border-bottom:0.5px solid rgba(184,160,106,0.12);"><table width="100%"><tr><td style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#7A7568;">Customer Name</td><td align="right" style="font-family:Georgia,serif;font-size:17px;color:#1A1814;">${customerName || '—'}</td></tr></table></td></tr>
            <tr><td style="padding:10px 24px;border-bottom:0.5px solid rgba(184,160,106,0.12);"><table width="100%"><tr><td style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#7A7568;">Customer Phone</td><td align="right" style="font-family:Georgia,serif;font-size:17px;color:#1A1814;">${phone}</td></tr></table></td></tr>
            <tr><td style="padding:10px 24px;border-bottom:0.5px solid rgba(184,160,106,0.12);"><table width="100%"><tr><td style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#7A7568;">Customer Email</td><td align="right" style="font-size:13px;color:#1A1814;">${email}</td></tr></table></td></tr>
            <tr><td style="padding:10px 24px;border-bottom:0.5px solid rgba(184,160,106,0.12);"><table width="100%"><tr><td style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#7A7568;">Brand</td><td align="right" style="font-family:Georgia,serif;font-size:17px;color:#1A1814;">${brand || '—'}</td></tr></table></td></tr>
            <tr><td style="padding:10px 24px;border-bottom:0.5px solid rgba(184,160,106,0.12);"><table width="100%"><tr><td style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#7A7568;">Quotation Amount</td><td align="right" style="font-family:Georgia,serif;font-size:17px;color:#1A1814;">SGD ${quotationAmount || '—'}</td></tr></table></td></tr>
            <tr><td style="padding:10px 24px;"><table width="100%"><tr><td style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#7A7568;">New Status</td><td align="right" style="font-family:Georgia,serif;font-size:15px;color:#7B2D2D;">Quotation rejected — return without repair</td></tr></table></td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="padding:16px 20px;background:#FDF5F5;border-left:2px solid rgba(123,45,45,0.4);">
              <p style="font-size:12px;color:#7A7568;line-height:1.9;margin:0;">Please prepare the timepiece for return and update the <strong style="color:#3D3930;">Collection Date</strong> in the Google Sheet when the watch is ready for pickup. The customer will be notified automatically.</p>
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td height="1" style="background:rgba(184,160,106,0.25);font-size:0;">&nbsp;</td></tr></table>
          <p style="font-family:Georgia,serif;font-size:18px;color:#1A1814;margin:0;">Regence<span style="color:#B8A06A;">.</span></p>
        </td></tr>
        <tr><td style="background:#F5F2EC;padding:20px 48px;text-align:center;border-left:0.5px solid rgba(184,160,106,0.3);border-right:0.5px solid rgba(184,160,106,0.3);border-bottom:0.5px solid rgba(184,160,106,0.3);">
          <p style="font-size:10px;color:#7A7568;line-height:1.7;margin:0;">This is an automated notification from the Regence Group After-Sales System.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try { await sendEmail(`Quotation Declined — Job ${jobNumber} (${brand || 'Unknown'})`, html, recipients); }
  catch (e) { console.error('Email error:', e); }

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true }) };
};
