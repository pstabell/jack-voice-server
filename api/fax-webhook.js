/**
 * Sinch Fax Webhook Handler
 * Receives fax status updates and sends email notifications
 */

// Supabase config for MPT-Accounting
const SUPABASE_URL = process.env.SUPABASE_URL_ACCOUNTING || 'https://pezgfalkjoucwnfytubb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY_ACCOUNTING;

// Teams/Email config
const TEAMS_CONFIG = {
  tenantId: 'd64d2564-1908-42a5-a979-65cef52bd7c0',
  clientId: 'e9ea4d08-1047-4588-bf07-70aa7befa62f',
};

const NOTIFICATION_EMAIL = 'Support@MetroPointTech.com';

/**
 * Get Microsoft Graph access token for sending email
 */
async function getGraphToken() {
  const tokenUrl = `https://login.microsoftonline.com/${TEAMS_CONFIG.tenantId}/oauth2/v2.0/token`;
  
  const body = new URLSearchParams({
    client_id: TEAMS_CONFIG.clientId,
    grant_type: 'refresh_token',
    refresh_token: process.env.MS_REFRESH_TOKEN,
    scope: 'Mail.Send User.Read offline_access'
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Send email notification via Microsoft Graph
 */
async function sendEmailNotification(faxRecord, sinchStatus) {
  const token = await getGraphToken();
  
  const statusEmoji = sinchStatus === 'COMPLETED' ? '✅' : '❌';
  const subject = `${statusEmoji} Fax ${sinchStatus}: ${faxRecord.title}`;
  
  const body = `
    <h2>${statusEmoji} Fax ${sinchStatus}</h2>
    <p><strong>Title:</strong> ${faxRecord.title}</p>
    <p><strong>Recipient:</strong> ${faxRecord.recipient}</p>
    <p><strong>File:</strong> ${faxRecord.filename || 'N/A'}</p>
    ${faxRecord.notes ? `<p><strong>Notes:</strong> ${faxRecord.notes}</p>` : ''}
    <p><strong>Fax ID:</strong> ${faxRecord.sinch_fax_id}</p>
    <p><strong>Status:</strong> ${sinchStatus}</p>
    <hr>
    <p><em>This notification was sent automatically by MPT-Accounting Fax System.</em></p>
  `;

  const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: body },
        toRecipients: [{ emailAddress: { address: NOTIFICATION_EMAIL } }]
      },
      saveToSentItems: true
    })
  });

  if (!response.ok) {
    throw new Error(`Email send failed: ${await response.text()}`);
  }
  
  return true;
}

/**
 * Get fax record from Supabase
 */
async function getFaxRecord(sinchFaxId) {
  if (!SUPABASE_KEY) return null;
  
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/acc_fax_tracking?sinch_fax_id=eq.${sinchFaxId}&limit=1`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  
  if (response.ok) {
    const records = await response.json();
    return records[0] || null;
  }
  return null;
}

/**
 * Update fax record in Supabase
 */
async function updateFaxRecord(sinchFaxId, status, notified = false) {
  if (!SUPABASE_KEY) return false;
  
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/acc_fax_tracking?sinch_fax_id=eq.${sinchFaxId}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        status,
        notified,
        updated_at: new Date().toISOString()
      })
    }
  );
  
  return response.ok;
}

/**
 * Main webhook handler
 */
export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Sinch sends webhook events in this format
    const event = req.body;
    
    console.log('📠 Sinch Fax Webhook received:', JSON.stringify(event));
    
    // Extract fax details from Sinch event
    const faxId = event.fax_id || event.id;
    const status = event.status || event.event_type;
    
    if (!faxId) {
      console.log('No fax ID in webhook event');
      return res.status(200).json({ received: true, action: 'no_fax_id' });
    }
    
    // Only process completion/failure events
    const isFinal = ['COMPLETED', 'FAILED', 'completed', 'failed'].includes(status);
    
    if (!isFinal) {
      console.log(`Fax ${faxId} status update: ${status} (not final)`);
      // Still update status in DB
      await updateFaxRecord(faxId, status.toUpperCase());
      return res.status(200).json({ received: true, action: 'status_updated' });
    }
    
    // Get local fax record
    const faxRecord = await getFaxRecord(faxId);
    
    if (!faxRecord) {
      console.log(`No local record for fax ${faxId}`);
      return res.status(200).json({ received: true, action: 'no_local_record' });
    }
    
    // Update status
    const normalizedStatus = status.toUpperCase();
    await updateFaxRecord(faxId, normalizedStatus);
    
    // Send email notification if requested and not already sent
    if (faxRecord.notify_email && !faxRecord.notified) {
      try {
        await sendEmailNotification(faxRecord, normalizedStatus);
        await updateFaxRecord(faxId, normalizedStatus, true);
        console.log(`✅ Email notification sent for fax ${faxId}`);
      } catch (emailError) {
        console.error(`Failed to send email for fax ${faxId}:`, emailError);
      }
    }
    
    return res.status(200).json({ 
      received: true, 
      action: 'processed',
      fax_id: faxId,
      status: normalizedStatus,
      notified: faxRecord.notify_email
    });

  } catch (error) {
    console.error('Fax webhook error:', error);
    // Return 200 to prevent Sinch retries
    return res.status(200).json({ received: true, error: error.message });
  }
}
