/**
 * Internal-Only Webhook for Metro Bot (Web)
 * ALWAYS runs in Director of Operations mode - no PIN required
 * Only for internal use (Patrick's web widget)
 */

// Import handlers from main webhook
import mainHandler from './vapi-webhook.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message } = req.body;

    // Force internal/director mode by modifying the message
    // Add a flag that the main handler can check
    if (message) {
      message._internalMode = true;
    }

    // For tool-calls, process directly without mode restrictions
    if (message?.type === 'tool-calls' || message?.type === 'function-call') {
      // Import handlers directly and bypass mode checks
      const handlers = await getHandlers();
      
      if (message.type === 'tool-calls') {
        const toolCalls = message.toolCallList || message.toolWithToolCallList || [];
        const results = [];
        
        for (const tc of toolCalls) {
          const id = tc.id || tc.toolCall?.id || 'unknown';
          const name = tc.name || tc.function?.name || tc.toolCall?.function?.name;
          const args = getArgs(tc);
          
          console.log(`[INTERNAL] Tool: ${name}`, args);
          
          const fn = handlers[name];
          const result = fn ? await fn(args) : { error: `Unknown tool: ${name}` };
          results.push({ toolCallId: id, result: JSON.stringify(result) });
        }
        
        return res.status(200).json({ results });
      }
      
      if (message.type === 'function-call') {
        const fc = message.functionCall;
        const name = fc.name || fc.function?.name;
        const args = fc.parameters || fc.arguments || {};
        
        const fn = handlers[name];
        const result = fn ? await fn(typeof args === 'string' ? JSON.parse(args) : args) : { error: `Unknown: ${name}` };
        return res.status(200).json({ results: [{ toolCallId: fc.id, result: JSON.stringify(result) }] });
      }
    }

    return res.status(200).json({});
  } catch (error) {
    console.error('[INTERNAL] Error:', error);
    return res.status(200).json({ 
      results: [{ toolCallId: 'error', result: JSON.stringify({ error: error.message }) }] 
    });
  }
}

function getArgs(tc) {
  const args = tc.arguments || tc.function?.arguments || tc.toolCall?.function?.arguments || tc.parameters || {};
  return typeof args === 'string' ? JSON.parse(args) : args;
}

