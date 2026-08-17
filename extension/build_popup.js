const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'popup.js');
const origCode = fs.readFileSync(srcPath, 'utf8');

const anchor = 'function parseActiveGoals(goalString)';
const index = origCode.indexOf(anchor);

if (index === -1) {
    console.error("Could not find scraping functions anchor");
    process.exit(1);
}

const scrapingLogic = origCode.substring(index);

const newTopLogic = `const API_BASE = 'http://127.0.0.1:8000';
let currentUser = null;
let appInitialized = false;

// UI Elements (Existing + New)
const closeBtn = document.getElementById('closeBtn');
const authStatus = document.getElementById('authStatus');
const authStatusText = document.getElementById('authStatusText');
const apiStatus = document.getElementById('apiStatus');
const apiStatusText = document.getElementById('apiStatusText');
const apiInfoBox = document.getElementById('apiInfoBox');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const scrapeExportBtn = document.getElementById('scrapeExportBtn');
const clearDataBtn = document.getElementById('clearDataBtn');
const consoleLog = document.getElementById('consoleLog');
const stopExportBtn = document.getElementById('stopExportBtn');

// Configuration State
let parkId = null;
let detectedEndpoint = null;
let stopRequested = false;

// Token Helper
async function getAuthHeaders() {
  const token = (await chrome.storage.local.get(['access_token'])).access_token;
  return {
    'Authorization': \`Bearer \${token}\`,
    'Content-Type': 'application/json'
  };
}

// Auth functions
async function checkSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['access_token'], async (result) => {
      if (!result.access_token) return resolve(null);
      try {
        const res = await fetch(\`\${API_BASE}/api/auth/me\`, {
          headers: { 'Authorization': \`Bearer \${result.access_token}\` }
        });
        if (res.ok) {
          const user = await res.json();
          resolve(user);
        } else {
          resolve(null);
        }
      } catch (err) {
        resolve(null);
      }
    });
  });
}

async function handleLogin(email, password) {
  const res = await fetch(\`\${API_BASE}/api/auth/login\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  if (res.status === 403) {
    const errorData = await res.json();
    throw new Error(errorData.detail || 'Forbidden');
  } else if (res.status === 401) {
    throw new Error('Invalid email or password');
  } else if (!res.ok) {
    throw new Error('Login failed');
  }
  
  const data = await res.json();
  await chrome.storage.local.set({ access_token: data.access_token });
  return data.user;
}

function handleLogout() {
  chrome.storage.local.remove(['access_token'], () => {
    currentUser = null;
    showAuthScreen();
  });
}

function showAuthScreen() {
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'block';
}

function showAppScreen(user) {
  currentUser = user;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'flex';
  
  if (user && user.full_name) {
    document.getElementById('app-header-title').textContent = \`Welcome, \${user.full_name}\`;
  } else {
    document.getElementById('app-header-title').textContent = \`Yango Fleet Exporter\`;
  }
  
  // Tab visibility based on packages
  const activePackages = user.packages || [];
  const hasDataScraping = activePackages.some(p => p.name === 'data_scraping' && p.status === 'active');
  const hasDbSync = activePackages.some(p => p.name === 'db_sync' && p.status === 'active');
  
  const tabScraping = document.getElementById('tab-scraping');
  const tabDbSync = document.getElementById('tab-dbsync');
  
  if (hasDataScraping) tabScraping.style.display = 'block';
  else tabScraping.style.display = 'none';
  
  if (hasDbSync) tabDbSync.style.display = 'block';
  else tabDbSync.style.display = 'none';
  
  // Pick first available tab
  if (hasDataScraping) switchTab('panel-scraping');
  else if (hasDbSync) switchTab('panel-dbsync');
  else switchTab('panel-inquiry');
}

// Module navigation
function switchTab(panelId) {
  // Hide all panels
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  // Remove active from all tabs
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  
  // Show target
  const targetPanel = document.getElementById(panelId);
  const targetTab = document.querySelector(\`.tab[data-target="\${panelId}"]\`);
  
  if (targetPanel) targetPanel.classList.add('active');
  if (targetTab) targetTab.classList.add('active');
  
  // Load content dynamically
  if (panelId === 'panel-dbsync') {
    loadSyncStats();
    loadDataPreview();
  } else if (panelId === 'panel-inquiry') {
    loadMyInquiries();
  } else if (panelId === 'panel-review') {
    loadAllReviews();
  }
}

// Field config functions
async function loadFieldConfig() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(\`\${API_BASE}/api/fields/config\`, { headers });
    if (!res.ok) return;
    const data = await res.json();
    
    const reqList = document.getElementById('required-fields-list');
    const optList = document.getElementById('optional-fields-list');
    
    // Clear lists (keep label)
    reqList.innerHTML = '<label>Required</label>';
    optList.innerHTML = '<label>Optional</label>';
    
    // Required fields (locked)
    if (data.required_fields) {
      data.required_fields.forEach(field => {
        const div = document.createElement('div');
        div.className = 'checkbox-item';
        div.innerHTML = \`<input type="checkbox" checked disabled> 🔒 \${field}\`;
        reqList.appendChild(div);
      });
    }
    
    // Optional fields
    if (data.optional_fields) {
      Object.entries(data.optional_fields).forEach(([field, enabled]) => {
        const div = document.createElement('div');
        div.className = 'checkbox-item';
        div.innerHTML = \`<input type="checkbox" id="field_\${field}" \${enabled ? 'checked' : ''}> \${field}\`;
        optList.appendChild(div);
      });
    }
  } catch (e) {
    console.error("Error loading field config", e);
  }
}

async function saveFieldConfig() {
  try {
    const checkboxes = document.querySelectorAll('#optional-fields-list input[type="checkbox"]');
    const fields = {};
    checkboxes.forEach(cb => {
      const fieldName = cb.id.replace('field_', '');
      fields[fieldName] = cb.checked;
    });
    
    const headers = await getAuthHeaders();
    const res = await fetch(\`\${API_BASE}/api/fields/config\`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ fields })
    });
    
    if (res.ok) {
      alert('Configuration saved successfully');
    } else {
      alert('Failed to save configuration');
    }
  } catch (e) {
    console.error("Error saving field config", e);
  }
}

// DB Sync functions  
async function loadSyncStats() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(\`\${API_BASE}/api/data/stats\`, { headers });
    if (res.ok) {
      const stats = await res.json();
      document.getElementById('sync-stats').innerHTML = \`
        Total Records: \${stats.total_records || 0}<br>
        Total Drivers: \${stats.total_drivers || 0}<br>
        Last Sync: \${stats.last_sync || 'Never'}
      \`;
    }
  } catch (e) {
    document.getElementById('sync-stats').innerText = "Error loading stats";
  }
}

async function syncData() {
  alert("Data sync is handled automatically during Fetch & Export. Pushing cached data not fully implemented.");
}

async function loadDataPreview() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(\`\${API_BASE}/api/data?limit=10\`, { headers });
    if (res.ok) {
      const data = await res.json();
      const list = data.data || [];
      const container = document.getElementById('data-preview');
      if (list.length === 0) {
        container.innerHTML = "No data available.";
        return;
      }
      container.innerHTML = list.map(item => \`
        <div style="padding:4px; border-bottom:1px solid var(--border-color)">
          \${item.trip_date || ''} - \${item.rider_name || 'Unknown'} - Rs \${item.total_collection || 0}
        </div>
      \`).join('');
    }
  } catch (e) {
    document.getElementById('data-preview').innerText = "Error loading data preview";
  }
}

// Inquiry functions
async function submitInquiry() {
  const subject = document.getElementById('inquiry-subject').value;
  const message = document.getElementById('inquiry-message').value;
  if (!subject || !message) {
    alert("Please fill in both subject and message");
    return;
  }
  
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(\`\${API_BASE}/api/inquiries\`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ subject, message })
    });
    
    if (res.ok) {
      document.getElementById('inquiry-subject').value = '';
      document.getElementById('inquiry-message').value = '';
      alert("Inquiry submitted successfully");
      loadMyInquiries();
    } else {
      alert("Failed to submit inquiry");
    }
  } catch (e) {
    console.error("Error submitting inquiry", e);
  }
}

async function loadMyInquiries() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(\`\${API_BASE}/api/inquiries/my\`, { headers });
    if (res.ok) {
      const inquiries = await res.json();
      const container = document.getElementById('inquiries-list');
      if (inquiries.length === 0) {
        container.innerHTML = "No inquiries yet.";
        return;
      }
      container.innerHTML = inquiries.map(i => \`
        <div class="inquiry-item">
          <strong>\${i.subject}</strong> <span class="badge \${i.status === 'resolved' ? 'badge-success' : 'badge-warning'}">\${i.status}</span><br>
          <span style="color: var(--text-muted)">\${i.message}</span>
        </div>
      \`).join('');
    }
  } catch (e) {
    document.getElementById('inquiries-list').innerText = "Error loading inquiries";
  }
}

// Review functions
let selectedRating = 0;
async function submitReview() {
  const comment = document.getElementById('review-comment').value;
  if (selectedRating === 0 || !comment) {
    alert("Please select a rating and write a comment");
    return;
  }
  
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(\`\${API_BASE}/api/reviews\`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rating: selectedRating, comment })
    });
    
    if (res.ok) {
      alert("Review submitted successfully");
      loadAllReviews();
    } else {
      alert("Failed to submit review");
    }
  } catch (e) {
    console.error("Error submitting review", e);
  }
}

async function loadAllReviews() {
  try {
    // Reviews are public, but we can pass auth headers just in case
    const res = await fetch(\`\${API_BASE}/api/reviews\`);
    if (res.ok) {
      const reviews = await res.json();
      const container = document.getElementById('reviews-list');
      if (reviews.length === 0) {
        container.innerHTML = "No reviews yet.";
        return;
      }
      container.innerHTML = reviews.map(r => \`
        <div class="review-item">
          <strong>\${r.user_name || 'Anonymous'}</strong>: \${'★'.repeat(r.rating)}\${'☆'.repeat(5-r.rating)}<br>
          <span style="color: var(--text-muted)">\${r.comment}</span>
        </div>
      \`).join('');
    }
  } catch (e) {
    document.getElementById('reviews-list').innerText = "Error loading reviews";
  }
}

// Wire up events on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
  const loginForm = document.getElementById('login-form');
  const authMsg = document.getElementById('auth-msg');
  const logoutBtn = document.getElementById('logoutBtn');
  
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const pass = document.getElementById('login-password').value;
      try {
        authMsg.textContent = 'Logging in...';
        authMsg.className = 'auth-msg info';
        const user = await handleLogin(email, pass);
        authMsg.textContent = '';
        showAppScreen(user);
        initializeApp();
      } catch (err) {
        authMsg.textContent = err.message;
        authMsg.className = 'auth-msg error';
      }
    });
  }

  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  const user = await checkSession();
  if (user) {
    showAppScreen(user);
    initializeApp();
  } else {
    showAuthScreen();
  }
  
  // Module Tabs logic
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const target = e.target.getAttribute('data-target');
      if (target) switchTab(target);
    });
  });
  
  // New buttons logic
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  if (saveConfigBtn) saveConfigBtn.addEventListener('click', saveFieldConfig);
  
  const syncNowBtn = document.getElementById('syncNowBtn');
  if (syncNowBtn) syncNowBtn.addEventListener('click', syncData);
  
  const refreshDataBtn = document.getElementById('refreshDataBtn');
  if (refreshDataBtn) refreshDataBtn.addEventListener('click', loadDataPreview);
  
  const submitInquiryBtn = document.getElementById('submitInquiryBtn');
  if (submitInquiryBtn) submitInquiryBtn.addEventListener('click', submitInquiry);
  
  const submitReviewBtn = document.getElementById('submitReviewBtn');
  if (submitReviewBtn) submitReviewBtn.addEventListener('click', submitReview);
  
  // Star rating interactive logic
  const stars = document.querySelectorAll('#review-stars span');
  stars.forEach(star => {
    star.addEventListener('mouseover', (e) => {
      const val = parseInt(e.target.getAttribute('data-value'));
      stars.forEach(s => {
        const sVal = parseInt(s.getAttribute('data-value'));
        s.style.color = sVal <= val ? '#f59f00' : 'var(--border-color)';
      });
    });
    star.addEventListener('mouseout', () => {
      stars.forEach(s => {
        const sVal = parseInt(s.getAttribute('data-value'));
        s.style.color = sVal <= selectedRating ? '#f59f00' : 'var(--border-color)';
      });
    });
    star.addEventListener('click', (e) => {
      selectedRating = parseInt(e.target.getAttribute('data-value'));
      stars.forEach(s => {
        const sVal = parseInt(s.getAttribute('data-value'));
        s.style.color = sVal <= selectedRating ? '#f59f00' : 'var(--border-color)';
      });
    });
  });
});

async function initializeApp() {
  if (appInitialized) return;
  appInitialized = true;
  
  initializeDates();
  await checkAuth();
  await loadSavedEndpoint();
  await loadFieldConfig();
  
  // Wire up existing event listeners
  scrapeExportBtn.addEventListener('click', runFullExport);
  clearDataBtn.addEventListener('click', clearSavedEndpoint);

  closeBtn.addEventListener('click', () => {
    window.close();
  });
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'YANGO_API_INTERCEPT') {
      handleApiIntercept(message);
    }
  });

  stopExportBtn.addEventListener('click', () => {
    stopRequested = true;
    stopExportBtn.textContent = "Stopping...";
    stopExportBtn.disabled = true;
  });
}

\n\n`;

const finalCode = newTopLogic + scrapingLogic;
fs.writeFileSync(srcPath, finalCode);
console.log("Successfully rebuilt popup.js");
