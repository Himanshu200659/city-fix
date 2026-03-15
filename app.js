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
    getDocs, 
    query, 
    where, 
    orderBy, 
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// --- State ---
let currentUserData = null; // { uid, email, displayName, photoURL, role: 'citizen' | 'admin' }
let unsubscribeCitizen = null;
let unsubscribeAdmin = null;

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
    toastMsg: document.getElementById('toast-msg')
};

// --- Utilities ---
function showToast(message, isError = false) {
    ui.toastMsg.textContent = message;
    ui.toast.style.borderColor = isError ? 'var(--color-danger)' : 'var(--glass-border)';
    document.getElementById('toast-icon').style.background = isError ? 'var(--color-danger)' : 'var(--color-success)';
    document.getElementById('toast-icon').textContent = isError ? '!' : '✓';
    
    ui.toast.classList.add('show');
    setTimeout(() => ui.toast.classList.remove('show'), 3000);
}

function switchView(viewName) {
    Object.values(views).forEach(v => {
        v.classList.remove('active');
        setTimeout(() => v.classList.add('hidden'), 300); // fade out duration
    });
    
    setTimeout(() => {
        views[viewName].classList.remove('hidden');
        // Trigger reflow for animation
        void views[viewName].offsetWidth;
        views[viewName].classList.add('active');
    }, 300);

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
        ui.userName.textContent = user.displayName?.split(' ')[0] || 'User';
        ui.userAvatar.src = user.photoURL || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ccc"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>';
    }
}

// --- Auth Flow ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Check role
        try {
            const adminDoc = await getDoc(doc(db, "admins", user.uid));
            currentUserData = {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                role: adminDoc.exists() ? 'admin' : 'citizen'
            };
            
            updateProfileUI(user);
            
            if (currentUserData.role === 'admin') {
                switchView('admin');
                setupAdminListener();
                showToast("Welcome back, Admin");
            } else {
                switchView('citizen');
                setupCitizenListener(user.uid);
                showToast("Citizen portal active");
            }
        } catch (error) {
            console.error("Not an admin or error fetching role:", error);
            // Default to citizen if the query fails (likely due to permissions)
            currentUserData = {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                role: 'citizen'
            };
            
            updateProfileUI(user);
            switchView('citizen');
            setupCitizenListener(user.uid);
            showToast("Citizen portal active");
        }
    } else {
        currentUserData = null;
        if (unsubscribeCitizen) unsubscribeCitizen();
        if (unsubscribeAdmin) unsubscribeAdmin();
        switchView('landing');
    }
});

// Regular Login
ui.btnGoogleLogin.addEventListener('click', async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Login Error:", error);
        showToast("Login failed. Please try again.", true);
    }
});

// Admin Auth Login/Registration
ui.btnAdminGoogleLogin.addEventListener('click', async () => {
    const code = ui.adminAuthCode.value.trim();
    if (code !== "CITYFIX_ADMIN_2024") { // Hardcoded demo code
        ui.adminErrorMsg.textContent = "Invalid authorization code.";
        ui.adminErrorMsg.classList.remove('hidden');
        return;
    }
    
    try {
        ui.adminErrorMsg.classList.add('hidden');
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        
        // Ensure user is in admins collection
        await setDoc(doc(db, "admins", user.uid), {
            email: user.email,
            registeredAt: serverTimestamp()
        }, { merge: true });
        
        ui.modalAdmin.classList.add('hidden');
        ui.adminAuthCode.value = "";
        
        // onAuthStateChanged will handle routing
    } catch (error) {
        console.error("Admin Login Error:", error);
        ui.adminErrorMsg.textContent = error.message;
        ui.adminErrorMsg.classList.remove('hidden');
    }
});

ui.btnLogout.addEventListener('click', () => {
    signOut(auth);
});

// Modal Toggles
ui.btnAdminPortal.addEventListener('click', () => {
    ui.modalAdmin.classList.remove('hidden');
});

