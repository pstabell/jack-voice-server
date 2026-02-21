/**
 * SMS Webhook Handler
 * Receives Twilio SMS webhooks and posts notifications to Teams channel
 * ONE-WAY: Teams is read-only, no replies go back to SMS
 */

// Teams config
const TEAMS_CONFIG = {
  teamId: '3127241f-0d7c-4a8b-a86d-84ae2c068610',
  channelId: '19:d5bb20da579c4b0cb567b8938fb8e8fc@thread.tacv2',
  clientId: 'e9ea4d08-1047-4588-bf07-70aa7befa62f',
  tenantId: 'd64d2564-1908-42a5-a979-65cef52bd7c0',
};

// CRM config for contact lookup
const CRM_CONFIG = {
  url: 'https://qgtjpdviboxxlrivwcan.supabase.co',
  key: process.env.SUPABASE_CRM_KEY,
};

/**
 * Get fresh Microsoft Graph access token
 */
async function getGraphToken() {
  const tokenUrl = `https://login.microsoftonline.com/${TEAMS_CONFIG.tenantId}/oauth2/v2.0/token`;
  
  const body = new URLSearchParams({
    client_id: TEAMS_CONFIG.clientId,
    client_secret: process.env.MS_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: process.env.MS_REFRESH_TOKEN,
    scope: 'ChannelMessage.Send User.Read offline_access'
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Look up contact in CRM by phone number
 */
async function lookupContact(phone) {
  if (!CRM_CONFIG.key) return null;
  
  // Normalize phone number (remove +1, spaces, dashes)
  const normalized = phone.replace(/[\s\-\+]/g, '').replace(/^1/, '');
  
  try {
    const response = await fetch(
      `${CRM_CONFIG.url}/rest/v1/contacts?or=(phone.ilike.%${normalized}%,phone.ilike.%${phone}%)&limit=1`,
      {
        headers: {
          'apikey': CRM_CONFIG.key,
          'Authorization': `Bearer ${CRM_CONFIG.key}`
        }
      }
    );
    
    if (response.ok) {
      const contacts = await response.json();
      return contacts[0] || null;
    }
  } catch (e) {
    console.error('CRM lookup error:', e);
  }
  return null;
}

/**
 * Post message to Teams channel
 */
async function postToTeams(message) {
  const token = await getGraphToken();
  
  const url = `https://graph.microsoft.com/v1.0/teams/${TEAMS_CONFIG.teamId}/channels/${encodeURIComponent(TEAMS_CONFIG.channelId)}/messages`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      body: {
        contentType: 'html',
        content: message
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Teams post failed: ${error}`);
  }

  return await response.json();
}

/**
 * Format phone number for display
 */
function formatPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  }
  return phone;
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
    // Twilio sends form-encoded data
    const {
      From,           // Sender phone number
      To,             // Your Twilio number
      Body,           // Message text
      MessageSid,     // Unique message ID
      NumMedia,       // Number of media attachments
    } = req.body;

    console.log(`📥 Inbound SMS from ${From}: ${Body}`);

    // Look up contact in CRM
    const contact = await lookupContact(From);
    
    // Build Teams notification
    const fromDisplay = contact 
      ? `<strong>${contact.first_name} ${contact.last_name}</strong> (${formatPhone(From)})`
      : `<strong>${formatPhone(From)}</strong>`;
    
    const contactLink = contact
      ? `<br/><a href="https://mpt-crm.streamlit.app/?contact=${contact.id}">View in CRM</a>`
      : '';
    
    const mediaNote = NumMedia > 0 
      ? `<br/><em>📎 ${NumMedia} attachment(s)</em>` 
      : '';

    const teamsMessage = `
      <div style="border-left: 4px solid #0078d4; padding-left: 12px; margin: 8px 0;">
        <strong>📥 Inbound SMS</strong><br/>
        From: ${fromDisplay}<br/>
        To: ${formatPhone(To)}<br/>
        <hr style="margin: 8px 0; border: none; border-top: 1px solid #ddd;"/>
        ${Body}
        ${mediaNote}
        ${contactLink}
      </div>
    `;

    // Post to Teams
    await postToTeams(teamsMessage);

    // Respond to Twilio (empty TwiML = no auto-reply)
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  } catch (error) {
    console.error('SMS webhook error:', error);
    // Still return 200 to Twilio to prevent retries
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
}

/**
 * Utility: Post outbound SMS notification to Teams
 * Call this from CRM when sending SMS
 */
export async function notifyOutboundSMS({ to, body, contactName, sentBy = 'CRM' }) {
  const toDisplay = contactName 
    ? `<strong>${contactName}</strong> (${formatPhone(to)})`
    : `<strong>${formatPhone(to)}</strong>`;

  const teamsMessage = `
    <div style="border-left: 4px solid #28a745; padding-left: 12px; margin: 8px 0;">
      <strong>📤 Outbound SMS</strong> <em>(sent by ${sentBy})</em><br/>
      To: ${toDisplay}<br/>
      <hr style="margin: 8px 0; border: none; border-top: 1px solid #ddd;"/>
      ${body}
    </div>
  `;

  return await postToTeams(teamsMessage);
}
