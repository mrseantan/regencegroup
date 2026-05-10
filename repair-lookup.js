// repair-lookup.js
// Unified lookup for both repair jobs AND orders
// Customer enters reference number + last 4 digits of mobile
// Checks repair sheet first, then orders sheet
// Returns { type: 'repair', ... } or { type: 'order', ... }

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function verifyStripeSignature(payload, header, secret) {
  const crypto = require('crypto');
  const parts  = header.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k]       = v;
    return acc;
  }, {});
  const timestamp = parts['t'];
  const sig       = parts['v1'];
  if (!timestamp || !sig) return false;
  const signedPayload = `${timestamp}.${payload}`;
  const expected      = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return expected === sig;
}

async function createStripeSession({ amount, description, successUrl, cancelUrl, email, metadata }) {
  const STRIPE_KEY  = process.env.STRIPE_SECRET_KEY_TISSOT || process.env.STRIPE_SECRET_KEY;
  const amountCents = Math.round(parseFloat(amount) * 100);
  if (!amountCents || amountCents < 50) throw new Error(`Invalid amount: ${amount}`);

  const params = new URLSearchParams({
    'payment_method_types[]':                  'card',
    'line_items[0][price_data][currency]':     'sgd',
    'line_items[0][price_data][unit_amount]':  amountCents,
    'line_items[0][price_data][product_data][name]': description,
    'line_items[0][quantity]':                 '1',
    'mode':                                    'payment',
    'success_url':                             successUrl,
    'cancel_url':                              cancelUrl,
  });

  // Add metadata
  Object.entries(metadata).forEach(([k, v]) => params.set(`metadata[${k}]`, v));
  if (email) params.set('customer_email', email);

  const res  = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString()
  });
  const data = await res.json();
  console.log('Stripe session response:', res.status, data.url ? 'has URL' : 'no URL', data.error?.message || '');
  if (!res.ok) throw new Error(data.error?.message || 'Stripe session creation failed');
  return data.url;
}


