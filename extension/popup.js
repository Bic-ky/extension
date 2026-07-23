// popup.js
// Main control panel logic for Yango Fleet Contractor Exporter

// UI Elements
const closeBtn = document.getElementById('closeBtn');
const authStatus = document.getElementById('authStatus');
const authStatusText = document.getElementById('authStatusText');
const apiStatus = document.getElementById('apiStatus');
const apiStatusText = document.getElementById('apiStatusText');
const apiInfoBox = document.getElementById('apiInfoBox');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const scrapeExportBtn = document.getElementById('scrapeExportBtn');
const scrapeActiveBtn = document.getElementById('scrapeActiveBtn');
const clearDataBtn = document.getElementById('clearDataBtn');
const consoleLog = document.getElementById('consoleLog');

const stopExportBtn = document.getElementById('stopExportBtn');

// Configuration State
let parkId = null;
let detectedEndpoint = null;
let stopRequested = false;

// Initialize Popup
document.addEventListener('DOMContentLoaded', async () => {
  initializeDates();
  await checkAuth();
  await loadSavedEndpoint();
  
  // Wire up event listeners
  scrapeExportBtn.addEventListener('click', runFullExport);
  clearDataBtn.addEventListener('click', clearSavedEndpoint);

  closeBtn.addEventListener('click', () => {
    window.close();
  });
  
  // Listen for message from content script containing intercepted API data
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
});

function parseActiveGoals(goalString) {
  let achieved = 0;
  let target = 0;
  if (goalString && typeof goalString === 'string') {
    const match = goalString.match(/(\d+)\s*(?:of|out of|\/)\s*(\d+)/i);
    if (match) {
      achieved = parseInt(match[1], 10);
      target = parseInt(match[2], 10);
    }
  }
  return { achieved, target };
}

// Helper: Log message to the console-like UI area
function logConsole(message) {
  const timestamp = new Date().toLocaleTimeString();
  consoleLog.textContent += `[${timestamp}] ${message}\n`;
  consoleLog.scrollTop = consoleLog.scrollHeight;
  console.log(`[Fleet Exporter] ${message}`);
}

function initializeDates() {
  const today = new Date();
  
  const formatDate = (date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  
  const formattedToday = formatDate(today);
  
  startDateInput.value = formattedToday;
  endDateInput.value = formattedToday;
}

// Converts "HH:MM:SS" to decimal hours (e.g., "01:38:56" -> 1.65)
function formatWorkingHours(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10) ;
    const m = parseInt(parts[1], 10) ;
    const s = parseInt(parts[2], 10) ;
    const decimalHours = h + (m / 60) + (s / 3600);
    return parseFloat(decimalHours.toFixed(2));
  }
  return parseFloat(timeStr) ;
}

// Strips "/hour" and returns just the number (e.g., "329.32/hour" -> 329.32)
function formatHourlyEarnings(earningsStr) {
  if (!earningsStr) return 0;
  const str = String(earningsStr).replace(/\/hour/i, '').replace(/,/g, '').trim();
  return parseFloat(str) ;
}

// Update UI badge statuses
function updateStatus(element, textElement, type, text) {
  element.className = `badge badge-${type}`;
  textElement.textContent = text;
}

// 1. Fetch work rules from the API
async function loadWorkTerms(parkId) {
  try {
    const response = await fetch('https://fleet.yango.com/api/fleet/driver-work-rules/v1/work-rules/light-list', {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'x-park-id': parkId
      },
      body: JSON.stringify({ has_contractors: true, is_archived: false })
    });

    if (response.ok) {
      const data = await response.json();
      renderWorkTerms(data.light_work_rules || []);
    } else {
      document.getElementById('work-terms-list').innerText = "Failed to load work terms.";
    }
  } catch (err) {
    console.error("Error loading work terms:", err);
    document.getElementById('work-terms-list').innerText = "Error loading work terms.";
  }
}

// 2. Render them as checkboxes in the UI
function renderWorkTerms(workRules) {
  const container = document.getElementById('work-terms-list');
  container.innerHTML = ''; // Clear the "Loading..." text
  
  if (workRules.length === 0) {
    container.innerHTML = '<span style="color: #666;">No active work terms found.</span>';
    return;
  }

  workRules.forEach(rule => {
    const label = document.createElement('label');
    label.style.display = 'block';
    label.style.cursor = 'pointer';
    label.style.marginBottom = '4px';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = rule.id;
    checkbox.dataset.name = rule.name; // Store the name for the URL later
    checkbox.className = 'work-term-checkbox';
    
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` ${rule.name}`));
    container.appendChild(label);
  });
}

