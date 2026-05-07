// ── WHATSAPP HELPER ──
// Sends WhatsApp messages via Twilio

function formatPhone(raw) {
  if (!raw) return null;
  const s = raw.toString().trim().replace(/\s+/g, '');
  if (s.startsWith('+')) return `whatsapp:${s}`;
  if (s.startsWith('00')) return `whatsapp:+${s.slice(2)}`;
  // assume Singapore
  return `whatsapp:+65${s}`;
}

async function sendWhatsApp(to, body) {
  const SID   = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const FROM  = process.env.TWILIO_WHATSAPP_FROM; // e.g. whatsapp:+14155238886

  if (!SID || !TOKEN || !FROM) {
    console.log('Twilio env vars missing — skipping WhatsApp');
    return;
  }

  const toFormatted = formatPhone(to);
  if (!toFormatted) { console.log('Invalid phone number — skipping WhatsApp'); return; }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ From: FROM, To: toFormatted, Body: body }).toString()
  });
  const data = await res.json();
  if (!res.ok) console.error('Twilio error:', JSON.stringify(data));
  return data;
}

async function notifyTeam(body) {
  const team    = process.env.NOTIFY_WHATSAPP_TEAM;
  const manager = process.env.NOTIFY_WHATSAPP_MANAGER;
  const sends = [];
  if (team)    sends.push(sendWhatsApp(team, body));
  if (manager) sends.push(sendWhatsApp(manager, body));
  await Promise.all(sends);
}

// ── TEAM MESSAGES ──

function msgTeamPaymentMade({ jobNumber, savNumber, customerName, brand, amount }) {
  return [
    `✅ *Payment Received*`,
    ``,
    `Job No: ${jobNumber}`,
    `SAV Repair No: ${savNumber || '—'}`,
    `Customer: ${customerName}`,
    `Brand: ${brand || 'Tissot'}`,
    `Amount: SGD ${parseFloat(amount || 0).toFixed(2)}`,
    ``,
    `The repair has been authorised. Please proceed accordingly.`,
    ``,
    `_Regence Group · Repair System_`
  ].join('\n');
}

function msgTeamPaymentDeclined({ jobNumber, savNumber, customerName, brand }) {
  return [
    `❌ *Quotation Declined*`,
    ``,
    `Job No: ${jobNumber}`,
    `SAV Repair No: ${savNumber || '—'}`,
    `Customer: ${customerName}`,
    `Brand: ${brand || 'Tissot'}`,
    ``,
    `The customer has declined the repair quotation. The timepiece should be prepared for return.`,
    ``,
    `_Regence Group · Repair System_`
  ].join('\n');
}

function msgTeamReadyForCollection({ jobNumber, savNumber, customerName, brand }) {
  return [
    `🕐 *Ready for Collection*`,
    ``,
    `Job No: ${jobNumber}`,
    `SAV Repair No: ${savNumber || '—'}`,
    `Customer: ${customerName}`,
    `Brand: ${brand || 'Tissot'}`,
    ``,
    `The timepiece has been marked as ready for collection.`,
    ``,
    `_Regence Group · Repair System_`
  ].join('\n');
}

// ── CUSTOMER MESSAGES ──

function msgCustomerNoIntervention({ jobNumber, customerName }) {
  const first = (customerName || '').split(' ')[0] || 'Valued Customer';
  return [
    `Dear ${first},`,
    ``,
    `We are pleased to inform you that our watchmaker has assessed your timepiece and determined that no repair is necessary.`,
    ``,
    `Your timepiece will be prepared for return shortly. You will be notified once it is ready for collection.`,
    ``,
    `Job Reference: ${jobNumber}`,
    ``,
    `Regence Group`
  ].join('\n');
}

