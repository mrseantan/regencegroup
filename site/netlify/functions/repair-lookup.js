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

  // Read columns A through O (Date through Status)
  const range    = 'Sheet1!A:O';
  const url      = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${API_KEY}`;

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

  // Row 0 is header — skip it
  // Columns (0-indexed):
  // A=0  Date
  // B=1  Repair Job No.
  // C=2  SAV Repair No.
  // D=3  Name
  // E=4  Phone No
  // F=5  Email
  // G=6  Customer Request
  // H=7  Quotation Price
  // I=8  Quotation Y/N
  // J=9  Warranty Y/N
  // K=10 Invoice No.
  // L=11 SAV Tax Invoice No.
  // M=12 Collection Date
  // N=13 Remark
  // O=14 Status

  const normaliseJob = s => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
  const searchJob    = normaliseJob(jobNumber);

  const match = rows.slice(1).find(row => {
    const rowJob    = normaliseJob(row[1] || '');
    const rowPhone  = String(row[4] || '').replace(/\D/g, ''); // digits only
    const last4     = rowPhone.slice(-4);
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

  const quotationAmt = match[7] ? String(match[7]).trim() : null;
  const status       = match[14] ? String(match[14]).trim() : 'Pending';
  const collectionDate = match[12] ? String(match[12]).trim() : null;

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      jobNumber:      match[1] || '',
      savRepairNo:    match[2] || '',
      customerName:   match[3] || '',
      date:           match[0] || '',
      status:         status,
      warranty:       warrantyYes,
      hasQuotation:   hasQuote,
      quotationAmount: hasQuote && quotationAmt ? quotationAmt : null,
      collectionDate: collectionDate,
      remark:         match[13] || ''
    })
  };
};
