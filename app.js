// =============================================
// CityFix - Municipal Complaint Platform
// Fully integrated with Firebase Auth + Firestore
// =============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
    getAuth,
    signInWithPopup,
    GoogleAuthProvider,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import {
    getFirestore,
    collection,
    addDoc,
    query,
    where,
    onSnapshot,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyCQ1cc8A2Vd0MWHYYd891c-dh2VWv5hFtA",
    authDomain: "cityfix-12f8e.firebaseapp.com",
    databaseURL: "https://cityfix-12f8e-default-rtdb.firebaseio.com",
    projectId: "cityfix-12f8e",
    storageBucket: "cityfix-12f8e.firebasestorage.app",
    messagingSenderId: "668200888655",
    appId: "1:668200888655:web:8798edf0179a8fa4e4fd3a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// --- State ---
let currentUserData = null;
let unsubscribeCitizen = null;
let unsubscribeAdmin = null;
let pendingAdminRegistration = false; // Flag to handle admin registration timing

// --- DOM Elements ---
const views = {
    landing: document.getElementById('view-landing'),
    citizen: document.getElementById('view-citizen-dashboard'),
    admin: document.getElementById('view-admin-dashboard')
};

const ui = {
    btnAdminPortal: document.getElementById('btn-admin-portal'),
    btnGoogleLogin: document.getElementById('btn-google-login'),
    btnAdminGoogleLogin: document.getElementById('btn-admin-google'),
    btnLogout: document.getElementById('btn-logout'),
    userProfile: document.getElementById('user-profile'),
    userName: document.getElementById('user-name'),
    userAvatar: document.getElementById('user-avatar'),

    modalAdmin: document.getElementById('modal-adminAuth'),
    closeModal: document.querySelector('.close-modal'),
    adminAuthCode: document.getElementById('admin-auth-code'),
    adminErrorMsg: document.getElementById('admin-error-msg'),

    formComplaint: document.getElementById('form-complaint'),
    btnGeolocate: document.getElementById('btn-geolocate'),
    btnSubmitComplaint: document.getElementById('btn-submit-complaint'),
    submitLoader: document.getElementById('submit-loader'),

    citizenList: document.getElementById('citizen-complaints-list'),
    adminList: document.getElementById('admin-complaints-list'),
    sortAdmin: document.getElementById('sort-complaints'),

    toast: document.getElementById('toast'),
    toastMsg: document.getElementById('toast-msg'),
    toastIcon: document.getElementById('toast-icon')
};

// =============================================
// UTILITIES
// =============================================

function showToast(message, isError = false) {
    ui.toastMsg.textContent = message;
    ui.toastIcon.style.background = isError ? 'var(--color-danger)' : 'var(--color-success)';
    ui.toastIcon.textContent = isError ? '!' : '✓';
    ui.toast.style.borderColor = isError ? 'var(--color-danger)' : 'var(--glass-border)';

    // Remove hidden first, then add show for animation
    ui.toast.classList.remove('hidden');
    // Force reflow so the browser registers the non-hidden state before animating
    void ui.toast.offsetWidth;
    ui.toast.classList.add('show');

    setTimeout(() => {
        ui.toast.classList.remove('show');
        // After animation out, re-hide
        setTimeout(() => ui.toast.classList.add('hidden'), 400);
    }, 3000);
}

// Instant, synchronous view switch — no race conditions
function switchView(viewName) {
    // Hide all views immediately
    Object.values(views).forEach(v => {
        v.classList.remove('active');
        v.classList.add('hidden');
    });

    // Show the target view
    const target = views[viewName];
    target.classList.remove('hidden');
    // Force reflow for CSS animation
    void target.offsetWidth;
    target.classList.add('active');

    // Update header
    if (viewName === 'landing') {
        ui.userProfile.classList.add('hidden');
        ui.btnAdminPortal.classList.remove('hidden');
    } else {
        ui.userProfile.classList.remove('hidden');
        ui.btnAdminPortal.classList.add('hidden');
    }
}

function updateProfileUI(user) {
    if (user) {
        ui.userName.textContent = user.displayName ? user.displayName.split(' ')[0] : 'User';
        ui.userAvatar.src = user.photoURL || '';
    }
}

function getStatusClass(status) {
    if (status === 'Resolved') return 'status-resolved';
    if (status === 'Rejected') return 'status-rejected';
    return 'status-pending';
}

function getPriorityClass(priority) {
    if (priority === 'High') return 'priority-high';
    if (priority === 'Medium') return 'priority-medium';
    return 'priority-low';
}

function formatDate(timestamp) {
    if (!timestamp || !timestamp.toDate) return 'Just now';
    try {
        const date = timestamp.toDate();
        return new Intl.DateTimeFormat('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: 'numeric'
        }).format(date);
    } catch (e) {
        return 'Just now';
    }
}

