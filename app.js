// ══════════════════════════════════════════════════════
//  CITY FIX – app.js  (Realtime Database, no Storage)
// ══════════════════════════════════════════════════════
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAnalytics }
  from "https://www.gstatic.com/firebasejs/12.10.0/firebase-analytics.js";
import {
  getAuth, GoogleAuthProvider,
  signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import {
  getDatabase, ref, push, update, get, onValue, query, orderByChild
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";

// ─── Config ────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCQ1cc8A2Vd0MWHYYd891c-dh2VWv5hFtA",
  authDomain: "cityfix-12f8e.firebaseapp.com",
  databaseURL: "https://cityfix-12f8e-default-rtdb.firebaseio.com",
  projectId: "cityfix-12f8e",
  storageBucket: "cityfix-12f8e.firebasestorage.app",
  messagingSenderId: "668200888655",
  appId: "1:668200888655:web:8798edf0179a8fa4e4fd3a"
};

const app  = initializeApp(firebaseConfig);
getAnalytics(app);
const auth = getAuth(app);
const db   = getDatabase(app);

// ─── Helpers ────────────────────────────────────────────
const el = id => document.getElementById(id);

function showView(which) {
  el('loading-overlay').style.display = 'none';
  el('view-landing').style.display    = (which === 'landing') ? 'flex'  : 'none';
  el('view-app').style.display        = (which === 'app')     ? 'flex'  : 'none';
}

function showPanel(id) {
  ['panel-feed','panel-new','panel-admin','panel-stats'].forEach(pid => {
    el(pid).style.display = (pid === id) ? 'flex' : 'none';
  });
}

function setActiveNav(targetBtn) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  if (targetBtn) targetBtn.classList.add('active');
}

function toast(msg, type = 'info') {
  const t = el('toast');
  t.textContent = msg;
  t.className   = `toast ${type}`;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 3600);
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function priorityClass(p) {
  return p === 'High' ? 'High' : p === 'Medium' ? 'Medium' : 'Low';
}

function statusCSSClass(s) {
  return (s || '').replace(' ', '-');
}

// ─── State ──────────────────────────────────────────────
let currentUser   = null;
let currentRole   = 'citizen';
let wantAdminRole = false;
let feedUnsub     = null;
let adminUnsub    = null;

// ─── Landing stats ──────────────────────────────────────
onValue(ref(db, 'complaints'), snap => {
  const all = snap.val() ? Object.values(snap.val()) : [];
  el('stat-total').textContent    = all.length;
  el('stat-resolved').textContent = all.filter(c => c.status === 'Resolved').length;
  el('stat-pending').textContent  = all.filter(c => c.status === 'Pending').length;
});

// ─── Auth ───────────────────────────────────────────────
el('btn-citizen-login').addEventListener('click', () => loginWith(false));
el('btn-admin-login').addEventListener('click',   () => loginWith(true));
el('btn-logout').addEventListener('click', () => signOut(auth));

async function loginWith(asAdmin) {
  wantAdminRole = asAdmin;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    toast('Login failed: ' + e.message, 'error');
  }
}

onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    await resolveRole(user);
    bootApp();
  } else {
    currentUser = null;
    currentRole = 'citizen';
    if (feedUnsub)  { feedUnsub();  feedUnsub  = null; }
    if (adminUnsub) { adminUnsub(); adminUnsub = null; }
    showView('landing');
  }
});

async function resolveRole(user) {
  if (wantAdminRole) {
    await update(ref(db, `users/${user.uid}`), {
      role: 'admin', email: user.email, name: user.displayName
    });
    wantAdminRole = false;
  }

  const snap = await get(ref(db, `users/${user.uid}/role`));
  if (snap.exists()) {
    currentRole = snap.val();
  } else {
    await update(ref(db, `users/${user.uid}`), {
      role: 'citizen', email: user.email, name: user.displayName
    });
    currentRole = 'citizen';
  }
}

