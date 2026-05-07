// admin-cancel-appointment.js
// Called by Google Apps Script when manager sets Status = "Cancelled" in the sheet
// Sends customer email, team email, team WhatsApp

async function sendEmail(to, subject, html) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return;
  const from = process.env.EMAIL_FROM_DOMAIN || 'onboarding@resend.dev';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Regence Group <${from}>`, to: [to], subject, html })
  });
  if (!res.ok) console.error('Email error:', await res.json());
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
  return `${h > 12 ? h - 12 : h}:${String(m).padStart(2,'0')}${h >= 12 ? 'pm' : 'am'}`;
}

function customerEmailHtml({ name, date, time, reason }) {
  const first       = (name || '').split(' ')[0] || 'there';
  const reasonLower = (reason || '').trim().toLowerCase();
  const isCustomerRequest = reasonLower === 'customer request';
  const isNA              = reasonLower === 'n.a.' || reasonLower === 'na' || reasonLower === 'n.a';

  // Body paragraph varies by reason
  let bodyPara = '';
  let closingPara = '';

  if (isCustomerRequest) {
    bodyPara    = `Dear ${first}, we have noted your cancellation and your appointment has been removed from our schedule.`;
    closingPara = `We hope to welcome you to the Tissot Boutique on another occasion. Should you wish to make a new appointment, please visit <a href="https://regencegroup.com" style="color:#B8A06A;text-decoration:none;">regencegroup.com</a>.`;
  } else if (isNA) {
    bodyPara    = `Dear ${first}, your appointment at the Tissot Boutique has been cancelled.`;
    closingPara = `We would be glad to welcome you at another time. Please visit <a href="https://regencegroup.com" style="color:#B8A06A;text-decoration:none;">regencegroup.com</a> to book a new appointment at your convenience.`;
  } else {
    // Specific reason provided
    bodyPara    = `Dear ${first}, your appointment at the Tissot Boutique has been cancelled.`;
    closingPara = `We would be glad to welcome you at another time. Please visit <a href="https://regencegroup.com" style="color:#B8A06A;text-decoration:none;">regencegroup.com</a> to book a new appointment at your convenience.`;
  }

  const reasonRow = (!isCustomerRequest && !isNA && reason)
    ? `<div style="padding:14px 18px;background:#F5F2EC;border-left:2px solid #B8A06A;margin-bottom:20px;">
         <p style="font-size:13px;color:#7A7568;line-height:1.85;margin:0;">${reason}</p>
       </div>`
    : '';

  return `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#FDFCFA;border:1px solid #EDE9E0;">
    <div style="height:3px;background:linear-gradient(90deg,#B8A06A,#D4BC8A,#B8A06A);"></div>
    <div style="padding:40px 40px 32px;text-align:center;background:#F5F2EC;border-bottom:1px solid #EDE9E0;">
      <p style="font-size:10px;letter-spacing:0.35em;text-transform:uppercase;color:#B8A06A;margin:0 0 16px;">Tissot Boutique · Singapore</p>
      <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:300;color:#1A1814;margin:0;line-height:1.2;">Your appointment has been cancelled.</h1>
    </div>
    <div style="padding:36px 40px;">
      <p style="font-size:14px;color:#3D3930;line-height:1.9;margin:0 0 24px;">${bodyPara}</p>
      <div style="padding:20px 24px;background:#F5F2EC;border:0.5px solid rgba(184,160,106,0.25);margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;width:38%;">Date</td>
              <td style="padding:10px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;">${formatDate(date)}</td></tr>
          <tr><td style="padding:10px 0;color:#7A7568;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">Time</td>
              <td style="padding:10px 0;color:#1A1814;font-size:13px;">${formatSlot(time)}</td></tr>
        </table>
      </div>
      ${reasonRow}
      <div style="padding:14px 18px;background:#F5F2EC;border-left:2px solid #B8A06A;">
        <p style="font-size:13px;color:#7A7568;line-height:1.85;margin:0;">${closingPara}</p>
      </div>
    </div>
    <div style="padding:24px 40px;background:#F5F2EC;border-top:1px solid #EDE9E0;">
      <p style="font-family:Georgia,serif;font-size:13px;color:#1A1814;margin:0 0 4px;">Tissot Boutique · Regence Group</p>
      <p style="font-size:11px;color:#7A7568;margin:0;letter-spacing:0.05em;">#01-27 PLQ Mall · Daily 11:00am – 9:30pm</p>
    </div>
  </div>`;
}

function teamEmailHtml({ name, phone, date, time, reason }) {
  const reasonLower = (reason || '').trim().toLowerCase();
  const reasonDisplay = reasonLower === 'n.a.' || reasonLower === 'na' || reasonLower === 'n.a' ? '—' : (reason || '—');
  return `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#FDFCFA;border:1px solid #EDE9E0;">
    <div style="height:3px;background:linear-gradient(90deg,#B8A06A,#D4BC8A,#B8A06A);"></div>
    <div style="padding:32px 40px 24px;">
      <span style="display:inline-block;font-size:9px;letter-spacing:0.25em;text-transform:uppercase;padding:4px 12px;color:#7B2D2D;border:0.5px solid rgba(123,45,45,0.3);background:rgba(123,45,45,0.05);margin-bottom:16px;">Appointment Cancelled</span>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#1A1814;margin:0 0 6px;line-height:1.2;">Tissot Boutique · PLQ Mall</h1>
      <p style="font-size:13px;color:#7A7568;line-height:1.7;margin:0 0 24px;">The following appointment has been cancelled.</p>
      <div style="width:32px;height:1px;background:#B8A06A;margin-bottom:24px;opacity:0.5;"></div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;width:36%;">Date</td>
            <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;font-weight:bold;">${formatDate(date)}</td></tr>
        <tr><td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Time</td>
            <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;font-weight:bold;">${formatSlot(time)}</td></tr>
        <tr><td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Customer</td>
            <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;">${name}</td></tr>
        <tr><td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Phone</td>
            <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;">${phone}</td></tr>
        <tr><td style="padding:11px 0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Reason</td>
            <td style="padding:11px 0;color:#1A1814;font-size:13px;">${reasonDisplay}</td></tr>
      </table>
      <div style="margin-top:24px;padding:14px 18px;background:#F5F2EC;border-left:2px solid #B8A06A;">
        <p style="font-size:13px;color:#7A7568;line-height:1.85;margin:0;">This slot is now available. You may wish to offer it to a walk-in or reschedule another customer.</p>
      </div>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #EDE9E0;">
      <p style="font-size:11px;color:#B8A06A;letter-spacing:0.15em;text-transform:uppercase;margin:0;">Tissot Boutique · PLQ Mall · Regence Group</p>
    </div>
  </div>`;
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

  const { date, time, name, email, phone, reason } = body;

  if (!date || !time || !name) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const TEAM_EMAIL = process.env.NOTIFY_EMAIL;
  const TEAM_WA    = process.env.NOTIFY_WHATSAPP_TEAM;
  const MGR_WA     = process.env.NOTIFY_WHATSAPP_MANAGER;

  try {
    // Customer email
    if (email) {
      await sendEmail(
        email,
        `Your Tissot Boutique appointment has been cancelled — ${formatDate(date)}`,
        customerEmailHtml({ name, date, time, reason })
      );
    }

    // Team email
    if (TEAM_EMAIL) {
      await sendEmail(
        TEAM_EMAIL,
        `Appointment Cancelled — ${formatDate(date)} at ${formatSlot(time)}`,
        teamEmailHtml({ name, phone, date, time, reason })
      );
    }

    // Team WhatsApp
    const reasonLower = (reason || '').trim().toLowerCase();
    const reasonDisplay = reasonLower === 'n.a.' || reasonLower === 'na' || reasonLower === 'n.a' ? '' : (reason ? `\nReason: ${reason}` : '');
    const waMsg = [
      `❌ *Appointment Cancelled — Tissot PLQ*`,
      ``,
      `Date: ${formatDate(date)}`,
      `Time: ${formatSlot(time)}`,
      `Customer: ${name} · ${phone}${reasonDisplay}`,
      ``,
      `_Tissot Boutique · Regence Group_`
    ].join('\n');

    await Promise.all([
      TEAM_WA ? sendWhatsApp(TEAM_WA, waMsg) : Promise.resolve(),
      MGR_WA  ? sendWhatsApp(MGR_WA,  waMsg) : Promise.resolve(),
    ]);

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error('admin-cancel error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Failed to send notifications' }) };
  }
};