// Verify Authentication by looking for Yango's 'park_id' cookie
async function checkAuth() {
  try {
    const cookie = await chrome.cookies.get({
      url: 'https://fleet.yango.com',
      name: 'park_id'
    });
    
    if (cookie && cookie.value) {
      parkId = cookie.value;
      updateStatus(authStatus, authStatusText, 'success', `Connected (ID: ${parkId.substring(0, 8)}...)`);
      logConsole(`Authentication confirmed. park_id: ${parkId}`);
      scrapeExportBtn.disabled = false;
      loadWorkTerms(parkId);
      return true;
    } else {
      parkId = null;
      updateStatus(authStatus, authStatusText, 'error', 'Action Required');
      logConsole("Error: park_id cookie not found. Please log in to fleet.yango.com first.");
      scrapeExportBtn.disabled = true;
      return false;
    }
  } catch (error) {
    logConsole("Error checking authentication: " + error.message);
    updateStatus(authStatus, authStatusText, 'error', 'Error');
    return false;
  }
}

// Load previously intercepted endpoint configuration from storage
async function loadSavedEndpoint() {
  try {
    const result = await chrome.storage.local.get('yango_endpoint_config');
    if (result && result.yango_endpoint_config) {
      detectedEndpoint = result.yango_endpoint_config;
      updateStatus(apiStatus, apiStatusText, 'success', 'Endpoint Ready');
      apiInfoBox.className = "info-box";
      apiInfoBox.style.borderLeftColor = "var(--success)";
      apiInfoBox.style.backgroundColor = "#f4fcf6";
      apiInfoBox.textContent = `API detected: ${detectedEndpoint.path} (Speed Mode enabled)`;
      logConsole(`Loaded cached API endpoint config: ${detectedEndpoint.path}`);
    } else {
      detectedEndpoint = null;
      updateStatus(apiStatus, apiStatusText, 'success', 'Auto-Detect Ready');
      apiInfoBox.className = "info-box";
      apiInfoBox.style.borderLeftColor = "var(--primary)";
      apiInfoBox.style.backgroundColor = "var(--bg-color)";
      apiInfoBox.textContent = "API endpoint will be detected automatically on run. No manual page loads required.";
    }
  } catch (error) {
    logConsole("Error loading endpoint: " + error.message);
  }
}

// Handle network interception message
async function handleApiIntercept(message) {
  const { url, method, headers, body } = message;
  
  try {
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname;
    
    if (!path.includes('/rent/') && !path.includes('/metrics') && !path.includes('/details') && !path.includes('/earnings') && !path.includes('/subvention')) {
      return;
    }

    const endpointConfig = {
      path: path,
      method: method,
      headers: headers,
      isPost: method.toUpperCase() === 'POST',
      queryParams: Array.from(parsedUrl.searchParams.keys())
    };
    
    if (endpointConfig.isPost && body) {
      try {
        endpointConfig.bodyTemplate = JSON.parse(body);
      } catch (e) {}
    }
    
    await chrome.storage.local.set({ 'yango_endpoint_config': endpointConfig });
    logConsole("API Interceptor successfully captured metrics endpoint!");
    await loadSavedEndpoint();
  } catch (error) {
    logConsole("Error processing intercepted endpoint: " + error.message);
  }
}

// Clear saved endpoint configuration
async function clearSavedEndpoint() {
  try {
    await chrome.storage.local.remove('yango_endpoint_config');
    logConsole("Cleared API endpoint config.");
    await loadSavedEndpoint();
  } catch (error) {
    logConsole("Error clearing saved endpoint: " + error.message);
  }
}

// Fuzzy matching to find key properties in nested JSON API responses
function fuzzyGet(obj, patterns) {
  if (!obj) return null;
  for (let pattern of patterns) {
    const lowerPattern = pattern.toLowerCase();
    for (let key in obj) {
      if (key.toLowerCase().includes(lowerPattern)) {
        return obj[key];
      }
    }
  }
  return null;
}


