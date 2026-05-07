// cancel-appointment.js
// Finds booking by ID in sheet, marks as Cancelled, notifies team

async function getGoogleAccessToken() {
  const email  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) throw new Error('Missing Google service account credentials');
  const privateKey = rawKey.replace(/\\n/g, '\n');
  const crypto  = require('crypto');
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now     = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  })).toString('base64url');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(privateKey, 'base64url');
  const jwt = `${header}.${payload}.${sig}`;
  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function sendEmail(to, subject, html) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return;
  const from = process.env.EMAIL_FROM_DOMAIN || 'onboarding@resend.dev';
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Regence Group <${from}>`, to: [to], subject, html })
  });
}

async function sendWhatsApp(to, body) {
  const SID   = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const FROM  = process.env.TWILIO_WHATSAPP_FROM;
  if (!SID || !TOKEN || !FROM) return;
  let toFmt = to.toString().trim().replace(/\s+/g,'');
  if (!toFmt.startsWith('+')) toFmt = `+65${toFmt}`;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ From: FROM, To: `whatsapp:${toFmt}`, Body: body }).toString()
  });
}

function formatDate(dateStr) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const d = new Date(dateStr + 'T00:00:00');
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatSlot(time) {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${h > 12 ? h - 12 : h}:${String(m).padStart(2,'0')}${ampm}`;
}

