/**
 * Jack Metro Bot - Vapi Webhook Handler
 * Director of Operations with dual-mode system prompt
 * - Sales/Service mode (default, customer-facing)
 * - Full Director mode (PIN-protected, full access)
 */

import { createModeHandler } from './mode-handler.js';

// CRM Supabase config
const CRM_CONFIG = {
  url: 'https://qgtjpdviboxxlrivwcan.supabase.co',
  key: process.env.SUPABASE_CRM_KEY,
};

// Email configs for business and personal
const EMAIL_CONFIGS = {
  business: {
    clientId: "e9ea4d08-1047-4588-bf07-70aa7befa62f",
    tenantId: "d64d2564-1908-42a5-a979-65cef52bd7c0",
    authority: "https://login.microsoftonline.com/d64d2564-1908-42a5-a979-65cef52bd7c0",
    refreshToken: process.env.MS_REFRESH_TOKEN,
  },
  personal: {
    clientId: "6914fea1-7b20-49e6-8932-51e56e1838fb",
    tenantId: "consumers",
    authority: "https://login.microsoftonline.com/consumers",
    refreshToken: process.env.MS_REFRESH_TOKEN_PERSONAL,
  }
};

// Cache for recent emails (to reference by index)
let cachedEmails = { business: [], personal: [] };
let currentInbox = 'business';

// Get fresh access token for specified inbox
async function getGraphToken(inbox = 'business') {
  const config = EMAIL_CONFIGS[inbox] || EMAIL_CONFIGS.business;
  
  if (!config.refreshToken) {
    throw new Error(`No refresh token for ${inbox} inbox`);
  }

  const tokenUrl = `${config.authority}/oauth2/v2.0/token`;
  
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
    scope: 'Mail.ReadWrite Calendars.ReadWrite User.Read offline_access'
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(`Token failed (${inbox}): ${data.error_description || data.error}`);
  }
  return data.access_token;
}

// Make Graph API request
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

// Strip HTML and clean email body
function cleanEmailBody(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 1500);
}

