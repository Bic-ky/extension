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
  } else if (message.action === 'scrape_subvention') {
    // 🌟 ADDED: Listener for the subvention (bonuses) scrape
    try {
      const result = performSubventionScrape(message.targetDate);
      sendResponse(result);
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