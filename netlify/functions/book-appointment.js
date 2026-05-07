// book-appointment.js
// Writes a new appointment to the Google Sheet
// Sends email to team, WhatsApp to team + manager + customer

async function getGoogleAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) throw new Error('Missing Google service account credentials');
  const privateKey = rawKey.replace(/\\n/g, '\n');

  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now     = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  })).toString('base64url');

  const crypto  = require('crypto');
  const sign    = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig     = sign.sign(privateKey, 'base64url');
  const jwt     = `${header}.${payload}.${sig}`;

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
  const res  = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Regence Group <${from}>`, to: [to], subject, html })
  });
  if (!res.ok) console.error('Email error:', await res.json());
}

function formatSlot(time) {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12  = h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2,'0')}${ampm}`;
}

function formatDate(dateStr) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function dayName(dateStr) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return days[new Date(dateStr + 'T00:00:00').getDay()];
}

function teamEmailHtml({ name, email, phone, date, time, purpose, watchModel }) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#FDFCFA;border:1px solid #EDE9E0;">
    <div style="height:3px;background:linear-gradient(90deg,#B8A06A,#D4BC8A,#B8A06A);"></div>
    <div style="padding:32px 40px 24px;">
      <p style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#B8A06A;margin:0 0 10px;">New Appointment</p>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#1A1814;margin:0 0 6px;">Tissot Boutique · PLQ Mall</h1>
      <p style="font-size:13px;color:#7A7568;margin:0 0 28px;line-height:1.7;">A new appointment has been booked.</p>
      <div style="width:32px;height:1px;background:#B8A06A;margin-bottom:28px;opacity:0.5;"></div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;width:36%;">Date</td>
            <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;font-weight:bold;">${dayName(date)}, ${formatDate(date)}</td></tr>
        <tr><td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Time</td>
            <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;font-weight:bold;">${formatSlot(time)}</td></tr>
        <tr><td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Name</td>
            <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;">${name}</td></tr>
        <tr><td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Email</td>
            <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#B8A06A;font-size:13px;"><a href="mailto:${email}" style="color:#B8A06A;text-decoration:none;">${email}</a></td></tr>
        <tr><td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Phone</td>
            <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;">${phone}</td></tr>
        <tr><td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Purpose</td>
            <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;">${purpose}</td></tr>
        <tr><td style="padding:11px 0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Watch Model</td>
            <td style="padding:11px 0;color:#1A1814;font-size:13px;">${watchModel || '—'}</td></tr>
      </table>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #EDE9E0;">
      <p style="font-size:11px;color:#B8A06A;letter-spacing:0.15em;text-transform:uppercase;margin:0;">Tissot Boutique · PLQ Mall · Regence Group</p>
    </div>
  </div>`;
}

function customerEmailHtml({ name, date, time, cancelUrl }) {
  const first = (name || '').split(' ')[0] || 'there';
  const storeWa = process.env.TISSOT_WHATSAPP_NUMBER || '';
  const waNumber = storeWa.replace(/\D/g,'');
  const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=10+Paya+Lebar+Road+PLQ+Mall+Singapore+409057';
  return `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#FDFCFA;border:1px solid #EDE9E0;">
    <div style="height:3px;background:linear-gradient(90deg,#B8A06A,#D4BC8A,#B8A06A);"></div>
    <div style="padding:40px 40px 32px;text-align:center;background:#F5F2EC;border-bottom:1px solid #EDE9E0;">
      <p style="font-size:10px;letter-spacing:0.35em;text-transform:uppercase;color:#B8A06A;margin:0 0 16px;">Tissot Boutique Singapore</p>
      <h1 style="font-family:Georgia,serif;font-size:30px;font-weight:300;color:#1A1814;margin:0;line-height:1.2;">Your appointment is confirmed.</h1>
    </div>
    <div style="padding:36px 40px;">
      <p style="font-size:14px;color:#3D3930;line-height:1.9;margin:0 0 24px;">Dear ${first}, we look forward to welcoming you to the Tissot Boutique at Paya Lebar Quarter Mall.</p>
      <div style="padding:24px;background:#F5F2EC;border:0.5px solid rgba(184,160,106,0.3);margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:10px 0;color:#7A7568;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;width:38%;border-bottom:1px solid #EDE9E0;vertical-align:top;">Date</td>
              <td style="padding:10px 0;color:#1A1814;font-size:14px;font-family:Georgia,serif;border-bottom:1px solid #EDE9E0;">${dayName(date)}, ${formatDate(date)}</td></tr>
          <tr><td style="padding:10px 0;color:#7A7568;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;border-bottom:1px solid #EDE9E0;vertical-align:top;">Time</td>
              <td style="padding:10px 0;color:#1A1814;font-size:14px;font-family:Georgia,serif;border-bottom:1px solid #EDE9E0;">${formatSlot(time)}</td></tr>
          <tr><td style="padding:10px 0;color:#7A7568;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;border-bottom:1px solid #EDE9E0;vertical-align:top;">Location</td>
              <td style="padding:10px 0;color:#1A1814;font-size:13px;border-bottom:1px solid #EDE9E0;">
                Tissot Boutique<br>#01-27 PLQ Mall<br>10 Paya Lebar Road<br>Singapore 409057<br>
                <a href="${mapsUrl}" style="font-size:11px;color:#B8A06A;text-decoration:none;display:inline-block;margin-top:8px;letter-spacing:0.05em;">↗ Get Directions</a>
              </td></tr>
          <tr><td style="padding:10px 0;color:#7A7568;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;border-bottom:1px solid #EDE9E0;vertical-align:top;">Opening Hours</td>
              <td style="padding:10px 0;color:#1A1814;font-size:13px;border-bottom:1px solid #EDE9E0;">Daily · 11:00am – 9:30pm</td></tr>
          <tr><td style="padding:10px 0;color:#7A7568;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;vertical-align:top;">Contact</td>
              <td style="padding:10px 0;font-size:13px;">
                ${waNumber ? `<a href="https://wa.me/${waNumber}" style="color:#B8A06A;text-decoration:none;">${storeWa}</a><span style="font-size:11px;color:#7A7568;margin-left:6px;">(WhatsApp)</span>` : '—'}
              </td></tr>
        </table>
      </div>
      <div style="padding:14px 18px;background:#F5F2EC;border-left:2px solid #B8A06A;margin-bottom:20px;">
        <p style="font-size:13px;color:#7A7568;line-height:1.85;margin:0;">Our team will be ready to receive you. If you need to reschedule or have any questions, please do not hesitate to reach out to us via WhatsApp.</p>
      </div>
      ${cancelUrl ? `<p style="text-align:center;margin-bottom:4px;"><a href="${cancelUrl}" style="font-size:12px;color:#8C7245;letter-spacing:0.08em;text-decoration:underline;">Cancel this appointment</a></p>` : ''}
    </div>
    <div style="padding:24px 40px;background:#F5F2EC;border-top:1px solid #EDE9E0;">
      <p style="font-size:13px;color:#1A1814;font-family:Georgia,serif;margin:0 0 4px;">Tissot Boutique · Regence Group</p>
      <p style="font-size:11px;color:#7A7568;margin:0;letter-spacing:0.05em;">#01-27 PLQ Mall · Daily 11:00am – 9:30pm</p>
    </div>
  </div>`;
}

function teamWhatsApp({ name, phone, date, time, purpose, watchModel }) {
  return [
    `📅 *New Appointment — Tissot PLQ*`,
    ``,
    `Date: ${dayName(date)}, ${formatDate(date)}`,
    `Time: ${formatSlot(time)}`,
    `Name: ${name}`,
    `Phone: ${phone}`,
    `Purpose: ${purpose}`,
    `Watch Model: ${watchModel || '—'}`,
    ``,
    `_Tissot Boutique · Regence Group_`
  ].join('\n');
}

function customerWhatsApp({ name, date, time }) {
  const first = (name || '').split(' ')[0] || 'there';
  return [
    `Dear ${first},`,
    ``,
    `Your appointment at the Tissot Boutique has been confirmed.`,
    ``,
    `📅 ${dayName(date)}, ${formatDate(date)}`,
    `🕐 ${formatSlot(time)}`,
    `📍 Tissot Boutique`,
    `    #01-27 PLQ Mall`,
    `    10 Paya Lebar Road`,
    `    Singapore 409057`,
    `    Daily · 11:00am – 9:30pm`,
    ``,
    `We look forward to welcoming you.`,
    ``,
    `Regence Group`
  ].join('\n');
}