function cleanupListeners() {
    if (unsubscribeCitizen) { unsubscribeCitizen(); unsubscribeCitizen = null; }
    if (unsubscribeAdmin) { unsubscribeAdmin(); unsubscribeAdmin = null; }
}

// =============================================
// AUTH FLOW
// =============================================

async function handleUserLoggedIn(user) {
    let role = 'citizen';

    // If we just registered as admin, skip the check — we know they're admin
    if (pendingAdminRegistration) {
        role = 'admin';
        pendingAdminRegistration = false;
    } else {
        // Check Firestore for admin role
        try {
            const adminDoc = await getDoc(doc(db, "admins", user.uid));
            if (adminDoc.exists()) {
                role = 'admin';
            }
        } catch (err) {
            // Permission denied or network error — default to citizen
            console.warn("Could not check admin status, defaulting to citizen:", err.message);
        }
    }

    currentUserData = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        role: role
    };

    updateProfileUI(user);
    cleanupListeners();

    if (role === 'admin') {
        switchView('admin');
        setupAdminListener();
        showToast("Welcome, Admin");
    } else {
        switchView('citizen');
        setupCitizenListener(user.uid);
        showToast("Welcome, Citizen");
    }
}

function handleUserLoggedOut() {
    currentUserData = null;
    cleanupListeners();
    switchView('landing');
}

// Firebase auth state observer
onAuthStateChanged(auth, (user) => {
    if (user) {
        handleUserLoggedIn(user);
    } else {
        handleUserLoggedOut();
    }
});

// =============================================
// EVENT LISTENERS
// =============================================

// --- Citizen Google Login ---
ui.btnGoogleLogin.addEventListener('click', async () => {
    try {
        ui.btnGoogleLogin.disabled = true;
        ui.btnGoogleLogin.style.opacity = '0.7';
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Login Error:", error);
        if (error.code !== 'auth/popup-closed-by-user') {
            showToast("Login failed: " + error.message, true);
        }
    } finally {
        ui.btnGoogleLogin.disabled = false;
        ui.btnGoogleLogin.style.opacity = '1';
    }
});

// --- Admin Registration + Login ---
ui.btnAdminGoogleLogin.addEventListener('click', async () => {
    const code = ui.adminAuthCode.value.trim();

    // Validate authorization code
    if (code !== "CITYFIX_ADMIN_2024") {
        ui.adminErrorMsg.textContent = "Invalid authorization code.";
        ui.adminErrorMsg.classList.remove('hidden');
        return;
    }

    try {
        ui.adminErrorMsg.classList.add('hidden');
        ui.btnAdminGoogleLogin.disabled = true;
        ui.btnAdminGoogleLogin.style.opacity = '0.7';

        // Set the flag BEFORE signing in so handleUserLoggedIn knows to treat as admin
        pendingAdminRegistration = true;

        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        // Write to admins collection
        await setDoc(doc(db, "admins", user.uid), {
            email: user.email,
            displayName: user.displayName,
            registeredAt: serverTimestamp()
        }, { merge: true });

        // Close modal
        ui.modalAdmin.classList.add('hidden');
        ui.adminAuthCode.value = "";

        // If onAuthStateChanged already fired (user was already logged in),
        // we need to manually re-route since the flag was set after
        if (currentUserData && currentUserData.role !== 'admin') {
            currentUserData.role = 'admin';
            cleanupListeners();
            switchView('admin');
            setupAdminListener();
            showToast("Admin access granted!");
        }

    } catch (error) {
        console.error("Admin Login Error:", error);
        pendingAdminRegistration = false;
        if (error.code !== 'auth/popup-closed-by-user') {
            ui.adminErrorMsg.textContent = error.message;
            ui.adminErrorMsg.classList.remove('hidden');
        }
    } finally {
        ui.btnAdminGoogleLogin.disabled = false;
        ui.btnAdminGoogleLogin.style.opacity = '1';
    }
});

