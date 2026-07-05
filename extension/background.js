// background.js
// Configures the extension icon to toggle the persistent sidebar layout on click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Side Panel error:", error));