// --- UPDATED VEHICLE TAB NAVIGATOR (popup.js) ---
async function fetchVehicleData(tabId, contractorId, parkId) {
  const carUrl = `https://fleet.yango.com/contractors/${contractorId}/car?park_id=${parkId}`;
  
  await chrome.tabs.update(tabId, { url: carUrl });
  await new Promise(r => setTimeout(r, 3000)); // Allow 3 seconds for initial map/form load
  
  let scrapedData = { vehicle_plate_number: 'N/A', vehicle_detail: 'N/A' };
  
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] }).catch(() => {});
      
      const response = await new Promise(r => {
        chrome.tabs.sendMessage(tabId, { action: 'scrape_vehicle' }, res => {
          if (chrome.runtime.lastError) r(null);
          else r(res);
        });
      });
      
      if (response && response.success && response.vehicleData) {
        const vData = response.vehicleData;
        
        // Update our fallback data with whatever we found
        if (vData.vehicle_plate_number !== 'N/A') scrapedData.vehicle_plate_number = vData.vehicle_plate_number;
        if (vData.vehicle_detail !== 'N/A') scrapedData.vehicle_detail = vData.vehicle_detail;

        // 🌟 FIXED: ONLY exit the loop if we successfully grabbed BOTH pieces of data
        if (scrapedData.vehicle_plate_number !== 'N/A' && scrapedData.vehicle_detail !== 'N/A') {
          break; 
        }
      }
    } catch (e) {}
    
    // Wait 500ms before trying again
    await new Promise(r => setTimeout(r, 500));
  }
  
  return scrapedData;
}
// Format singular day JSON metrics to Excel Row structure
function mapMetricsToRow(dayData, riderName, profileData, defaultDate = "", previousDayBonus = 0) {
  const tripDateStr = fuzzyGet(dayData, ['date', 'day', 'trip_date', 'time']) || defaultDate;
  let tripDate = tripDateStr;
  if (tripDateStr) {
    const d = new Date(tripDateStr);
    if (!isNaN(d.getTime())) {
      tripDate = d.toISOString().split('T')[0];
    }
  }
  
  const completedRides = parseFloat(fuzzyGet(dayData, ['rides', 'orders', 'completed', 'success']) || 1);
  const totalMileage = parseFloat(fuzzyGet(dayData, ['mileage', 'distance', 'km']) );
  const cash = parseFloat(fuzzyGet(dayData, ['cash']) );
  const promotion = parseFloat(fuzzyGet(dayData, ['promotion', 'subsidy', 'subsidies', 'compensation']) );
  const partnerFees = parseFloat(fuzzyGet(dayData, ['fee', 'commission', 'partner', 'company']) );

  const taxesAndFees = parseFloat(fuzzyGet(dayData, ['tax', 'taxes', 'taxes_and_fees']) );

  const naturalBonus = parseFloat(fuzzyGet(dayData, ['bonus', 'bonuses']) );
  const finalBonus = previousDayBonus > 0 ? previousDayBonus : naturalBonus;
  
  const totalCollection = cash + promotion + finalBonus + partnerFees;
  
  const onlineHoursVal = fuzzyGet(dayData, ['online', 'hours', 'duration', 'work_time']) || '00:00:00';
  let onlineHoursStr = '00:00:00';
  let decimalHours = 0;
  
  if (typeof onlineHoursVal === 'string') {
    onlineHoursStr = onlineHoursVal;
    const parts = onlineHoursVal.split(':');
    if (parts.length === 3) {
      decimalHours = (parseInt(parts[0], 10) ) + (parseInt(parts[1], 10) )/60 + (parseInt(parts[2], 10) )/3600;
    } else if (parts.length === 2) {
      decimalHours = (parseInt(parts[0], 10) ) + (parseInt(parts[1], 10) )/60;
    }
  } else if (typeof onlineHoursVal === 'number') {
    if (onlineHoursVal > 24) {
      decimalHours = onlineHoursVal / 3600;
    } else {
      decimalHours = onlineHoursVal;
    }
    const totalSecs = Math.floor(decimalHours * 3600);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    onlineHoursStr = [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
  }
  
  let averageEarningsStr = '0.00/hour';
  if (decimalHours > 0) {
    averageEarningsStr = `${(totalCollection / decimalHours).toFixed(2)}/hour`;
  }
  
  return {
    Trip_Date: tripDate,
    Rider_Name: riderName,
    Phone_Number: profileData ? profileData.phone : 'N/A',
    ID: profileData ? profileData.id : 'N/A',
    Completed_Rides: completedRides,
    Total_Mileage: totalMileage,
    Cash: cash,
    Promotion_Compensation: promotion,
    Bonus: finalBonus, 
    Partner_Fees: partnerFees,
    Taxes_And_Fees: taxesAndFees,
    Total_Collection: parseFloat(totalCollection.toFixed(2)),
    Online_Hours: formatWorkingHours(onlineHoursStr), 
    Average_Hourly_Earnings: formatHourlyEarnings(averageEarningsStr),
    Achieved_Goal: 0, 
    Target_Goal: 0,
    Subvention_Bonus: 0,
    Previous_Day_Bonus: 0 
  };
}

// Helper: Safely calculates the previous day's date string (YYYY-MM-DD)
function getPreviousDayDateString(dateStr) {
  if (!dateStr) return '';
  const dateParts = dateStr.split('-');
  if (dateParts.length !== 3) return dateStr;
  const year = parseInt(dateParts[0], 10);
  const monthIndex = parseInt(dateParts[1], 10) - 1;
  const dayValue = parseInt(dateParts[2], 10);
  
  const d = new Date(year, monthIndex, dayValue);
  d.setDate(d.getDate() - 1);
  
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Fetch contractor list from `/v2/contractors/list` POST endpoint
// async function fetchContractorList(parkId) {
//   let allContractors = [];
//   let cursor = null;
//   let hasMore = true;
//   let page = 1;

//   const selectedCheckboxes = document.querySelectorAll('.work-term-checkbox:checked');
//   const selectedWorkRuleIds = Array.from(selectedCheckboxes).map(cb => cb.value);

//   while (hasMore) {
//     logConsole(`Fetching driver list page ${page}...`);
    
//     const payload = {
//       query: { search: "" },
//       limit: 100
//     };
    
//     if (selectedWorkRuleIds.length > 0) {
//       payload.query.park = { work_rule_ids: selectedWorkRuleIds };
//     }

//     if (cursor) {
//       payload.cursor = cursor;
//     }
    
//     const response = await fetch('https://fleet.yango.com/api/fleet/contractor-profiles-manager/v2/contractors/list', {
//       method: 'POST',
//       headers: {
//         'accept': '*/*',
//         'content-type': 'application/json',
//         'x-park-id': parkId,
//         'x-client-version': 'fleet/21170'
//       },
//       body: JSON.stringify(payload),
//       credentials: 'include'
//     });
    
//     if (!response.ok) {
//       throw new Error(`HTTP list error: ${response.status}`);
//     }
    
//     const data = await response.json();
//     if (data.contractors && data.contractors.length > 0) {
//       allContractors = allContractors.concat(data.contractors);
//       logConsole(`Retrieved ${data.contractors.length} drivers.`);
//     }
    
//     if (data.cursor && data.contractors && data.contractors.length === 100) {
//       cursor = data.cursor;
//       page++;
//     } else {
//       hasMore = false;
//     }
//   }
  
//   return allContractors;
// }

async function fetchContractorList(parkId) {
  let allContractors = [];
  let cursor = null;
  let hasMore = true;
  let page = 1;

  const selectedCheckboxes = document.querySelectorAll('.work-term-checkbox:checked');
  const selectedWorkRuleIds = Array.from(selectedCheckboxes).map(cb => cb.value);

  while (hasMore) {
    logConsole(`Fetching driver list page ${page}...`);
    
    // 🌟 CORRECTED PAYLOAD SCHEMA: Use "filter" instead of "query"
    const payload = {
      projection: ["full_name","avatar_url","name","status","id","phone","orders_count","groups","violations","attestation_issues","balance","balance_limit","unblock_date","photocheck_restrictions"],
      limit: 50
    };
    
    if (selectedWorkRuleIds.length > 0) {
      payload.filter = { work_rule_ids: selectedWorkRuleIds };
    }

    if (cursor) {
      payload.cursor = cursor;
    }
    
    const response = await fetch('https://fleet.yango.com/api/fleet/contractor-profiles-manager/v2/contractors/list', {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'content-type': 'application/json',
        'x-park-id': parkId,
        'x-client-version': 'fleet/21170'
      },
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP list error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.contractors && data.contractors.length > 0) {
      allContractors = allContractors.concat(data.contractors);
      logConsole(`Retrieved ${data.contractors.length} filtered drivers.`);
    } else {
      logConsole(`No contractors found matching the selected work terms.`);
    }
    
    // Pagination check
    if (data.cursor && data.contractors && data.contractors.length === 50) {
      cursor = data.cursor;
      page++;
    } else {
      hasMore = false;
    }
  }
  
  return allContractors;
}

async function fetchContractorProfileData(contractorId, currentParkId) {
  try {
    const url = `https://fleet.yango.com/api/fleet/contractor-profiles-manager/v1/contractor-profile/contractor-data?contractor_profile_id=${contractorId}&park_id=${currentParkId}`;
    
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'X-Park-Id': currentParkId 
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      return {
        phone: data.phone || 'N/A',
        id: data.license_number || 'N/A'
      };
    } else {
      console.error(`Profile fetch failed for ${contractorId}. Status: ${response.status}`);
    }
  } catch (error) {
    console.error(`Profile fetch error for ${contractorId}:`, error);
  }
  return { phone: 'N/A', id: 'N/A' };
}

// Direct background API metrics fetching (Mode 2)
async function fetchContractorMetrics(contractorId, parkId, startDate, endDate, config) {
  let url = 'https://fleet.yango.com' + config.path;
  
  const headers = {
    'accept': '*/*',
    'content-type': 'application/json',
    'x-park-id': parkId,
    'x-client-version': 'fleet/21170'
  };
  
  for (let key in config.headers) {
    const lKey = key.toLowerCase();
    if (['cookie', 'host', 'origin', 'referer', 'content-length'].indexOf(lKey) === -1) {
      headers[key] = config.headers[key];
    }
  }
  
  const fetchOptions = {
    method: config.method,
    headers: headers,
    credentials: 'include'
  };
  
  if (config.isPost) {
    let bodyObj = {};
    if (config.bodyTemplate) {
      bodyObj = JSON.parse(JSON.stringify(config.bodyTemplate));
    }
    if (bodyObj.contractor_id !== undefined) bodyObj.contractor_id = contractorId;
    if (bodyObj.contractor_profile_id !== undefined) bodyObj.contractor_profile_id = contractorId;
    if (bodyObj.park_id !== undefined) bodyObj.park_id = parkId;
    if (bodyObj.metrics_period_start !== undefined) bodyObj.metrics_period_start = startDate + 'T00:00:00';
    if (bodyObj.metrics_period_end !== undefined) bodyObj.metrics_period_end = endDate + 'T23:59:59';
    if (bodyObj.query && bodyObj.query.contractor_ids) bodyObj.query.contractor_ids = [contractorId];
    
    fetchOptions.body = JSON.stringify(bodyObj);
  } else {
    const urlObj = new URL(url);
    config.queryParams.forEach(param => {
      if (param === 'contractor_id' || param === 'contractor_profile_id') {
        urlObj.searchParams.set(param, contractorId);
      } else if (param === 'park_id') {
        urlObj.searchParams.set(param, parkId);
      } else if (param === 'metrics_period_start') {
        urlObj.searchParams.set(param, startDate + 'T00:00:00');
      } else if (param === 'metrics_period_end') {
        urlObj.searchParams.set(param, endDate + 'T23:59:59');
      } else {
        urlObj.searchParams.set(param, urlObj.searchParams.get(param) || 'park');
      }
    });
    url = urlObj.toString();
  }
  
  const response = await fetch(url, fetchOptions);
  if (!response.ok) {
    throw new Error(`HTTP metrics error ${response.status}`);
  }
  return await response.json();
}


// --- UPDATED IN popup.js ---
async function fetchGpsViaTabNavigation(tabId, driverName, contractorId, parkId, startDate, endDate) {
  const encodedStart = startDate + 'T00:00:00';
  const encodedEnd = endDate + 'T23:59:59';;
  
  const gpsUrl = `https://fleet.yango.com/contractors/${contractorId}/gps?park_id=${parkId}&rent_type=park&dateFrom=${encodedStart}&dateTo=${encodedEnd}&gps_date_from=${encodedStart}&gps_date_to=${encodedEnd}&gps_view=list`;
  
  await chrome.tabs.update(tabId, { url: gpsUrl });
  
  // Wait initially for map layout
  await new Promise(r => setTimeout(r, 3500));
  
  let scrapedData = null;
  
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] }).catch(() => {});
      
      const scrape = await new Promise(r => {
        // 🌟 FIXED: Passing driverName and startDate to content.js
        chrome.tabs.sendMessage(tabId, { 
          action: 'scrape_gps_dom',
          driverName: driverName, 
          startDate: startDate 
        }, (res) => {
          if (chrome.runtime.lastError) r(null);
          else r(res);
        });
      });
      
      if (scrape && scrape.success && scrape.isReady) {
        scrapedData = scrape.gpsData;
        break; 
      }
    } catch (e) {
      console.log("GPS Scrape attempt failed:", e);
    }
    // Check every 500ms if the correct Date and Name have finally appeared
    await new Promise(r => setTimeout(r, 500));
  }
  
  return scrapedData || { total_gps_mileage: 0, active_mileage: 0, idle_mileage: 0, offline_mileage: 0 };
}

