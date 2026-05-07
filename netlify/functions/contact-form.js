async function sendEmail(to, subject, html) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) { console.log('No RESEND_API_KEY — skipping email'); return; }
  const fromDomain = process.env.EMAIL_FROM_DOMAIN || 'onboarding@resend.dev';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Regence Group <${fromDomain}>`, to: [to], subject, html })
  });
  const data = await res.json();
  if (!res.ok) console.error('Resend error:', data);
}

function teamEmail({ name, company, email, phone, topic, message }) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#FDFCFA;border:1px solid #EDE9E0;">
    <div style="height:3px;background:linear-gradient(90deg,#B8A06A,#D4BC8A,#B8A06A);"></div>
    <div style="padding:32px 40px 24px;">
      <p style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#B8A06A;margin:0 0 10px;">New Enquiry</p>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#1A1814;margin:0 0 6px;line-height:1.2;">Contact Form Submission</h1>
      <p style="font-size:13px;color:#7A7568;margin:0 0 28px;line-height:1.7;">A new enquiry has been submitted via regencegroup.com.</p>
      <div style="width:32px;height:1px;background:#B8A06A;margin-bottom:28px;opacity:0.5;"></div>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;width:36%;">Name</td>
          <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;">${name || '—'}</td>
        </tr>
        <tr>
          <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Company</td>
          <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;">${company || '—'}</td>
        </tr>
        <tr>
          <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Email</td>
          <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#B8A06A;font-size:13px;"><a href="mailto:${email}" style="color:#B8A06A;text-decoration:none;">${email || '—'}</a></td>
        </tr>
        <tr>
          <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Phone</td>
          <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;">${phone || '—'}</td>
        </tr>
        <tr>
          <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#7A7568;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Topic</td>
          <td style="padding:11px 0;border-bottom:1px solid #EDE9E0;color:#1A1814;font-size:13px;font-weight:bold;">${topic || '—'}</td>
        </tr>
      </table>
      <div style="margin-top:24px;padding:20px 24px;background:#F5F2EC;border-left:2px solid #B8A06A;">
        <p style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#B8A06A;margin:0 0 10px;">Message</p>
        <p style="font-size:13px;color:#3D3930;line-height:1.85;margin:0;white-space:pre-wrap;">${message || '—'}</p>
      </div>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #EDE9E0;">
      <p style="font-size:11px;color:#B8A06A;letter-spacing:0.15em;text-transform:uppercase;margin:0;">Regence Group · Contact System</p>
    </div>
  </div>`;
}

function autoReplyEmail({ name }) {
  const firstName = (name || '').split(' ')[0] || 'there';
  return `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#FDFCFA;border:1px solid #EDE9E0;">
    <div style="height:3px;background:linear-gradient(90deg,#B8A06A,#D4BC8A,#B8A06A);"></div>
    <div style="padding:40px 40px 32px;text-align:center;background:#F5F2EC;border-bottom:1px solid #EDE9E0;">
      <p style="font-size:10px;letter-spacing:0.35em;text-transform:uppercase;color:#B8A06A;margin:0 0 16px;">Regence Group</p>
      <h1 style="font-family:Georgia,serif;font-size:30px;font-weight:300;color:#1A1814;margin:0;line-height:1.2;">Thank you, ${firstName}.</h1>
    </div>
    <div style="padding:36px 40px;">
      <p style="font-size:14px;color:#3D3930;line-height:1.9;margin:0 0 20px;">We have received your enquiry and appreciate you taking the time to reach out to us.</p>
      <p style="font-size:14px;color:#3D3930;line-height:1.9;margin:0 0 20px;">A member of our team will review your message and respond to you personally. We endeavour to reply within one business day.</p>
      <div style="width:32px;height:1px;background:#B8A06A;margin:28px 0;opacity:0.6;"></div>
      <p style="font-size:13px;color:#7A7568;line-height:1.85;margin:0;">In the meantime, you are welcome to learn more about our distributed brands and services at <a href="https://regencegroup.com" style="color:#B8A06A;text-decoration:none;">regencegroup.com</a>.</p>
    </div>
    <div style="padding:24px 40px;background:#F5F2EC;border-top:1px solid #EDE9E0;">
      <p style="font-size:13px;color:#1A1814;font-family:Georgia,serif;margin:0 0 4px;">Regence Group</p>
      <p style="font-size:11px;color:#7A7568;margin:0;letter-spacing:0.05em;">Exclusive Regional Distributor · Southeast Asia &amp; Indian Ocean</p>
    </div>
  </div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Parse form data — Netlify sends as application/x-www-form-urlencoded
    const params = new URLSearchParams(event.body);
    const name    = params.get('name')    || '';
    const company = params.get('company') || '';
    const email   = params.get('email')   || '';
    const phone   = params.get('phone')   || '';
    const topic   = params.get('topic')   || '';
    const message = params.get('message') || '';

    const OPS_EMAIL = process.env.CONTACT_FORM_EMAIL || 'ops@regencegroup.com';

    // Send team notification
    await sendEmail(
      OPS_EMAIL,
      `New Enquiry: ${topic || 'Contact Form'} — ${name}`,
      teamEmail({ name, company, email, phone, topic, message })
    );

    // Send auto-reply to submitter
    if (email) {
      await sendEmail(
        email,
        'Your enquiry has been received — Regence Group',
        autoReplyEmail({ name })
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('contact-form error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process enquiry' })
    };
  }
};
