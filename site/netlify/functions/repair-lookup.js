exports.handler = async function(event) {
  const HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  const { jobNumber, mobileLast4 } = body;

  if (!jobNumber || !mobileLast4) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Job number and last 4 digits of mobile are required' }) };
  }

  if (!/^\d{4}$/.test(mobileLast4)) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Please enter exactly 4 digits' }) };
  }

  const API_KEY  = process.env.GOOGLE_API_KEY;
  const SHEET_ID = process.env.SHEET_ID;

  if (!API_KEY || !SHEET_ID) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  const range = 'Repair Job!A:O';
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

  if (rows.length < 2) {
    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'No records found' }) };
  }

  const normaliseJob = s => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
  const searchJob    = normaliseJob(jobNumber);

  const match = rows.slice(1).find(row => {
    const rowJob   = normaliseJob(row[1] || '');
    const rowPhone = String(row[4] || '').replace(/\D/g, '');
    const last4    = rowPhone.slice(-4);
    return rowJob === searchJob && last4 === mobileLast4;
  });

  if (!match) {
    return {
      statusCode: 404,
      headers: HEADERS,
      body: JSON.stringify({ error: 'No matching record found. Please check your job number and mobile digits.' })
    };
  }

  const warrantyRaw  = String(match[9] || '').trim().toUpperCase();
  const warrantyYes  = warrantyRaw === 'Y' || warrantyRaw === 'YES';
  const quotationRaw = String(match[8] || '').trim().toUpperCase();
  const hasQuote     = quotationRaw === 'Y' || quotationRaw === 'YES';