// Sequence: Run automated scraper loop
async function runFullExport() {
  if (!parkId) return;
  
  const startDate = startDateInput.value;
  const endDate = endDateInput.value;

  const selectedCheckboxes = document.querySelectorAll('.work-term-checkbox:checked');
  const params = new URLSearchParams();

  // Append IDs first, then Names, then park_id to match Yango's format precisely
  selectedCheckboxes.forEach(cb => params.append('work_rule_ids', cb.value));
  selectedCheckboxes.forEach(cb => params.append('work_rule_names', cb.dataset.name));
  params.append('park_id', parkId);

  const finalUrl = `https://fleet.yango.com/contractors?${params.toString()}`;
  logConsole(`Target Filter URL: ${finalUrl}`);

  scrapeExportBtn.style.display = 'none';
  stopExportBtn.style.display = 'inline-block';
  stopExportBtn.textContent = "Stop & Export";
  stopExportBtn.disabled = false;
  stopRequested = false; 
  
  const allRows = [];
  
  try {
    let contractors = await fetchContractorList(parkId);
    if (!contractors || contractors.length === 0) {
      logConsole("No contractors found matching the selected work terms. Halting process.");
      
      scrapeExportBtn.style.display = 'inline-block';
      stopExportBtn.style.display = 'none';
      return; // Stops execution entirely
    }

    logConsole(`Total drivers to process: ${contractors.length}`);
    
    // --- MODE 2: Ultra-Fast Direct API Scraper ---
    if (detectedEndpoint) {
      logConsole("Running in SPEED MODE (Direct API fetches in the background)...");
      
      for (let i = 0; i < contractors.length; i++) {
        if (stopRequested) {
          logConsole(`⚠️ Stop requested by user. Halting at ${i}/${contractors.length}...`);
          break;
        }

        const driver = contractors[i];
        const prevDate = getPreviousDayDateString(startDate);
        let previousDayBonus = 0;
        
        logConsole(`[${i+1}/${contractors.length}] Requesting API metrics for ${driver.full_name}...`);
        
        const profileData = await fetchContractorProfileData(driver.id, parkId);
        
        try {
          const metricsData = await fetchContractorMetrics(driver.id, parkId, startDate, endDate, detectedEndpoint);
          try {
            const prevMetricsData = await fetchContractorMetrics(driver.id, parkId, prevDate, prevDate, detectedEndpoint);
            const prevDailyList = fuzzyGet(prevMetricsData, ['metrics', 'days', 'items', 'list', 'data']) || [];
            if (Array.isArray(prevDailyList) && prevDailyList.length > 0) {
              previousDayBonus = parseFloat(fuzzyGet(prevDailyList[0], ['bonus', 'bonuses']) );
            } else if (typeof prevMetricsData === 'object') {
              previousDayBonus = parseFloat(fuzzyGet(prevMetricsData, ['bonus', 'bonuses']) );
            }
          } catch (prevErr) {
            logConsole(`Could not fetch previous day bonus for ${driver.full_name}: ${prevErr.message}`);
          }
          const dailyList = fuzzyGet(metricsData, ['metrics', 'days', 'items', 'list', 'data']) || [];
          
          if (Array.isArray(dailyList) && dailyList.length > 0) {
            dailyList.forEach(day => {
              allRows.push(mapMetricsToRow(day, driver.full_name, profileData, startDate, previousDayBonus));
            });
          } else if (typeof metricsData === 'object') {
            allRows.push(mapMetricsToRow(metricsData, driver.full_name, profileData, startDate, previousDayBonus));
          }
        } catch (err) {
          logConsole(`API error for ${driver.full_name}: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 200));
      }
    } 
    // --- MODE 1: Automated Tab-Navigation DOM Scraper ---
    else {
      logConsole("Running in AUTOMATION MODE (Tab Navigation and DOM scraping)...");
      
      const tabs = await new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, resolve);
      });
      if (!tabs || tabs.length === 0) {
        throw new Error("No active tab found to perform navigation.");
      }
      
      const activeTab = tabs[0];
      const originalUrl = activeTab.url;
      
      for (let i = 0; i < contractors.length; i++) {
        if (stopRequested) {
          logConsole(`⚠️ Stop requested by user. Halting at ${i}/${contractors.length}...`);
          break;
        }

        const driver = contractors[i];

        let previousDayBonus = 0;
        let prevDayFetched = false;
        const prevDate = getPreviousDayDateString(startDate);

        if (detectedEndpoint) {
          try {
            const prevMetricsData = await fetchContractorMetrics(driver.id, parkId, prevDate, prevDate, detectedEndpoint);
            const prevDailyList = fuzzyGet(prevMetricsData, ['metrics', 'days', 'items', 'list', 'data']) || [];
            if (Array.isArray(prevDailyList) && prevDailyList.length > 0) {
              previousDayBonus = parseFloat(fuzzyGet(prevDailyList[0], ['bonus', 'bonuses']) );
            } else if (typeof prevMetricsData === 'object') {
              previousDayBonus = parseFloat(fuzzyGet(prevMetricsData, ['bonus', 'bonuses']) );
            }
            prevDayFetched = true;
          } catch (err) {
            console.log("Direct API previous day fetch unavailable, falling back to page load...");
          }
        }
        
        if (!prevDayFetched) {
          const prevMetricsStart = prevDate + 'T00:00:00';
          const prevMetricsEnd = prevDate + 'T23:59:59';
          const prevContractorUrl = `https://fleet.yango.com/contractors/${driver.id}/income?park_id=${parkId}&rent_type=park&metrics_period_start=${prevMetricsStart}&metrics_period_end=${prevMetricsEnd}`;
          
          logConsole(`[${i+1}/${contractors.length}] Checking Previous Day Bonus via DOM navigation for ${driver.full_name}...`);
          await chrome.tabs.update(activeTab.id, { url: prevContractorUrl });
          await new Promise(r => setTimeout(r, 2000));
          
          let prevScrapedData = null;
          for (let attempt = 1; attempt <= 12; attempt++) {
            await new Promise(r => setTimeout(r, 500));
            try {
              const ping = await new Promise(r => chrome.tabs.sendMessage(activeTab.id, { action: 'ping' }, res => r(chrome.runtime.lastError ? null : res)));
              if (!ping) {
                await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content.js'] });
                await new Promise(r => setTimeout(r, 200));
              }
              const scrape = await new Promise(r => chrome.tabs.sendMessage(activeTab.id, { action: 'scrape_dom' }, res => r(chrome.runtime.lastError ? null : res)));
              if (scrape && scrape.success && scrape.isReady) {
                prevScrapedData = scrape;
                break;
              }
            } catch(e) {}
          }
          if (prevScrapedData && prevScrapedData.metrics) {
            previousDayBonus = prevScrapedData.metrics.bonus ;
          }
        }

        logConsole(`[${i+1}/${contractors.length}] Navigating to earnings for ${driver.full_name}...`);
        
        const metricsStart = startDate + 'T00:00:00';
        const metricsEnd = endDate + 'T23:59:59';
        const contractorUrl = `https://fleet.yango.com/contractors/${driver.id}/income?park_id=${parkId}&rent_type=park&metrics_period_start=${metricsStart}&metrics_period_end=${metricsEnd}`;
        
        await chrome.tabs.update(activeTab.id, { url: contractorUrl });
        await new Promise(r => setTimeout(r, 2000));
        
        let scrapedData = null;
        const maxAttempts = 12; 
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          await new Promise(r => setTimeout(r, 500));
          
          try {
            const pingResponse = await new Promise(resolve => {
              chrome.tabs.sendMessage(activeTab.id, { action: 'ping' }, (res) => {
                if (chrome.runtime.lastError) resolve(null);
                else resolve(res);
              });
            });
            
            if (!pingResponse) {
              await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                files: ['content.js']
              });
              await new Promise(r => setTimeout(r, 200));
            }
            
            const scrapeResponse = await new Promise(resolve => {
              chrome.tabs.sendMessage(activeTab.id, { action: 'scrape_dom' }, (res) => {
                if (chrome.runtime.lastError) resolve({ success: false });
                else resolve(res);
              });
            });
            
            if (scrapeResponse && scrapeResponse.success && scrapeResponse.isReady) {
              scrapedData = scrapeResponse;
              break; 
            } else if (attempt === maxAttempts && scrapeResponse && scrapeResponse.success) {
              scrapedData = scrapeResponse;
            }
          } catch (e) {}
        }

        // SCRAPE ACTIVE GOALS
        logConsole(`[${i+1}/${contractors.length}] Step 2: Loading Subventions for ${driver.full_name}...`);
        const subventionUrl = `https://fleet.yango.com/contractors/${driver.id}/subvention?park_id=${parkId}`;
        
        await chrome.tabs.update(activeTab.id, { url: subventionUrl });
        await new Promise(r => setTimeout(r, 2000));
        
        let subventionData = null;
        for (let attempt = 1; attempt <= 12; attempt++) {
          await new Promise(r => setTimeout(r, 400));
          try {
            const ping = await new Promise(r => chrome.tabs.sendMessage(activeTab.id, { action: 'ping' }, res => r(chrome.runtime.lastError ? null : res)));
            if (!ping) {
              await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content.js'] });
              await new Promise(r => setTimeout(r, 200));
            }
            
            const scrape = await new Promise(r => chrome.tabs.sendMessage(activeTab.id, { 
              action: 'scrape_subvention', 
              targetDate: startDate 
            }, res => r(chrome.runtime.lastError ? null : res)));
            
            if (scrape && scrape.success && scrape.isReady) { subventionData = scrape; break; }
          } catch (e) {}
        }

        
        //DOM METHOD: Step 3: Navigating to GPS tab and scraping UI...
        logConsole(`[${i+1}/${contractors.length}] Step 3: Navigating to GPS tab for ${driver.full_name}...`);
        
        const gps = await fetchGpsViaTabNavigation(activeTab.id, driver.full_name, driver.id, parkId, startDate, endDate);

        const profileData = await fetchContractorProfileData(driver.id, parkId);
        
        if (scrapedData && scrapedData.metrics) {
          const m = scrapedData.metrics;
          
          let displayName = scrapedData.riderName !== 'Unknown Driver' ? scrapedData.riderName : driver.full_name;
          displayName = displayName.replace(/^Contractors\s*/i, '').trim();
          
          const activeGoalsValue = subventionData ? subventionData.activeGoals : '0 of 0';
          const subventionBonusValue = subventionData && subventionData.bonusAmount ? subventionData.bonusAmount : 0;
          
          let achievedGoal = 0;
          let targetGoal = 0;
          const goalMatch = activeGoalsValue.match(/(\d+)\s*(?:of|out of|\/)\s*(\d+)/i);
          if (goalMatch) {
            achievedGoal = parseInt(goalMatch[1], 10);
            targetGoal = parseInt(goalMatch[2], 10);
          }

        logConsole(`[${i+1}/${contractors.length}] Step: Loading Vehicle details for ${driver.full_name}...`);
        const vehicleInfo = await fetchVehicleData(activeTab.id, driver.id, parkId);
          
          allRows.push({
            Trip_Date: startDate,
            Rider_Name: displayName,
            Phone_Number: profileData.phone,
            ID: profileData.id,
            Vehicle_Plate_Number: vehicleInfo.vehicle_plate_number,
            Vehicle_Detail: vehicleInfo.vehicle_detail,
            Completed_Rides: m.completed_rides,
            Total_Mileage: m.mileage,
            Cash: m.cash,
            Promotion_Compensation: m.promotion,
            Bonus: previousDayBonus, 
            Partner_Fees: m.partner_fees,
            Taxes_And_Fees: m.taxes ,
            Total_Collection: m.total_collection,
            Online_Hours: formatWorkingHours(m.working_hours), 
            Average_Hourly_Earnings: formatHourlyEarnings(m.hourly_earnings), 
            Achieved_Goal: achievedGoal, 
            Target_Goal: targetGoal,     
            Subvention_Bonus: subventionBonusValue,
            Previous_Day_Bonus: 0 ,
            Total_GPS_Mileage: gps.total_gps_mileage,
            Active_Mileage: gps.active_mileage,
            Idle_Mileage: gps.idle_mileage,
            Offline_Mileage: gps.offline_mileage
          });
          logConsole(`Consolidated profile for ${displayName} (${achievedGoal}/${targetGoal} goals | Rs ${subventionBonusValue}).`);
        }
        else {
          logConsole(`Warning: Failed to scrape DOM for ${driver.full_name} (timeout).`);
        }
        
        await new Promise(r => setTimeout(r, 300));
      }
      
      logConsole("Scraping finished. Restoring tab view...");
      await chrome.tabs.update(activeTab.id, { url: originalUrl });
    }
    
    if (allRows.length > 0) {
      logConsole("Data collection complete. Compiling Excel sheet...");
      generateExcel(allRows, startDate, endDate);

      logConsole("Uploading data to backend...");
      try {
        await sendToBackend(allRows);
        
      } catch (error) {
        console.log(`Backend upload failed : ${error}`);
        
      }
    } else {
      logConsole("Error: No metrics collected.");
    }
  } catch (error) {
    logConsole(`Export process failed: ${error.message}`);
    scrapeExportBtn.style.display = 'inline-block';
    stopExportBtn.style.display = 'none';
  }
}