ui.closeModal.addEventListener('click', () => {
    ui.modalAdmin.classList.add('hidden');
    ui.adminErrorMsg.classList.add('hidden');
});

// --- Feature: Geolocation ---
ui.btnGeolocate.addEventListener('click', () => {
    if ("geolocation" in navigator) {
        ui.btnGeolocate.innerHTML = '<div class="loader" style="width:14px;height:14px;border-width:2px;border-top-color:var(--color-text-primary)"></div>';
        navigator.geolocation.getCurrentPosition(
            (position) => {
                document.getElementById('complaint-locality').value = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
                ui.btnGeolocate.innerHTML = '✓';
                setTimeout(() => {
                    ui.btnGeolocate.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
                }, 2000);
            },
            (error) => {
                showToast("Location access denied or unavailable", true);
                ui.btnGeolocate.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path></svg>';
            }
        );
    } else {
        showToast("Geolocation is not supported by your browser", true);
    }
});

// --- Feature: Submit Complaint (Data Layer) ---
ui.formComplaint.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUserData) return;

    ui.btnSubmitComplaint.querySelector('span').classList.add('hidden');
    ui.submitLoader.classList.remove('hidden');
    ui.btnSubmitComplaint.disabled = true;

    try {
        const newComplaint = {
            city: document.getElementById('complaint-city').value,
            locality: document.getElementById('complaint-locality').value,
            priority: document.getElementById('complaint-priority').value,
            description: document.getElementById('complaint-description').value,
            status: 'Pending',
            userId: currentUserData.uid,
            userEmail: currentUserData.email,
            userName: currentUserData.displayName,
            createdAt: serverTimestamp()
        };

        await addDoc(collection(db, "complaints"), newComplaint);
        
        ui.formComplaint.reset();
        showToast("Report submitted successfully");
    } catch (error) {
        console.error("Error submitting complaint: ", error);
        showToast("Failed to submit report", true);
    } finally {
        ui.btnSubmitComplaint.querySelector('span').classList.remove('hidden');
        ui.submitLoader.classList.add('hidden');
        ui.btnSubmitComplaint.disabled = false;
    }
});

// --- Feature: Read Data (Real-time Listeners) ---

function getStatusClass(status) {
    if(status === 'Resolved') return 'status-resolved';
    if(status === 'Rejected') return 'status-rejected';
    return 'status-pending';
}

function getPriorityClass(priority) {
    if(priority === 'High') return 'priority-high';
    if(priority === 'Medium') return 'priority-medium';
    return 'priority-low';
}

function formatDate(timestamp) {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate();
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute:'numeric' }).format(date);
}

function setupCitizenListener(uid) {
    if (unsubscribeCitizen) unsubscribeCitizen();
    
    const q = query(
        collection(db, "complaints"), 
        where("userId", "==", uid)
    );

    unsubscribeCitizen = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            ui.citizenList.innerHTML = `<div class="loading-state"><p>You haven't filed any reports yet.</p></div>`;
            return;
        }

        let docsObj = snapshot.docs.sort((a,b) => {
            const dateA = a.data().createdAt?.toDate() || new Date(0);
            const dateB = b.data().createdAt?.toDate() || new Date(0);
            return dateB - dateA;
        });

        ui.citizenList.innerHTML = docsObj.map(doc => {
            const data = doc.data();
            return `
                <div class="glass-panel complaint-card ${getPriorityClass(data.priority)}">
                    <div class="card-header">
                        <span class="card-title">${data.city} - ${data.priority} Priority</span>
                        <span class="status-badge ${getStatusClass(data.status)}">${data.status}</span>
                    </div>
                    <div class="card-location">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path></svg>
                        ${data.locality}
                    </div>
                    <div class="card-desc">${data.description}</div>
                    <div class="card-footer">
                        <span>ID: ${doc.id.substring(0,8).toUpperCase()}</span>
                        <span>${formatDate(data.createdAt)}</span>
                    </div>
                </div>
            `;
        }).join('');
    }, (error) => {
        // If index is missing initially, query might fail. We'll show an error but Firebase console will link the index creation.
        console.error("Citizen data fetch error. This may require a Firestore composite index:", error);
        ui.citizenList.innerHTML = `<div class="loading-state"><p style="color:var(--color-danger)">Error loading data. If deploying for the first time, check Firestore indexes.</p></div>`;
    });
}

