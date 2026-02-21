# Jack Voice Integration - End-to-End Testing Guide

## Overview
This guide covers comprehensive testing of Jack's voice integration with all Metro Bot systems.

**Test Phone Number:** +1 (239) 966-1917  
**Vapi Dashboard:** https://dashboard.vapi.ai  
**Webhook URL:** https://jack-voice-server.vercel.app/api/vapi-webhook

---

## Pre-Testing Setup

### 1. Verify Deployment
- [ ] Webhook deployed to Vercel and responding
- [ ] Environment variables configured (.env.production)
- [ ] Vapi assistant configured with latest tools and webhook URL

### 2. Required Access Tokens
- [ ] Microsoft Graph refresh tokens (business & personal email)
- [ ] Supabase CRM access key
- [ ] Mission Control API accessible
- [ ] Twilio credentials for SMS (payment links)

### 3. Test Data Preparation
- [ ] Have test contacts in CRM
- [ ] Have test emails in both business/personal inboxes
- [ ] Have calendar events scheduled
- [ ] Have Mission Control tasks available

---

## Test Scenarios

### Phase 1: Sales/Service Mode (Default)
**Goal:** Verify customer-facing functionality works without PIN

#### A. Company Information
1. **Call Jack:** +1 (239) 966-1917
2. **Say:** "Tell me about Metro Point Technology"
3. **Expected:** Professional company overview, services summary
4. **Say:** "What services do you offer?"
5. **Expected:** Detailed service breakdown (System Optimization, Integration, etc.)
6. **Say:** "How much does custom development cost?"
7. **Expected:** Pricing information with offer to schedule discovery call

#### B. Payment Processing
1. **Say:** "I need to make a payment"
2. **Expected:** Request for phone/email to send payment link
3. **Provide:** Test phone number or email
4. **Expected:** SMS/email sent with client portal link
5. **Verify:** Payment link leads to metropointtech.com/portal

#### C. Appointment Scheduling
1. **Say:** "I want to schedule a meeting"
2. **Expected:** Request for date, time, and details
3. **Provide:** "Tomorrow at 2pm for discovery call"
4. **Expected:** Confirmation of scheduled appointment
5. **Verify:** Appointment appears in Microsoft Calendar

#### D. Invoice Lookup
1. **Say:** "Look up my invoice"
2. **Expected:** Request for invoice number or customer info
3. **Provide:** Test invoice number (if available)
4. **Expected:** Invoice details and payment options

#### E. Restricted Functions (Should Fail)
1. **Say:** "Check my email"
2. **Expected:** Access denied message with hint about director mode
3. **Say:** "Show me my tasks"
4. **Expected:** Access denied message

### Phase 2: PIN Authentication
**Goal:** Verify PIN-protected director mode works

#### A. PIN Unlock Request
1. **Say:** "Unlock director mode"
2. **Expected:** Request for 4-digit PIN
3. **Say:** Wrong PIN (e.g., "1234")
4. **Expected:** "Incorrect PIN. X attempts remaining"
5. **Say:** Correct PIN: "7058"
6. **Expected:** "Access granted. Full Director of Operations mode activated."

#### B. Multiple Failed Attempts
1. **Say:** "Unlock director mode"
2. **Provide:** 3 wrong PINs in sequence
3. **Expected:** Account locked for 30 minutes
4. **Verify:** Cannot unlock even with correct PIN until lockout expires

### Phase 3: Full Director Mode
**Goal:** Test all administrative functions after PIN unlock

#### A. Email Management
1. **Say:** "Triage my business inbox"
2. **Expected:** List of recent emails with unread count
3. **Say:** "Read email 1" (or mention subject)
4. **Expected:** Full email content read aloud
5. **Say:** "Delete the spam emails"
6. **Expected:** Confirmation of emails deleted
7. **Say:** "Flag email 2 for follow-up"
8. **Expected:** Email flagged successfully

#### B. Personal Email Access
1. **Say:** "Check my personal inbox"
2. **Expected:** Personal email summary
3. **Say:** "Read the first personal email"
4. **Expected:** Personal email content

#### C. Calendar Management
1. **Say:** "What's on my calendar today?"
2. **Expected:** List of today's appointments
3. **Say:** "What about tomorrow?"
4. **Expected:** Tomorrow's schedule
5. **Say:** "Schedule a team meeting for Friday at 10am"
6. **Expected:** Meeting scheduled and confirmed