function runActiveTabScrape() {
  logConsole("Scraping active tab DOM...");
  
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      logConsole("Error: No active tab found.");
      return;
    }
    
    const activeTab = tabs[0];
    if (!activeTab.url.includes('fleet.yango.com')) {
      logConsole("Error: Active page is not fleet.yango.com");
      return;
    }
    
    const sendMessage = () => {
      chrome.tabs.sendMessage(activeTab.id, { action: 'scrape_dom' }, (response) => {
        if (chrome.runtime.lastError) {
          logConsole("DOM Scrape Error: " + chrome.runtime.lastError.message);
          return;
        }
        
        if (response && response.success) {
          const data = response.data;
          if (data.metrics) {
            logConsole(`DOM Scrape successful! Driver: ${data.riderName}`);
            const row = {
              Trip_Date: startDateInput.value,
              Rider_Name: data.riderName,
              Completed_Rides: data.metrics.completed_rides,
              Total_Mileage: data.metrics.mileage,
              Cash: data.metrics.cash,
              Promotion_Compensation: data.metrics.promotion,
              Bonus: data.metrics.Previous_Day_Bonus, 
              Partner_Fees: data.metrics.partner_fees,
              Taxes_And_Fees: data.metrics.taxes ,
              Total_Collection: data.metrics.total_collection,
              Online_Hours: data.metrics.working_hours,
              Average_Hourly_Earnings: data.metrics.hourly_earnings
            };
            generateExcel([row], startDateInput.value, endDateInput.value);
          } else {
            logConsole(`Scraped driver ${data.riderName} but verified empty metrics state.`);
          }
        } else {
          logConsole("Scrape failed: " + (response ? response.error : "Unknown error"));
        }
      });
    };
    
    chrome.tabs.sendMessage(activeTab.id, { action: 'ping' }, (pingResponse) => {
      if (chrome.runtime.lastError) {
        logConsole("Content script not active. Programmatically injecting script...");
        chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['content.js']
        }, () => {
          if (chrome.runtime.lastError) {
            logConsole("Injection failed: " + chrome.runtime.lastError.message);
            return;
          }
          logConsole("Scraper script successfully injected. Running scrape...");
          setTimeout(sendMessage, 200);
        });
      } else {
        sendMessage();
      }
    });
  });
}

