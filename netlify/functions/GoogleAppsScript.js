// ============================================================
// REGENCE GROUP — Google Apps Script
// Paste this into your Google Sheet:
//   Extensions → Apps Script → paste → Save → set up trigger
// ============================================================

// ── CONFIGURATION ──
const CONFIG = {
  RESEND_API_KEY: 'YOUR_RESEND_API_KEY',        // paste your Resend API key
  FROM_EMAIL:     'noreply@regencegroup.com',    // your verified Resend domain
  FROM_NAME:      'Regence Group',
  SITE_URL:       'https://regencegroup.com',    // your live site URL

  // Column indices (1-based for Apps Script)
  COL_DATE:           1,   // A
  COL_JOB_NUMBER:     2,   // B
  COL_SAV_NUMBER:     3,   // C
  COL_NAME:           4,   // D
  COL_PHONE:          5,   // E
  COL_EMAIL:          6,   // F
  COL_REQUEST:        7,   // G
  COL_PRICE:          8,   // H
  COL_QUOTATION_YN:   9,   // I  (written by system: Y=paid, N=declined)
  COL_WARRANTY:       10,  // J
  COL_INVOICE:        11,  // K
  COL_SAV_INVOICE:    12,  // L
  COL_COLLECTION_DATE:13,  // M
  COL_REMARK:         14,  // N
  COL_STATUS:         15,  // O
  COL_BRAND:          16,  // P

  SHEET_NAME: 'Repair Job',

  // Collection locations lookup
  LOCATIONS: {
    'tissot': {
      name:    'Tissot Boutique',
      address: '#01-27 Paya Lebar Quarter Mall\nSingapore',
      hours:   'Daily · 11:00am – 9:30pm'
    }
    // Add more brands here as needed:
    // 'maurice lacroix': { name: '...', address: '...', hours: '...' }
  }
};

// ── TRIGGER SETUP ──
// Run this function ONCE to set up the single trigger:
function createTrigger() {
  // Remove any existing triggers first to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onEdit')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  Logger.log('Single trigger created.');
}

// ── MAIN TRIGGER — handles both Repair Job sheet and Appointments sheet ──
function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  const name  = sheet.getName();

  if (name === CONFIG.SHEET_NAME) {
    onStatusChange(e);
  } else if (name === 'Appointments') {
    onAppointmentReasonSelected(e);
  }
}

function onStatusChange(e) {
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;

  const row     = e.range.getRow();
  const col     = e.range.getColumn();
  const newVal  = String(e.value || '').trim();

  // Only fire on status column (O)
  if (col !== CONFIG.COL_STATUS) return;
  // Skip header row
  if (row <= 1) return;

  // Only fire if value actually changed
  const oldVal = String(e.oldValue || '').trim().toLowerCase();
  if (oldVal === newVal.toLowerCase()) {
    Logger.log(`Row ${row}: Value unchanged (${newVal}) — skipping.`);
    return;
  }

  // Use a script lock to prevent duplicate execution within 10 seconds
  const lock = LockService.getScriptLock();
  const lockKey = `notify_${row}_${newVal.toLowerCase().replace(/\s+/g,'_')}`;
  const cache = CacheService.getScriptCache();
  if (cache.get(lockKey)) {
    Logger.log(`Row ${row}: Duplicate trigger detected — skipping.`);
    return;
  }
  // Set cache for 30 seconds to block duplicates
  cache.put(lockKey, '1', 30);

  const rowData = sheet.getRange(row, 1, 1, 16).getValues()[0];

  const jobNumber    = String(rowData[CONFIG.COL_JOB_NUMBER    - 1] || '').trim();
  const savNumber    = String(rowData[CONFIG.COL_SAV_NUMBER    - 1] || '').trim();
  const customerName = String(rowData[CONFIG.COL_NAME          - 1] || '').trim();
  const customerEmail= String(rowData[CONFIG.COL_EMAIL         - 1] || '').trim();
  const customerPhone= String(rowData[CONFIG.COL_PHONE         - 1] || '').trim();
  const price        = String(rowData[CONFIG.COL_PRICE         - 1] || '').trim();
  const brand        = String(rowData[CONFIG.COL_BRAND         - 1] || '').trim().toLowerCase();

  if (!customerEmail) {
    Logger.log(`Row ${row}: No customer email — skipping notification.`);
    return;
  }

  const statusLower = newVal.toLowerCase();

  if (statusLower === 'quotation; pending payment') {
    sendQuotationEmail(jobNumber, savNumber, customerName, customerEmail, price, brand, row);
  }
  else if (statusLower === 'ready for collection') {
    sendCollectionEmail(jobNumber, savNumber, customerName, customerEmail, brand);
  }

  // ── WhatsApp notifications ──
  sendWhatsAppNotify({
    status: newVal,
    jobNumber,
    savNumber,
    customerName,
    customerPhone,
    brand,
    quotationAmount: price
  });
}

