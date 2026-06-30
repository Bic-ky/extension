// popup.js
// Main control panel logic for Yango Fleet Contractor Exporter

// UI Elements
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

// Configuration State
let parkId = null;
let detectedEndpoint = null;

// Initialize Popup
document.addEventListener('DOMContentLoaded', async () => {
  initializeDates();
  await checkAuth();
  await loadSavedEndpoint();
  
  // Wire up event listeners
  scrapeExportBtn.addEventListener('click', runFullExport);
  clearDataBtn.addEventListener('click', clearSavedEndpoint);
  
  // Listen for message from content script containing intercepted API data
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'YANGO_API_INTERCEPT') {
      handleApiIntercept(message);
    }
  });
});

// Helper: Log message to the console-like UI area
function logConsole(message) {
  const timestamp = new Date().toLocaleTimeString();
  consoleLog.textContent += `[${timestamp}] ${message}\n`;
  consoleLog.scrollTop = consoleLog.scrollHeight;
  console.log(`[Fleet Exporter] ${message}`);
}

function initializeDates() {
  const today = new Date();
  
  // High-reliability local YYYY-MM-DD formatter
  const formatDate = (date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  
  const formattedToday = formatDate(today);
  
  // Setting both to today defaults the query from 12:00 AM to 11:59 PM
  startDateInput.value = formattedToday;
  endDateInput.value = formattedToday;
}

// Update UI badge statuses
function updateStatus(element, textElement, type, text) {
  element.className = `badge badge-${type}`;
  textElement.textContent = text;
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

// Format singular day JSON metrics to Excel Row structure
function mapMetricsToRow(dayData, riderName, defaultDate = "") {
  const tripDateStr = fuzzyGet(dayData, ['date', 'day', 'trip_date', 'time']) || defaultDate;
  let tripDate = tripDateStr;
  if (tripDateStr) {
    const d = new Date(tripDateStr);
    if (!isNaN(d.getTime())) {
      tripDate = d.toISOString().split('T')[0];
    }
  }
  
  const completedRides = parseFloat(fuzzyGet(dayData, ['rides', 'orders', 'completed', 'success']) || 1);
  const totalMileage = parseFloat(fuzzyGet(dayData, ['mileage', 'distance', 'km']) || 0);
  const cash = parseFloat(fuzzyGet(dayData, ['cash']) || 0);
  const promotion = parseFloat(fuzzyGet(dayData, ['promotion', 'subsidy', 'subsidies', 'compensation']) || 0);
  const bonus = parseFloat(fuzzyGet(dayData, ['bonus', 'bonuses']) || 0);
  const partnerFees = parseFloat(fuzzyGet(dayData, ['fee', 'commission', 'partner', 'company']) || 0);
  
  const totalCollection = cash + promotion + bonus + partnerFees;
  
  const onlineHoursVal = fuzzyGet(dayData, ['online', 'hours', 'duration', 'work_time']) || '00:00:00';
  let onlineHoursStr = '00:00:00';
  let decimalHours = 0;
  
  if (typeof onlineHoursVal === 'string') {
    onlineHoursStr = onlineHoursVal;
    const parts = onlineHoursVal.split(':');
    if (parts.length === 3) {
      decimalHours = (parseInt(parts[0], 10) || 0) + (parseInt(parts[1], 10) || 0)/60 + (parseInt(parts[2], 10) || 0)/3600;
    } else if (parts.length === 2) {
      decimalHours = (parseInt(parts[0], 10) || 0) + (parseInt(parts[1], 10) || 0)/60;
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
    Completed_Rides: completedRides,
    Total_Mileage: totalMileage,
    Cash: cash,
    Promotion_Compensation: promotion,
    Bonus: bonus,
    Partner_Fees: partnerFees,
    Total_Collection: parseFloat(totalCollection.toFixed(2)),
    Online_Hours: onlineHoursStr,
    Average_Hourly_Earnings: averageEarningsStr
  };
}

// Fetch contractor list from `/v2/contractors/list` POST endpoint
async function fetchContractorList(parkId) {
  let allContractors = [];
  let cursor = null;
  let hasMore = true;
  let page = 1;

  while (hasMore) {
    logConsole(`Fetching driver list page ${page}...`);
    const payload = {
      query: { search: "" },
      limit: 100
    };
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
      logConsole(`Retrieved ${data.contractors.length} drivers.`);
    }
    
    if (data.cursor && data.contractors && data.contractors.length === 100) {
      cursor = data.cursor;
      page++;
    } else {
      hasMore = false;
    }
  }
  
  return allContractors;
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

// Sequence: Run automated scraper loop
async function runFullExport() {
  if (!parkId) return;
  
  const startDate = startDateInput.value;
  const endDate = endDateInput.value;
  
  scrapeExportBtn.disabled = true;
  const allRows = [];
  
  try {
    let contractors = await fetchContractorList(parkId);
    if (!contractors || contractors.length === 0) {
      throw new Error("No drivers found in this park.");
    }

    // TESTING LIMIT: Caps test runs to 10 drivers
    // contractors = contractors.slice(0, 8 );
    logConsole(`Total drivers to process: ${contractors.length}`);
    
    // --- MODE 2: Ultra-Fast Direct API Scraper ---
    if (detectedEndpoint) {
      logConsole("Running in SPEED MODE (Direct API fetches in the background)...");
      
      for (let i = 0; i < contractors.length; i++) {
        const driver = contractors[i];
        logConsole(`[${i+1}/${contractors.length}] Requesting API metrics for ${driver.full_name}...`);
        
        try {
          const metricsData = await fetchContractorMetrics(driver.id, parkId, startDate, endDate, detectedEndpoint);
          const dailyList = fuzzyGet(metricsData, ['metrics', 'days', 'items', 'list', 'data']) || [];
          
          if (Array.isArray(dailyList) && dailyList.length > 0) {
            dailyList.forEach(day => {
              allRows.push(mapMetricsToRow(day, driver.full_name));
            });
          } else if (typeof metricsData === 'object') {
            allRows.push(mapMetricsToRow(metricsData, driver.full_name, startDate));
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
        const driver = contractors[i];
        logConsole(`[${i+1}/${contractors.length}] Navigating to earnings for ${driver.full_name}...`);
        
        const metricsStart = startDate + 'T00:00:00';
        const metricsEnd = endDate + 'T23:59:59';
        const contractorUrl = `https://fleet.yango.com/contractors/${driver.id}/income?park_id=${parkId}&rent_type=park&metrics_period_start=${metricsStart}&metrics_period_end=${metricsEnd}`;
        
        await chrome.tabs.update(activeTab.id, { url: contractorUrl });
        
        // Wait for tab navigation loading to settle initially
        await new Promise(r => setTimeout(r, 2000));
        
        let scrapedData = null;
        const maxAttempts = 12; // 6-second max loading window per driver profile
        
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
            
            // Capture flat data directly from messaging context safely
            if (scrapeResponse && scrapeResponse.success && scrapeResponse.isReady) {
              scrapedData = scrapeResponse;
              break; 
            } else if (attempt === maxAttempts && scrapeResponse && scrapeResponse.success) {
              scrapedData = scrapeResponse;
            }
          } catch (e) {}
        }

        // ================= STEP 2: SCRAPE ACTIVE GOALS =================
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
            const scrape = await new Promise(r => chrome.tabs.sendMessage(activeTab.id, { action: 'scrape_subvention' }, res => r(chrome.runtime.lastError ? null : res)));
            if (scrape && scrape.success && scrape.isReady) { subventionData = scrape; break; }
          } catch (e) {}
        }
        
        if (scrapedData && scrapedData.metrics) {
          const m = scrapedData.metrics;
          const displayName = scrapedData.riderName !== 'Unknown Driver' ? scrapedData.riderName : driver.full_name;
          const activeGoalsValue = subventionData ? subventionData.activeGoals : '0 of 0';
          
          allRows.push({
            Trip_Date: startDate,
            Rider_Name: displayName,
            Completed_Rides: m.completed_rides,
            Total_Mileage: m.mileage,
            Cash: m.cash,
            Promotion_Compensation: m.promotion,
            Bonus: m.bonus,
            Partner_Fees: m.partner_fees,
            Total_Collection: m.total_collection,
            Online_Hours: m.working_hours,
            Average_Hourly_Earnings: m.hourly_earnings,
            Active_Goals: activeGoalsValue 
          });
          logConsole(`Successfully consolidated profiles for ${displayName} (${activeGoalsValue}).`);
        } else {
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
    } else {
      logConsole("Error: No metrics collected.");
    }
  } catch (error) {
    logConsole(`Export process failed: ${error.message}`);
  } finally {
    scrapeExportBtn.disabled = false;
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
              Bonus: data.metrics.bonus,
              Partner_Fees: data.metrics.partner_fees,
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
  const headers = [
    'Trip_Date',
    'Rider_Name',
    'Completed_Rides',
    'Total_Mileage',
    'Cash',
    'Promotion Compensation',
    'Bonus',
    'Partner Fees',
    'Total_Collection',
    'Online_Hours',
    'Average Hourly Earnings',
    'Active goals'
  ];
  
  const wsData = [
    [], [], [], 
    headers 
  ];
  
  rowsData.forEach(row => {
    wsData.push([
      row.Trip_Date,
      row.Rider_Name,
      row.Completed_Rides,
      row.Total_Mileage,
      row.Cash,
      row.Promotion_Compensation,
      row.Bonus,
      row.Partner_Fees,
      row.Total_Collection,
      row.Online_Hours,
      row.Average_Hourly_Earnings,
      row.Active_Goals
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