// Tool handlers
const handlers = {
  
  async triage_inbox(args) {
    const inbox = args?.inbox?.toLowerCase() === 'personal' ? 'personal' : 'business';
    currentInbox = inbox;
    
    try {
      const token = await getGraphToken(inbox);
      const result = await graphRequest(
        '/me/mailFolders/inbox/messages?$top=10&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,isRead,importance,bodyPreview',
        token
      );
      
      if (!result.value || result.value.length === 0) {
        return { summary: `Your ${inbox} inbox is empty.` };
      }

      cachedEmails[inbox] = result.value;

      const unread = result.value.filter(m => !m.isRead);
      const inboxLabel = inbox === 'personal' ? 'personal' : 'business';
      
      let summary = `Your ${inboxLabel} inbox has ${result.value.length} recent emails. `;
      if (unread.length > 0) summary += `${unread.length} unread. `;
      
      const emailList = result.value.slice(0, 5).map((m, i) => {
        const from = m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Unknown';
        return `${i + 1}. ${from}: ${m.subject?.substring(0, 50)}`;
      });
      
      summary += `Here they are: ${emailList.join('. ')}. Want me to read any in detail or take action?`;
      
      return { inbox, totalCount: result.value.length, unreadCount: unread.length, summary };
    } catch (error) {
      console.error('triage_inbox error:', error);
      return { error: error.message, summary: `Couldn't access ${inbox} inbox: ${error.message}` };
    }
  },

  async read_email(args) {
    const { emailIndex, subject } = args || {};
    const inbox = args?.inbox?.toLowerCase() === 'personal' ? 'personal' : currentInbox;
    
    try {
      const token = await getGraphToken(inbox);
      let emailToRead = null;
      
      if (emailIndex && cachedEmails[inbox]?.length > 0) {
        emailToRead = cachedEmails[inbox][emailIndex - 1];
      }
      
      if (!emailToRead && subject) {
        const result = await graphRequest(
          '/me/mailFolders/inbox/messages?$top=10&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,body',
          token
        );
        cachedEmails[inbox] = result.value || [];
        emailToRead = cachedEmails[inbox].find(m => 
          m.subject?.toLowerCase().includes(subject.toLowerCase())
        );
      }
      
      if (!emailToRead && emailIndex) {
        emailToRead = cachedEmails[inbox]?.[emailIndex - 1];
      }
      
      if (!emailToRead) {
        return { summary: "Couldn't find that email. Try checking inbox first." };
      }
      
      if (!emailToRead.body) {
        const fullEmail = await graphRequest(`/me/messages/${emailToRead.id}?$select=subject,from,body`, token);
        emailToRead = fullEmail;
      }
      
      const from = emailToRead.from?.emailAddress?.name || emailToRead.from?.emailAddress?.address;
      const body = cleanEmailBody(emailToRead.body?.content || emailToRead.bodyPreview || '');
      
      return {
        subject: emailToRead.subject,
        from,
        body,
        summary: `From ${from}. Subject: ${emailToRead.subject}. ${body.substring(0, 400)}${body.length > 400 ? '... Want me to continue?' : ''}`
      };
    } catch (error) {
      console.error('read_email error:', error);
      return { error: error.message, summary: "Couldn't read that email." };
    }
  },

  async delete_email(args) {
    const { emailIndex, subject } = args || {};
    const inbox = args?.inbox?.toLowerCase() === 'personal' ? 'personal' : currentInbox;
    
    try {
      const token = await getGraphToken(inbox);
      let emailsToDelete = [];
      
      // Get emails if not cached
      if (!cachedEmails[inbox]?.length) {
        const result = await graphRequest(
          '/me/mailFolders/inbox/messages?$top=10&$orderby=receivedDateTime desc&$select=id,subject,from',
          token
        );
        cachedEmails[inbox] = result.value || [];
      }
      
      if (emailIndex) {
        const email = cachedEmails[inbox][emailIndex - 1];
        if (email) emailsToDelete.push(email);
      } else if (subject) {
        emailsToDelete = cachedEmails[inbox].filter(m => 
          m.subject?.toLowerCase().includes(subject.toLowerCase())
        );
      }
      
      if (emailsToDelete.length === 0) {
        return { summary: "Couldn't find emails to delete." };
      }
      
      let deleted = 0;
      for (const email of emailsToDelete) {
        const result = await graphRequest(`/me/messages/${email.id}`, token, 'DELETE');
        if (result.success) deleted++;
      }
      
      // Update cache
      cachedEmails[inbox] = cachedEmails[inbox].filter(m => 
        !emailsToDelete.find(e => e.id === m.id)
      );
      
      return { 
        deletedCount: deleted,
        summary: `Done. Deleted ${deleted} email${deleted > 1 ? 's' : ''}.`
      };
    } catch (error) {
      console.error('delete_email error:', error);
      return { error: error.message, summary: "Couldn't delete emails." };
    }
  },

  async check_deployments(args) {
    try {
      const token = await getGraphToken('business');
      const result = await graphRequest(
        `/me/mailFolders/inbox/messages?$filter=contains(subject,'deployment') or contains(subject,'deploy')&$top=5&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview`,
        token
      );
      
      if (!result.value?.length) {
        return { summary: "No recent deployment notifications. Things look good." };
      }
      
      const failed = result.value.filter(m => m.subject?.toLowerCase().includes('failed'));
      
      if (failed.length > 0) {
        return { 
          failedCount: failed.length,
          summary: `Found ${failed.length} failed deployment${failed.length > 1 ? 's' : ''}. Want me to delete these notifications since they're resolved, or read the details?`
        };
      }
      
      return { summary: "Your deployments look good. No failures in recent notifications." };
    } catch (error) {
      return { error: error.message, summary: "Couldn't check deployments." };
    }
  },

  async get_calendar(args) {
    const { timeframe = 'today' } = args || {};
    
    try {
      const token = await getGraphToken('business');
      const now = new Date();
      let startDate = new Date(now);
      let endDate = new Date(now);
      
      if (timeframe === 'today') {
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
      } else if (timeframe === 'tomorrow') {
        startDate.setDate(startDate.getDate() + 1);
        startDate.setHours(0, 0, 0, 0);
        endDate.setDate(endDate.getDate() + 1);
        endDate.setHours(23, 59, 59, 999);
      } else {
        endDate.setDate(endDate.getDate() + 7);
      }
      
      const events = await graphRequest(
        `/me/calendarView?startDateTime=${startDate.toISOString()}&endDateTime=${endDate.toISOString()}&$orderby=start/dateTime&$select=subject,start,end`,
        token
      );
      
      if (!events.value?.length) {
        return { summary: `No events scheduled for ${timeframe}.` };
      }
      
      const eventList = events.value.map(e => {
        const time = new Date(e.start.dateTime + 'Z').toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
        });
        return `${time}: ${e.subject}`;
      });
      
      return { count: events.value.length, summary: `${events.value.length} event${events.value.length > 1 ? 's' : ''} ${timeframe}. ${eventList.slice(0,3).join('. ')}` };
    } catch (error) {
      return { summary: "Couldn't access calendar." };
    }
  },

  async get_tasks(args) {
    const { status = 'in-progress' } = args || {};
    try {
      const response = await fetch(`https://mpt-mission-control.vercel.app/api/tasks?status=${status}`);
      const tasks = await response.json();
      
      if (!tasks?.length) return { summary: `No ${status} tasks.` };
      
      return { count: tasks.length, summary: `${tasks.length} ${status} tasks. Top: ${tasks.slice(0,3).map(t => t.title).join(', ')}` };
    } catch (error) {
      return { summary: "Couldn't reach Mission Control." };
    }
  },

  async create_task(args) {
    const { title, description, priority = 'normal' } = args || {};
    if (!title) return { summary: "What should I call the task?" };
    
    try {
      const response = await fetch('https://mpt-mission-control.vercel.app/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description: description || title, priority, status: 'todo', category: 'task', track: 'operations' })
      });
      const task = await response.json();
      return { success: true, summary: `Created task: "${title}"` };
    } catch (error) {
      return { summary: "Couldn't create task." };
    }
  },

  async company_info(args) {
    const { topic } = args || {};
    const knowledge = {
      services: "MPT offers System Optimization, Integration & Automation, Custom Development, and AI Solutions.",
      products: "Our flagship is AMS-App for insurance agencies. Also Mission Control for task management.",
      pricing: "Hourly at $150/hour, monthly retainers, or project-based pricing.",
      contact: "Support@MetroPointTech.com or metropointtech.com",
      default: "Metro Point Technology builds custom software. Ask about services, products, or pricing."
    };
    const key = topic?.toLowerCase()?.replace(/[^a-z]/g, '') || 'default';
    return { summary: knowledge[key] || knowledge.default };
  },

  async flag_email(args) {
    const { emailIndex, subject, action = 'flag' } = args || {};
    const inbox = args?.inbox?.toLowerCase() === 'personal' ? 'personal' : currentInbox;
    
    try {
      const token = await getGraphToken(inbox);
      let emailToFlag = null;
      
      // Get emails if not cached
      if (!cachedEmails[inbox]?.length) {
        const result = await graphRequest(
          '/me/mailFolders/inbox/messages?$top=10&$orderby=receivedDateTime desc&$select=id,subject,from,flag',
          token
        );
        cachedEmails[inbox] = result.value || [];
      }
      
      if (emailIndex) {
        emailToFlag = cachedEmails[inbox][emailIndex - 1];
      } else if (subject) {
        emailToFlag = cachedEmails[inbox].find(m => 
          m.subject?.toLowerCase().includes(subject.toLowerCase())
        );
      }
      
      if (!emailToFlag) {
        return { summary: "Couldn't find that email to flag." };
      }
      
      // Set flag status
      const flagStatus = action === 'unflag' ? 'notFlagged' : 'flagged';
      await graphRequest(
        `/me/messages/${emailToFlag.id}`,
        token,
        'PATCH',
        { flag: { flagStatus } }
      );
      
      return { 
        success: true,
        summary: `Done. ${action === 'unflag' ? 'Unflagged' : 'Flagged'} the email: "${emailToFlag.subject?.substring(0, 30)}..."`
      };
    } catch (error) {
      console.error('flag_email error:', error);
      return { error: error.message, summary: "Couldn't flag that email: " + error.message };
    }
  },

  async add_contact_note(args) {
    const { contactName, note } = args || {};
    
    if (!contactName || !note) {
      return { summary: "I need a contact name and the note content." };
    }
    
    try {
      // Search for contact by name
      const searchName = contactName.toLowerCase();
      const searchResponse = await fetch(
        `${CRM_CONFIG.url}/rest/v1/contacts?or=(first_name.ilike.*${searchName}*,last_name.ilike.*${searchName}*)&limit=5`,
        {
          headers: {
            'apikey': CRM_CONFIG.key,
            'Authorization': `Bearer ${CRM_CONFIG.key}`,
          }
        }
      );
      
      const contacts = await searchResponse.json();
      
      if (!contacts || contacts.length === 0) {
        return { summary: `Couldn't find a contact named "${contactName}" in CRM.` };
      }
      
      // Use first match
      const contact = contacts[0];
      const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
      
      // Append note to existing notes
      const existingNotes = contact.notes || '';
      const newNotes = existingNotes 
        ? `${existingNotes}\n\n---\n[${timestamp}] ${note}`
        : `[${timestamp}] ${note}`;
      
      // Update contact with new note
      const updateResponse = await fetch(
        `${CRM_CONFIG.url}/rest/v1/contacts?id=eq.${contact.id}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': CRM_CONFIG.key,
            'Authorization': `Bearer ${CRM_CONFIG.key}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ notes: newNotes, last_contacted: new Date().toISOString() })
        }
      );
      
      if (!updateResponse.ok) {
        const err = await updateResponse.text();
        return { summary: `Couldn't update contact: ${err}` };
      }
      
      return { 
        success: true,
        contactId: contact.id,
        contactName: `${contact.first_name} ${contact.last_name}`,
        summary: `Got it. Added note to ${contact.first_name} ${contact.last_name}'s CRM record. Anything else?`
      };
    } catch (error) {
      console.error('add_contact_note error:', error);
      return { error: error.message, summary: "Couldn't add that note to CRM." };
    }
  },

  async capture_thought(args) {
    const { thought, category = 'note' } = args || {};
    
    if (!thought) {
      return { summary: "What would you like me to capture?" };
    }
    
    try {
      // Create a Mission Control task to capture the thought
      const response = await fetch('https://mpt-mission-control.vercel.app/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `📝 ${category.toUpperCase()}: ${thought.substring(0, 50)}${thought.length > 50 ? '...' : ''}`,
          description: `Captured via voice on ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}:\n\n${thought}`,
          priority: category === 'todo' ? 'high' : 'normal',
          status: 'todo',
          category: 'task',
          track: 'operations',
          clientId: 'client_001'
        })
      });
      
      const task = await response.json();
      
      if (task.error) {
        return { summary: `Couldn't save that thought: ${task.error}` };
      }
      
      return { 
        success: true,
        taskId: task.id,
        summary: `Got it. Captured your ${category} in Mission Control: "${thought.substring(0, 40)}..." What else?`
      };
    } catch (error) {
      console.error('capture_thought error:', error);
      return { error: error.message, summary: "Couldn't capture that thought." };
    }
  },

  async lookup_contact(args) {
    const { name, phone, email } = args || {};
    
    if (!name && !phone && !email) {
      return { summary: "I need a name, phone number, or email to look up." };
    }
    
    try {
      let query = `${CRM_CONFIG.url}/rest/v1/contacts?select=id,first_name,last_name,company,email,phone,source,tags,notes&limit=5`;
      
      if (phone) {
        // Clean phone and search
        const cleanPhone = phone.replace(/\D/g, '');
        query += `&phone=ilike.*${cleanPhone.slice(-7)}*`;
      } else if (email) {
        query += `&email=ilike.*${email}*`;
      } else if (name) {
        const searchName = name.toLowerCase();
        query += `&or=(first_name.ilike.*${searchName}*,last_name.ilike.*${searchName}*,company.ilike.*${searchName}*)`;
      }
      
      const response = await fetch(query, {
        headers: {
          'apikey': CRM_CONFIG.key,
          'Authorization': `Bearer ${CRM_CONFIG.key}`,
        }
      });
      
      const contacts = await response.json();
      
      if (!contacts || contacts.length === 0) {
        return { found: false, summary: `No contact found matching ${name || phone || email}. Would you like me to create one?` };
      }
      
      const c = contacts[0];
      const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown';
      let details = `Found ${fullName}`;
      if (c.company) details += ` from ${c.company}`;
      if (c.phone) details += `. Phone: ${c.phone}`;
      if (c.email) details += `. Email: ${c.email}`;
      if (c.tags?.length) details += `. Tags: ${c.tags.join(', ')}`;
      
      return {
        found: true,
        contact: {
          id: c.id,
          name: fullName,
          firstName: c.first_name,
          lastName: c.last_name,
          company: c.company,
          email: c.email,
          phone: c.phone,
          source: c.source,
          tags: c.tags,
          notes: c.notes?.substring(0, 200)
        },
        summary: details + `. What would you like to do?`
      };
    } catch (error) {
      console.error('lookup_contact error:', error);
      return { error: error.message, summary: "Couldn't search CRM: " + error.message };
    }
  },

  async create_contact(args) {
    const { firstName, lastName, company, email, phone, source = 'phone_call', notes } = args || {};
    
    if (!firstName && !lastName && !company) {
      return { summary: "I need at least a name or company to create a contact." };
    }
    
    try {
      const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
      const contactData = {
        first_name: firstName || null,
        last_name: lastName || null,
        company: company || null,
        email: email || null,
        phone: phone || null,
        source: source,
        source_detail: 'Created via Jack voice call',
        notes: notes ? `[${timestamp}] ${notes}` : `[${timestamp}] Contact created via phone call.`,
        tags: ['new-lead']
      };
      
      const response = await fetch(`${CRM_CONFIG.url}/rest/v1/contacts`, {
        method: 'POST',
        headers: {
          'apikey': CRM_CONFIG.key,
          'Authorization': `Bearer ${CRM_CONFIG.key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(contactData)
      });
      
      if (!response.ok) {
        const err = await response.text();
        return { summary: `Couldn't create contact: ${err}` };
      }
      
      const [newContact] = await response.json();
      const fullName = `${firstName || ''} ${lastName || ''}`.trim() || company || 'New contact';
      
      return {
        success: true,
        contactId: newContact.id,
        summary: `Created ${fullName} in CRM. ${phone ? `Phone: ${phone}. ` : ''}${email ? `Email: ${email}. ` : ''}Anything else to add?`
      };
    } catch (error) {
      console.error('create_contact error:', error);
      return { error: error.message, summary: "Couldn't create contact." };
    }
  },

  async send_payment_link(args) {
    const { contactName, phone, email, amount, description, invoiceId } = args || {};
    
    if (!phone && !email) {
      return { summary: "I need a phone number or email to send the payment link. Or you can visit our website at metro point tech dot com to make a payment through your client portal." };
    }
    
    try {
      // Direct customers to MetroPointTech.com client portal for payments
      const paymentUrl = 'https://metropointtech.com/portal';
      const websiteSpoken = 'metro point tech dot com slash portal';
      
      if (phone) {
        // Send SMS via Twilio
        const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
        const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioPhone = process.env.TWILIO_PHONE_NUMBER || '+12394267058';
        
        if (!twilioAccountSid || !twilioAuthToken) {
          // No Twilio - give verbal instructions with slow spelling
          return { 
            summary: `I can give you the website to make a payment. Go to: M. E. T. R. O. P. O. I. N. T. T. E. C. H. dot com. slash portal. That's metro point tech dot com slash portal. You can log in there to view invoices and make payments.`
          };
        }
        
        const smsBody = `Metro Point Technology: Make a payment at ${paymentUrl}${amount ? ` - Amount due: $${amount.toFixed(2)}` : ''}${description ? ` (${description})` : ''}`;
        
        const cleanPhone = phone.replace(/\D/g, '');
        const toPhone = cleanPhone.startsWith('1') ? `+${cleanPhone}` : `+1${cleanPhone}`;
        
        const twilioResponse = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64'),
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              To: toPhone,
              From: twilioPhone,
              Body: smsBody
            })
          }
        );
        
        if (!twilioResponse.ok) {
          const err = await twilioResponse.text();
          console.error('Twilio error:', err);
          // Fallback to verbal with slow spelling
          return { 
            summary: `I wasn't able to send the text, but I can give you the website. Go to: M. E. T. R. O. P. O. I. N. T. T. E. C. H. dot com. slash portal. You can log in there to make a payment.`
          };
        }
        
        return {
          success: true,
          method: 'sms',
          summary: `Done! I just sent you a text with the payment link.${amount ? ` Amount: $${amount.toFixed(2)}.` : ''} You'll be able to log into your client portal and make the payment there.`
        };
      }
      
      if (email) {
        // Send via Graph API email
        const token = await getGraphToken('business');
        const emailBody = `
          <p>Hello,</p>
          <p>You can make a payment through your Metro Point Technology client portal${amount ? ` for $${amount.toFixed(2)}` : ''}${description ? ` (${description})` : ''}:</p>
          <p><a href="${paymentUrl}" style="background:#4F46E5;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">Go to Client Portal</a></p>
          <p>Or visit: ${paymentUrl}</p>
          <p>Log in with your account to view invoices and make payments.</p>
          <p>Thank you for your business!</p>
          <p>Metro Point Technology</p>
        `;
        
        await graphRequest('/me/sendMail', token, 'POST', {
          message: {
            subject: amount ? `Payment Request: $${amount.toFixed(2)}` : 'Make a Payment - Metro Point Technology',
            body: { contentType: 'HTML', content: emailBody },
            toRecipients: [{ emailAddress: { address: email } }]
          }
        });
        
        return {
          success: true,
          method: 'email',
          summary: `Sent the payment link to ${email}. They'll get an email with the secure checkout link.`
        };
      }
      
    } catch (error) {
      console.error('send_payment_link error:', error);
      return { error: error.message, summary: "Couldn't send payment link: " + error.message };
    }
  },

  async lookup_invoice(args) {
    const { contactName, invoiceNumber, status } = args || {};
    
    try {
      // Query MPT-Accounting Supabase for invoices
      const ACCOUNTING_CONFIG = {
        url: 'https://pezgfalkjoucwnfytubb.supabase.co',
        key: process.env.SUPABASE_ACCOUNTING_KEY || process.env.SUPABASE_CRM_KEY // Fallback
      };
      
      let query = `${ACCOUNTING_CONFIG.url}/rest/v1/invoices?select=*&limit=10&order=created_at.desc`;
      
      if (invoiceNumber) {
        query += `&invoice_number=eq.${invoiceNumber}`;
      }
      if (status) {
        query += `&status=eq.${status}`;
      }
      
      const response = await fetch(query, {
        headers: {
          'apikey': ACCOUNTING_CONFIG.key,
          'Authorization': `Bearer ${ACCOUNTING_CONFIG.key}`,
        }
      });
      
      const invoices = await response.json();
      
      if (!invoices || invoices.length === 0) {
        return { found: false, summary: "No invoices found matching that criteria." };
      }
      
      if (invoiceNumber && invoices.length === 1) {
        const inv = invoices[0];
        return {
          found: true,
          invoice: inv,
          summary: `Invoice #${inv.invoice_number}: $${inv.total?.toFixed(2) || '0.00'}, status: ${inv.status}. ${inv.status === 'pending' || inv.status === 'overdue' ? 'Would you like me to send a payment link?' : ''}`
        };
      }
      
      const pending = invoices.filter(i => i.status === 'pending' || i.status === 'overdue');
      return {
        found: true,
        count: invoices.length,
        pendingCount: pending.length,
        summary: `Found ${invoices.length} recent invoices. ${pending.length} are pending payment, totaling $${pending.reduce((sum, i) => sum + (i.total || 0), 0).toFixed(2)}. Want details on a specific one?`
      };
    } catch (error) {
      console.error('lookup_invoice error:', error);
      return { error: error.message, summary: "Couldn't access invoices: " + error.message };
    }
  },

  async schedule_appointment(args) {
    const { title, date, time, duration = 30, attendeeEmail, description } = args || {};
    
    if (!title || !date || !time) {
      return { summary: "I need a title, date, and time to schedule the appointment." };
    }
    
    try {
      const token = await getGraphToken('business');
      
      // Parse date and time
      const dateStr = date; // Expected: YYYY-MM-DD or natural language
      const timeStr = time; // Expected: HH:MM or natural language
      
      // Simple parsing - in production, use a proper date parser
      let startDateTime;
      try {
        // Try parsing as ISO
        startDateTime = new Date(`${dateStr}T${timeStr}:00`);
        if (isNaN(startDateTime.getTime())) {
          // Try natural parsing
          const now = new Date();
          if (dateStr.toLowerCase() === 'today') {
            startDateTime = new Date(now.toISOString().split('T')[0] + 'T' + timeStr + ':00');
          } else if (dateStr.toLowerCase() === 'tomorrow') {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            startDateTime = new Date(tomorrow.toISOString().split('T')[0] + 'T' + timeStr + ':00');
          }
        }
      } catch (e) {
        return { summary: "Couldn't parse that date/time. Try 'tomorrow at 2pm' or '2026-02-20 at 14:00'." };
      }
      
      const endDateTime = new Date(startDateTime.getTime() + duration * 60000);
      
      const event = {
        subject: title,
        body: {
          contentType: 'HTML',
          content: description || `Appointment scheduled via Jack.`
        },
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: 'America/New_York'
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: 'America/New_York'
        },
        attendees: attendeeEmail ? [{
          emailAddress: { address: attendeeEmail },
          type: 'required'
        }] : []
      };
      
      const result = await graphRequest('/me/events', token, 'POST', event);
      
      if (result.error) {
        return { summary: `Couldn't create appointment: ${result.error.message}` };
      }
      
      const timeFormatted = startDateTime.toLocaleString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York'
      });
      
      return {
        success: true,
        eventId: result.id,
        summary: `Scheduled "${title}" for ${timeFormatted}. ${attendeeEmail ? `Invite sent to ${attendeeEmail}. ` : ''}Duration: ${duration} minutes.`
      };
    } catch (error) {
      console.error('schedule_appointment error:', error);
      return { error: error.message, summary: "Couldn't schedule appointment: " + error.message };
    }
  },

  async get_services_info(args) {
    const { service } = args || {};
    
    const services = {
      'system-optimization': {
        name: 'System Optimization',
        description: 'Audit and streamline your existing technology. We eliminate redundant tools, improve workflows, and reduce tech debt.',
        pricing: 'Starting at $2,000 for initial audit',
        timeline: '2-4 weeks'
      },
      'integration': {
        name: 'Integration & Automation',
        description: 'Connect your systems together. QuickBooks to CRM, email to calendar, you name it. If it has an API, we can integrate it.',
        pricing: 'Starting at $1,500 per integration',
        timeline: '1-3 weeks per integration'
      },
      'custom-dev': {
        name: 'Custom Development',
        description: 'Bespoke software built exactly for your needs. Web apps, mobile apps, internal tools.',
        pricing: '$150/hour or project-based quotes',
        timeline: 'Varies by scope'
      },
      'ai-solutions': {
        name: 'AI Solutions',
        description: 'AI chatbots, voice assistants, automation powered by artificial intelligence. Like this conversation!',
        pricing: 'Starting at $5,000 for basic implementation',
        timeline: '4-8 weeks'
      },
      'ams': {
        name: 'AMS-App (Agency Management System)',
        description: 'Commission tracking and policy management for insurance agencies. Automatic commission calculations, reconciliation, and reporting.',
        pricing: '$299/month per agency',
        timeline: 'Setup in 1 week'
      }
    };
    
    if (service) {
      const key = service.toLowerCase().replace(/\s+/g, '-');
      const s = services[key] || Object.values(services).find(sv => 
        sv.name.toLowerCase().includes(service.toLowerCase())
      );
      
      if (s) {
        return {
          service: s,
          summary: `${s.name}: ${s.description} Pricing: ${s.pricing}. Typical timeline: ${s.timeline}. Would you like to schedule a discovery call?`
        };
      }
      return { summary: "I don't have details on that specific service. Our main offerings are System Optimization, Integration, Custom Development, and AI Solutions." };
    }
    
    return {
      services: Object.values(services),
      summary: "Metro Point Technology offers: System Optimization, Integration & Automation, Custom Development, and AI Solutions. We also have AMS-App for insurance agencies. Which one interests you?"
    };
  }
};

