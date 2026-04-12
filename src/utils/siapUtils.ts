import { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { safeTabsSendMessage } from "@/lib/safe-tabs-send-message";

export type SiapAuthHeartbeatStatus = "logado" | "deslogado";

export const SIAP_TAB_URL_MATCH = "*://siap.educacao.go.gov.br/*";
export const SIAP_USER_NAME_STORAGE_KEY = "siap_user_name";
export const SIAP_USER_EMAIL_STORAGE_KEY = "siap_user_email";
export const SIAP_USER_ESCOLA_STORAGE_KEY = "siap_user_escola_vinculada";
export const SIAP_SYNC_TURMAS_KEY = "siap_sync_turmas_pending";
export const SIAP_ESPERANDO_DADOS_KEY = "siap_esperando_dados";

export type SiapPendingDayEntry = number | { day: number; dataCanonica?: string | null };

export function siapDayEntryDay(d: SiapPendingDayEntry): number {
  return typeof d === "number" ? d : d.day;
}

export function siapDayEntryCanon(d: SiapPendingDayEntry): string | undefined {
  if (typeof d === "number") return undefined;
  const c = d.dataCanonica;
  return c ? String(c) : undefined;
}

export function flattenPendingDayNumbers(stats: any): number[] {
  const months = stats?.pendingMonths;
  if (!Array.isArray(months)) return [];
  const nums = months.flatMap((m: any) =>
    Array.isArray(m?.days) ? m.days.map((d: any) => siapDayEntryDay(d)) : [],
  );
  const finite = nums.filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(finite)].sort((a, b) => a - b);
}

