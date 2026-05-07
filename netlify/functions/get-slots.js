// get-slots.js
// Returns available half-hour slots for a given date
// Reads from Tissot Appointments Google Sheet
// Blocked slots: Status = "Blocked"
// Full slots: count of Confirmed bookings >= 2

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function generateSlots() {
  // 11:00am to 9:00pm (last slot), every 30 mins
  const slots = [];
  for (let h = 11; h <= 21; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 21 && m > 0) break;
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      slots.push(`${hh}:${mm}`);
    }
  }
  return slots; // 11:00, 11:30, ... 21:00
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  const date = event.queryStringParameters && event.queryStringParameters.date;
  if (!date) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing date' }) };

  const API_KEY  = process.env.GOOGLE_API_KEY;
  const SHEET_ID = process.env.SHEET_ID_TISSOT_APPOINTMENTS;

  if (!API_KEY || !SHEET_ID) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Missing configuration' }) };
  }

  try {
    // Read all bookings from sheet
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Appointments!A:I?key=${API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    const rows = (data.values || []).slice(1); // skip header

    const allSlots = generateSlots();

    // Count bookings and blocked slots per time on this date
    const confirmedCount = {};
    const blockedSlots   = new Set();

    rows.forEach(row => {
      const rowDate   = (row[0] || '').trim(); // Col A: Date (YYYY-MM-DD)
      const rowTime   = (row[1] || '').trim(); // Col B: Time (HH:MM)
      const rowStatus = (row[8] || '').trim(); // Col I: Status

      if (rowDate !== date) return;
      if (rowStatus === 'Blocked') {
        blockedSlots.add(rowTime);
      } else if (rowStatus === 'Confirmed') {
        confirmedCount[rowTime] = (confirmedCount[rowTime] || 0) + 1;
      }
    });

    const result = allSlots.map(slot => {
      const blocked = blockedSlots.has(slot);
      const count   = confirmedCount[slot] || 0;
      const full    = count >= 2;
      return { time: slot, available: !blocked && !full };
    });

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ slots: result }) };

  } catch (err) {
    console.error('get-slots error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Failed to fetch slots' }) };
  }
};
