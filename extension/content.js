// content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ success: true });
  } else if (message.action === 'scrape_dom') {
    try {
      const result = performTextStreamScrape();
      sendResponse(result);
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }else if (message.action === 'scrape_vehicle') {
    try {
      const result = performVehicleScrape();
      sendResponse(result);
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }
   else if (message.action === 'scrape_subvention') {
    // 🌟 ADDED: Listener for the subvention (bonuses) scrape
    try {
      const result = performSubventionScrape(message.targetDate);
      sendResponse(result);
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  } else if (message.action === 'scrape_gps_dom') {
    try {
      const rawPageText = document.body.innerText;
      
      // 1. Remove all spaces so we bypass Yango's weird "07 / 20 / 2026" HTML gaps
      const compactPageText = rawPageText.replace(/\s+/g, '');
      
      // 2. Format the target date (2026-07-20 -> 07/20/2026)
      const [year, month, day] = message.startDate.split('-');
      const targetDateCompact = `${month}/${day}/${year}`;
      const driverNameCompact = message.driverName.replace(/\s+/g, '');

      // 3. STRICT READY CHECK: The page must have the Driver's Name AND the exact Date
      const isReady = compactPageText.includes(driverNameCompact) && 
                      compactPageText.includes(targetDateCompact) &&
                      rawPageText.includes('Total mileage');

      if (!isReady) {
        // Tell popup.js the page isn't fully loaded yet, keep trying!
        return sendResponse({ success: true, isReady: false });
      }
      
      // Helper to find the number before "km" for a specific label
      const getGpsValue = (label) => {
        const escapedLabel = label.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`${escapedLabel}\\s*\\n*\\s*([\\d\\.]+)\\s*km`, 'i');
        const match = rawPageText.match(regex);
        return match && match[1] ? parseFloat(match[1]) : 0;
      };

      sendResponse({
        success: true,
        isReady: true, // Safe to proceed!
        gpsData: {
          total_gps_mileage: getGpsValue('Total mileage'),
          active_mileage: getGpsValue('Active mileage'),
          idle_mileage: getGpsValue('Idle mileage'),
          offline_mileage: getGpsValue('Offline')
        }
      });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }
  return true;
});


// --- SUBVENTION (BONUS) SCRAPER ---
function performSubventionScrape(targetDate) {
  const pageText = document.body.innerText;
  let activeGoalText = '0 of 0 trip';
  let bonusAmountText = 0; 

  if (!targetDate) {
    const today = new Date();
    targetDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }

  // Build possible date labels
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dateParts = targetDate.split('-');
  const possibleLabels = [];

  if (dateParts.length === 3) {
    const year = parseInt(dateParts[0], 10);
    const monthIndex = parseInt(dateParts[1], 10) - 1;
    const dayValue = parseInt(dateParts[2], 10);
    
    possibleLabels.push(`${months[monthIndex]} ${dayValue}`); 
    possibleLabels.push(`${months[monthIndex].substring(0,3)} ${dayValue}`);
    
    const targetDateObj = new Date(year, monthIndex, dayValue);
    const todayObj = new Date();
    const yesterdayObj = new Date();
    yesterdayObj.setDate(yesterdayObj.getDate() - 1);
    
    if (targetDateObj.toDateString() === todayObj.toDateString()) {
      possibleLabels.push("Today");
    }
    if (targetDateObj.toDateString() === yesterdayObj.toDateString()) {
      possibleLabels.push("Yesterday");
    }
  }

  const tripRegex = /(\d+\s*(?:of|out of|\/)\s*\d+\s*trips?)/i;
  let foundDateLabel = false;

  for (let label of possibleLabels) {
    const datePosition = pageText.toLowerCase().indexOf(label.toLowerCase());
    if (datePosition !== -1) {
      foundDateLabel = true;
      
      const contextBlock = pageText.substring(datePosition, datePosition + 400);
      const tripMatch = contextBlock.match(tripRegex);
      
      if (tripMatch) {
        activeGoalText = tripMatch[1].trim();
        
        // 🌟 FIX: Isolate ONLY the immediate text following the trip goal
        const startIndex = tripMatch.index + tripMatch[0].length;
        const immediateText = contextBlock.substring(startIndex, startIndex + 80);
        
        // 🌟 FIX: Find the VERY FIRST bonus indicator (either a % or an Rs amount)
        const firstBonusMatch = immediateText.match(/(?:\+?\s*\d+\s*%)|(?:Rs\s*\d+(?:\.\d+)?)/i);
        
        if (firstBonusMatch) {
          // If the very first thing it sees is a percentage, it's a percentage bonus -> force 0
          if (firstBonusMatch[0].includes('%')) {
            bonusAmountText = 0;
          } else {
            // Otherwise, it's an Rs amount, extract the numbers cleanly
            const rsMatch = firstBonusMatch[0].match(/Rs\s*(\d+(?:\.\d+)?)/i);
            if (rsMatch) {
              bonusAmountText = parseFloat(rsMatch[1]);
            }
          }
        }
      }
      break; 
    }
  }

  return {
    success: true,
    isReady: foundDateLabel || /Ended last week|Ended this week|% of trip total/i.test(pageText),
    activeGoals: activeGoalText,
    bonusAmount: bonusAmountText
  };
}



function performTextStreamScrape() {
  const pageText = document.body.innerText;

  let riderName = 'Unknown Driver';
  if (document.title && document.title.includes('|')) {
    riderName = document.title.split('|')[0].trim();
  } else {
    const h2s = Array.from(document.querySelectorAll('h1, h2, h3, [class*="title"]'));
    for (let h of h2s) {
      const txt = h.textContent.trim();
      if (txt && txt !== 'Report' && txt !== 'Contractors' && txt.length < 50) {
        riderName = txt;
        break;
      }
    }
  }

  // 🌟 FIX: Exhaustive search over all label instances to target the true metric row
  const getValueForLabel = (labelName) => {
    const elements = Array.from(document.querySelectorAll('*'));
    
    const labelElements = elements.filter(el => {
      const t = el.textContent.trim().toLowerCase();
      return t === labelName.toLowerCase() || t === (labelName.toLowerCase() + ':');
    });
    
    for (const labelElement of labelElements) {
      let parent = labelElement.parentElement;
      for (let depth = 0; depth < 3; depth++) {
        if (!parent) break;
        let remainingText = parent.textContent.replace(labelElement.textContent, '').replace(/\s+/g, ' ').trim();
        remainingText = remainingText.replace(/\?/g, '').trim(); 
        
        if (remainingText && /[0-9]/.test(remainingText)) {
          const parts = remainingText.split('\n').map(p => p.trim()).filter(p => p && /[0-9]/.test(p));
          if (parts.length > 0) return parts[0];
        }
        parent = parent.parentElement;
      }

      let sib = labelElement.nextElementSibling;
      while (sib) {
        let txt = sib.textContent.trim().replace(/\?/g, '').trim();
        if (txt && /[0-9]/.test(txt)) return txt;
        sib = sib.nextElementSibling;
      }
    }
    return null;
  };

  const extractByRegex = (text, label, isTime = false) => {
    const escapedLabel = label.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`${escapedLabel}\\s*[:\\-]?\\s*\\n*\\s*([^\\n]+)`, 'i');
    const match = text.match(regex);
    if (match && match[1]) {
      return match[1].replace(/\s*\?\s*$/, '').trim();
    }
    return isTime ? '00:00:00' : '0';
  };

  const isHydrated = pageText.includes('Report') || pageText.includes('Working hours') || pageText.includes('TOTAL');

  const ridesStr = getValueForLabel('Completed rides') || extractByRegex(pageText, 'Completed rides');
  const mileageStr = getValueForLabel('Mileage') || getValueForLabel('Distance') || extractByRegex(pageText, 'Mileage');
  const cashStr = getValueForLabel('Cash') || extractByRegex(pageText, 'Cash');
  const promoStr = getValueForLabel('Promotion compensation') || extractByRegex(pageText, 'Promotion compensation');
  const bonusStr = getValueForLabel('Bonus') || extractByRegex(pageText, 'Bonus');
  const taxesStr=  getValueForLabel('Taxes and fees')  || extractByRegex(pageText, 'Taxes and fees');
  const feesStr = getValueForLabel('Partner fees') || extractByRegex(pageText, 'Partner fees');
  const totalStr = getValueForLabel('TOTAL') || getValueForLabel('Taxi meter amount') || extractByRegex(pageText, 'TOTAL');
  const hoursStr = getValueForLabel('Working hours') || getValueForLabel('Online hours') || extractByRegex(pageText, 'Working hours', true);
  const avgStr = getValueForLabel('Average hourly earnings') || extractByRegex(pageText, 'Average hourly earnings');

  return {
    success: true,
    isReady: isHydrated,
    riderName: riderName,
    metrics: {
      completed_rides: num(ridesStr),
      mileage: num(mileageStr),
      cash: num(cashStr),
      promotion: num(promoStr),
      bonus: num(bonusStr),
      taxes: num(taxesStr),
      partner_fees: num(feesStr),
      total_collection: num(totalStr),
      working_hours: hoursStr,
      hourly_earnings: avgStr
    }
  };
}