export function canonYmdToDdMmYyyy(canon: string): string | null {
  const parts = String(canon).split("/").map((p) => parseInt(String(p).trim(), 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [yy, mm, dd] = parts;
  return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${yy}`;
}

export function flattenPendingDayDateStrings(stats: any): string[] {
  const months = stats?.pendingMonths;
  if (!Array.isArray(months)) return [];
  const out: string[] = [];
  for (const m of months) {
    const mo = m.month;
    const y = m.year;
    const days = Array.isArray(m?.days) ? m.days : [];
    for (const entry of days) {
      const day = siapDayEntryDay(entry);
      const canon = siapDayEntryCanon(entry);
      if (canon) {
        const s = canonYmdToDdMmYyyy(canon);
        if (s) out.push(s);
      } else if (Number.isFinite(mo) && mo != null && Number.isFinite(y) && y != null && Number.isFinite(day)) {
        out.push(`${String(day).padStart(2, "0")}/${String(mo).padStart(2, "0")}/${y}`);
      }
    }
  }
  return out;
}

export function buildTurmasDisponiveis(classesData: any): any[] {
  if (!classesData || typeof classesData !== "object") return [];
  const out: any[] = [];
  const seen = new Set<number>();
  for (const [disciplinaKey, turmas] of Object.entries(classesData)) {
    if (!Array.isArray(turmas)) continue;
    const disciplina = String(disciplinaKey ?? "").trim();
    for (const t of turmas) {
      const idx = t?.rowIndex;
      if (typeof idx !== "number" || !Number.isFinite(idx) || seen.has(idx)) continue;
      seen.add(idx);
      const nome = t?.name != null ? String(t.name).trim() : "";
      out.push({
        id: String(idx),
        nome: nome || `Turma ${idx}`,
        disciplina,
      });
    }
  }
  return out;
}

export function getAulaAtualFromStats(stats: any): string {
  if (!stats || stats.aulaAtual == null) return "";
  return String(stats.aulaAtual).trim();
}

export function getDiaOficialSiapFromStats(stats: any): string | null {
  if (!stats) return null;
  if (stats.diaOficialSiap != null && String(stats.diaOficialSiap).trim() !== "") {
    return String(stats.diaOficialSiap).trim();
  }
  if (stats.selectedDay != null) {
    const n = parseInt(String(stats.selectedDay), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 31) {
      const now = new Date();
      const dd = String(n).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      return `${dd}/${mm}/${now.getFullYear()}`;
    }
  }
  return null;
}

export async function sendBroadcastDadosTurmaAndProfessor(
  channel: RealtimeChannel,
  turmaPayload: any,
  supabase: SupabaseClient | null
): Promise<string> {
  const chromeApi = (window as any).chrome;
  return new Promise((resolve) => {
    const readPerfilProfessor = (cb: (nome: string, email: string, escola: string) => void) => {
      if (!chromeApi?.storage?.local) {
        cb("", "", "");
        return;
      }
      chromeApi.storage.local.get(
        [SIAP_USER_NAME_STORAGE_KEY, SIAP_USER_EMAIL_STORAGE_KEY, SIAP_USER_ESCOLA_STORAGE_KEY],
        (result: any) => {
          cb(
            String(result?.[SIAP_USER_NAME_STORAGE_KEY] || "").trim(),
            String(result?.[SIAP_USER_EMAIL_STORAGE_KEY] || "").trim(),
            String(result?.[SIAP_USER_ESCOLA_STORAGE_KEY] || "").trim()
          );
        }
      );
    };

    readPerfilProfessor((nomeProfessor, emailProfessor, escolaProfessor) => {
      void (async () => {
        let emailFinal = emailProfessor.trim();
        if (!emailFinal && supabase) {
          const { data } = await supabase.auth.getSession();
          emailFinal = data.session?.user?.email?.trim() || "";
        }
        void channel
          .send({ type: "broadcast", event: "DADOS_TURMA", payload: turmaPayload })
          .then(async (status) => {
            if (status === "ok") {
              await channel.send({
                type: "broadcast",
                event: "DADOS_PROFESSOR",
                payload: {
                  nome: nomeProfessor,
                  nome_siap: nomeProfessor,
                  ...(escolaProfessor ? { escola_siap: escolaProfessor } : {}),
                  ...(emailFinal ? { email: emailFinal } : {}),
                },
              });
            }
            resolve(String(status));
          })
          .catch(() => resolve("error"));
      })();
    });
  });
}

export async function broadcastDadosProfessorFromStorage(channel: RealtimeChannel, supabase: SupabaseClient | null): Promise<void> {
  const chromeApi = (window as any).chrome;
  return new Promise((resolve) => {
    if (!chromeApi?.storage?.local) {
      resolve();
      return;
    }
    chromeApi.storage.local.get(
      [SIAP_USER_NAME_STORAGE_KEY, SIAP_USER_EMAIL_STORAGE_KEY, SIAP_USER_ESCOLA_STORAGE_KEY],
      (result: any) => {
        void (async () => {
          const n = String(result?.[SIAP_USER_NAME_STORAGE_KEY] || "").trim();
          let e = String(result?.[SIAP_USER_EMAIL_STORAGE_KEY] || "").trim();
          const esc = String(result?.[SIAP_USER_ESCOLA_STORAGE_KEY] || "").trim();
          if (!e && supabase) {
            const { data } = await supabase.auth.getSession();
            e = data.session?.user?.email?.trim() || "";
          }
          void channel
            .send({
              type: "broadcast",
              event: "DADOS_PROFESSOR",
              payload: {
                ...(n ? { nome: n, nome_siap: n } : {}),
                ...(esc ? { escola_siap: esc } : {}),
                ...(e ? { email: e } : {}),
              },
            })
            .finally(() => resolve());
        })();
      }
    );
  });
}

export function findFirstPendingDayContext(stats: any, dayNum: number): any | null {
  const months = stats?.pendingMonths;
  if (!Array.isArray(months) || !Number.isFinite(dayNum)) return null;
  for (const m of months) {
    if (!Array.isArray(m?.days)) continue;
    for (const dayEntry of m.days) {
      if (siapDayEntryDay(dayEntry) === dayNum) {
        return {
          day: dayNum,
          month: m.month,
          year: m.year,
          dataCanonica: siapDayEntryCanon(dayEntry) ?? null,
        };
      }
    }
  }
  return null;
}

/** Diagnóstico de sessão via Injected Script */
export function siapInjectedSessionCheck(): { loggedIn: boolean; href: string } {
  const href = location.href || "";
  const low = href.toLowerCase();
  if (low.includes("login.aspx") || low.includes("sessaoexpirada")) return { loggedIn: false, href };
  const el = document.getElementById("lblNomeUsuario");
  const hasUser = !!(el && String(el.textContent || "").trim());
  let hasLogout = false;
  document.querySelectorAll("a[href]").forEach((a) => {
    if ((a.getAttribute("href") || "").toLowerCase().includes("logout")) hasLogout = true;
  });
  return { loggedIn: hasUser || hasLogout, href };
}

export function siapInjectedTurmasListagemReady(): { ready: boolean } {
  const href = (location.href || "").toLowerCase();
  if (href.includes("diarioescolarlistagem.aspx")) return { ready: true };
  const listBtn = document.querySelector('input[value*="Listar"]') || 
                  Array.from(document.querySelectorAll("input, button")).find(el => (el as any).value?.toLowerCase().includes("listar") || el.textContent?.toLowerCase().includes("listar"));
  if (listBtn) return { ready: true };
  for (const t of document.querySelectorAll("table")) {
    const text = (t.textContent || "").toLowerCase();
    if (text.includes("turma") && (text.includes("componente") || text.includes("disciplina"))) return { ready: true };
  }
  return { ready: false };
}

export function executeScriptPromise(chromeApi: any, tabId: number, func: () => unknown): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      if (!chromeApi?.scripting?.executeScript) { resolve(undefined); return; }
      chromeApi.scripting.executeScript({ target: { tabId }, func: func as () => void }, (results: any) => {
        resolve(results?.[0]?.result);
      });
    } catch { resolve(undefined); }
  });
}

export async function resolveSiapSessionFromDom(chromeApi: any): Promise<{ tabId: number; url: string } | null> {
  if (!chromeApi?.tabs?.query) return null;
  const tabs: any[] = await new Promise(r => chromeApi.tabs.query({ url: SIAP_TAB_URL_MATCH }, (t: any) => r(t || [])));
  if (tabs.length === 0) return null;
  
  const currentWindow: any = await new Promise(r => chromeApi.windows.getCurrent(r));
  const sorted = [...tabs].sort((a, b) => {
    const score = (x: any) => (x.active ? 4 : 0) + (currentWindow?.id != null && x.windowId === currentWindow.id ? 2 : 0) - (x.index / 1000);
    return score(b) - score(a);
  });

  for (const tab of sorted) {
    if (tab.id == null) continue;
    const result: any = await executeScriptPromise(chromeApi, tab.id, siapInjectedSessionCheck);
    if (result?.loggedIn) return { tabId: tab.id, url: result.href || tab.url || "" };
  }
  return null;
}

export async function evaluateTurmasListagemReadyOnTab(chromeApi: any, tabId: number, tabUrl: string): Promise<boolean> {
  if (tabUrl.toLowerCase().includes("diarioescolarlistagem.aspx")) return true;
  const r: any = await executeScriptPromise(chromeApi, tabId, siapInjectedTurmasListagemReady);
  return !!r?.ready;
}

export async function isSiapSessionValid(chromeApi: any): Promise<boolean> {
  const r = await resolveSiapSessionFromDom(chromeApi);
  return r != null;
}

export function hasSiapTabOpen(chromeApi: any): Promise<boolean> {
  return new Promise(r => chromeApi.tabs?.query({ url: SIAP_TAB_URL_MATCH }, (tabs: any) => r(!!tabs?.length)));
}

let siapWakeAudioContext: AudioContext | null = null;
export function keepTabAwake(): void {
  if (typeof window === "undefined") return;
  try {
    if (siapWakeAudioContext && siapWakeAudioContext.state !== "closed") {
      if (siapWakeAudioContext.state === "suspended") void siapWakeAudioContext.resume();
      return;
    }
    const ctx = new AudioContext();
    siapWakeAudioContext = ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {}
}