// ── PAYMENT LOG PARSER ──
function parsePaymentsLog(log) {
  if (!log || !log.trim()) return 0;
  const lines = log.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let total = 0;
  for (const line of lines) {
    const m = line.match(/^\[(.+?)\]\s*([-]?)SGD\s*([\d.]+)\s*·\s*(.+?)\s*·\s*(.+)$/i);
    if (m) total += (m[2] === '-' ? -1 : 1) * parseFloat(m[3]);
  }
  return Math.round(total * 100) / 100;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: HEADERS, body: '' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { jobNumber, mobileLast4 } = body;
  if (!jobNumber || !mobileLast4) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Job/order number and last 4 digits required' }) };
  }

  const API_KEY      = process.env.GOOGLE_API_KEY;
  const SHEET_ID     = process.env.SHEET_ID || process.env.SHEET_ID_TISSOT;  // Repair + Orders sheet
  const SITE_URL     = process.env.SITE_URL || 'https://regencegroup.com';

  // ── 1. TRY REPAIR LOOKUP ──
  try {
    // Use batchGet per-column to avoid sparse column truncation (Google Sheets drops trailing empty cells)
    const repairCols = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V'];
    const repairParam = repairCols.map(col => `ranges=Repair%20Job!${col}:${col}`).join('&');
    const repairRes  = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?${repairParam}&key=${API_KEY}`);
    const repairData = await repairRes.json();
    if (!repairData.valueRanges) throw new Error('batchGet failed: ' + JSON.stringify(repairData));

    // Build rows array from per-column valueRanges — header row is index 0, data starts at 1
    const colArrays = repairData.valueRanges.map(vr => (vr.values || []).map(row => (row[0] || '')));
    const rowCount  = colArrays[0].length; // Col A drives row count
    const rows      = [];
    for (let i = 1; i < rowCount; i++) { // skip header row (i=0)
      rows.push(repairCols.map((_, ci) => colArrays[ci][i] || ''));
    }

    const match = rows.find(r => {
      const rowJob   = (r[1] || '').trim().toUpperCase();
      const inputJob = jobNumber.trim().toUpperCase();
      if (rowJob !== inputJob) return false;
      const phone    = (r[4] || '').replace(/\D/g, '');
      return phone.slice(-4) === mobileLast4.trim();
    });

    if (match) {
      const status          = (match[14] || '').trim();
      const quotationAmount = parseFloat((match[7] || '0').toString().replace(/[^0-9.]/g, '')) || 0;
      const paymentsLog     = match[20] || '';  // col U (index 20)
      const totalPaid       = parsePaymentsLog(paymentsLog);
      const balanceDue      = Math.max(0, Math.round((quotationAmount - totalPaid) * 100) / 100);
      const customerName    = (match[3] || '').trim();
      const customerEmail   = (match[5] || '').trim();
      const customerPhone   = (match[4] || '').trim();
      const brand           = (match[15] || '').trim();
      const rowIndex        = rows.indexOf(match) + 2; // +2: 1 for header, 1 for 1-based sheet index
      const jobNum          = (match[1] || '').trim();
      const savNum          = (match[2] || '').trim();

      let paymentLink = null;
      const needsPayment = status.toLowerCase() === 'quotation; pending payment' || status.toLowerCase().includes('quote revised');
      if (needsPayment && balanceDue >= 0.5) {
        try {
          console.log('Repair Stripe attempt - amount:', quotationAmount, 'status:', status, 'brand:', brand, 'SITE_URL:', process.env.SITE_URL);
          paymentLink = await createStripeSession({
            amount:      balanceDue,
            description: `Watch Repair — Job ${jobNum}`,
            successUrl:  `${SITE_URL}/?payment=success&job=${encodeURIComponent(jobNum)}&amount=${encodeURIComponent(balanceDue)}`,
            cancelUrl:   `${SITE_URL}/?job=${encodeURIComponent(jobNum)}`,
            email:       customerEmail,
            metadata: {
              type:           'repair',
              job_number:     jobNum,
              row_index:      rowIndex,
              customer_name:  customerName,
              customer_email: customerEmail,
              customer_phone: customerPhone,
              brand,
              amount:         `SGD ${balanceDue.toFixed(2)}`
            }
          });
        } catch(e) {
          console.error('Stripe session error (repair):', e.message);
        }
      }

      console.log('Returning repair result for job:', jobNum);
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          type:            'repair',
          jobNumber:       jobNum,
          savRepairNo:     savNum,
          customerName,
          customerEmail,
          customerPhone,
          brand,
          status,
          quotationAmount,
          totalPaid,
          balanceDue,
          overpaid: totalPaid > quotationAmount && quotationAmount > 0,
          rowIndex,
          paymentLink,
          date:            (match[0] || '').trim(),
          request:         (match[6] || '').trim(),
          remark:          (match[13] || '').trim()
        })
      };
    }
  } catch(e) {
    console.error('Repair lookup error:', e.message);
    // Don't fall through to order lookup if repair threw a system error
    // (only fall through if no match was found, i.e. normal flow)
  }

  // ── 2. TRY ORDER LOOKUP ──
  try {
    const orderUrl  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Orders!A:L?key=${API_KEY}`;
    const orderRes  = await fetch(orderUrl);
    const orderData = await orderRes.json();
    if (!orderData.values) {
      // Orders tab doesn't exist or returned an error — not a connection issue
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'No record found. Please check your reference number and mobile number.' }) };
    }
    const oRows     = (orderData.values || []).slice(1);

    const oMatch = oRows.find(r => {
      const rowOrder   = (r[0] || '').trim().toUpperCase();
      const inputOrder = jobNumber.trim().toUpperCase();
      if (rowOrder !== inputOrder) return false;
      const phone = (r[3] || '').replace(/\D/g, '');
      return phone.slice(-4) === mobileLast4.trim();
    });

    if (oMatch) {
      const status       = (oMatch[8] || '').trim();
      const quote        = parseFloat((oMatch[7] || '0').toString().replace(/[^0-9.]/g,'')) || 0;
      const orderNo      = (oMatch[0] || '').trim();
      const name         = (oMatch[2] || '').trim();
      const email        = (oMatch[4] || '').trim();
      const phone        = (oMatch[3] || '').trim();
      const brand        = (oMatch[5] || '').trim();
      const item         = (oMatch[6] || '').trim();
      const rowIndex     = oRows.indexOf(oMatch) + 2;

      let paymentLink = null;
      if (status.toLowerCase() === 'quoted - pending payment' && quote >= 0.5) {
        try {
          console.log('Creating order Stripe session, key present:', !!(process.env.STRIPE_SECRET_KEY_TISSOT || process.env.STRIPE_SECRET_KEY));
          paymentLink = await createStripeSession({
            amount:      quote,
            description: `${brand} — ${item}`,
            successUrl:  `${SITE_URL}/?order_payment=success&order=${encodeURIComponent(orderNo)}&amount=${encodeURIComponent(quote)}`,
            cancelUrl:   `${SITE_URL}/?order=${encodeURIComponent(orderNo)}`,
            email,
            metadata: {
              type:           'order',
              orderNo,
              row_index:      rowIndex,
              customer_name:  name,
              customer_email: email,
              brand,
              item,
              amount:         `SGD ${quote.toFixed(2)}`
            }
          });
          console.log('Order payment link created:', !!paymentLink);
        } catch(e) {
          console.error('Stripe session error (order):', e.message);
        }
      }

      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          type:      'order',
          orderNo,
          name,
          email,
          phone,
          brand,
          item,
          quote,
          status,
          rowIndex,
          date:      (oMatch[1] || '').trim(),
          paidAt:    (oMatch[9] || '').trim(),
          paymentLink
        })
      };
    }
  } catch(e) {
    console.error('Order lookup error:', e.message);
  }

  // ── 3. NOT FOUND ──
  return {
    statusCode: 404,
    headers: HEADERS,
    body: JSON.stringify({ error: 'No record found. Please check your reference number and mobile number.' })
  };
};
