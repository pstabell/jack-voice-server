/**
 * Jack Mode Handler - Dual-mode system prompt management
 * Handles Sales/Service default mode and PIN-unlocked Director mode
 */

import fs from 'fs';
import path from 'path';

// Load system prompts configuration
const SYSTEM_PROMPTS = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'system-prompts.json'), 'utf8')
);

// Session state storage (in production, use Redis or persistent storage)
const sessionStates = new Map();

export class ModeHandler {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.state = sessionStates.get(sessionId) || {
      mode: 'sales_service',
      authenticated: false,
      pinAttempts: 0,
      lastAttempt: null,
      lockedUntil: null
    };
    sessionStates.set(sessionId, this.state);
  }

  /**
   * Get current mode configuration
   */
  getCurrentMode() {
    return SYSTEM_PROMPTS.modes[this.state.mode];
  }

  /**
   * Get system prompt for current mode
   */
  getSystemPrompt() {
    return this.getCurrentMode().system_prompt;
  }

  /**
   * Check if session is currently locked due to failed PIN attempts
   */
  isLocked() {
    if (!this.state.lockedUntil) return false;
    if (new Date() > new Date(this.state.lockedUntil)) {
      // Lockout expired
      this.state.lockedUntil = null;
      this.state.pinAttempts = 0;
      this.saveState();
      return false;
    }
    return true;
  }

  /**
   * Detect PIN unlock request in user message
   */
  detectPinUnlockRequest(message) {
    const lowerMessage = message.toLowerCase();
    return SYSTEM_PROMPTS.pin_unlock_phrases.some(phrase => 
      lowerMessage.includes(phrase)
    );
  }

  /**
   * Extract PIN from user message
   */
  extractPin(message) {
    // Look for 4-digit PIN in the message
    const pinMatch = message.match(/\b\d{4}\b/);
    return pinMatch ? pinMatch[0] : null;
  }

  /**
   * Attempt PIN authentication
   */
  attemptPinAuth(pin) {
    if (this.isLocked()) {
      const unlockTime = new Date(this.state.lockedUntil).toLocaleTimeString();
      return {
        success: false,
        message: `Access locked due to failed attempts. Try again after ${unlockTime}.`
      };
    }

    const correctPin = SYSTEM_PROMPTS.modes.full_assistant.pin_code;
    
    if (pin === correctPin) {
      // Successful authentication
      this.state.mode = 'full_assistant';
      this.state.authenticated = true;
      this.state.pinAttempts = 0;
      this.state.lockedUntil = null;
      this.saveState();
      
      return {
        success: true,
        message: "Access granted. Full Director of Operations mode activated. I now have complete access to all your systems."
      };
    } else {
      // Failed attempt
      this.state.pinAttempts++;
      this.state.lastAttempt = new Date().toISOString();
      
      if (this.state.pinAttempts >= SYSTEM_PROMPTS.pin_attempts.max_attempts) {
        // Lock account
        const lockoutMinutes = SYSTEM_PROMPTS.pin_attempts.lockout_duration_minutes;
        this.state.lockedUntil = new Date(Date.now() + lockoutMinutes * 60000).toISOString();
        this.saveState();
        
        return {
          success: false,
          message: `Incorrect PIN. Account locked for ${lockoutMinutes} minutes due to multiple failed attempts.`
        };
      } else {
        const attemptsLeft = SYSTEM_PROMPTS.pin_attempts.max_attempts - this.state.pinAttempts;
        this.saveState();
        
        return {
          success: false,
          message: `Incorrect PIN. ${attemptsLeft} attempt${attemptsLeft > 1 ? 's' : ''} remaining.`
        };
      }
    }
  }

  /**
   * Switch back to sales/service mode
   */
  switchToSalesMode() {
    this.state.mode = 'sales_service';
    this.state.authenticated = false;
    this.saveState();
    
    return {
      success: true,
      message: "Switched to Sales & Service mode. Full access disabled."
    };
  }

  /**
   * Process user message and handle mode switching
   */
  processMessage(message) {
    // Check for PIN unlock request
    if (this.detectPinUnlockRequest(message)) {
      const pin = this.extractPin(message);
      
      if (!pin) {
        return {
          requiresResponse: true,
          response: "Please provide your 4-digit PIN to unlock full assistant access."
        };
      }
      
      const authResult = this.attemptPinAuth(pin);
      return {
        requiresResponse: true,
        response: authResult.message,
        modeChanged: authResult.success
      };
    }

    // Check for sales mode switch request
    if (message.toLowerCase().includes('sales mode') || message.toLowerCase().includes('customer mode')) {
      if (this.state.mode === 'full_assistant') {
        const result = this.switchToSalesMode();
        return {
          requiresResponse: true,
          response: result.message,
          modeChanged: true
        };
      }
    }

    return { requiresResponse: false };
  }

  /**
   * Check if current mode allows access to a specific function
   */
  canAccessFunction(functionName) {
    if (this.state.mode === 'full_assistant') {
      return true; // Full access mode allows everything
    }

    // Sales/Service mode restrictions
    const restrictedFunctions = [
      'triage_inbox',
      'read_email', 
      'delete_email',
      'flag_email',
      'get_tasks',
      'create_task',
      'capture_thought',
      'check_deployments'
    ];

    return !restrictedFunctions.includes(functionName);
  }

  /**
   * Get access denied message for restricted functions
   */
  getAccessDeniedMessage(functionName) {
    return `I don't have access to ${functionName} in customer service mode. If you're Patrick, say "unlock director mode" and provide your PIN for full access.`;
  }

  /**
   * Save current state
   */
  saveState() {
    sessionStates.set(this.sessionId, this.state);
  }

  /**
   * Get current mode info for debugging
   */
  getModeInfo() {
    return {
      mode: this.state.mode,
      authenticated: this.state.authenticated,
      isLocked: this.isLocked(),
      pinAttempts: this.state.pinAttempts
    };
  }
}

/**
 * Extract session ID from Vapi message
 */
export function getSessionId(message) {
  return message.call?.id || message.session?.id || 'default_session';
}

/**
 * Create mode handler for request
 */
export function createModeHandler(message) {
  const sessionId = getSessionId(message);
  return new ModeHandler(sessionId);
}