// Success page HTML shown in browser after cancellation
function cancelSuccessPage() {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Appointment Cancelled — Regence Group</title>
<style>body{font-family:Arial,sans-serif;background:#F5F2EC;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.card{background:#FDFCFA;border:1px solid #EDE9E0;max-width:480px;width:90%;overflow:hidden;}
.bar{height:3px;background:linear-gradient(90deg,#B8A06A,#D4BC8A,#B8A06A);}
.body{padding:48px 40px;text-align:center;}
.eyebrow{font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#B8A06A;margin-bottom:24px;}
.line{width:48px;height:1px;background:#B8A06A;margin:0 auto 24px;}
h1{font-family:Georgia,serif;font-size:26px;font-weight:300;color:#1A1814;margin-bottom:12px;}
p{font-size:13px;color:#7A7568;line-height:1.85;margin-bottom:24px;}
a{display:inline-block;padding:12px 32px;background:#1A1814;color:#FDFCFA;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;text-decoration:none;}
</style></head>
<body><div class="card"><div class="bar"></div><div class="body">
<p class="eyebrow">Tissot Boutique · Regence Group</p>
<div class="line"></div>
<h1>Your appointment has been cancelled.</h1>
<p>We have noted your cancellation. We hope to welcome you to the Tissot Boutique on another occasion.</p>
<a href="https://regencegroup.com">Return to Website</a>
</div></div></body></html>`;
}

function cancelErrorPage(msg) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Error — Regence Group</title>
<style>body{font-family:Arial,sans-serif;background:#F5F2EC;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.card{background:#FDFCFA;border:1px solid #EDE9E0;max-width:480px;width:90%;padding:48px 40px;text-align:center;}
h1{font-family:Georgia,serif;font-size:24px;font-weight:300;color:#1A1814;margin-bottom:12px;}
p{font-size:13px;color:#7A7568;line-height:1.85;margin-bottom:24px;}
a{display:inline-block;padding:12px 32px;background:#1A1814;color:#FDFCFA;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;text-decoration:none;}
</style></head>
<body><div class="card">
<h1>Something went wrong.</h1>
<p>${msg || 'This cancellation link may have already been used or is invalid.'}</p>
<a href="https://regencegroup.com">Return to Website</a>
</div></body></html>`;
}

exports.handler = async function(event) {
  const bookingId = event.queryStringParameters && event.queryStringParameters.id;
  if (!bookingId) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: cancelErrorPage('Invalid cancellation link.') };
  }

  const SHEET_ID   = process.env.SHEET_ID_TISSOT_APPOINTMENTS;
  const TEAM_EMAIL = process.env.NOTIFY_EMAIL;
  const TEAM_WA    = process.env.NOTIFY_WHATSAPP_TEAM;
  const MGR_WA     = process.env.NOTIFY_WHATSAPP_MANAGER;
  const API_KEY    = process.env.GOOGLE_API_KEY;

  try {
    // Find the booking by ID (column J)
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Appointments!A:J?key=${API_KEY}`;
    const readRes = await fetch(readUrl);
    const readData = await readRes.json();
    const rows = (readData.values || []);

    let rowIndex = -1;
    let rowData  = null;
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][9] || '').trim() === bookingId) {
        rowIndex = i + 1; // 1-indexed for Sheets API
        rowData  = rows[i];
        break;
      }
    }

    if (rowIndex === -1) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: cancelErrorPage('This booking could not be found.') };
    }

    if ((rowData[8] || '').toLowerCase() === 'cancelled') {
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: cancelErrorPage('This appointment has already been cancelled.') };
    }

    // Mark as Cancelled in column I and write reason to column K
    const token = await getGoogleAccessToken();
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Appointments!I${rowIndex}:K${rowIndex}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [['Cancelled', '', 'Cancelled by Customer']] })
      }
    );

    const date = rowData[0] || '';
    const time = rowData[1] || '';
    const name = rowData[2] || '';
    const email= rowData[3] || '';
    const phone= rowData[4] || '';

    // Customer cancellation email
    const first = (name || '').split(' ')[0] || 'there';
    const customerHtml = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#FDFCFA;border:1px solid #EDE9E0;">
      <div style="height:3px;background:linear-gradient(90deg,#B8A06A,#D4BC8A,#B8A06A);"></div>
      <div style="padding:40px 40px 32px;text-align:center;background:#F5F2EC;border-bottom:1px solid #EDE9E0;">
        <p style="font-size:10px;letter-spacing:0.35em;text-transform:uppercase;color:#B8A06A;margin:0 0 16px;">Tissot Boutique · Singapore</p>
        <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:300;color:#1A1814;margin:0;line-height:1.2;">Your appointment has been cancelled.</h1>
      </div>
      <div style="padding:36px 40px;">
        <p style="font-size:14px;color:#3D3930;line-height:1.9;margin:0 0 24px;">Dear ${first}, we have noted your cancellation and your appointment has been removed from our schedule.</p>
        <div style="padding:20px 24px;background:#F5F2EC;border:0.5px solid rgba(184,160,106,0.25);margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;width:38%;">Date</td>
                <td style="padding:8px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;">${formatDate(date)}</td></tr>
            <tr><td style="padding:8px 0;color:#7A7568;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">Time</td>
                <td style="padding:8px 0;color:#1A1814;font-size:13px;">${formatSlot(time)}</td></tr>
          </table>
        </div>
        <div style="padding:14px 18px;background:#F5F2EC;border-left:2px solid #B8A06A;margin-bottom:20px;">
          <p style="font-size:13px;color:#7A7568;line-height:1.85;margin:0;">We hope to welcome you to the Tissot Boutique on another occasion. Should you wish to make a new appointment, please visit regencegroup.com.</p>
        </div>
      </div>
      <div style="padding:24px 40px;background:#F5F2EC;border-top:1px solid #EDE9E0;">
        <p style="font-family:Georgia,serif;font-size:13px;color:#1A1814;margin:0 0 4px;">Tissot Boutique · Regence Group</p>
        <p style="font-size:11px;color:#7A7568;margin:0;letter-spacing:0.05em;">#01-27 PLQ Mall · Daily 11:00am – 9:30pm</p>
      </div>
    </div>`;

    if (email) {
      await sendEmail(email, `Your Tissot Boutique appointment has been cancelled — ${formatDate(date)}`, customerHtml);
    }

    // Notify team by email
    const teamHtml = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#FDFCFA;border:1px solid #EDE9E0;">
      <div style="height:3px;background:linear-gradient(90deg,#B8A06A,#D4BC8A,#B8A06A);"></div>
      <div style="padding:32px 40px;">
        <p style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#7B2D2D;margin-bottom:10px;opacity:0.8;">Appointment Cancelled</p>
        <h1 style="font-family:Georgia,serif;font-size:24px;font-weight:400;color:#1A1814;margin-bottom:20px;">Tissot Boutique · PLQ Mall</h1>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;width:36%;">Date</td>
              <td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;">${formatDate(date)}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Time</td>
              <td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;">${formatSlot(time)}</td></tr>
          <tr><td style="padding:10px 0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Customer</td>
              <td style="padding:10px 0;color:#1A1814;font-size:13px;">${name} · ${phone}</td></tr>
        </table>
      </div>
      <div style="padding:20px 40px;border-top:1px solid #EDE9E0;">
        <p style="font-size:11px;color:#B8A06A;letter-spacing:0.15em;text-transform:uppercase;margin:0;">Tissot Boutique · Regence Group</p>
      </div>
    </div>`;

    if (TEAM_EMAIL) {
      await sendEmail(TEAM_EMAIL, `Appointment Cancelled — ${formatDate(date)} at ${formatSlot(time)}`, teamHtml);
    }

    // Notify team via WhatsApp
    const waMsg = [
      `❌ *Appointment Cancelled — Tissot PLQ*`,
      ``,
      `Date: ${formatDate(date)}`,
      `Time: ${formatSlot(time)}`,
      `Customer: ${name} · ${phone}`,
      ``,
      `_Tissot Boutique · Regence Group_`
    ].join('\n');

    await Promise.all([
      TEAM_WA ? sendWhatsApp(TEAM_WA, waMsg) : Promise.resolve(),
      MGR_WA  ? sendWhatsApp(MGR_WA,  waMsg) : Promise.resolve(),
    ]);

    return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: cancelSuccessPage() };

  } catch (err) {
    console.error('cancel-appointment error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: cancelErrorPage('An error occurred. Please contact us directly.') };
  }
};