function setupAdminListener(sortMethod = 'date-desc') {
    if (unsubscribeAdmin) unsubscribeAdmin();
    
    let q;
    const complaintsRef = collection(db, "complaints");
    
    // Simple sorts to avoid needing multiple composite indexes
    q = query(complaintsRef); // Pull all and sort client-side to prevent complex index delays

    unsubscribeAdmin = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            ui.adminList.innerHTML = `<tr><td colspan="7" class="text-center py-4">No reports found in the system.</td></tr>`;
            return;
        }

        let docs = snapshot.docs;
        
        // Client-side priority and date soft if requested
        if (sortMethod === 'priority') {
            const priorityMap = { 'High': 3, 'Medium': 2, 'Low': 1 };
            docs = docs.sort((a,b) => {
                const pA = priorityMap[a.data().priority] || 0;
                const pB = priorityMap[b.data().priority] || 0;
                return pB - pA;
            });
        } else if (sortMethod === 'date-desc') {
            docs = docs.sort((a,b) => {
                const dateA = a.data().createdAt?.toDate() || new Date(0);
                const dateB = b.data().createdAt?.toDate() || new Date(0);
                return dateB - dateA;
            });
        } else if (sortMethod === 'date-asc') {
            docs = docs.sort((a,b) => {
                const dateA = a.data().createdAt?.toDate() || new Date(0);
                const dateB = b.data().createdAt?.toDate() || new Date(0);
                return dateA - dateB;
            });
        }

        ui.adminList.innerHTML = docs.map(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;
            return `
                <tr>
                    <td>
                        <div style="font-size:0.85em; color:var(--color-text-secondary); margin-bottom:4px;">${id.substring(0,8).toUpperCase()}</div>
                        ${formatDate(data.createdAt)}
                    </td>
                    <td>
                        <div style="font-weight:500">${data.userName || 'Citizen'}</div>
                        <div style="font-size:0.8em; color:var(--color-text-secondary)">${data.userEmail}</div>
                    </td>
                    <td><div style="font-weight:500">${data.city}</div><div style="font-size:0.85em; color:var(--color-text-secondary)">${data.locality}</div></td>
                    <td><div style="max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${data.description}">${data.description}</div></td>
                    <td><span style="color: ${data.priority==='High'?'var(--color-danger)':data.priority==='Medium'?'var(--color-warning)':'var(--color-success)'}; font-weight:600;">${data.priority}</span></td>
                    <td><span class="status-badge ${getStatusClass(data.status)}">${data.status}</span></td>
                    <td>
                        <select class="status-update" data-id="${id}" data-current="${data.status}">
                            <option value="Pending" ${data.status === 'Pending' ? 'selected' : ''}>Pending</option>
                            <option value="Resolved" ${data.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
                            <option value="Rejected" ${data.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                        </select>
                    </td>
                </tr>
            `;
        }).join('');
        
        // Attach listeners to new selects
        document.querySelectorAll('.status-update').forEach(select => {
            select.addEventListener('change', async (e) => {
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
                    e.target.value = originalStatus; // revert visual
                } finally {
                    e.target.disabled = false;
                }
            });
        });
    }, (error) => {
        console.error("Admin data fetch error:", error);
        ui.adminList.innerHTML = `<tr><td colspan="7" class="text-center py-4" style="color:var(--color-danger)">Firebase Permission Error. Please check your Firestore Security Rules to allow reading the 'complaints' collection.</td></tr>`;
    });
}

// Admin Sorting Event
ui.sortAdmin.addEventListener('change', (e) => {
    setupAdminListener(e.target.value);
});