#### D. Mission Control Integration
1. **Say:** "What are my current tasks?"
2. **Expected:** List of in-progress Mission Control tasks
3. **Say:** "Create a task to review Jack integration"
4. **Expected:** Task created in Mission Control
5. **Verify:** Task appears in Mission Control dashboard

#### E. CRM Operations
1. **Say:** "Look up contact John Smith"
2. **Expected:** Contact details from CRM (if exists)
3. **Say:** "Create a new contact for Jane Doe at Example Corp"
4. **Expected:** Contact created with confirmation
5. **Say:** "Add a note to John Smith: Called about website project"
6. **Expected:** Note added to CRM contact

#### F. Thought Capture
1. **Say:** "Capture this thought: Need to update website pricing page"
2. **Expected:** Thought saved as Mission Control task
3. **Verify:** Task appears in Mission Control

### Phase 4: Voice Quality & Polish
**Goal:** Assess conversation flow and voice quality

#### A. Natural Conversation
1. Test interruptions (speak while Jack is talking)
2. Test conversation continuity across multiple requests
3. Verify Jack remembers context within the call
4. Test unclear speech recognition

#### B. Error Handling
1. **Say:** Nonsensical request
2. **Expected:** Graceful error handling with helpful suggestions
3. Test network interruptions
4. Test timeout scenarios

#### C. Response Quality
1. Verify responses are concise and actionable
2. Check for natural, conversational tone
3. Ensure technical details are explained clearly
4. Verify professional language in sales mode vs. casual in director mode

---

## Performance Testing

### 1. Response Times
- [ ] Email triage: < 5 seconds
- [ ] Calendar lookup: < 3 seconds  
- [ ] CRM queries: < 4 seconds
- [ ] Mission Control tasks: < 3 seconds

### 2. Concurrent Calls
- [ ] Test multiple simultaneous calls to Jack
- [ ] Verify session isolation (each call independent)
- [ ] Check webhook performance under load

### 3. Integration Reliability
- [ ] Microsoft Graph token refresh working
- [ ] CRM database connections stable
- [ ] Mission Control API responses consistent

---

## Regression Testing

### 1. After Code Changes
- [ ] Re-run core scenarios (sales info, PIN unlock, email triage)
- [ ] Verify no functionality broken
- [ ] Test error paths still work

### 2. After Vapi Updates
- [ ] Check tool calling still works
- [ ] Verify webhook format compatibility
- [ ] Test voice quality unchanged

### 3. After Environment Changes
- [ ] Verify all environment variables work
- [ ] Test API keys and tokens
- [ ] Check deployment configuration

---

## Troubleshooting Common Issues

### 1. Webhook Not Responding
- Check Vercel deployment status
- Verify webhook URL in Vapi dashboard
- Check server logs for errors

### 2. Authentication Failures
- Verify Microsoft Graph refresh tokens
- Check environment variable spelling
- Test token refresh manually

### 3. Database Connection Issues
- Verify Supabase API keys
- Check CRM database permissions
- Test direct API calls

### 4. Voice Quality Issues
- Check microphone/connection quality
- Verify Vapi assistant settings
- Test with different devices/locations

---

## Test Results Documentation

### Template for Each Test Run:
```
Date: ___________
Tester: ___________
Version: ___________

Sales Mode Tests: PASS/FAIL
- Company info: ___________
- Payment links: ___________
- Appointments: ___________
- Access restrictions: ___________

PIN Authentication: PASS/FAIL
- Correct PIN: ___________
- Failed attempts: ___________
- Lockout behavior: ___________

Director Mode Tests: PASS/FAIL
- Email management: ___________
- Calendar access: ___________
- Mission Control: ___________
- CRM operations: ___________

Voice Quality: PASS/FAIL
- Clarity: ___________
- Response time: ___________
- Natural flow: ___________

Issues Found:
1. ___________
2. ___________
3. ___________

Overall Status: READY/NEEDS WORK
```

---

## Demo Preparation (TopGolf Meeting)

### Pre-Demo Checklist:
- [ ] Run complete test suite day before
- [ ] Prepare test scenarios that showcase business value
- [ ] Have backup phone available
- [ ] Verify strong cell signal at TopGolf
- [ ] Practice key phrases and timing

### Demo Script for Roger:
1. **Open:** "Let me show you our AI phone assistant, Jack"
2. **Call Jack:** Show company info lookup
3. **Demonstrate:** Professional appointment scheduling
4. **Highlight:** Payment processing capabilities
5. **Show Value:** "This saves agencies hours of phone tag"

### Fallback Plan:
- Have screenshots/recordings of successful tests
- Prepare manual demo of webhook responses
- Have business cards with Jack's number for follow-up calls