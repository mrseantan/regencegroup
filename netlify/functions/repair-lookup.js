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
    'expires_at':                              Math.floor(Date.now() / 1000) + 3600,
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
  if (!res.ok) throw new Error(data.error?.message || 'Stripe session creation failed');
  return data.url;
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
  const SHEET_ID     = process.env.SHEET_ID;         // Repair sheet
  const SITE_URL     = process.env.SITE_URL || 'https://regencegroup.com';

  // ── 1. TRY REPAIR LOOKUP ──
  try {
    const repairUrl  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Repair%20Job!A:P?key=${API_KEY}`;
    const repairRes  = await fetch(repairUrl);
    const repairData = await repairRes.json();
    const rows       = (repairData.values || []).slice(1);

    const match = rows.find(r => {
      const rowJob    = (r[1] || '').trim().toUpperCase();
      const inputJob  = jobNumber.trim().toUpperCase();
      if (rowJob !== inputJob) return false;
      const phone     = (r[4] || '').replace(/\D/g, '');
      return phone.slice(-4) === mobileLast4.trim();
    });

    if (match) {
      const status          = (match[14] || '').trim();
      const quotationAmount = parseFloat((match[7] || '0').toString().replace(/[^0-9.]/g, '')) || 0;
      const customerName    = (match[3] || '').trim();
      const customerEmail   = (match[5] || '').trim();
      const customerPhone   = (match[4] || '').trim();
      const brand           = (match[15] || '').trim();
      const rowIndex        = rows.indexOf(match) + 2;
      const jobNum          = (match[1] || '').trim();
      const savNum          = (match[2] || '').trim();

      let paymentLink = null;
      if (status.toLowerCase() === 'quotation; pending payment' && quotationAmount >= 0.5) {
        try {
          paymentLink = await createStripeSession({
            amount:      quotationAmount,
            description: `Watch Repair — Job ${jobNum}`,
            successUrl:  `${SITE_URL}/?payment=success&job=${encodeURIComponent(jobNum)}&amount=${encodeURIComponent(quotationAmount)}`,
            cancelUrl:   `${SITE_URL}/?job=${encodeURIComponent(jobNum)}`,
            email:       customerEmail,
            metadata: {
              type:           'repair',
              job_number:     jobNum,
              row_index:      rowIndex,
              customer_name:  customerName,
              customer_email: customerEmail,
              brand,
              amount:         `SGD ${quotationAmount.toFixed(2)}`
            }
          });
        } catch(e) {
          console.error('Stripe session error (repair):', e.message);
        }
      }

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
  }

  // ── 2. TRY ORDER LOOKUP ──
  try {
    const orderUrl  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Orders!A:L?key=${API_KEY}`;
    const orderRes  = await fetch(orderUrl);
    const orderData = await orderRes.json();
    const oRows     = (orderData.values || []).slice(1);

    const oMatch = oRows.find(r => {
      const rowOrder  = (r[0] || '').trim().toUpperCase();
      const inputOrder = jobNumber.trim().toUpperCase();
      if (rowOrder !== inputOrder) return false;
      const phone = (r[6] || '').replace(/\D/g, '');
      return phone.slice(-4) === mobileLast4.trim();
    });

    if (oMatch) {
      const status       = (oMatch[8] || '').trim();
      const quote        = parseFloat((oMatch[4] || '0').toString().replace(/[^0-9.]/g, '')) || 0;
      const orderNo      = (oMatch[0] || '').trim();
      const name         = (oMatch[5] || '').trim();
      const email        = (oMatch[7] || '').trim();
      const phone        = (oMatch[6] || '').trim();
      const brand        = (oMatch[2] || '').trim();
      const item         = (oMatch[3] || '').trim();
      const rowIndex     = oRows.indexOf(oMatch) + 2;

      let paymentLink = null;
      if (status.toLowerCase() === 'quoted - pending payment' && quote >= 0.5) {
        try {
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