// ── EMAIL 1: QUOTATION READY ──
function sendQuotationEmail(jobNumber, savNumber, customerName, customerEmail, price, brand, row) {
  const paymentUrl = `${CONFIG.SITE_URL}/?job=${encodeURIComponent(jobNumber)}`; // ?job= works for email links since they open fresh
  const firstName  = customerName.split(' ')[0] || customerName;
  const amountDisplay = price ? `SGD ${parseFloat(price).toFixed(2)}` : '—';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#E8E4DC;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#E8E4DC;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- gold bar -->
        <tr><td height="3" style="background:linear-gradient(90deg,#B8A06A,#D4BC8A,#B8A06A);font-size:0;">&nbsp;</td></tr>
        <!-- header -->
        <tr><td style="background:#F5F2EC;padding:36px 48px 28px;text-align:center;border-left:0.5px solid rgba(184,160,106,0.3);border-right:0.5px solid rgba(184,160,106,0.3);">
          <p style="font-family:Georgia,serif;font-size:22px;letter-spacing:0.18em;text-transform:uppercase;color:#1A1814;margin:0 0 4px;">Regence<span style="color:#B8A06A;">.</span></p>
          <p style="font-size:9px;letter-spacing:0.3em;text-transform:uppercase;color:#7A7568;margin:0;">After-Sales Service</p>
        </td></tr>
        <!-- body -->
        <tr><td style="background:#FDFCFA;padding:40px 48px;border-left:0.5px solid rgba(184,160,106,0.3);border-right:0.5px solid rgba(184,160,106,0.3);">
          <p style="font-family:Georgia,serif;font-size:22px;color:#1A1814;margin:0 0 16px;">Dear ${firstName},</p>
          <p style="font-size:13px;color:#7A7568;line-height:1.9;margin:0 0 28px;">Thank you for entrusting your timepiece to us. Our watchmaker has completed the assessment and a repair quotation has been prepared for your review.</p>
          <!-- job box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;border:0.5px solid rgba(184,160,106,0.25);margin-bottom:28px;">
            <tr><td style="padding:14px 24px;border-bottom:0.5px solid rgba(184,160,106,0.2);">
              <p style="font-size:9px;letter-spacing:0.3em;text-transform:uppercase;color:#B8A06A;margin:0;">Repair Summary</p>
            </td></tr>
            <tr><td style="padding:10px 24px;border-bottom:0.5px solid rgba(184,160,106,0.15);">
              <table width="100%"><tr>
                <td style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#7A7568;">Repair Job No.</td>
                <td align="right" style="font-family:Georgia,serif;font-size:18px;color:#1A1814;">${jobNumber}</td>
              </tr></table>
            </td></tr>
            <tr><td style="padding:10px 24px;">
              <table width="100%"><tr>
                <td style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#7A7568;">Quotation Amount</td>
                <td align="right" style="font-family:Georgia,serif;font-size:18px;color:#8C7245;font-weight:bold;">${amountDisplay}</td>
              </tr></table>
            </td></tr>
          </table>
          <!-- note -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="padding:16px 20px;background:#F5F2EC;border-left:2px solid rgba(184,160,106,0.4);">
              <p style="font-size:12px;color:#7A7568;line-height:1.9;margin:0;">Please note that <strong style="color:#3D3930;">all payments are strictly non-refundable.</strong> If you wish to decline the quotation, you may do so through the payment page and your timepiece will be returned to you without repair.</p>
            </td></tr>
          </table>
          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td align="center">
              <a href="${paymentUrl}" style="display:inline-block;padding:16px 40px;background:#1A1814;color:#FDFCFA;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;text-decoration:none;">Proceed to Payment</a>
            </td></tr>
          </table>
          <!-- divider -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td height="1" style="background:rgba(184,160,106,0.25);font-size:0;">&nbsp;</td></tr>
          </table>
          <p style="font-size:13px;color:#7A7568;line-height:1.9;margin:0 0 20px;">If you have any questions, please contact our after-sales team quoting your job reference number.</p>
          <p style="font-family:Georgia,serif;font-size:18px;color:#1A1814;margin:0;">Regence<span style="color:#B8A06A;">.</span></p>
        </td></tr>
        <!-- footer -->
        <tr><td style="background:#F5F2EC;padding:20px 48px;text-align:center;border-left:0.5px solid rgba(184,160,106,0.3);border-right:0.5px solid rgba(184,160,106,0.3);border-bottom:0.5px solid rgba(184,160,106,0.3);">
          <p style="font-size:10px;color:#7A7568;line-height:1.7;margin:0;">This email was sent regarding your repair job at Regence Group.<br>Please do not reply — contact us directly quoting your job reference.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  sendEmail(
    customerEmail,
    `Your Repair Quotation — Job ${jobNumber}`,
    html
  );
  Logger.log(`Quotation email sent to ${customerEmail} for job ${jobNumber}`);
}

