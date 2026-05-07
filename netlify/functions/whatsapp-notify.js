const {
  notifyTeam,
  msgTeamReadyForCollection,
  msgCustomerNoIntervention,
  msgCustomerWarranty,
  msgCustomerQuotationPending,
  msgCustomerRepairBegun,
  msgCustomerQuotationRejected,
  msgCustomerReadyForCollection,
  msgCustomerCollected,
  sendWhatsApp
} = require('./whatsapp');

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

  const {
    status,
    jobNumber,
    savNumber,
    customerName,
    customerPhone,
    brand,
    quotationAmount
  } = body;

  if (!status || !jobNumber) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const rawStatus = (status || '').trim().toLowerCase();
  const siteUrl   = process.env.SITE_URL || 'regencegroup.com';

  try {
    switch (rawStatus) {

      case 'no intervention required':
        if (customerPhone) {
          await sendWhatsApp(customerPhone, msgCustomerNoIntervention({ jobNumber, customerName }));
        }
        break;

      case 'repair processed under warranty; no payment required':
      case 'repair processed under warranty':
        if (customerPhone) {
          await sendWhatsApp(customerPhone, msgCustomerWarranty({ jobNumber, customerName }));
        }
        break;

      case 'quotation; pending payment':
        if (customerPhone) {
          await sendWhatsApp(customerPhone, msgCustomerQuotationPending({
            jobNumber, customerName, amount: quotationAmount, siteUrl
          }));
        }
        break;

      case 'quotation accepted; repair begun':
        if (customerPhone) {
          await sendWhatsApp(customerPhone, msgCustomerRepairBegun({ jobNumber, customerName }));
        }
        break;

      case 'quotation rejected; return without repair':
        if (customerPhone) {
          await sendWhatsApp(customerPhone, msgCustomerQuotationRejected({ jobNumber, customerName }));
        }
        break;

      case 'ready for collection':
        // Notify team
        await notifyTeam(msgTeamReadyForCollection({ jobNumber, savNumber, customerName, brand }));
        // Notify customer
        if (customerPhone) {
          await sendWhatsApp(customerPhone, msgCustomerReadyForCollection({ jobNumber, customerName, brand }));
        }
        break;

      case 'collected':
        if (customerPhone) {
          await sendWhatsApp(customerPhone, msgCustomerCollected({ jobNumber, customerName }));
        }
        break;

      default:
        console.log(`No WhatsApp action for status: ${status}`);
    }

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error('WhatsApp notify error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Failed to send WhatsApp' }) };
  }
};
