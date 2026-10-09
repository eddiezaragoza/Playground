// background.js — QuickForce v1.9.0
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.id) return;

    // ensure content script present
    try { await chrome.tabs.sendMessage(tab.id, { ping: true }); }
    catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["contentScript.js"]
        });
      } catch (e) {}
    }

    const send = (type) => chrome.tabs.sendMessage(tab.id, { type });

    if (command === "copy-record-id")                 send("COPY_ID");
    else if (command === "open-record-from-clipboard") send("NAVIGATE");
    else if (command === "toggle-setup")              send("TOGGLE_SETUP");
    else if (command === "open-flows-home")           send("OPEN_FLOWS_HOME");
    else if (command === "open-reports-home")         send("OPEN_REPORTS_HOME");
    else if (command === "open-dashboards-home")      send("OPEN_DASHBOARDS_HOME");
    else if (command === "open-app-manager")          send("OPEN_APP_MANAGER");
    else if (command === "open-installed-packages")   send("OPEN_INSTALLED_PACKAGES");
    else if (command === "open-users-home")           send("OPEN_USERS_HOME");
  } catch {}
});
