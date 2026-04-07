// Enable Side Panel on action click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

/** Relay: content.js → painel React (buffer unificado de logs). */
const SIAP_LIVE_LOG = "SIAP_LIVE_LOG";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== SIAP_LIVE_LOG) return;
  // Só encaminha mensagens originadas na aba SIAP (content script).
  if (!sender.tab) return;

  const payload = {
    type: SIAP_LIVE_LOG,
    source: "content",
    level: message.level || "log",
    text: typeof message.text === "string" ? message.text : "",
    ts: typeof message.ts === "number" ? message.ts : Date.now(),
    tabId: sender.tab.id,
    href: typeof message.href === "string" ? message.href : "",
  };

  chrome.runtime.sendMessage(payload).catch(() => {});
  sendResponse({});
});
