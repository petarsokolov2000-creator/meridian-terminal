// System notifications for price alerts. Optional: without permission, alerts still show as
// messages inside Meridian.
//   PC:    the browser's notifications (shown by Windows). They work while the Meridian window
//          is open, also minimised or behind other windows; not after it is closed.
//   Phone: the Android app's native side (window.AndroidApp, in app versions that have it) shows
//          them, and also checks the alerts itself about every 15 minutes while the app is
//          closed. The page hands it the pending alerts (syncAlerts) and collects what it
//          triggered in the meantime (takeFired).

const app = () => window.AndroidApp || null;
export const onPhone = () => !!window.AndroidNet;
/** True in a phone app new enough to notify and to check alerts in the background. */
export const hasBackground = () => !!app();
export const APP_PAGE = 'https://github.com/petarsokolov2000-creator/meridian-terminal/releases/tag/android';

function call(name, ...args) {
  try {
    const a = app();
    return a && typeof a[name] === 'function' ? a[name](...args) : null;
  } catch {
    return null;
  }
}
const parse = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

/** What the phone app reports about itself: versions, last update check, alert checks. Null on a PC. */
export const appInfo = () => parse(call('info'), null);

/** 'granted' | 'denied' | 'ask' | 'old-app' (a phone app without notifications) | 'unsupported' */
export function permission() {
  if (app()) return appInfo()?.notify || 'ask';
  if (onPhone()) return 'old-app';
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission === 'default' ? 'ask' : Notification.permission;
}

/** Asks for permission to notify; resolves to the new permission() value. */
export function request() {
  if (app()) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(permission()), 60e3);
      window.__meridianNotify = (state) => {
        clearTimeout(timer);
        resolve(state || permission());
      };
      call('requestNotifications');
    });
  }
  if (!('Notification' in window)) return Promise.resolve(permission());
  try {
    return Promise.resolve(Notification.requestPermission()).then(() => permission(), () => permission());
  } catch {
    return Promise.resolve(permission());
  }
}

/** Shows one system notification; false if it couldn't (no permission, not supported). */
export function show(id, title, body) {
  if (app()) return permission() === 'granted' && call('showNotification', String(id), String(title), String(body)) === true;
  if (permission() !== 'granted') return false;
  try {
    const n = new Notification(title, { body, tag: `meridian-${id}` });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/** Phone: the alerts still waiting, for the app's background checks. rows: [{id, sym, y, op, v, dp, s10}] */
export const syncAlerts = (rows) => call('syncAlerts', JSON.stringify(rows));
/** Phone: alerts the app triggered while Meridian was closed, [{id, price, at}]; reading clears them. */
export const takeFired = () => parse(call('takeFired'), []);
/** Phone: run the background check right now; resolves to its one-line result. */
export function checkNow() {
  if (!app()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('no answer within 60 s'), 60e3);
    window.__meridianAlertCheck = (text) => {
      clearTimeout(timer);
      resolve(text);
    };
    call('checkAlertsNow');
  });
}
export const openSettings = (which) => call('openSettings', which);
