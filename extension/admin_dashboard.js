window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  event.preventDefault();
});

const API_BASE = 'http://127.0.0.1:8000';

document.addEventListener('DOMContentLoaded', async () => {
  // Check authentication
  const token = await getToken();
  if (!token) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;"><h2>Access Denied</h2><p>Please log in through the extension popup first.</p></div>';
    return;
  }

  // Verify Admin Role
  try {
    const user = await fetchMe(token);
    if (!user || user.role !== 'admin') {
      document.body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--danger)"><h2>Access Denied</h2><p>You do not have administrator privileges.</p></div>';
      return;
    }
    document.getElementById('admin-name-display').textContent = user.full_name || user.email;
    document.getElementById('current-date-display').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch (e) {
    showToast('Failed to authenticate session.', 'error');
  }

  // Navigation Setup
  setupNavigation();
  
  // Logout Setup
  document.getElementById('logoutBtn').addEventListener('click', () => {
    chrome.storage.local.remove(['access_token'], () => {
      window.close(); // Close dashboard on logout
    });
  });

  // Initial Data Load
  loadDashboardData();
  
  // Form Setup
  document.getElementById('create-user-form').addEventListener('submit', handleCreateUser);
});

// --- API Helpers ---

async function getToken() {
  const data = await chrome.storage.local.get(['access_token']);
  return data.access_token;
}

async function getAuthHeaders() {
  const token = await getToken();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function fetchMe(token) {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Unauthorized');
  return await res.json();
}

// --- Navigation ---

function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.content-section');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      // Update active nav
      navItems.forEach(nav => nav.classList.remove('active'));
      navItems.forEach(nav => nav.removeAttribute('aria-current'));
      item.classList.add('active');
      item.setAttribute('aria-current', 'page');

      // Update active section
      const targetId = item.getAttribute('data-target');
      sections.forEach(sec => sec.classList.remove('active'));
      document.getElementById(targetId).classList.add('active');

      // Change header title
      const titleText = item.querySelector('span:last-child').textContent;
      document.querySelector('.header-title h1').textContent = titleText === 'Dashboard' ? 'Dashboard Overview' : titleText;

      // Load section data
      loadSectionData(targetId);
    });
  });
}

function loadSectionData(sectionId) {
  switch (sectionId) {
    case 'section-dashboard':
      loadDashboardData();
      break;
    case 'section-users':
      loadUsersData();
      break;
    case 'section-dbaccess':
      loadPackageRequests();
      break;
    case 'section-inquiries':
      loadInquiriesData();
      break;
    case 'section-metrics':
      loadMetricsData();
      break;
  }
}

// --- Data Loaders ---