function msgCustomerWarranty({ jobNumber, customerName }) {
  const first = (customerName || '').split(' ')[0] || 'Valued Customer';
  return [
    `Dear ${first},`,
    ``,
    `We are pleased to confirm that your timepiece is covered under warranty and the repair is now underway. No payment will be required.`,
    ``,
    `You will be notified when your timepiece is ready for collection.`,
    ``,
    `Job Reference: ${jobNumber}`,
    ``,
    `Regence Group`
  ].join('\n');
}

function msgCustomerQuotationPending({ jobNumber, customerName, amount, siteUrl }) {
  const first = (customerName || '').split(' ')[0] || 'Valued Customer';
  const url   = `https://${siteUrl || 'regencegroup.com'}/?job=${encodeURIComponent(jobNumber)}`;
  return [
    `Dear ${first},`,
    ``,
    `Our watchmaker has assessed your timepiece and prepared a repair quotation.`,
    ``,
    `Quotation Amount: SGD ${parseFloat(amount || 0).toFixed(2)}`,
    `Job Reference: ${jobNumber}`,
    ``,
    `To authorise the repair, please proceed with payment via the link below:`,
    `${url}`,
    ``,
    `This link will take you directly to your repair status and payment page.`,
    ``,
    `Regence Group`
  ].join('\n');
}

function msgCustomerRepairBegun({ jobNumber, customerName }) {
  const first = (customerName || '').split(' ')[0] || 'Valued Customer';
  return [
    `Dear ${first},`,
    ``,
    `Thank you for authorising the repair. Our watchmaker has commenced work on your timepiece.`,
    ``,
    `You will be notified when it is ready for collection.`,
    ``,
    `Job Reference: ${jobNumber}`,
    ``,
    `Regence Group`
  ].join('\n');
}

function msgCustomerQuotationRejected({ jobNumber, customerName }) {
  const first = (customerName || '').split(' ')[0] || 'Valued Customer';
  return [
    `Dear ${first},`,
    ``,
    `We note your decision to decline the repair quotation. Your timepiece will be returned to you without intervention.`,
    ``,
    `You will be notified when it is ready for collection.`,
    ``,
    `Job Reference: ${jobNumber}`,
    ``,
    `Regence Group`
  ].join('\n');
}

function msgCustomerReadyForCollection({ jobNumber, customerName, brand }) {
  const first = (customerName || '').split(' ')[0] || 'Valued Customer';
  // Collection address per brand
  const addresses = {
    tissot: 'Tissot Boutique\n10 Paya Lebar Road\n#01-27 PLQ Mall\nSingapore 409057\nDaily · 11:00am – 9:30pm'
  };
  const address = addresses[(brand || '').toLowerCase()] || 'Please contact us for collection details.';
  return [
    `Dear ${first},`,
    ``,
    `Your timepiece is ready and awaiting you.`,
    ``,
    `Please collect it at your earliest convenience from:`,
    ``,
    address,
    ``,
    `Job Reference: ${jobNumber}`,
    ``,
    `We look forward to placing your timepiece back in your hands.`,
    ``,
    `Regence Group`
  ].join('\n');
}

function msgCustomerCollected({ jobNumber, customerName }) {
  const first = (customerName || '').split(' ')[0] || 'Valued Customer';
  return [
    `Dear ${first},`,
    ``,
    `Your timepiece has been collected. We are glad to have been of service.`,
    ``,
    `We hope your timepiece continues to serve you well, and we look forward to welcoming you again.`,
    ``,
    `Job Reference: ${jobNumber}`,
    ``,
    `Regence Group`
  ].join('\n');
}

module.exports = {
  sendWhatsApp,
  notifyTeam,
  msgTeamPaymentMade,
  msgTeamPaymentDeclined,
  msgTeamReadyForCollection,
  msgCustomerNoIntervention,
  msgCustomerWarranty,
  msgCustomerQuotationPending,
  msgCustomerRepairBegun,
  msgCustomerQuotationRejected,
  msgCustomerReadyForCollection,
  msgCustomerCollected
};
