import { state } from '../shared/state.js';

const $ = id => document.getElementById(id);
let initializeApp = async () => {};

export function showLoginScreen(message = '') {
  $('app-shell').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
  $('login-error').textContent = message;
  $('login-password').value = '';
  if (message) $('login-username').focus();
}

export function showAuthenticatedApp() {
  $('auth-screen').classList.add('hidden');
  $('app-shell').classList.remove('hidden');
}

async function initializeAuthenticatedApp() {
  showAuthenticatedApp();
  if (!state.appInitialization) {
    state.appInitialization = initializeApp().catch(error => {
      state.appInitialization = null;
      console.error('StudyBuddy could not initialize after sign-in.', error);
      showLoginScreen('Could not load your study desk. Please sign in again.');
    });
  }
  return state.appInitialization;
}

export async function checkAuthentication() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not check the sign-in session.');
    const result = await response.json();
    if (result.authenticated === true) {
      await initializeAuthenticatedApp();
    } else {
      showLoginScreen();
    }
  } catch {
    showLoginScreen('Could not reach StudyBuddy. Check your connection and try again.');
  }
}

export function init(deps = {}) {
  initializeApp = deps.initializeApp || initializeApp;
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (state.loginPending) return;
    state.loginPending = true;
    const submit = $('login-submit');
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    $('login-error').textContent = '';
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'StudyBuddy'
        },
        body: JSON.stringify({
          username: $('login-username').value,
          password: $('login-password').value
        })
      });
      const result = await response.json();
      if (!response.ok) {
        $('login-error').textContent = response.status === 429
          ? result.error || 'Too many sign-in attempts. Please wait and try again.'
          : response.status === 401
            ? 'Incorrect username or password'
            : result.error || 'Could not sign in right now. Please try again.';
        return;
      }
      $('login-password').value = '';
      await initializeAuthenticatedApp();
    } catch {
      $('login-error').textContent = 'Could not reach StudyBuddy. Check your connection and try again.';
    } finally {
      state.loginPending = false;
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  });
  $('toggle-login-password').addEventListener('click', () => {
    const password = $('login-password');
    const visible = password.type === 'text';
    password.type = visible ? 'password' : 'text';
    $('toggle-login-password').textContent = visible ? 'Show' : 'Hide';
    $('toggle-login-password').setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
    $('toggle-login-password').setAttribute('aria-pressed', String(!visible));
  });
  $('logout-btn').addEventListener('click', async () => {
    const button = $('logout-btn');
    button.disabled = true;
    $('logout-status').textContent = '';
    $('logout-status').classList.add('hidden');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'StudyBuddy'
        },
        body: '{}'
      });
      if (!response.ok) throw new Error('Could not log out right now. Please try again.');
      state.appInitialization = null;
      showLoginScreen();
      $('login-username').focus();
    } catch (error) {
      $('logout-status').textContent = error.message || 'Could not log out right now. Please try again.';
      $('logout-status').classList.remove('hidden');
    } finally {
      button.disabled = false;
    }
  });
  checkAuthentication();
}