// Extract tool name
function getToolName(tc) {
  return tc.name || tc.function?.name || (tc.toolCall?.function?.name);
}

// Extract arguments
function getToolArgs(tc) {
  const args = tc.arguments || tc.function?.arguments || tc.toolCall?.function?.arguments || tc.parameters || {};
  return typeof args === 'string' ? JSON.parse(args) : args;
}

// Main handler
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message } = req.body;
    
    // Check for internal mode (bypasses PIN requirement)
    // Parse URL manually since req.query may not be available
    const urlParams = new URL(req.url, `https://${req.headers.host}`).searchParams;
    const isInternal = urlParams.get('internal') === 'true' || req.query?.internal === 'true';
    console.log('[VAPI] Internal mode:', isInternal, 'URL:', req.url);

    // Initialize mode handler for this session
    const modeHandler = createModeHandler(message);
    
    // Force full access for internal requests
    if (isInternal) {
      modeHandler.state.mode = 'full_assistant';
      modeHandler.state.authenticated = true;
    }

    // Handle mode switching requests (PIN unlock, etc.)
    if (message?.type === 'transcript' && message?.transcriptType === 'partial') {
      const userMessage = message.transcript;
      const modeResult = modeHandler.processMessage(userMessage);
      
      if (modeResult.requiresResponse) {
        return res.status(200).json({
          results: [{
            toolCallId: 'mode_switch',
            result: JSON.stringify({ 
              summary: modeResult.response,
              systemPrompt: modeResult.modeChanged ? modeHandler.getSystemPrompt() : undefined
            })
          }]
        });
      }
    }

    if (message?.type === 'tool-calls') {
      const toolCalls = message.toolCallList || message.toolWithToolCallList || [];
      const results = [];
      
      for (const tc of toolCalls) {
        const id = tc.id || tc.toolCall?.id || 'unknown';
        const name = getToolName(tc);
        const args = getToolArgs(tc);
        
        console.log(`Tool: ${name}`, args);
        
        // Check permissions for this function (skip for internal mode)
        if (!isInternal && !modeHandler.canAccessFunction(name)) {
          results.push({
            toolCallId: id,
            result: JSON.stringify({
              error: "Access denied",
              summary: modeHandler.getAccessDeniedMessage(name)
            })
          });
          continue;
        }
        
        const fn = handlers[name];
        const result = fn ? await fn(args) : { error: `Unknown: ${name}` };
        results.push({ toolCallId: id, result: JSON.stringify(result) });
      }
      
      return res.status(200).json({ results });
    }

    if (message?.type === 'function-call') {
      const fc = message.functionCall;
      const name = fc.name || fc.function?.name;
      const args = fc.parameters || fc.arguments || {};
      
      // Check permissions for this function (skip for internal mode)
      if (!isInternal && !modeHandler.canAccessFunction(name)) {
        return res.status(200).json({
          results: [{
            toolCallId: fc.id,
            result: JSON.stringify({
              error: "Access denied",
              summary: modeHandler.getAccessDeniedMessage(name)
            })
          }]
        });
      }
      
      const fn = handlers[name];
      const result = fn ? await fn(typeof args === 'string' ? JSON.parse(args) : args) : { error: `Unknown: ${name}` };
      return res.status(200).json({ results: [{ toolCallId: fc.id, result: JSON.stringify(result) }] });
    }

    return res.status(200).json({});
  } catch (error) {
    console.error('Error:', error);
    return res.status(200).json({ results: [{ toolCallId: 'error', result: JSON.stringify({ error: error.message }) }] });
  }
}