// ── EMAIL 2: READY FOR COLLECTION ──
function sendCollectionEmail(jobNumber, savNumber, customerName, customerEmail, brand) {
  const firstName = customerName.split(' ')[0] || customerName;
  const location  = CONFIG.LOCATIONS[brand] || CONFIG.LOCATIONS['tissot'];

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#E8E4DC;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#E8E4DC;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td height="3" style="background:linear-gradient(90deg,#B8A06A,#D4BC8A,#B8A06A);font-size:0;">&nbsp;</td></tr>
        <tr><td style="background:#F5F2EC;padding:36px 48px 28px;text-align:center;border-left:0.5px solid rgba(184,160,106,0.3);border-right:0.5px solid rgba(184,160,106,0.3);">
          <p style="font-family:Georgia,serif;font-size:22px;letter-spacing:0.18em;text-transform:uppercase;color:#1A1814;margin:0 0 4px;">Regence<span style="color:#B8A06A;">.</span></p>
          <p style="font-size:9px;letter-spacing:0.3em;text-transform:uppercase;color:#7A7568;margin:0;">After-Sales Service</p>
        </td></tr>
        <tr><td style="background:#FDFCFA;padding:40px 48px;border-left:0.5px solid rgba(184,160,106,0.3);border-right:0.5px solid rgba(184,160,106,0.3);">
          <p style="font-family:Georgia,serif;font-size:22px;color:#1A1814;margin:0 0 16px;">Dear ${firstName},</p>
          <p style="font-size:13px;color:#7A7568;line-height:1.9;margin:0 0 28px;">We are pleased to inform you that your timepiece is ready for collection. Our team looks forward to returning it to you.</p>
          <!-- job box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;border:0.5px solid rgba(184,160,106,0.25);margin-bottom:24px;">
            <tr><td style="padding:14px 24px;border-bottom:0.5px solid rgba(184,160,106,0.2);">
              <p style="font-size:9px;letter-spacing:0.3em;text-transform:uppercase;color:#B8A06A;margin:0;">Repair Summary</p>
            </td></tr>
            <tr><td style="padding:10px 24px;border-bottom:0.5px solid rgba(184,160,106,0.15);">
              <table width="100%"><tr>
                <td style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#7A7568;">Repair Job No.</td>
                <td align="right" style="font-family:Georgia,serif;font-size:18px;color:#1A1814;">${jobNumber}</td>
              </tr></table>
            </td></tr>
            <tr><td style="padding:10px 24px;">
              <table width="100%"><tr>
                <td style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#7A7568;">Status</td>
                <td align="right" style="font-family:Georgia,serif;font-size:16px;color:#1A1814;">Ready for Collection</td>
              </tr></table>
            </td></tr>
          </table>
          <!-- address box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;border:0.5px solid rgba(184,160,106,0.25);margin-bottom:24px;">
            <tr><td style="padding:16px 24px;">
              <p style="font-size:9px;letter-spacing:0.3em;text-transform:uppercase;color:#B8A06A;margin:0 0 10px;">Collection Address</p>
              <p style="font-family:Georgia,serif;font-size:18px;color:#1A1814;margin:0 0 4px;">${location.name}</p>
              <p style="font-size:13px;color:#7A7568;line-height:1.8;margin:0 0 6px;">${location.address.replace(/\n/g,'<br>')}</p>
              <p style="font-size:11px;color:#B8A06A;letter-spacing:0.1em;margin:0;">${location.hours}</p>
            </td></tr>
          </table>
          <!-- note -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="padding:16px 20px;background:#F5F2EC;border-left:2px solid rgba(184,160,106,0.4);">
              <p style="font-size:12px;color:#7A7568;line-height:1.9;margin:0;">Please bring this email or your job reference number when collecting. Our team will be happy to assist you.</p>
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td height="1" style="background:rgba(184,160,106,0.25);font-size:0;">&nbsp;</td></tr>
          </table>
          <p style="font-size:13px;color:#7A7568;line-height:1.9;margin:0 0 20px;">If you have any questions, please contact our after-sales team quoting your job reference number.</p>
          <p style="font-family:Georgia,serif;font-size:18px;color:#1A1814;margin:0;">Regence<span style="color:#B8A06A;">.</span></p>
        </td></tr>
        <tr><td style="background:#F5F2EC;padding:20px 48px;text-align:center;border-left:0.5px solid rgba(184,160,106,0.3);border-right:0.5px solid rgba(184,160,106,0.3);border-bottom:0.5px solid rgba(184,160,106,0.3);">
          <p style="font-size:10px;color:#7A7568;line-height:1.7;margin:0;">This email was sent regarding your repair job at Regence Group.<br>Please do not reply — contact us directly quoting your job reference.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  sendEmail(
    customerEmail,
    `Your Timepiece is Ready for Collection — Job ${jobNumber}`,
    html
  );
  Logger.log(`Collection email sent to ${customerEmail} for job ${jobNumber}`);
}

