/**
 * Evita "Uncaught (in promise) Error: Could not establish connection. Receiving end does not exist."
 * quando a aba do SIAP recarrega (postback) e o content script ainda não está ouvindo.
 */

type TabsSend = typeof chrome.tabs.sendMessage;

export function safeTabsSendMessage(
  tabsApi: { sendMessage: TabsSend },
  tabId: number,
  message: object,
): void {
  try {
    void Promise.resolve(tabsApi.sendMessage(tabId, message as never)).catch(() => {
      /* aba recarregando / sem receiver */
    });
  } catch {
    /* ignora */
  }
}

export function safeTabsSendMessageCallback(
  chromeApi: { tabs: { sendMessage: TabsSend }; runtime: typeof chrome.runtime },
  tabId: number,
  message: object,
  callback: (response: unknown) => void,
): void {
  try {
    chromeApi.tabs.sendMessage(tabId, message as never, (response) => {
      if (chromeApi.runtime.lastError?.message) return;
      callback(response);
    });
  } catch {
    /* ignora */
  }
}
