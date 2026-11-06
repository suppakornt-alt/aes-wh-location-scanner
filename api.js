// api.js

const CONFIG = {
  API_URL:
    "https://script.google.com/macros/s/AKfycbxu5KExFiT9S2Tb7GyrVDtDR6CX67g69Zmm5YQFDaBnIleBaTlbXndJ4dhOHlTp99ql/exec"
};

/**
 * Sends a request to Google Apps Script.
 */
async function safeFetch(action, payload = {}) {
  const requestBody = {
    action,
    ...payload
  };

  console.log("[API REQUEST]", requestBody);

  try {
    const response = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();

    console.log("[API STATUS]", response.status);
    console.log("[API RAW RESPONSE]", responseText);

    let result;

    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error("[API JSON ERROR]", parseError);

      return {
        success: false,
        message: "Backend returned invalid JSON.",
        status: response.status,
        rawResponse: responseText
      };
    }

    if (!response.ok || result.success === false) {
      console.error("[API BACKEND ERROR]", {
        action,
        status: response.status,
        result
      });
    }

    return result;

  } catch (error) {
    console.error(`[API NETWORK ERROR] ${action}`, error);

    return {
      success: false,
      message: "Network connection failed.",
      error: error.message
    };
  }
}