function num(v) {
  if (v === undefined || v === null) return 0;
  // 🌟 FIX: Convert fancy dashboard typography minus signs (U+2212 "−") into keyboard hyphens "-"
  let s = String(v).replace(/[\u2212\u2013\u2014]/g, '-');
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// --- UPDATED VEHICLE TAB SCRAPER (content.js) ---
function performVehicleScrape() {
  const pageText = document.body.innerText;
  
  let plateNumber = '';
  let vehicleDetail = '';

  // 🌟 STRATEGY 1: Target the specific string next to the "Unlink" button
  const unlinkMatch = pageText.match(/([A-Za-z0-9-]+)\s*[•·-]\s*([A-Za-z0-9\s]+?)\s*[•·-]\s*(Active|Inactive|Blocked|Disabled|Draft)/i);
  if (unlinkMatch) {
    plateNumber = unlinkMatch[1].trim();
    const specs = unlinkMatch[2].replace(/\s+/g, ' ').trim();
    const status = unlinkMatch[3].trim();
    vehicleDetail = `${specs} • ${status}`;
  }

  // 🌟 STRATEGY 2: Read directly from the rendered text layout
  if (!vehicleDetail || vehicleDetail === 'N/A') {
    // Helper to find the text rendered visually next to a label
    const extractField = (label) => {
      const els = Array.from(document.querySelectorAll('div, span, label, p'))
                       .filter(el => el.innerText && el.innerText.trim() === label);
      if (els.length > 0) {
        let parent = els[0].parentElement;
        for (let i = 0; i < 4 && parent; i++) {
          let parts = parent.innerText.split('\n').map(t => t.trim()).filter(t => t && t !== label && !t.includes('(?)'));
          if (parts.length > 0) return parts[0];
          parent = parent.parentElement;
        }
      }
      return '';
    };

    const make = extractField('Make');
    const model = extractField('Model');
    const year = extractField('Year');
    const color = extractField('Color');
    const status = extractField('Status');
    const plate = extractField('Vehicle plate number');

    if (!plateNumber && plate) plateNumber = plate;

    const specsParts = [make, model, year, color].filter(Boolean).join(' ');
    if (specsParts) {
      vehicleDetail = status ? `${specsParts} • ${status}` : specsParts;
    }
  }

  // 🌟 STRATEGY 3: Final Fallback for Plate Number from the top header
  if (!plateNumber || plateNumber === 'N/A') {
    const headerMatch = pageText.match(/Driver\s*[•·]\s*([A-Za-z0-9-]+)\s*[•·]/i);
    if (headerMatch) plateNumber = headerMatch[1].trim();
  }

  return {
    success: true,
    vehicleData: {
      vehicle_plate_number: plateNumber || 'N/A',
      vehicle_detail: vehicleDetail || 'N/A'
    }
  };
}