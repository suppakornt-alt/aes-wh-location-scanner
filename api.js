// api.js

const CONFIG = {
  // Your live deployment URL
  API_URL: "https://script.google.com/macros/s/AKfycbxu5KExFiT9S2Tb7GyrVDtDR6CX67g69Zmm5YQFDaBnIleBaTlbXndJ4dhOHlTp99ql/exec",
  // The secret codeword matching Code.gs
  API_KEY: "aes-scanner-prod-2026" 
};

/**
 * Securely transmits data to Google Apps Script.
 */
async function safeFetch(action, payload = {}) {
  try {
    const response = await fetch(CONFIG.API_URL, {
      method: 'POST',
      // We use text/plain to safely bypass strict browser preflight checks
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        apiKey: CONFIG.API_KEY,
        action: action,
        ...payload
      })
    });
    
    return await response.json();
    
  } catch (error) {
    console.error(`[API Error] Failed to execute ${action}:`, error);
    return { success: false, message: "Network connection failed." };
  }
}