// ── SEND VIA RESEND ──
function sendEmail(to, subject, html) {
  Logger.log(`Attempting to send email to: ${to}`);
  Logger.log(`Subject: ${subject}`);
  Logger.log(`From: ${CONFIG.FROM_NAME} <${CONFIG.FROM_EMAIL}>`);
  Logger.log(`API Key starts with: ${CONFIG.RESEND_API_KEY.substring(0, 8)}...`);

  if (!to || to === '—' || to.indexOf('@') === -1) {
    Logger.log(`Invalid email address: "${to}" — skipping send`);
    return;
  }

  if (!CONFIG.RESEND_API_KEY || CONFIG.RESEND_API_KEY === 'YOUR_RESEND_API_KEY') {
    Logger.log('ERROR: Resend API key not set');
    return;
  }

  const payload = JSON.stringify({
    from:    `${CONFIG.FROM_NAME} <${CONFIG.FROM_EMAIL}>`,
    to:      [to],
    subject: subject,
    html:    html
  });

  Logger.log(`Payload length: ${payload.length} chars`);

  const options = {
    method:      'post',
    contentType: 'application/json',
    headers:     { 'Authorization': `Bearer ${CONFIG.RESEND_API_KEY}` },
    payload:     payload,
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch('https://api.resend.com/emails', options);
    const code     = response.getResponseCode();
    const body     = response.getContentText();
    Logger.log(`Resend response code: ${code}`);
    Logger.log(`Resend response body: ${body}`);
    if (code !== 200 && code !== 201) {
      Logger.log(`EMAIL FAILED (${code}): ${body}`);
    } else {
      Logger.log(`Email sent successfully to ${to}`);
    }
  } catch(err) {
    Logger.log(`Exception during email send: ${err.toString()}`);
  }
}

// ── WHATSAPP NOTIFY ──
// Calls the Netlify whatsapp-notify function on every status change
function sendWhatsAppNotify({ status, jobNumber, savNumber, customerName, customerPhone, brand, quotationAmount }) {
  const siteUrl = CONFIG.SITE_URL.replace('https://', '').replace('http://', '').replace(/\/$/, '');
  const payload = JSON.stringify({
    status,
    jobNumber,
    savNumber,
    customerName,
    customerPhone,
    brand,
    quotationAmount,
    siteUrl
  });

  const options = {
    method:      'post',
    contentType: 'application/json',
    payload,
    muteHttpExceptions: true
  };

  try {
    const url      = `https://${siteUrl}/.netlify/functions/whatsapp-notify`;
    const response = UrlFetchApp.fetch(url, options);
    const code     = response.getResponseCode();
    Logger.log(`WhatsApp notify response: ${code} — ${response.getContentText()}`);
  } catch(err) {
    Logger.log(`WhatsApp notify error: ${err.toString()}`);
  }
}

