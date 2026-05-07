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

  const { jobNumber, mobileLast4 } = body;
  if (!jobNumber || !mobileLast4) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Job number and last 4 digits of mobile are required' }) };
  if (!/^\d{4}$/.test(mobileLast4)) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Please enter exactly 4 digits' }) };

  const API_KEY  = process.env.GOOGLE_API_KEY;
  const SHEET_ID = process.env.SHEET_ID;
  if (!API_KEY || !SHEET_ID) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server configuration error' }) };

  const range = 'Repair Job!A:P';
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;

  let rows;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const err = await response.text();
      console.error('Sheets API error:', err);
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Could not reach data source' }) };
    }
    const data = await response.json();
    rows = data.values || [];
  } catch (e) {
    console.error('Fetch error:', e);
    return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Could not reach data source' }) };
  }

  if (rows.length < 2) return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'No records found' }) };

  // Column index reference (0-based):
  // A=0 Date, B=1 Repair Job No., C=2 SAV Repair No., D=3 Name, E=4 Phone No
  // F=5 Email, G=6 Customer Request, H=7 Quotation Price
  // I=8 Quotation Y/N (written by system: Y=paid, N=declined)
  // J=9 Warranty Y/N, K=10 Invoice No., L=11 SAV Tax Invoice No.
  // M=12 Collection Date, N=13 Remark, O=14 Status, P=15 Brand

  const normaliseJob = s => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
  const searchJob    = normaliseJob(jobNumber);

  let matchRowIndex = -1;
  const match = rows.slice(1).find((row, i) => {
    const rowJob   = normaliseJob(row[1] || '');
    const rowPhone = String(row[4] || '').replace(/\D/g, '');
    const last4    = rowPhone.slice(-4);
    if (rowJob === searchJob && last4 === mobileLast4) { matchRowIndex = i + 2; return true; }
    return false;
  });

  if (!match) return {
    statusCode: 404, headers: HEADERS,
    body: JSON.stringify({ error: 'No matching record found. Please check your job number and mobile digits.' })
  };

  const warrantyRaw  = String(match[9]  || '').trim().toUpperCase();
  const warrantyYes  = warrantyRaw === 'Y' || warrantyRaw === 'YES';
  const quotationAmt = match[7]  ? String(match[7]).trim()  : null;
  const status       = match[14] ? String(match[14]).trim() : 'Pending';
  const collectionDate = match[12] ? String(match[12]).trim() : null;
  const brand        = match[15] ? String(match[15]).trim() : null;
  const customerEmail = match[5] ? String(match[5]).trim()  : null;
  const customerName  = match[3] ? String(match[3]).trim()  : null;
  const remark        = match[13] ? String(match[13]).trim() : null;

  // Generate Stripe payment link when status is quotation pending payment
  let paymentLink = null;
  const statusLower = status.toLowerCase();

  if (statusLower === 'quotation; pending payment' && quotationAmt) {
    const stripeKey = brand && brand.toLowerCase() === 'tissot'
      ? process.env.STRIPE_SECRET_KEY_TISSOT
      : null;

    if (stripeKey) {
      try {
        const amountCents = Math.round(parseFloat(quotationAmt.replace(/[^0-9.]/g, '')) * 100);
        if (amountCents > 0) {
          const stripeRes = await fetch('https://api.stripe.com/v1/payment_links', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${stripeKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              'line_items[0][price_data][currency]': 'sgd',
              'line_items[0][price_data][product_data][name]': `Watch Repair — Job ${match[1] || jobNumber}`,
              'line_items[0][price_data][product_data][description]': `Authorised repair service for ${customerName || 'customer'}`,
              'line_items[0][price_data][unit_amount]': String(amountCents),
              'line_items[0][quantity]': '1',
              'metadata[job_number]': String(match[1] || jobNumber),
              'metadata[row_index]': String(matchRowIndex),
              'metadata[brand]': String(brand || ''),
              'metadata[customer_name]': String(customerName || ''),
              'metadata[customer_email]': String(customerEmail || ''),
              'metadata[amount]': String(quotationAmt),
              'after_completion[type]': 'redirect',
              'after_completion[redirect][url]': `https://${process.env.SITE_URL || 'regencegroup.com'}/?payment=success&job=${encodeURIComponent(match[1] || jobNumber)}&amount=${encodeURIComponent(quotationAmt)}`
            }).toString()
          });
          const stripeData = await stripeRes.json();
          if (stripeData.url) paymentLink = stripeData.url;
        }
      } catch (e) {
        console.error('Stripe error:', e);
      }
    }
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      jobNumber:       match[1]  || '',
      savRepairNo:     match[2]  || '',
      customerName,
      date:            match[0]  || '',
      status,
      warranty:        warrantyYes,
      quotationAmount: quotationAmt || null,
      collectionDate,
      remark,
      brand,
      paymentLink,
      rowIndex:        matchRowIndex
    })
  };
};