async function sendWhatsApp(to, body) {
  const SID   = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const FROM  = process.env.TWILIO_WHATSAPP_FROM;
  if (!SID || !TOKEN || !FROM) return;

  let toFmt = to.toString().trim().replace(/\s+/g,'');
  if (!toFmt.startsWith('+')) toFmt = `+65${toFmt}`;
  toFmt = `whatsapp:${toFmt}`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ From: FROM, To: toFmt, Body: body }).toString()
  });
  if (!res.ok) console.error('WhatsApp error:', await res.json());
}

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { date, time, name, email, phone, purpose, watchModel, consent } = body;

  if (!date || !time || !name || !email || !phone || !purpose) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const SHEET_ID   = process.env.SHEET_ID_TISSOT_APPOINTMENTS;
  const TEAM_EMAIL = process.env.NOTIFY_EMAIL;
  const TEAM_WA    = process.env.NOTIFY_WHATSAPP_TEAM;
  const MGR_WA     = process.env.NOTIFY_WHATSAPP_MANAGER;
  const SITE_URL   = process.env.SITE_URL || 'regencegroup.com';

  if (!SHEET_ID) {
    console.error('Missing SHEET_ID_TISSOT_APPOINTMENTS env var');
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Missing sheet configuration' }) };
  }

  try {
    // Generate unique booking ID
    const bookingId = `APT-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
    const cancelUrl = `https://${SITE_URL}/.netlify/functions/cancel-appointment?id=${bookingId}`;

    // Write to Google Sheet — include bookingId in column J
    const token = await getGoogleAccessToken();
    const row = [date, time, name, email, phone, purpose, watchModel || '', consent ? 'Yes' : 'No', 'Confirmed', bookingId];
    const sheetRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Appointments!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [row] })
      }
    );
    if (!sheetRes.ok) {
      const errText = await sheetRes.text();
      console.error('Sheet write failed:', sheetRes.status, errText);
      throw new Error(`Sheet write failed: ${errText}`);
    }

    // Send team email
    if (TEAM_EMAIL) {
      await sendEmail(TEAM_EMAIL, `New Appointment — ${dayName(date)} ${formatDate(date)} at ${formatSlot(time)}`,
        teamEmailHtml({ name, email, phone, date, time, purpose, watchModel }));
    }

    // Send customer confirmation email
    await sendEmail(email, `Your appointment at Tissot Boutique — ${formatDate(date)}`,
      customerEmailHtml({ name, date, time, cancelUrl }));

    // Team WhatsApp
    const waMsg = teamWhatsApp({ name, phone, date, time, purpose, watchModel });
    await Promise.all([
      TEAM_WA ? sendWhatsApp(TEAM_WA, waMsg) : Promise.resolve(),
      MGR_WA  ? sendWhatsApp(MGR_WA,  waMsg) : Promise.resolve(),
    ]);

    // Customer WhatsApp
    if (phone) await sendWhatsApp(phone, customerWhatsApp({ name, date, time }));

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error('book-appointment error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Booking failed' }) };
  }
};