function generateExcel(rowsData, start, end) {
  // Add Taxes and Fees to the headers array
  const headers = [
    'Trip_Date',
    'Rider_Name',
    'Phone Number',
    'ID',
    'Vehicle Plate Number',
    'Vehicle Detail',
    'Completed_Rides',
    'Total_Mileage',
    'Cash',
    'Promotion Compensation',
    'Bonus',
    'Partner Fees',
    'Taxes and Fees',
    'Total_Collection',
    'Online_Hours',
    'Average Hourly Earnings',
    'Achieved Goal',
    'Target Goal',
    'Subvention Bonus',
    'Total GPS Mileage',
    'Active Mileage',
    'Idle Mileage',
    'Offline Mileage'
  ];
  
  const wsData = [
    [], [], [], 
    headers 
  ];
  
  rowsData.forEach(row => {
    wsData.push([
      row.Trip_Date,
      row.Rider_Name,
      row.Phone_Number,
      row.ID,
      row.Vehicle_Plate_Number,
      row.Vehicle_Detail,
      row.Completed_Rides,
      row.Total_Mileage,
      row.Cash,
      row.Promotion_Compensation,
      row.Bonus, 
      row.Partner_Fees,
      row.Taxes_And_Fees,
      row.Total_Collection,
      row.Online_Hours,
      row.Average_Hourly_Earnings,
      row.Achieved_Goal, 
      row.Target_Goal,   
      row.Subvention_Bonus,
      row.Total_GPS_Mileage ,
      row.Active_Mileage ,
      row.Idle_Mileage ,
      row.Offline_Mileage 
    ]);
  });
  
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });
  
  function s2ab(s) {
    const buf = new ArrayBuffer(s.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xFF;
    return buf;
  }
  
  const blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fleet_export_${start}_to_${end}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  logConsole(`Excel generated: fleet_export_${start}_to_${end}.xlsx`);
}

async function sendToBackend(scrapedData) {
    try {
        const response = await fetch("http://127.0.0.1:8000/api/upload", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ data: scrapedData })
        });

        const result = await response.json();
        
        if (response.ok) {
            console.log("✅ Data successfully saved to database:", result);
        } else {
            console.error("❌ Failed to save data:", result);
        }
    } catch (error) {
        console.error("❌ Network error connecting to backend:", error);
    }
}