function bootApp() {
  const name = currentUser.displayName || currentUser.email || 'User';
  el('user-avatar').textContent    = initials(name);
  el('user-name').textContent      = name.split(' ')[0];
  el('user-role-label').textContent = currentRole === 'admin' ? 'Admin' : 'Citizen';
  el('user-role-label').className  = 'user-role-badge' + (currentRole === 'admin' ? ' admin' : '');

  el('citizen-nav').style.display = currentRole === 'citizen' ? 'flex' : 'none';
  el('admin-nav').style.display   = currentRole === 'admin'   ? 'flex' : 'none';

  if (currentRole === 'admin') {
    showPanel('panel-admin');
    highlightNav('panel-admin');
    subscribeAdmin();
    subscribeAdminStats();
  } else {
    showPanel('panel-feed');
    highlightNav('panel-feed');
    subscribeFeed();
  }

  showView('app');
}

function highlightNav(panelId) {
  const btn = document.querySelector(`.nav-item[data-panel="${panelId}"]`);
  setActiveNav(btn);
}

// ─── Sidebar Nav ─────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    showPanel(btn.dataset.panel);
    setActiveNav(btn);
  });
});

el('btn-goto-new').addEventListener('click', () => {
  showPanel('panel-new');
  highlightNav('panel-new');
});

// ─── Geolocation ─────────────────────────────────────────
el('btn-geolocate').addEventListener('click', () => {
  const iconEl = el('geo-icon');
  iconEl.textContent = '⏳';
  if (!navigator.geolocation) {
    toast('Geolocation not supported by your browser.', 'error');
    iconEl.textContent = '📍';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      el('comp-location').value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
      iconEl.textContent = '✅';
    },
    () => {
      toast('Location access denied or unavailable.', 'error');
      iconEl.textContent = '📍';
    }
  );
});

// ─── Clear Form ──────────────────────────────────────────
el('btn-clear-form').addEventListener('click', () => {
  el('form-complaint').reset();
  el('geo-icon').textContent = '📍';
  ['err-category','err-priority','err-address','err-desc'].forEach(id => {
    el(id).textContent = '';
  });
});

// ─── Submit Report ───────────────────────────────────────
el('form-complaint').addEventListener('submit', async e => {
  e.preventDefault();
  if (!validateForm()) return;

  const submitBtn   = el('btn-submit-complaint');
  const labelEl     = el('submit-label');
  const spinnerEl   = el('submit-spinner');
  submitBtn.disabled = true;
  labelEl.style.display   = 'none';
  spinnerEl.style.display = 'inline-block';

  const complaint = {
    uid:         currentUser.uid,
    email:       currentUser.email,
    displayName: currentUser.displayName || currentUser.email,
    category:    el('comp-category').value,
    priority:    el('comp-priority').value,
    address:     el('comp-address').value.trim(),
    location:    el('comp-location').value.trim(),
    description: el('comp-description').value.trim(),
    status:      'Pending',
    createdAt:   Date.now()
  };

  try {
    await push(ref(db, 'complaints'), complaint);
    toast('✅ Report submitted successfully!', 'success');
    el('form-complaint').reset();
    el('geo-icon').textContent = '📍';
    showPanel('panel-feed');
    highlightNav('panel-feed');
  } catch (err) {
    toast('Submission failed: ' + err.message, 'error');
  } finally {
    submitBtn.disabled      = false;
    labelEl.style.display   = 'inline';
    spinnerEl.style.display = 'none';
  }
});

function validateForm() {
  const rules = [
    ['comp-category',    'err-category', 'Please select a category'],
    ['comp-priority',    'err-priority', 'Please select a priority'],
    ['comp-address',     'err-address',  'Please enter an address'],
    ['comp-description', 'err-desc',     'Please describe the issue'],
  ];
  let ok = true;
  rules.forEach(([fieldId, errId, msg]) => {
    const field = el(fieldId);
    const errEl = el(errId);
    if (!field.value.trim()) {
      errEl.textContent = msg;
      ok = false;
    } else {
      errEl.textContent = '';
    }
  });
  return ok;
}
