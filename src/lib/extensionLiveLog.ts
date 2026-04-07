/** Buffer circular de logs do painel React (intercepta console.*). */

export type ExtensionLiveLogEntry = {
  ts: number;
  level: string;
  text: string;
};

const MAX_ENTRIES = 1000;
let entries: ExtensionLiveLogEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function formatArg(arg: unknown): string {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "string") return arg;
  if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") return String(arg);
  if (arg instanceof Error) {
    const st = arg.stack || "";
    return st ? `${arg.message}\n${st}` : arg.message;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function push(level: string, args: unknown[]) {
  const text = args.map(formatArg).join(" ");
  entries = [...entries, { ts: Date.now(), level, text }].slice(-MAX_ENTRIES);
  notify();
}

/** Tipo de mensagem relayada pelo background (content.js → painel). */
export const SIAP_LIVE_LOG_MESSAGE_TYPE = "SIAP_LIVE_LOG" as const;

/** Insere linha vinda da aba SIAP (content script) no mesmo buffer do painel. */
export function appendExtensionLiveLogFromContentScript(payload: {
  level: string;
  text: string;
  ts?: number;
  href?: string;
  tabId?: number;
}) {
  const ts = typeof payload.ts === "number" ? payload.ts : Date.now();
  let prefix = "[content]";
  if (payload.href) {
    try {
      prefix += ` ${new URL(payload.href).pathname}`;
    } catch {
      prefix += ` ${payload.href}`;
    }
  }
  if (payload.tabId != null) prefix += ` (tab ${payload.tabId})`;
  prefix += " ";
  const text = prefix + (payload.text || "");
  entries = [...entries, { ts, level: payload.level || "log", text }].slice(-MAX_ENTRIES);
  notify();
}

function installContentRelayListener() {
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
  const handler = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (r?: unknown) => void,
  ) => {
    if (!message || typeof message !== "object") return;
    const m = message as Record<string, unknown>;
    if (m.type !== SIAP_LIVE_LOG_MESSAGE_TYPE) return;
    if (m.source !== "content") return;
    appendExtensionLiveLogFromContentScript({
      level: typeof m.level === "string" ? m.level : "log",
      text: typeof m.text === "string" ? m.text : "",
      ts: typeof m.ts === "number" ? m.ts : undefined,
      href: typeof m.href === "string" ? m.href : undefined,
      tabId: typeof m.tabId === "number" ? m.tabId : undefined,
    });
    sendResponse({});
  };
  chrome.runtime.onMessage.addListener(handler);
}

export function subscribeExtensionLiveLog(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getExtensionLiveLogSnapshot(): ExtensionLiveLogEntry[] {
  return entries;
}

export function clearExtensionLiveLog() {
  entries = [];
  notify();
}

export function formatExtensionLiveLogForCopy(list: ExtensionLiveLogEntry[]): string {
  return list
    .map((e) => {
      const d = new Date(e.ts);
      const pad = (n: number) => String(n).padStart(2, "0");
      const stamp = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
      return `[${stamp}] [${e.level.toUpperCase()}] ${e.text}`;
    })
    .join("\n");
}

let installed = false;

/** Chame uma vez no boot do painel (main.tsx). */
export function installExtensionLiveLog() {
  if (installed) return;
  installed = true;

  const levels = ["log", "info", "warn", "error", "debug"] as const;
  for (const level of levels) {
    const orig = console[level].bind(console) as (...a: unknown[]) => void;
    (console as Record<string, unknown>)[level] = (...args: unknown[]) => {
      push(level, args);
      orig(...args);
    };
  }

  window.addEventListener("error", (ev) => {
    push("error", [ev.message, ev.filename, ev.lineno, ev.colno, ev.error]);
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    push("error", [`UnhandledRejection:`, r instanceof Error ? r : String(r)]);
  });

  installContentRelayListener();
}
