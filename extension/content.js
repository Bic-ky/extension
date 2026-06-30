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
      const result = performSubventionScrape();
      sendResponse(result);
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }
  return true;
});


// --- SUBVENTION (BONUS) SCRAPER ---
function performSubventionScrape() {
  const pageText = document.body.innerText;
  let activeGoalText = '0 of 0 trip';

  // 1. Look directly for the "Today" card in the DOM elements
  const allElements = Array.from(document.querySelectorAll('span, div, p, h1, h2, h3, h4, h5, h6'));
  const todayNode = allElements.find(el => el.textContent.trim() === 'Today' && el.children.length === 0);

  if (todayNode) {
    // Traverse up the HTML tree to the card container, then extract the trip fraction
    let parent = todayNode.parentElement;
    for (let i = 0; i < 6; i++) { // Climb up to wrap the whole card
      if (!parent) break;
      // Looks for digits formatted exactly like your layout (e.g., "7 of 7 trip")
      const match = parent.textContent.match(/(\d+\s*of\s*\d+\s*trips?)/i);
      if (match) {
        activeGoalText = match[1].trim();
        break;
      }
      parent = parent.parentElement;
    }
  }

  // 2. Global Regex Fallback just in case the "Today" label changes
  if (activeGoalText === '0 of 0 trip') {
    const fallbackMatch = pageText.match(/(\d+\s*of\s*\d+\s*trips?)/i);
    if (fallbackMatch) {
      activeGoalText = fallbackMatch[1].trim();
    }
  }

  return {
    success: true,
    isReady: pageText.includes('Active goals') || pageText.includes('Today') || pageText.includes('trip'),
    activeGoals: activeGoalText
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