async function loadDashboardData() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/admin/metrics`, { headers });
    if (!res.ok) throw new Error('Failed to fetch metrics');
    const data = await res.json();

    // Update stats
    if (data.global_stats) {
      document.getElementById('stat-total-users').textContent = data.global_stats.total_users || 0;
      document.getElementById('stat-active-users').textContent = data.global_stats.active_users || 0;
      document.getElementById('stat-total-scrapes').textContent = data.global_stats.total_scrape_logs || 0;
      document.getElementById('stat-total-records').textContent = data.global_stats.total_data_records || 0;
    }

    // Update recent activity (mocking from user metrics logs for now)
    const activityFeed = document.getElementById('recent-activity-feed');
    activityFeed.innerHTML = '';
    
    let allLogs = [];
    if (data.user_metrics) {
      data.user_metrics.forEach(u => {
        if (u.recent_logs) {
          u.recent_logs.forEach(log => {
            allLogs.push({ user: u.full_name || u.email, ...log });
          });
        }
      });
    }
    
    // Sort by created_at desc
    allLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const recentLogs = allLogs.slice(0, 5);
    
    if (recentLogs.length === 0) {
      activityFeed.innerHTML = '<div class="text-muted">No recent activity found.</div>';
    } else {
      recentLogs.forEach(log => {
        const item = document.createElement('div');
        item.className = 'activity-item';
        item.innerHTML = `
          <div class="activity-icon">📄</div>
          <div class="activity-content">
            <div class="activity-text"><strong>${escapeHtml(log.user)}</strong> performed a scrape resulting in ${log.rows_scraped} rows.</div>
            <div class="activity-time">${new Date(log.created_at).toLocaleString()}</div>
          </div>
        `;
        activityFeed.appendChild(item);
      });
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function loadUsersData() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/admin/users`, { headers });
    if (!res.ok) throw new Error('Failed to fetch users');
    const users = await res.json();
    
    const tbody = document.querySelector('#users-table tbody');
    tbody.innerHTML = '';
    
    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">No users found</td></tr>';
      return;
    }

    users.forEach(user => {
      const tr = document.createElement('tr');
      
      const pkgs = (user.packages || []).map(p => `<span class="badge badge-info mr-1">${escapeHtml(p.name)}</span>`).join(' ');
      const statusClass = user.status === 'active' ? 'badge-success' : 'badge-danger';
      
      tr.innerHTML = `
        <td><strong>${escapeHtml(user.full_name || '')}</strong></td>
        <td>${escapeHtml(user.email)}</td>
        <td><span class="badge badge-warning">${user.role}</span></td>
        <td><span class="badge ${statusClass}">${user.status || 'active'}</span></td>
        <td>${pkgs || '<span class="text-muted">None</span>'}</td>
        <td>
          <div class="action-group">
            <button class="btn btn-sm btn-secondary toggle-status-btn" data-id="${user.id}" data-status="${user.status === 'deactivated' ? 'active' : 'deactivated'}">
              ${user.status === 'deactivated' ? 'Activate' : 'Deactivate'}
            </button>
            <button class="btn btn-sm btn-success grant-db-btn" data-id="${user.id}">Grant DB</button>
            <button class="btn btn-sm btn-danger delete-user-btn" data-id="${user.id}">Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Attach listeners
    document.querySelectorAll('.toggle-status-btn').forEach(btn => btn.addEventListener('click', handleToggleStatus));
    document.querySelectorAll('.grant-db-btn').forEach(btn => btn.addEventListener('click', handleGrantDbSync));
    document.querySelectorAll('.delete-user-btn').forEach(btn => btn.addEventListener('click', handleDeleteUser));

  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function loadPackageRequests() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/admin/package-requests`, { headers });
    if (!res.ok) throw new Error('Failed to fetch package requests');
    const requests = await res.json();
    
    const tbody = document.querySelector('#requests-table tbody');
    tbody.innerHTML = '';
    
    if (requests.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No pending requests</td></tr>';
      return;
    }

    requests.forEach(req => {
      const tr = document.createElement('tr');
      const statusClass = req.status === 'pending' ? 'badge-warning' : (req.status === 'active' ? 'badge-success' : 'badge-danger');
      
      tr.innerHTML = `
        <td><strong>${escapeHtml(req.user_name || 'Unknown')}</strong><br><span style="font-size:12px;color:var(--text-muted)">${escapeHtml(req.user_email || '')}</span></td>
        <td><strong>${escapeHtml(req.package_display_name || req.package_name)}</strong></td>
        <td><span class="badge ${statusClass}">${req.status}</span></td>
        <td>${new Date(req.created_at).toLocaleString()}</td>
        <td>
          ${req.status === 'pending' ? `
          <div class="action-group">
            <button class="btn btn-sm btn-success update-req-btn" data-id="${req.id}" data-status="active">Approve</button>
            <button class="btn btn-sm btn-danger update-req-btn" data-id="${req.id}" data-status="declined">Reject</button>
          </div>
          ` : '-'}
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.update-req-btn').forEach(btn => btn.addEventListener('click', handleUpdatePackageRequest));

  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function loadInquiriesData() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/admin/inquiries`, { headers });
    if (!res.ok) throw new Error('Failed to fetch inquiries');
    const inquiries = await res.json();
    
    const tbody = document.querySelector('#inquiries-table tbody');
    tbody.innerHTML = '';
    
    if (inquiries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No inquiries found</td></tr>';
      return;
    }

    inquiries.forEach(inq => {
      const tr = document.createElement('tr');
      const statusClass = inq.status === 'resolved' ? 'badge-success' : 'badge-warning';
      
      tr.innerHTML = `
        <td><strong>${escapeHtml(inq.user_name || 'Unknown')}</strong><br><span style="font-size:12px;color:var(--text-muted)">${escapeHtml(inq.user_email || '')}</span></td>
        <td><strong>${escapeHtml(inq.subject)}</strong></td>
        <td style="max-width: 300px; white-space: normal;">${escapeHtml(inq.message)}</td>
        <td><span class="badge ${statusClass}">${inq.status}</span></td>
        <td>
          ${inq.status !== 'resolved' ? `
            <button class="btn btn-sm btn-success resolve-inq-btn" data-id="${inq.id}">Resolve</button>
          ` : '-'}
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.resolve-inq-btn').forEach(btn => btn.addEventListener('click', handleResolveInquiry));

  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function loadMetricsData() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/admin/metrics`, { headers });
    if (!res.ok) throw new Error('Failed to fetch metrics');
    const data = await res.json();
    
    const tbody = document.querySelector('#metrics-table tbody');
    tbody.innerHTML = '';
    
    if (!data.user_metrics || data.user_metrics.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No metrics available</td></tr>';
      return;
    }

    data.user_metrics.forEach(u => {
      const tr = document.createElement('tr');
      const recentLogsHtml = (u.recent_logs || []).map(log => 
        `<div class="log-item">${new Date(log.created_at).toLocaleDateString()} - ${log.rows_scraped} rows</div>`
      ).join('') || '<div class="text-muted">No recent logs</div>';
      
      tr.innerHTML = `
        <td>
          <div><strong>${escapeHtml(u.full_name || 'Unknown')}</strong></div>
          <div style="font-size: 12px; color: var(--text-muted)">${escapeHtml(u.email)}</div>
        </td>
        <td>${u.total_scrapes || 0}</td>
        <td>${u.total_rows_scraped || 0}</td>
        <td>${u.last_scrape ? new Date(u.last_scrape).toLocaleString() : 'Never'}</td>
        <td>${recentLogsHtml}</td>
      `;
      tbody.appendChild(tr);
    });

  } catch (e) {
    showToast(e.message, 'error');
  }
}

// --- Action Handlers ---

async function handleCreateUser(e) {
  e.preventDefault();
  const name = document.getElementById('new-user-name').value;
  const email = document.getElementById('new-user-email').value;
  const password = document.getElementById('new-user-password').value;
  const dbsync = document.getElementById('new-user-dbsync').checked;
  
  const package_names = dbsync ? ['db_sync'] : [];
  
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ full_name: name, email, password, package_names })
    });
    
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      throw new Error(err.detail || 'Failed to create user');
    }
    
    showToast('User created successfully!', 'success');
    document.getElementById('create-user-form').reset();
    loadUsersData();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function handleToggleStatus(e) {
  const id = e.target.getAttribute('data-id');
  const newStatus = e.target.getAttribute('data-status');
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/admin/users/${id}/status`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) throw new Error('Failed to update status');
    showToast(`User status updated to ${newStatus}`, 'success');
    loadUsersData();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function handleGrantDbSync(e) {
  const id = e.target.getAttribute('data-id');
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/admin/users/${id}/packages`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ package_names: ["db_sync"], status: "active" })
    });
    if (!res.ok) throw new Error('Failed to grant DB Sync');
    showToast('Granted DB Sync package successfully', 'success');
    loadUsersData();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function handleDeleteUser(e) {
  if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;
  const id = e.target.getAttribute('data-id');
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/admin/users/${id}`, {
      method: 'DELETE',
      headers
    });
    if (!res.ok) throw new Error('Failed to delete user');
    showToast('User deleted successfully', 'success');
    loadUsersData();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function handleUpdatePackageRequest(e) {
  const id = e.target.getAttribute('data-id');
  const status = e.target.getAttribute('data-status');
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/admin/package-requests/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Failed to update request');
    showToast(`Package request ${status}`, 'success');
    loadPackageRequests();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function handleResolveInquiry(e) {
  const id = e.target.getAttribute('data-id');
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/admin/inquiries/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'resolved' })
    });
    if (!res.ok) throw new Error('Failed to resolve inquiry');
    showToast('Inquiry resolved', 'success');
    loadInquiriesData();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// --- Utilities ---

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
  
  toast.innerHTML = `
    <div>${icon}</div>
    <div>${escapeHtml(message)}</div>
  `;
  
  container.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
