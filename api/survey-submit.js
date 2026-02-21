/**
 * Survey Submit API - Auto-upload survey responses to CRM
 * Handles both contact feedback and Patrick assessment surveys
 */

// CRM Supabase config (reusing from vapi-webhook.js)
const CRM_CONFIG = {
  url: 'https://qgtjpdviboxxlrivwcan.supabase.co',
  key: process.env.SUPABASE_CRM_KEY,
};

/**
 * Format survey data for CRM notes
 */
function formatSurveyForNotes(surveyData, surveyType) {
  const timestamp = new Date().toLocaleString('en-US', { 
    timeZone: 'America/New_York',
    dateStyle: 'short',
    timeStyle: 'short'
  });
  
  if (surveyType === 'contact') {
    const rating = '★'.repeat(parseInt(surveyData.meeting_rating || 0));
    const interests = Array.isArray(surveyData.interests) 
      ? surveyData.interests.join(', ') 
      : surveyData.interests || 'None specified';
    
    return `
📋 CONTACT SURVEY (${timestamp})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Meeting Rating: ${rating} (${surveyData.meeting_rating || 'N/A'}/5)
Services Interested In: ${interests}
Preferred Contact: ${surveyData.preferred_contact || 'Not specified'}
Further Topics: ${surveyData.further_topics || 'None'}
Survey ID: ${surveyData.surveyId || 'Unknown'}
`;
  } else if (surveyType === 'patrick') {
    const tempEmoji = {
      'hot': '🔥',
      'warm': '🌡️',
      'cold': '🧊'
    };
    
    return `
🎯 PATRICK ASSESSMENT (${timestamp})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Temperature: ${tempEmoji[surveyData.temperature] || ''} ${(surveyData.temperature || 'N/A').toUpperCase()}
Services Discussed: ${surveyData.services_discussed || surveyData.interests || 'Not specified'}
Follow-up Actions: ${surveyData.followup_actions || 'None'}
Referral Potential: ${surveyData.referral_potential || 'N/A'}/5
Next Meeting: ${surveyData.next_meeting || 'None scheduled'}
Notes: ${surveyData.notes || 'None'}
Survey ID: ${surveyData.surveyId || 'Unknown'}
`;
  }
  
  return `Survey Response (${timestamp}): ${JSON.stringify(surveyData)}`;
}

/**
 * Look up contact in CRM by contactId or email
 */
async function findContact(contactId, email) {
  try {
    let searchUrl;
    
    if (contactId) {
      searchUrl = `${CRM_CONFIG.url}/rest/v1/contacts?id=eq.${contactId}&limit=1`;
    } else if (email) {
      searchUrl = `${CRM_CONFIG.url}/rest/v1/contacts?email=eq.${email}&limit=1`;
    } else {
      return null;
    }
    
    const response = await fetch(searchUrl, {
      headers: {
        'apikey': CRM_CONFIG.key,
        'Authorization': `Bearer ${CRM_CONFIG.key}`,
      }
    });
    
    const contacts = await response.json();
    return contacts && contacts.length > 0 ? contacts[0] : null;
  } catch (error) {
    console.error('Error finding contact:', error);
    return null;
  }
}

/**
 * Update contact with survey response
 */
async function updateContactWithSurvey(contact, formattedSurvey) {
  try {
    // Append to existing notes
    const existingNotes = contact.notes || '';
    const newNotes = existingNotes 
      ? `${existingNotes}\n\n${formattedSurvey}`
      : formattedSurvey;
    
    // Update contact
    const response = await fetch(
      `${CRM_CONFIG.url}/rest/v1/contacts?id=eq.${contact.id}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': CRM_CONFIG.key,
          'Authorization': `Bearer ${CRM_CONFIG.key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ 
          notes: newNotes, 
          last_contacted: new Date().toISOString()
        })
      }
    );
    
    return response.ok;
  } catch (error) {
    console.error('Error updating contact:', error);
    return false;
  }
}

/**
 * Detect survey type based on form data
 */
function detectSurveyType(data) {
  // Contact survey fields
  if (data.meeting_rating || data.preferred_contact) {
    return 'contact';
  }
  
  // Patrick assessment fields
  if (data.temperature || data.referral_potential) {
    return 'patrick';
  }
  
  // Default to contact if unclear
  return 'contact';
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  // CORS headers
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
    const surveyData = req.body;
    console.log('Survey submission received:', surveyData);

    // Validate required data
    if (!surveyData || Object.keys(surveyData).length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No survey data received' 
      });
    }

    // Detect survey type
    const surveyType = detectSurveyType(surveyData);
    console.log('Detected survey type:', surveyType);

    // Find contact in CRM
    const contact = await findContact(surveyData.contactId, surveyData.email);
    
    if (!contact) {
      console.log('Contact not found:', { contactId: surveyData.contactId, email: surveyData.email });
      return res.status(404).json({ 
        success: false, 
        error: 'Contact not found in CRM',
        contactId: surveyData.contactId 
      });
    }

    console.log('Found contact:', { id: contact.id, name: `${contact.first_name} ${contact.last_name}` });

    // Format survey for notes
    const formattedSurvey = formatSurveyForNotes(surveyData, surveyType);

    // Update contact in CRM
    const updateSuccess = await updateContactWithSurvey(contact, formattedSurvey);

    if (!updateSuccess) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to update contact in CRM' 
      });
    }

    console.log('Survey successfully saved to CRM for contact:', contact.id);

    // Success response
    return res.status(200).json({
      success: true,
      message: `${surveyType === 'contact' ? 'Feedback' : 'Assessment'} saved successfully`,
      contact: {
        id: contact.id,
        name: `${contact.first_name} ${contact.last_name}`,
        company: contact.company
      },
      surveyType
    });

  } catch (error) {
    console.error('Survey submission error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
}