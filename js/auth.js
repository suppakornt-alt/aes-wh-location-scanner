const GOOGLE_TOKEN_STORAGE_KEY = 'aesWarehouseGoogleIdToken';

function decodeGoogleToken(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(decodeURIComponent(Array.from(atob(padded), c =>
      '%' + c.charCodeAt(0).toString(16).padStart(2, '0')
    ).join('')));
  } catch (_) {
    return null;
  }
}

function readStoredGoogleToken() {
  const token = sessionStorage.getItem(GOOGLE_TOKEN_STORAGE_KEY);
  const profile = token ? decodeGoogleToken(token) : null;
  if (!token || !profile || Number(profile.exp || 0) * 1000 <= Date.now()) {
    sessionStorage.removeItem(GOOGLE_TOKEN_STORAGE_KEY);
    return null;
  }
  return token;
}

let googleIdToken = readStoredGoogleToken();

function getGoogleIdToken() {
  if (!googleIdToken) googleIdToken = readStoredGoogleToken();
  const profile = googleIdToken ? decodeGoogleToken(googleIdToken) : null;
  if (!profile || Number(profile.exp || 0) * 1000 <= Date.now()) {
    googleIdToken = null;
    sessionStorage.removeItem(GOOGLE_TOKEN_STORAGE_KEY);
  }
  return googleIdToken;
}

function getGoogleProfile() {
  const token = getGoogleIdToken();
  return token ? decodeGoogleToken(token) : null;
}

function updateAuthenticatedUi() {
  const profile = getGoogleProfile();
  const status = document.getElementById('google-auth-status');
  const sidebarUser = document.getElementById('sidebar-user');
  if (status) status.textContent = profile?.email ? `ลงชื่อเข้าใช้แล้ว: ${profile.email}` : 'ลงชื่อเข้าใช้แล้ว';
  if (sidebarUser && profile?.email) sidebarUser.textContent = profile.email;
}

function handleGoogleCredential(response) {
  googleIdToken = response?.credential || null;
  if (!googleIdToken) return;
  sessionStorage.setItem(GOOGLE_TOKEN_STORAGE_KEY, googleIdToken);
  updateAuthenticatedUi();
  window.dispatchEvent(new CustomEvent('google-authenticated', { detail: getGoogleProfile() }));
}

function requireAuthenticatedPage(loginUrl = '../index.html') {
  if (getGoogleIdToken()) {
    updateAuthenticatedUi();
    return true;
  }
  window.location.replace(loginUrl);
  return false;
}

function signOutGoogle() {
  googleIdToken = null;
  sessionStorage.removeItem(GOOGLE_TOKEN_STORAGE_KEY);
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  window.location.href = window.location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
}

function initGoogleSignIn() {
  if (getGoogleIdToken()) {
    updateAuthenticatedUi();
    window.dispatchEvent(new CustomEvent('google-authenticated', { detail: getGoogleProfile() }));
    return;
  }

  const render = () => {
    if (!window.google?.accounts?.id) {
      window.setTimeout(render, 100);
      return;
    }

    google.accounts.id.initialize({
      client_id: APP_CONFIG.googleClientId,
      callback: handleGoogleCredential,
      color_scheme: 'light'
    });

    const button = document.getElementById('google-signin-button');
    if (button) {
      button.innerHTML = '';
      google.accounts.id.renderButton(button, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        width: 300
      });
    }
  };

  render();
}