// --- Logout ---
ui.btnLogout.addEventListener('click', () => {
    signOut(auth);
});

// --- Admin Modal ---
ui.btnAdminPortal.addEventListener('click', () => {
    ui.modalAdmin.classList.remove('hidden');
});

ui.closeModal.addEventListener('click', () => {
    ui.modalAdmin.classList.add('hidden');
    ui.adminErrorMsg.classList.add('hidden');
});

// Close modal on backdrop click
document.querySelector('.modal-backdrop')?.addEventListener('click', () => {
    ui.modalAdmin.classList.add('hidden');
    ui.adminErrorMsg.classList.add('hidden');
});

// --- Geolocation ---
ui.btnGeolocate.addEventListener('click', () => {
    if (!("geolocation" in navigator)) {
        showToast("Geolocation is not supported by your browser", true);
        return;
    }

    const originalHTML = ui.btnGeolocate.innerHTML;
    ui.btnGeolocate.innerHTML = '<div class="loader" style="width:14px;height:14px;border-width:2px;border-top-color:var(--color-text-primary)"></div>';

    navigator.geolocation.getCurrentPosition(
        (position) => {
            document.getElementById('complaint-locality').value =
                `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
            ui.btnGeolocate.innerHTML = '✓';
            setTimeout(() => { ui.btnGeolocate.innerHTML = originalHTML; }, 2000);
        },
        () => {
            showToast("Location access denied or unavailable", true);
            ui.btnGeolocate.innerHTML = originalHTML;
        }
    );
});

// --- Submit Complaint ---
ui.formComplaint.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUserData) return;

    const submitSpan = ui.btnSubmitComplaint.querySelector('span');
    submitSpan.classList.add('hidden');
    ui.submitLoader.classList.remove('hidden');
    ui.btnSubmitComplaint.disabled = true;

    try {
        await addDoc(collection(db, "complaints"), {
            city: document.getElementById('complaint-city').value.trim(),
            locality: document.getElementById('complaint-locality').value.trim(),
            priority: document.getElementById('complaint-priority').value,
            description: document.getElementById('complaint-description').value.trim(),
            status: 'Pending',
            userId: currentUserData.uid,
            userEmail: currentUserData.email,
            userName: currentUserData.displayName || 'Citizen',
            createdAt: serverTimestamp()
        });

        ui.formComplaint.reset();
        showToast("Report submitted successfully!");
    } catch (error) {
        console.error("Error submitting complaint:", error);
        showToast("Failed to submit report: " + error.message, true);
    } finally {
        submitSpan.classList.remove('hidden');
        ui.submitLoader.classList.add('hidden');
        ui.btnSubmitComplaint.disabled = false;
    }
});

// =============================================
// DATA LISTENERS (Real-time Firestore)
// =============================================

function setupCitizenListener(uid) {
    if (unsubscribeCitizen) unsubscribeCitizen();

    const q = query(
        collection(db, "complaints"),
        where("userId", "==", uid)
    );

    unsubscribeCitizen = onSnapshot(q,
        (snapshot) => {
            if (snapshot.empty) {
                ui.citizenList.innerHTML = '<div class="loading-state"><p>You haven\'t filed any reports yet.</p></div>';
                return;
            }

            // Client-side sort by date (newest first)
            const sorted = [...snapshot.docs].sort((a, b) => {
                const dA = a.data().createdAt?.toDate?.() || new Date(0);
                const dB = b.data().createdAt?.toDate?.() || new Date(0);
                return dB - dA;
            });

            ui.citizenList.innerHTML = sorted.map(docSnap => {
                const d = docSnap.data();
                return `
                    <div class="glass-panel complaint-card ${getPriorityClass(d.priority)}">
                        <div class="card-header">
                            <span class="card-title">${d.city} — ${d.priority} Priority</span>
                            <span class="status-badge ${getStatusClass(d.status)}">${d.status}</span>
                        </div>
                        <div class="card-location">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path></svg>
                            ${d.locality}
                        </div>
                        <div class="card-desc">${d.description}</div>
                        <div class="card-footer">
                            <span>ID: ${docSnap.id.substring(0, 8).toUpperCase()}</span>
                            <span>${formatDate(d.createdAt)}</span>
                        </div>
                    </div>
                `;
            }).join('');
        },
        (error) => {
            console.error("Citizen data fetch error:", error);
            ui.citizenList.innerHTML = `<div class="loading-state"><p style="color:var(--color-danger)">Error loading data: ${error.message}</p></div>`;
        }
    );
}

function setupAdminListener(sortMethod = 'date-desc') {
    if (unsubscribeAdmin) unsubscribeAdmin();

    // Fetch ALL complaints (no server-side ordering to avoid index requirements)
    const q = query(collection(db, "complaints"));

    unsubscribeAdmin = onSnapshot(q,
        (snapshot) => {
            if (snapshot.empty) {
                ui.adminList.innerHTML = '<tr><td colspan="7" class="text-center py-4">No reports found in the system.</td></tr>';
                return;
            }

            // Client-side sorting
            let docs = [...snapshot.docs];

            if (sortMethod === 'priority') {
                const pMap = { 'High': 3, 'Medium': 2, 'Low': 1 };
                docs.sort((a, b) => (pMap[b.data().priority] || 0) - (pMap[a.data().priority] || 0));
            } else if (sortMethod === 'date-asc') {
                docs.sort((a, b) => {
                    const dA = a.data().createdAt?.toDate?.() || new Date(0);
                    const dB = b.data().createdAt?.toDate?.() || new Date(0);
                    return dA - dB;
                });
            } else {
                // date-desc (default)
                docs.sort((a, b) => {
                    const dA = a.data().createdAt?.toDate?.() || new Date(0);
                    const dB = b.data().createdAt?.toDate?.() || new Date(0);
                    return dB - dA;
                });
            }

            ui.adminList.innerHTML = docs.map(docSnap => {
                const d = docSnap.data();
                const id = docSnap.id;
                const priorityColor = d.priority === 'High' ? 'var(--color-danger)' :
                                      d.priority === 'Medium' ? 'var(--color-warning)' : 'var(--color-success)';
                return `
                    <tr>
                        <td>
                            <div style="font-size:0.85em; color:var(--color-text-secondary); margin-bottom:4px;">${id.substring(0, 8).toUpperCase()}</div>
                            ${formatDate(d.createdAt)}
                        </td>
                        <td>
                            <div style="font-weight:500">${d.userName || 'Citizen'}</div>
                            <div style="font-size:0.8em; color:var(--color-text-secondary)">${d.userEmail || ''}</div>
                        </td>
                        <td>
                            <div style="font-weight:500">${d.city || ''}</div>
                            <div style="font-size:0.85em; color:var(--color-text-secondary)">${d.locality || ''}</div>
                        </td>
                        <td>
                            <div style="max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${d.description || ''}">${d.description || ''}</div>
                        </td>
                        <td><span style="color:${priorityColor}; font-weight:600;">${d.priority}</span></td>
                        <td><span class="status-badge ${getStatusClass(d.status)}">${d.status}</span></td>
                        <td>
                            <select class="status-update" data-id="${id}" data-current="${d.status}">
                                <option value="Pending" ${d.status === 'Pending' ? 'selected' : ''}>Pending</option>
                                <option value="Resolved" ${d.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
                                <option value="Rejected" ${d.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                            </select>
                        </td>
                    </tr>
                `;
            }).join('');

            // Attach change listeners to status dropdowns
            document.querySelectorAll('.status-update').forEach(sel => {
                sel.addEventListener('change', async (e) => {
                    const docId = e.target.dataset.id;
                    const newStatus = e.target.value;
                    const originalStatus = e.target.dataset.current;
                    if (newStatus === originalStatus) return;

                    try {
                        e.target.disabled = true;
                        await updateDoc(doc(db, "complaints", docId), {
                            status: newStatus,
                            updatedAt: serverTimestamp()
                        });
                        showToast(`Status updated to ${newStatus}`);
                    } catch (err) {
                        console.error("Update error:", err);
                        showToast("Failed to update status", true);
                        e.target.value = originalStatus;
                    } finally {
                        e.target.disabled = false;
                    }
                });
            });
        },
        (error) => {
            console.error("Admin data fetch error:", error);
            ui.adminList.innerHTML = `<tr><td colspan="7" class="text-center py-4" style="color:var(--color-danger)">Permission Error: Update your Firestore Security Rules to allow reads on the "complaints" collection.</td></tr>`;
        }
    );
}

// --- Admin Sort Control ---
ui.sortAdmin.addEventListener('change', (e) => {
    setupAdminListener(e.target.value);
});