// Dynamically import handlers from main webhook
async function getHandlers() {
  // CRM config
  const CRM_CONFIG = {
    url: 'https://qgtjpdviboxxlrivwcan.supabase.co',
    key: process.env.SUPABASE_CRM_KEY,
  };

  // Email config
  const EMAIL_CONFIG = {
    clientId: "e9ea4d08-1047-4588-bf07-70aa7befa62f",
    tenantId: "d64d2564-1908-42a5-a979-65cef52bd7c0",
    authority: "https://login.microsoftonline.com/d64d2564-1908-42a5-a979-65cef52bd7c0",
    refreshToken: process.env.MS_REFRESH_TOKEN,
  };

  // Get Graph token
  async function getGraphToken() {
    if (!EMAIL_CONFIG.refreshToken) {
      throw new Error('No MS_REFRESH_TOKEN configured');
    }

    const tokenUrl = `${EMAIL_CONFIG.authority}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: EMAIL_CONFIG.clientId,
      grant_type: 'refresh_token',
      refresh_token: EMAIL_CONFIG.refreshToken,
      scope: 'Mail.ReadWrite Calendars.ReadWrite User.Read offline_access'
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(`Token failed: ${data.error_description || data.error}`);
    }
    return data.access_token;
  }

  // Graph request helper
  async function graphRequest(endpoint, token, method = 'GET', body = null) {
    const options = {
      method,
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    if (body) options.body = JSON.stringify(body);
    
    const response = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, options);
    if (method === 'DELETE') return { success: response.ok };
    return response.json();
  }

  // Email cache
  let cachedEmails = [];

  return {
    async triage_inbox(args) {
      try {
        const token = await getGraphToken();
        const result = await graphRequest(
          '/me/mailFolders/inbox/messages?$top=10&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,isRead,importance,bodyPreview',
          token
        );
        
        if (!result.value || result.value.length === 0) {
          return { summary: "Your inbox is empty." };
        }

        cachedEmails = result.value;
        const unread = result.value.filter(m => !m.isRead);
        
        let summary = `Your business inbox has ${result.value.length} recent emails. `;
        if (unread.length > 0) summary += `${unread.length} unread. `;
        
        const emailList = result.value.slice(0, 5).map((m, i) => {
          const from = m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Unknown';
          return `${i + 1}. ${from}: ${m.subject?.substring(0, 50)}`;
        });
        
        summary += `Here they are: ${emailList.join('. ')}. Want me to read any?`;
        
        return { totalCount: result.value.length, unreadCount: unread.length, summary };
      } catch (error) {
        console.error('triage_inbox error:', error);
        return { error: error.message, summary: `Couldn't access inbox: ${error.message}` };
      }
    },

    async check_calendar(args) {
      try {
        const token = await getGraphToken();
        const daysAhead = args?.daysAhead || 7;
        const now = new Date();
        const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
        
        const result = await graphRequest(
          `/me/calendarView?startDateTime=${now.toISOString()}&endDateTime=${end.toISOString()}&$orderby=start/dateTime&$top=10&$select=subject,start,end,location,organizer`,
          token
        );
        
        if (!result.value || result.value.length === 0) {
          return { summary: `No events in the next ${daysAhead} days.` };
        }
        
        const events = result.value.map(e => {
          const start = new Date(e.start.dateTime + 'Z');
          const day = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          return `${day} at ${time}: ${e.subject}`;
        });
        
        return { 
          eventCount: result.value.length,
          summary: `You have ${result.value.length} events coming up: ${events.join('. ')}`
        };
      } catch (error) {
        console.error('check_calendar error:', error);
        return { error: error.message, summary: `Couldn't access calendar: ${error.message}` };
      }
    },

    async lookup_contact(args) {
      try {
        if (!CRM_CONFIG.key) {
          return { summary: "CRM not configured." };
        }

        const { firstName, lastName, company, phone } = args || {};
        let query = [];
        
        if (firstName) query.push(`first_name.ilike.%${firstName}%`);
        if (lastName) query.push(`last_name.ilike.%${lastName}%`);
        if (company) query.push(`company.ilike.%${company}%`);
        if (phone) query.push(`phone.ilike.%${phone}%`);
        
        if (query.length === 0) {
          return { summary: "Need a name, company, or phone to search." };
        }

        const url = `${CRM_CONFIG.url}/rest/v1/contacts?${query.join('&')}&select=id,first_name,last_name,company,email,phone,notes&limit=5`;
        
        const response = await fetch(url, {
          headers: {
            'apikey': CRM_CONFIG.key,
            'Authorization': `Bearer ${CRM_CONFIG.key}`
          }
        });
        
        const contacts = await response.json();
        
        if (!contacts.length) {
          return { summary: "No contacts found matching that search." };
        }
        
        const list = contacts.map(c => 
          `${c.first_name} ${c.last_name}${c.company ? ` at ${c.company}` : ''}`
        ).join(', ');
        
        return { 
          count: contacts.length,
          contacts,
          summary: `Found ${contacts.length}: ${list}`
        };
      } catch (error) {
        console.error('lookup_contact error:', error);
        return { error: error.message, summary: `CRM error: ${error.message}` };
      }
    },

    async check_mission_control(args) {
      try {
        const filter = args?.filter || 'in-progress';
        const url = `https://mpt-mission-control.vercel.app/api/tasks?status=${filter}&limit=10`;
        
        const response = await fetch(url);
        const tasks = await response.json();
        
        if (!tasks.length) {
          return { summary: `No tasks with status: ${filter}` };
        }
        
        const list = tasks.slice(0, 5).map(t => t.title?.substring(0, 50)).join('. ');
        
        return {
          count: tasks.length,
          summary: `${tasks.length} tasks ${filter}: ${list}`
        };
      } catch (error) {
        console.error('check_mission_control error:', error);
        return { error: error.message, summary: `Mission Control error: ${error.message}` };
      }
    },

    async get_mpt_info(args) {
      return {
        summary: "Metro Point Technology offers: System Optimization, Integration & Automation, Custom Development, and AI Solutions. Our flagship product is AMS-App for insurance agencies."
      };
    }
  };
}