// ── APPOINTMENT CANCELLATION HANDLER ──
// Fires when manager selects a Cancel Reason in column K of the Appointments sheet
// This automatically sets Status (col I) to Cancelled and sends all notifications
// Column I (Status) should NOT be manually edited — it is written only by:
//   - book-appointment.js (sets Confirmed on new booking)
//   - cancel-appointment.js (sets Cancelled on customer self-cancel)
//   - This function (sets Cancelled on manager cancel via reason selection)
function onAppointmentReasonSelected(e) {
  const sheet  = e.source.getActiveSheet();
  const row    = e.range.getRow();
  const col    = e.range.getColumn();
  const reason = String(e.value || '').trim();

  // Only fire on Cancel Reason column (K = col 11)
  if (col !== 11) return;
  if (row <= 1)   return;
  if (!reason)    return;
  // Customer self-cancellations are handled by cancel-appointment.js — skip here
  if (reason.toLowerCase() === 'cancelled by customer') return;
  // Only proceed for valid manager-initiated reasons
  const validReasons = ['customer request', 'n.a.', 'na', 'n.a'];
  if (!validReasons.includes(reason.toLowerCase())) return;

  // Prevent duplicate execution
  const cache   = CacheService.getScriptCache();
  const lockKey = `appt_cancel_${row}_${reason}`;
  if (cache.get(lockKey)) {
    Logger.log(`Row ${row}: duplicate appointment cancel — skipping`);
    return;
  }
  cache.put(lockKey, '1', 30);

  // Read row data
  const rowData = sheet.getRange(row, 1, 1, 11).getValues()[0];
  const status  = String(rowData[8] || '').trim().toLowerCase(); // Col I

  // Only proceed if not already cancelled
  if (status === 'cancelled') {
    Logger.log(`Row ${row}: already cancelled — skipping`);
    return;
  }

  const rawDate = rowData[0];
  const rawTime = rowData[1];

  // Google Sheets stores dates as Date objects — format to YYYY-MM-DD
  let date = '';
  if (rawDate instanceof Date && !isNaN(rawDate)) {
    const y = rawDate.getFullYear();
    const m = String(rawDate.getMonth() + 1).padStart(2, '0');
    const d = String(rawDate.getDate()).padStart(2, '0');
    date = `${y}-${m}-${d}`;
  } else {
    date = String(rawDate || '').trim();
  }

  // Time may also be a Date object — extract HH:MM
  let time = '';
  if (rawTime instanceof Date && !isNaN(rawTime)) {
    const h = String(rawTime.getHours()).padStart(2, '0');
    const mn = String(rawTime.getMinutes()).padStart(2, '0');
    time = `${h}:${mn}`;
  } else {
    time = String(rawTime || '').trim();
  }

  const name  = String(rowData[2] || '').trim();
  const email = String(rowData[3] || '').trim();
  const phone = String(rowData[4] || '').trim();

  if (!date || !time || !name) {
    Logger.log(`Row ${row}: missing appointment data — skipping`);
    return;
  }

  // Automatically set Status to Cancelled
  sheet.getRange(row, 9).setValue('Cancelled');

  // Call Netlify function to send all notifications
  const siteUrl = CONFIG.SITE_URL.replace('https://', '').replace('http://', '').replace(/\/$/, '');
  const payload = JSON.stringify({ date, time, name, email, phone, reason });

  try {
    const url      = `https://${siteUrl}/.netlify/functions/admin-cancel-appointment`;
    const response = UrlFetchApp.fetch(url, {
      method:      'post',
      contentType: 'application/json',
      payload,
      muteHttpExceptions: true
    });
    Logger.log(`Admin cancel response: ${response.getResponseCode()} — ${response.getContentText()}`);
  } catch(err) {
    Logger.log(`Admin cancel error: ${err.toString()}`);
  }
}
