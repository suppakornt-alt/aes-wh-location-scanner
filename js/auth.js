let googleIdToken = null;

function handleGoogleCredential(response) {
  googleIdToken = response?.credential || null;
  if (!googleIdToken) return;

  const status = document.getElementById('google-auth-status');
  if (status) status.textContent = 'ลงชื่อเข้าใช้แล้ว';
  window.dispatchEvent(new CustomEvent('google-authenticated'));
}

function getGoogleIdToken() {
  return googleIdToken;
}

function initGoogleSignIn() {
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
      google.accounts.id.renderButton(button, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        width: 280
      });
    }
  };

  render();
}
