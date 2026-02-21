/**
 * SMS Outbound Notification API
 * CRM calls this after sending an SMS to post notification to Teams
 * 
 * POST /api/sms-notify
 * Body: { to, body, contactName, sentBy }
 */

// Teams config (same as sms-webhook.js)
const TEAMS_CONFIG = {
  teamId: '3127241f-0d7c-4a8b-a86d-84ae2c068610',
  channelId: '19:d5bb20da579c4b0cb567b8938fb8e8fc@thread.tacv2',
  clientId: 'e9ea4d08-1047-4588-bf07-70aa7befa62f',
  tenantId: 'd64d2564-1908-42a5-a979-65cef52bd7c0',
};

/**
 * Get fresh Microsoft Graph access token
 */
async function getGraphToken() {
  const tokenUrl = `https://login.microsoftonline.com/${TEAMS_CONFIG.tenantId}/oauth2/v2.0/token`;
  
  const body = new URLSearchParams({
    client_id: TEAMS_CONFIG.clientId,
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
 * Main handler for outbound SMS notifications
 */
export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { to, body, contactName, sentBy = 'CRM' } = req.body;

    if (!to || !body) {
      return res.status(400).json({ error: 'Missing required fields: to, body' });
    }

    console.log(`📤 Outbound SMS to ${to}: ${body}`);

    // Build Teams notification
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

    // Post to Teams
    const result = await postToTeams(teamsMessage);

    return res.status(200).json({ 
      success: true, 
      messageId: result.id 
    });

  } catch (error) {
    console.error('Outbound SMS notify error:', error);
    return res.status(500).json({ 
      error: 'Failed to post notification',
      details: error.message 
    });
  }
}
