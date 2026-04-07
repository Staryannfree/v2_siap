import { useState, useEffect, useCallback, useRef, useMemo, type KeyboardEvent } from "react";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { Joyride, STATUS } from 'react-joyride';
import { toast } from "sonner";
import { 
  GraduationCap, 
  Search, 
  Sparkles, 
  Mic, 
  Image as ImageIcon,
  Loader2,
  FileText,
  Calendar,
  MonitorSmartphone,
  Info,
  RotateCcw,
  CheckCircle2,
  XCircle,
  ArrowRight,
  MousePointer2,
  BookOpen,
  Database,
  Zap,
  CalendarDays,
  PlusCircle,
  Save as SaveIcon,
  Eye,
  FileCheck2,
  Rocket,
  Clock,
  Camera,
  Upload,
  Radio,
  QrCode,
  Lock,
  LogOut,
  UserX,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import DropZone from "@/components/DropZone";
import { PlanejamentoTurboWizard, type TurboInjectionTask } from "@/components/PlanejamentoTurboWizard";
import { Button } from "@/components/ui/button";
import { extractAbsencesFromImage } from "@/lib/mock-api";
import ValidationPanel from "@/components/ValidationPanel";
import { PautaCameraVisionDialog } from "@/components/PautaCameraVisionDialog";
import { ConfirmacaoLoteModal } from "@/components/ConfirmacaoLoteModal";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/** Diagnóstico de build Vite — espelha `src/lib/supabase.ts`; nunca logar valores completos da chave. */
const VITE_SUPABASE_URL_DEFINED = Boolean(
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim(),
);
const VITE_SUPABASE_ANON_KEY_DEFINED = Boolean(
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim(),
);
import { safeTabsSendMessage, safeTabsSendMessageCallback } from "@/lib/safe-tabs-send-message";
import {
  formatDiaParaMensagemUsuario,
  formatDiaSelecionadoParaPrompt,
} from "@/lib/gemini-pauta-camera";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type SiapNavTab = "frequencia" | "conteudo" | "planejamento";

/** App publicado na Vercel — query `room` deve coincidir com o canal Supabase da extensão. */
const SIAP_MOBILE_APP_ORIGIN = "https://planejamentoturbo.vercel.app";

/** Landing de vendas (defina VITE_LANDING_PAGE_URL no .env da extensão). */
const LANDING_PAGE_URL =
  (import.meta.env.VITE_LANDING_PAGE_URL as string | undefined)?.trim() || SIAP_MOBILE_APP_ORIGIN;

/** Após TROCAR_TURMA: reenviar DADOS_TURMA ao celular quando o SIAP recarregar (sessionStorage no painel da extensão). */
const SIAP_ESPERANDO_DADOS_KEY = "siap_esperando_dados";

/** Após REQUEST_SYNC_TURMAS: aguardar classesData atualizar e então enviar DADOS_TURMA ao celular. */
const SIAP_SYNC_TURMAS_KEY = "siap_sync_turmas_pending";

/** Após redirect para listagem: painel deve autoclicar em "Listar" uma vez ao carregar (chrome.tabs.onUpdated). */
const SIAP_AUTO_CLICK_LISTAR_KEY = "SIAP_AUTO_CLICK_LISTAR";

/**
 * MODO DESENVOLVEDOR: não consulta `professores` / Mercado Pago — força licença ativa.
 * Defina `false` antes de publicar a extensão.
 */
const DEV_BYPASS_ASSINATURA = true;

/** Broadcast STATUS_SIAP: logado no portal vs deslogado (regra alinhada a isSiapSessionValid). */
type SiapAuthHeartbeatStatus = "logado" | "deslogado";

const SIAP_TAB_URL_MATCH = "*://siap.educacao.go.gov.br/*";

/** Sessão SIAP: só considera deslogado quando a URL indica login ou sessão expirada (sem DOM). */
function isSiapPortalUrlProbablyLoggedIn(url: string | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.includes("login.aspx") || u.includes("sessaoexpirada")) return false;
  return u.includes("siap.educacao.go.gov.br");
}

/**
 * Executado na página do SIAP (executeScript) — não referenciar escopo externo.
 * Sessão válida: #lblNomeUsuario com texto OU link de logout; exclui login.aspx / sessão expirada.
 */
function siapInjectedSessionCheck(): { loggedIn: boolean; href: string } {
  const href = location.href || "";
  const low = href.toLowerCase();
  if (low.includes("login.aspx") || low.includes("sessaoexpirada")) {
    return { loggedIn: false, href };
  }
  const el = document.getElementById("lblNomeUsuario");
  const hasUser = !!(el && String(el.textContent || "").trim());
  let hasLogout = false;
  document.querySelectorAll("a[href]").forEach((a) => {
    if ((a.getAttribute("href") || "").toLowerCase().includes("logout")) {
      hasLogout = true;
    }
  });
  return { loggedIn: hasUser || hasLogout, href };
}

/** Página apta a listar turmas (listagem ou UI equivalente). */
function siapInjectedTurmasListagemReady(): { ready: boolean } {
  const href = (location.href || "").toLowerCase();
  if (href.includes("diarioescolarlistagem.aspx")) {
    return { ready: true };
  }
  const listBtn =
    (document.querySelector('input[value*="Listar"]') as HTMLInputElement | null) ||
    (Array.from(document.querySelectorAll("input, button")).find((el) => {
      const v = ((el as HTMLInputElement).value || el.textContent || "").toLowerCase();
      return v.includes("listar");
    }) as HTMLInputElement | undefined);
  if (listBtn) return { ready: true };
  for (const t of document.querySelectorAll("table")) {
    const text = (t.textContent || "").toLowerCase();
    if (text.includes("turma") && (text.includes("componente") || text.includes("disciplina"))) {
      return { ready: true };
    }
  }
  return { ready: false };
}

function executeScriptPromise(chromeApi: any, tabId: number, func: () => unknown): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      if (!chromeApi?.scripting?.executeScript) {
        resolve(undefined);
        return;
      }
      chromeApi.scripting.executeScript(
        { target: { tabId }, func: func as () => void },
        (results: Array<{ result?: unknown }> | undefined) => {
          if (chromeApi.runtime?.lastError) {
            resolve(undefined);
            return;
          }
          const first = Array.isArray(results) && results.length > 0 ? results[0] : undefined;
          resolve(first?.result);
        },
      );
    } catch {
      resolve(undefined);
    }
  });
}

async function getChromeCurrentWindowId(chromeApi: any): Promise<number | undefined> {
  if (!chromeApi?.windows?.getCurrent) return undefined;
  return new Promise((resolve) => {
    try {
      chromeApi.windows.getCurrent((w: { id?: number }) => {
        resolve(w?.id);
      });
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Resolve aba do SIAP com sessão realmente logada (DOM), priorizando aba ativa da janela atual.
 * Evita falso positivo quando tabs[0] é login.aspx em segundo plano e outra aba está em default.aspx.
 */
async function resolveSiapSessionFromDom(chromeApi: any): Promise<{ tabId: number; url: string } | null> {
  if (!chromeApi?.tabs?.query) return null;

  const tabs: any[] = await new Promise((resolve) => {
    try {
      chromeApi.tabs.query({ url: SIAP_TAB_URL_MATCH }, (t: any[]) => {
        resolve(Array.isArray(t) ? t : []);
      });
    } catch {
      resolve([]);
    }
  });
  if (tabs.length === 0) return null;

  const currentWindowId = await getChromeCurrentWindowId(chromeApi);

  const sorted = [...tabs].sort((a, b) => {
    const score = (x: any) =>
      (x.active ? 4 : 0) +
      (currentWindowId != null && x.windowId === currentWindowId ? 2 : 0) +
      (typeof x.index === "number" ? -x.index / 1000 : 0);
    return score(b) - score(a);
  });

  if (chromeApi.scripting?.executeScript) {
    for (const tab of sorted) {
      if (tab.id == null) continue;
      const result = await executeScriptPromise(chromeApi, tab.id, siapInjectedSessionCheck);
      if (
        result &&
        typeof result === "object" &&
        (result as { loggedIn?: boolean }).loggedIn === true
      ) {
        const href = String((result as { href?: string }).href || tab.url || "");
        return { tabId: tab.id, url: href };
      }
    }
  }

  for (const tab of sorted) {
    const url = String(tab.url || "");
    const u = url.toLowerCase();
    if (!u.includes("siap.educacao.go.gov.br")) continue;
    if (u.includes("login.aspx") || u.includes("sessaoexpirada")) continue;
    if (tab.id != null) {
      return { tabId: tab.id, url };
    }
  }
  return null;
}

async function evaluateTurmasListagemReadyOnTab(
  chromeApi: any,
  tabId: number,
  tabUrl: string,
): Promise<boolean> {
  const u = tabUrl.toLowerCase();
  if (u.includes("diarioescolarlistagem.aspx")) return true;
  if (!chromeApi?.scripting?.executeScript) return false;
  const r = await executeScriptPromise(chromeApi, tabId, siapInjectedTurmasListagemReady);
  if (r && typeof r === "object" && "ready" in r) {
    return !!(r as { ready?: boolean }).ready;
  }
  return false;
}

function isSiapSessionValid(chromeApi: any): Promise<boolean> {
  return resolveSiapSessionFromDom(chromeApi).then((r) => r != null);
}

function hasSiapTabOpen(chromeApi: any): Promise<boolean> {
  if (!chromeApi?.tabs?.query) return Promise.resolve(false);
  return new Promise((resolve) => {
    chromeApi.tabs.query({ url: SIAP_TAB_URL_MATCH }, (tabs: unknown[]) => {
      resolve(Array.isArray(tabs) && tabs.length > 0);
    });
  });
}

/**
 * Mantém a thread de áudio ativa (volume 0) para reduzir chance do Chrome hibernar a aba
 * do painel e derrubar o Realtime — referência única de AudioContext.
 */
let siapWakeAudioContext: AudioContext | null = null;

function keepTabAwake(): void {
  if (typeof window === "undefined") return;
  try {
    if (siapWakeAudioContext && siapWakeAudioContext.state !== "closed") {
      if (siapWakeAudioContext.state === "suspended") {
        void siapWakeAudioContext.resume().catch(() => {});
      }
      return;
    }
    const ctx = new AudioContext();
    siapWakeAudioContext = ctx;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
  } catch (e) {
    console.warn("SIAP: keepTabAwake não pôde iniciar", e);
  }
}

type PlanejamentoInjectionRow = TurboInjectionTask & {
  status: "pending" | "processing" | "done";
};

/** Descobre o rowIndex da turma atual na tabela da listagem (usa stats da página de edição). */
function findRowIndexForCurrentClass(classesData: Record<string, any[]> | null, pageStats: any): number | null {
  if (!classesData || typeof classesData !== "object") return null;
  const turmaNeedle = (pageStats?.turma || "").trim();
  if (!turmaNeedle) return null;
  const discNeedle = (pageStats?.disciplina || "").trim().toUpperCase();

  const entries = Object.entries(classesData);
  for (const [disc, turmas] of entries) {
    if (discNeedle) {
      const d = disc.toUpperCase();
      if (!d.includes(discNeedle) && !discNeedle.includes(d)) continue;
    }
    if (!Array.isArray(turmas)) continue;
    for (const t of turmas) {
      if (t?.name != null && String(t.name).includes(turmaNeedle)) return t.rowIndex;
    }
  }
  for (const [, turmas] of entries) {
    if (!Array.isArray(turmas)) continue;
    for (const t of turmas) {
      if (t?.name != null && String(t.name).includes(turmaNeedle)) return t.rowIndex;
    }
  }
  return null;
}

type SiapPendingDayEntry = number | { day: number; dataCanonica?: string | null };

function siapDayEntryDay(d: SiapPendingDayEntry): number {
  return typeof d === "number" ? d : d.day;
}

function siapDayEntryCanon(d: SiapPendingDayEntry): string | undefined {
  if (typeof d === "number") return undefined;
  const c = d.dataCanonica;
  return c ? String(c) : undefined;
}

/** Números de dia pendentes (únicos, ordenados) — mesmo critério do calendário em `pendingMonths`. */
function flattenPendingDayNumbers(stats: { pendingMonths?: unknown } | null | undefined): number[] {
  const months = stats?.pendingMonths;
  if (!Array.isArray(months)) return [];
  const nums = months.flatMap((m: { days?: SiapPendingDayEntry[] }) =>
    Array.isArray(m?.days) ? m.days.map((d) => siapDayEntryDay(d)) : [],
  );
  const finite = nums.filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(finite)].sort((a, b) => a - b);
}

/** dataCanonica SIAP costuma ser yyyy/m/d → dd/mm/yyyy para o mobile. */
function canonYmdToDdMmYyyy(canon: string): string | null {
  const parts = String(canon).split("/").map((p) => parseInt(String(p).trim(), 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [yy, mm, dd] = parts;
  return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${yy}`;
}

/** Datas completas das aulas pendentes (para o app não perder o mês ao virar calendário no PC). */
function flattenPendingDayDateStrings(
  stats: { pendingMonths?: unknown } | null | undefined,
): string[] {
  const months = stats?.pendingMonths;
  if (!Array.isArray(months)) return [];
  const out: string[] = [];
  for (const m of months as {
    month?: number;
    year?: number;
    days?: SiapPendingDayEntry[];
  }[]) {
    const mo = m.month;
    const y = m.year;
    const days = Array.isArray(m?.days) ? m.days : [];
    for (const entry of days) {
      const day = siapDayEntryDay(entry);
      const canon = siapDayEntryCanon(entry);
      if (canon) {
        const s = canonYmdToDdMmYyyy(canon);
        if (s) out.push(s);
      } else if (
        Number.isFinite(mo) &&
        mo != null &&
        Number.isFinite(y) &&
        y != null &&
        Number.isFinite(day)
      ) {
        out.push(`${String(day).padStart(2, "0")}/${String(mo).padStart(2, "0")}/${y}`);
      }
    }
  }
  return out;
}

/** Fatia para dedupe de broadcast quando só mudam os pendentes do calendário. */
function pendingMonthsDedupeSegment(
  stats: { pendingMonths?: unknown } | null | undefined,
): string {
  const months = stats?.pendingMonths;
  if (!Array.isArray(months)) return "0";
  return (months as { year?: number; month?: number; days?: SiapPendingDayEntry[] }[])
    .map((m) => {
      const days = Array.isArray(m?.days)
        ? m!.days!.map((d) =>
            typeof d === "number"
              ? String(d)
              : `${siapDayEntryDay(d)}:${siapDayEntryCanon(d) ?? ""}`,
          )
        : [];
      return `${m.year ?? "y"}-${m.month ?? "m"}-${days.join(".")}`;
    })
    .join(";");
}

type TurmaDisponivelPayload = { id: string; nome: string; disciplina: string };

/**
 * Turmas de `siap_classes_data` — mesma estrutura do painel "SUAS TURMAS" (`Object.entries` por disciplina).
 * `disciplina` é o texto da coluna componente no SIAP (chave do mapa). `id` = rowIndex para `navigateSiapForTab` / `TROCAR_TURMA`.
 */
function buildTurmasDisponiveis(classesData: Record<string, unknown> | null | undefined): TurmaDisponivelPayload[] {
  if (!classesData || typeof classesData !== "object") return [];
  const out: TurmaDisponivelPayload[] = [];
  const seen = new Set<number>();
  for (const [disciplinaKey, turmas] of Object.entries(classesData)) {
    if (!Array.isArray(turmas)) continue;
    const disciplina = String(disciplinaKey ?? "").trim();
    for (const t of turmas as { rowIndex?: unknown; name?: unknown }[]) {
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

/** Nome completo do professor no SIAP (`content.js` → `#lblNomeUsuario` → `siap_user_name`). */
const SIAP_USER_NAME_STORAGE_KEY = "siap_user_name";
/** E-mail do professor no SIAP (`content.js` → `siap_user_email`). */
const SIAP_USER_EMAIL_STORAGE_KEY = "siap_user_email";
/** Escola/entidade no SIAP (`content.js` → `#lblNomeEntidade` → `siap_user_escola_vinculada`). */
const SIAP_USER_ESCOLA_STORAGE_KEY = "siap_user_escola_vinculada";

type DadosTurmaBroadcastPayload = {
  turma: string;
  disciplina: string;
  alunos: unknown[];
  diasPendentes: number[];
  /** Datas dd/mm/aaaa na ordem do calendário SIAP (pendências por mês visível). */
  diasPendentesDatas?: string[];
  turmasDisponiveis: TurmaDisponivelPayload[];
  /** Contrato único de data: dd/mm/aaaa vindo de txtDataSelecionada no SIAP. Nulo quando não há dia aberto. */
  diaOficialSiap?: string | null;
  /** Valor do dropdown de aulas do dia no SIAP (geminadas); string vazia quando indisponível. */
  aulaAtual?: string;
};

/** Extrai diaOficialSiap de pageStats (campo injetado pelo content.js).
 *  Fallback: selectedDay (número) → constrói dd/mm/aaaa com mês/ano atuais
 *  para compatibilidade com versões antigas do content.js. */
/** Dropdown de aulas do dia (`LstAulasDiaSelecionado`) — frequência e conteúdo usam o mesmo scrape. */
function getAulaAtualFromStats(stats: { aulaAtual?: unknown } | null | undefined): string {
  if (!stats || stats.aulaAtual == null) return "";
  const s = String(stats.aulaAtual).trim();
  return s;
}

function getDiaOficialSiapFromStats(stats: { diaOficialSiap?: unknown; selectedDay?: unknown } | null | undefined): string | null {
  if (!stats) return null;
  if (stats.diaOficialSiap != null && String(stats.diaOficialSiap).trim() !== "") {
    return String(stats.diaOficialSiap).trim();
  }
  // Fallback: selectedDay é só o número do dia (content.js antigo). Constrói data completa.
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

/**
 * Envia DADOS_TURMA e, se ok, DADOS_PROFESSOR com nome, escola e e-mail do storage (content script / pareamento).
 */
function sendBroadcastDadosTurmaAndProfessor(
  channel: RealtimeChannel,
  turmaPayload: DadosTurmaBroadcastPayload,
): Promise<string> {
  const chromeApi = (window as any).chrome;

  return new Promise((resolve) => {
    const readPerfilProfessor = (cb: (nome: string, email: string, escola: string) => void) => {
      if (!chromeApi?.storage?.local) {
        cb("", "", "");
        return;
      }
      try {
        chromeApi.storage.local.get(
          [
            SIAP_USER_NAME_STORAGE_KEY,
            SIAP_USER_EMAIL_STORAGE_KEY,
            SIAP_USER_ESCOLA_STORAGE_KEY,
          ],
          (result: Record<string, unknown>) => {
            const n = result?.[SIAP_USER_NAME_STORAGE_KEY];
            const e = result?.[SIAP_USER_EMAIL_STORAGE_KEY];
            const s = result?.[SIAP_USER_ESCOLA_STORAGE_KEY];
            cb(
              typeof n === "string" ? n.trim() : "",
              typeof e === "string" ? e.trim() : "",
              typeof s === "string" ? s.trim() : "",
            );
          },
        );
      } catch {
        cb("", "", "");
      }
    };

    readPerfilProfessor((nomeProfessor, emailProfessor, escolaProfessor) => {
      void (async () => {
        let emailFinal = emailProfessor.trim();
        if (!emailFinal && isSupabaseConfigured && supabase) {
          try {
            const { data } = await supabase.auth.getSession();
            const em = data.session?.user?.email?.trim();
            if (em) emailFinal = em.toLowerCase();
          } catch {
            /* ignore */
          }
        }
        void channel
          .send({
            type: "broadcast",
            event: "DADOS_TURMA",
            payload: turmaPayload,
          })
          .then(async (status) => {
            const st = typeof status === "string" ? status : String(status ?? "");
            if (st === "ok") {
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
            return st;
          })
          .then((status) => resolve(status))
          .catch(() => resolve("error"));
      })();
    });
  });
}

/**
 * Reenvia nome, escola e e-mail ao mobile antes de comandos que disparam injeção no SIAP — alinha vínculo da licença no app.
 */
function broadcastDadosProfessorFromStorage(channel: RealtimeChannel): Promise<void> {
  const chromeApi = (window as any).chrome;
  return new Promise((resolve) => {
    if (!chromeApi?.storage?.local) {
      resolve();
      return;
    }
    try {
      chromeApi.storage.local.get(
        [
          SIAP_USER_NAME_STORAGE_KEY,
          SIAP_USER_EMAIL_STORAGE_KEY,
          SIAP_USER_ESCOLA_STORAGE_KEY,
        ],
        (result: Record<string, unknown>) => {
          void (async () => {
            const n =
              typeof result?.[SIAP_USER_NAME_STORAGE_KEY] === "string"
                ? String(result[SIAP_USER_NAME_STORAGE_KEY]).trim()
                : "";
            let e =
              typeof result?.[SIAP_USER_EMAIL_STORAGE_KEY] === "string"
                ? String(result[SIAP_USER_EMAIL_STORAGE_KEY]).trim()
                : "";
            const esc =
              typeof result?.[SIAP_USER_ESCOLA_STORAGE_KEY] === "string"
                ? String(result[SIAP_USER_ESCOLA_STORAGE_KEY]).trim()
                : "";
            if (!e && isSupabaseConfigured && supabase) {
              try {
                const { data } = await supabase.auth.getSession();
                const em = data.session?.user?.email?.trim();
                if (em) e = em.toLowerCase();
              } catch {
                /* ignore */
              }
            }
            void channel
              .send({
                type: "broadcast",
                event: "DADOS_PROFESSOR",
                payload: {
                  ...(n ? { nome: n } : {}),
                  ...(n ? { nome_siap: n } : {}),
                  ...(esc ? { escola_siap: esc } : {}),
                  ...(e ? { email: e } : {}),
                },
              })
              .finally(() => resolve());
          })();
        },
      );
    } catch {
      resolve();
    }
  });
}

/** Primeira ocorrência do dia na lista de pendentes (ordem do SIAP: mês a mês), para enviar mês/ano/dataCanonica ao content script. */
function findFirstPendingDayContext(
  stats: { pendingMonths?: unknown } | null | undefined,
  dayNum: number,
): { day: number; month?: number; year?: number; dataCanonica: string | null } | null {
  const months = stats?.pendingMonths;
  if (!Array.isArray(months) || !Number.isFinite(dayNum)) return null;
  for (const m of months as { month?: number; year?: number; days?: SiapPendingDayEntry[] }[]) {
    const days = m?.days;
    if (!Array.isArray(days)) continue;
    for (const dayEntry of days) {
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

/** Primeiro dia pendente na ordem do SIAP (`pendingMonths`: mês a mês, dias na ordem da lista). */
function firstPendingDayFromStats(
  stats: { pendingMonths?: unknown } | null | undefined,
): { day: number; month?: number; year?: number; dataCanonica: string | null } | null {
  const months = stats?.pendingMonths;
  if (!Array.isArray(months)) return null;
  for (const m of months as { month?: number; year?: number; days?: SiapPendingDayEntry[] }[]) {
    const days = m?.days;
    if (!Array.isArray(days)) continue;
    for (const dayEntry of days) {
      const day = siapDayEntryDay(dayEntry);
      if (!Number.isFinite(day) || day <= 0) continue;
      return {
        day,
        month: m.month,
        year: m.year,
        dataCanonica: siapDayEntryCanon(dayEntry) ?? null,
      };
    }
  }
  return null;
}

function pageStatsHasSelectedDay(pageStats: { selectedDay?: unknown } | null | undefined): boolean {
  const raw = pageStats?.selectedDay;
  if (raw == null || raw === "") return false;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 1 && n <= 31;
}

const Index = () => {
  const [selectedDay, setSelectedDay] = useState("");
  const [classesData, setClassesData] = useState<any>(null);
  const [pageStats, setPageStats] = useState<any>(null);
  const pageStatsRef = useRef<any>(null);
  const classesDataRef = useRef<any>(null);
  /** Evita flood no Supabase com o mesmo STATUS_SIAP. */
  const lastSiapAuthBroadcastRef = useRef<SiapAuthHeartbeatStatus | null>(null);
  /** Canal Realtime atual (para reenvio DADOS_TURMA após troca de turma). */
  const realtimeChannelRef = useRef<any>(null);
  const esperandoTurmaFlushTimerRef = useRef<number | null>(null);
  const tryFlushEsperandoDadosTurmaRef = useRef<(stats: unknown) => void>(() => {});
  /** Ref estável para handleLoadClasses — atualizada a cada render para evitar closure stale no canal. */
  const handleLoadClassesRef = useRef<() => void>(() => {});
  /** Ref estável para handleFinalSave em comandos COMANDO_REMOTO remotos. */
  const handleFinalSaveRef = useRef<() => void>(() => {});
  /** Refs estáveis para listeners Realtime — evitam re-subscribe quando callbacks mudam. */
  const marcarFaltasPorNumerosChamadaRef = useRef<
    (numerosBrutos: number[], fonte: "input-ninja" | "controle-remoto") => void
  >(() => {});
  const desmarcarFaltasPorNumerosChamadaRef = useRef<(numerosBrutos: number[]) => void>(() => {});
  const performSaveAndNextDayRef = useRef<(opts?: { fromRemote?: boolean }) => void>(() => {});
  const performSelectCalendarDayRef = useRef<
    (day: number, month?: number, year?: number, dataCanonica?: string | null) => void
  >(() => {});
  const trocarTurmaControleRemotoRef = useRef<(turmaIdRaw: string) => void>(() => {});
  const handleMudarMesLocalRef = useRef<(direcao: "anterior" | "proximo") => void>(() => {});
  const handleSiapSessionLostRef = useRef<(motivo: string) => void>(() => {});
  const activeTabRef = useRef<"frequencia" | "conteudo" | "planejamento">("frequencia");
  /** Mobile `ABRIR_CONTEUDO`: `turmaId` = rowIndex da listagem SIAP (mesmo contrato que `turmasDisponiveis`). */
  const abrirConteudoMobileRef = useRef<(turmaId: string) => void>(() => {});
  const abrirPlanejamentoMobileRef = useRef<(turmaId: string) => void>(() => {});
  const handleUnidadeTematicaChangeMobileRef = useRef<(value: string) => void>(() => {});
  /** Evita disparar vários `SELECT_CALENDAR_DAY` enquanto o SIAP ainda não atualiza `selectedDay`. */
  const conteudoAutoDayLockRef = useRef<string | null>(null);
  /** Evita flood de CONTEUDO_CARREGADO / DADOS_CONTEUDO_PAGINA a cada tick do content script. */
  const conteudoMobileBroadcastSigRef = useRef<string | null>(null);
  /** Dedupe para o auto-broadcast de DADOS_TURMA na aba frequência. */
  const frequenciaMobileBroadcastSigRef = useRef<string | null>(null);
  /**
   * Incrementa a cada auto-clique no calendário (cenário 2). Incluído na assinatura do cenário 1 para que,
   * após postback/reload da aba SIAP, o broadcast não seja suprimido por dedupe igual ao estado pré-reload.
   */
  const conteudoCalNavGenerationRef = useRef(0);
  const [searchStudent, setSearchStudent] = useState("");
  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(null);
  /** Planejamento: destaque do botão pela data canônica SIAP (ex: 2026/5/4). */
  const [selectedPlanningCanon, setSelectedPlanningCanon] = useState<string | null>(null);
  const [markedStudents, setMarkedStudents] = useState<any[]>([]);
  const markedStudentsRef = useRef<any[]>([]);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcriptData, setTranscriptData] = useState("");
  const [voiceSuggestions, setVoiceSuggestions] = useState<any[]>([]);
  const [voiceFailCount, setVoiceFailCount] = useState(0);
  const [isLoginRequired, setIsLoginRequired] = useState(false);
  const [syncStatus, setSyncStatus] = useState<any>({ status: "IDLE" });
  const [timeSavedStats, setTimeSavedStats] = useState({ extractionsCount: 0, voiceCount: 0, autoFillCount: 0 });
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGhostMode, setIsGhostMode] = useState(false);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(false);
  const [runTour, setRunTour] = useState(false);
  const shouldBeListening = useRef(false);
  const voiceSessionCount = useRef(0);
  const silenceTimerRef = useRef<any>(null);
  /** Instância ativa do webkit SpeechRecognition — necessária para .stop() ao clicar em Parar. */
  const recognitionRef = useRef<any>(null);
  const [isReviewingVoiceResults, setIsReviewingVoiceResults] = useState(false);
  const [pautaCameraOpen, setPautaCameraOpen] = useState(false);
  const [confirmacaoLoteOpen, setConfirmacaoLoteOpen] = useState(false);
  /** Sala Realtime — UUID novo a cada abertura do painel (QR + canal idênticos). */
  const [roomId] = useState(() => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `room-${Date.now()}-${Math.random().toString(36).slice(2)}`));

  const [session, setSession] = useState<Session | null>(null);
  const [authSessionLoading, setAuthSessionLoading] = useState(true);
  /** após login: verificação em public.professores */
  const [licencaStatus, setLicencaStatus] = useState<"idle" | "loading" | "ativa" | "bloqueada">("idle");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authBusy, setAuthBusy] = useState(false);
  /** Estado da inscrição no canal Supabase (aba Frequência). */
  const [remoteBroadcastStatus, setRemoteBroadcastStatus] = useState<
    "idle" | "connecting" | "subscribed" | "error" | "room_error" | "disabled"
  >("idle");
  const [pairingQrOpen, setPairingQrOpen] = useState(false);
  /** Ref do setter: listeners Supabase (MV3) podem segurar closure antiga; sempre fecha o modal atual. */
  const setPairingQrOpenRef = useRef(setPairingQrOpen);
  setPairingQrOpenRef.current = setPairingQrOpen;

  /** E-mail SIAP em storage — enriquece o QR (`?email=`) para o mobile já vincular logs à pessoa. */
  const [siapProfessorEmail, setSiapProfessorEmail] = useState("");
  /** Nome do professor no SIAP (`siap_user_name`) — hardware lock com `nome_vinculado_siap`. */
  const [siapProfessorNome, setSiapProfessorNome] = useState("");
  const [pairingParearBusy, setPairingParearBusy] = useState(false);
  /** Nome normalizado gravado no Supabase (`nome_vinculado_siap`) para comparar com o SIAP. */
  const [professorDbVinculo, setProfessorDbVinculo] = useState<{
    nomeNorm: string;
  } | null>(null);

  const mobilePairingUrl = useMemo(() => {
    const base = `${SIAP_MOBILE_APP_ORIGIN}/?room=${encodeURIComponent(roomId)}`;
    const em = siapProfessorEmail.trim();
    if (!em) return base;
    return `${base}&email=${encodeURIComponent(em)}`;
  }, [roomId, siapProfessorEmail]);

  const diaPautaGemini = useMemo(
    () => formatDiaSelecionadoParaPrompt(selectedDay, selectedDayNumber, isGhostMode),
    [selectedDay, selectedDayNumber, isGhostMode],
  );
  const [studentsDetectedByVoice, setStudentsDetectedByVoice] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"frequencia" | "conteudo" | "planejamento">("frequencia");
  activeTabRef.current = activeTab;
  const [selectedConteudos, setSelectedConteudos] = useState<string[]>([]);
  const [selectedMateriais, setSelectedMateriais] = useState<string[]>([]);
  const [showAllMateriais, setShowAllMateriais] = useState(false);
  const [isContentReviewModalOpen, setIsContentReviewModalOpen] = useState(false);
  const [executionProgress, setExecutionProgress] = useState({ current: 0, total: 0 });
  const [isSyncingDay, setIsSyncingDay] = useState(false);
  const [isSyncingMonth, setIsSyncingMonth] = useState(false);

  /** Tabela premium de sincronização — Planejamento Turbo */
  const [planejamentoInjectionRows, setPlanejamentoInjectionRows] = useState<PlanejamentoInjectionRow[]>([]);
  const [isPlanejamentoInjectionOpen, setIsPlanejamentoInjectionOpen] = useState(false);
  const planejamentoInjectionTotalRef = useRef(0);
  /** Evita que ITEM_PROCESSED/QUEUE_PROGRESS do Turbo alterem a barra de conteúdo. */
  const planejamentoInjectionActiveRef = useRef(false);

  // Refs para evitar "Closure Traps" em ouvintes de mensagens
  const selectedDayRef = useRef(selectedDay);
  /** Último pageType vindo do SIAP — só sincronizamos a aba quando o tipo de página realmente muda (evita “puxar” de volta para Frequência). */
  const prevSiapPageTypeRef = useRef<string | null>(null);
  useEffect(() => {
    selectedDayRef.current = selectedDay;
  }, [selectedDay]);

  useEffect(() => {
    markedStudentsRef.current = markedStudents;
  }, [markedStudents]);

  useEffect(() => {
    pageStatsRef.current = pageStats;
  }, [pageStats]);

  useEffect(() => {
    classesDataRef.current = classesData;
  }, [classesData]);

  /** Supabase Auth: sessão inicial + mudanças */
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthSessionLoading(false);
      setSession(null);
      return;
    }
    let subscription: { unsubscribe: () => void } | undefined;
    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setAuthSessionLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    subscription = data.subscription;
    return () => subscription?.unsubscribe();
  }, []);

  /** E-mail do professor (content script → `siap_user_email`) — atualiza o QR e o broadcast DADOS_PROFESSOR. */
  useEffect(() => {
    const chromeApi = (window as any).chrome;
    if (!chromeApi?.storage?.local) return;
    const load = () => {
      chromeApi.storage.local.get([SIAP_USER_EMAIL_STORAGE_KEY], (r: Record<string, unknown>) => {
        const v = r?.[SIAP_USER_EMAIL_STORAGE_KEY];
        setSiapProfessorEmail(typeof v === "string" ? v.trim() : "");
      });
    };
    load();
    const onCh = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== "local" || !changes[SIAP_USER_EMAIL_STORAGE_KEY]) return;
      load();
    };
    chromeApi.storage.onChanged.addListener(onCh);
    return () => chromeApi.storage.onChanged.removeListener(onCh);
  }, []);

  /** Nome do professor (content script → `siap_user_name`). */
  useEffect(() => {
    const chromeApi = (window as any).chrome;
    if (!chromeApi?.storage?.local) return;
    const load = () => {
      chromeApi.storage.local.get([SIAP_USER_NAME_STORAGE_KEY], (r: Record<string, unknown>) => {
        const v = r?.[SIAP_USER_NAME_STORAGE_KEY];
        setSiapProfessorNome(typeof v === "string" ? v.trim() : "");
      });
    };
    load();
    const onCh = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== "local" || !changes[SIAP_USER_NAME_STORAGE_KEY]) return;
      load();
    };
    chromeApi.storage.onChanged.addListener(onCh);
    return () => chromeApi.storage.onChanged.removeListener(onCh);
  }, []);

  /** Se o SIAP não expuser e-mail na página, usa o e-mail da sessão Turbo; se divergir, sobrescreve para evitar valor stale. */
  useEffect(() => {
    const chromeApi = (window as any).chrome;
    const em = session?.user?.email?.trim();
    if (!chromeApi?.storage?.local || !em) return;
    chromeApi.storage.local.get([SIAP_USER_EMAIL_STORAGE_KEY], (r: Record<string, unknown>) => {
      const existing = typeof r[SIAP_USER_EMAIL_STORAGE_KEY] === "string" ? r[SIAP_USER_EMAIL_STORAGE_KEY].trim() : "";
      const normalized = em.toLowerCase();
      if (existing === normalized) return;
      chromeApi.storage.local.set({ [SIAP_USER_EMAIL_STORAGE_KEY]: normalized }, () => {
        setSiapProfessorEmail(normalized);
      });
    });
  }, [session?.user?.email]);

  /** Assinatura SaaS (public.professores) + nome vinculado (hardware lock). */
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLicencaStatus("idle");
      setProfessorDbVinculo(null);
      return;
    }
    const uid = session?.user?.id;
    if (!uid) {
      setLicencaStatus("idle");
      setProfessorDbVinculo(null);
      return;
    }

    // MODO DESENVOLVEDOR: Bypass da verificação de pagamento (sem banco / Mercado Pago)
    if (DEV_BYPASS_ASSINATURA) {
      setLicencaStatus("ativa");
      setProfessorDbVinculo({ nomeNorm: "" });
      return;
    }

    // Consulta real em produção (desative DEV_BYPASS_ASSINATURA acima)
    setLicencaStatus("loading");
    setProfessorDbVinculo(null);
    let cancelled = false;
    void supabase
      .from("professores")
      .select("status_assinatura, nome_vinculado_siap")
      .eq("id", uid)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error && error.code !== "PGRST116") {
          console.warn("SIAP: professores", error.message);
        }
        if (error?.code === "PGRST116" || !data) {
          setProfessorDbVinculo(null);
          setLicencaStatus("bloqueada");
          return;
        }
        const st = String(data.status_assinatura ?? "").toLowerCase();
        /** trial | pro | plus: período ativo no painel; sem linha em professores continua bloqueada. */
        const liberado = st === "trial" || st === "pro" || st === "plus";
        const nomeRaw = String(data.nome_vinculado_siap ?? "").trim();
        const nomeNorm = nomeRaw.toLowerCase().replace(/\s+/g, " ");
        setProfessorDbVinculo({ nomeNorm });
        setLicencaStatus(liberado ? "ativa" : "bloqueada");
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const perfilSiapDivergente = useMemo(() => {
    if (DEV_BYPASS_ASSINATURA) return false;
    if (licencaStatus !== "ativa") return false;
    if (!professorDbVinculo) return false;
    const dbNome = professorDbVinculo.nomeNorm;
    const scNome = siapProfessorNome.trim().toLowerCase().replace(/\s+/g, " ");
    if (!dbNome) return false;
    if (!scNome) return false;
    return dbNome !== scNome;
  }, [licencaStatus, professorDbVinculo, siapProfessorNome]);

  // Tour Steps
  const tourSteps: any[] = [
    {
      target: 'body',
      content: 'Bem-vindo ao Modo Seguro! 👻🛡️ Este tour vai te ensinar a usar a IA sem salvar nada no SIAP oficial.',
      placement: 'center',
    },
    {
      target: '.tour-step-navegacao',
      content: 'Esta é a barra de funções. No SIAP Turbo, focamos no que importa: Frequência, Conteúdo e Planejamento.',
    },
    {
      target: '.tour-step-atualizar',
      content: 'Clique em "Listar" no SIAP e depois aqui em "Atualizar Lista" para puxar suas turmas reais!',
    },
    {
      target: '.tour-step-turmas',
      content: 'Aqui aparecem todas as suas turmas. Clique em UMA delas para abrir o diário correspondente.',
    },
    {
      target: '.tour-step-calendario',
      content: 'Agora, escolha um dos dias com aulas pendentes (em branco) para começar o lançamento.',
    },
    {
      target: '.tour-step-busca',
      content: 'Dica de Mestre: Você pode digitar o NÚMERO ou o NOME do aluno. Nosso buscador é inteligente e ignora acentos!',
    },
    {
      target: '.tour-step-busca',
      content: 'Tente agora: Digite o NÚMERO "5" ou o NOME de um aluno para ver a mágica acontecer.',
    },
    {
      target: '.tour-step-voz',
      content: 'Quer ir mais rápido? Clique no Microfone, autorize o acesso e diga: "Número 10" ou o nome do aluno.',
    },
    {
      target: '.tour-step-upload',
      content: 'Tem pauta de papel? Suba a foto aqui. A IA lerá as faltas para você conferir na pauta lateral!',
    },
    {
      target: '.tour-step-finalizar',
      content: 'Ao terminar, clique em "Finalizar Lançamento". No Modo Seguro, nada é salvo no SIAP, sinta-se livre para testar!',
    }
  ];

  const handleJoyrideEvent: import("react-joyride").EventHandler = (data) => {
    const { status } = data;
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRunTour(false);
    }
  };

  const normalizeName = (str: string) => {
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accents
      .toLowerCase()
      .replace(/[h]/g, ""); // ignore silent 'h'
  };

  const filteredStudents = pageStats?.students?.filter((s: any) => {
    const search = normalizeName(searchStudent);
    if (!search) return true;
    return normalizeName(s.name).startsWith(search) || s.number?.toString() === search;
  }) || [];

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    const email = authEmail.trim();
    const password = authPassword;
    if (!email || !password) {
      toast.error("Preencha e-mail e senha.");
      return;
    }
    setAuthBusy(true);
    try {
      if (authMode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Bem-vindo de volta!");
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success("Cadastro enviado. Verifique seu e-mail se o projeto exigir confirmação.");
        setAuthMode("signin");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha na autenticação.";
      toast.error(msg);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setAuthBusy(true);
    await supabase.auth.signOut();
    setAuthBusy(false);
    toast.info("Sessão encerrada.");
  };

  /** Salva nome (e escola se houver) em `professores` e abre o QR — hardware lock por nome. */
  const handleParearCelular = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      toast.error("Configure o Supabase na extensão.");
      return;
    }
    const uid = session?.user?.id;
    if (!uid) {
      toast.error("Faça login na conta SIAP Turbo para registrar o pareamento.");
      return;
    }
    const chromeApi = (window as any).chrome;
    let nome = "";
    let escola = "";
    if (chromeApi?.storage?.local) {
      await new Promise<void>((resolve) => {
        chromeApi.storage.local.get(
          [SIAP_USER_NAME_STORAGE_KEY, SIAP_USER_ESCOLA_STORAGE_KEY],
          (r: Record<string, unknown>) => {
            const n = r?.[SIAP_USER_NAME_STORAGE_KEY];
            if (typeof n === "string" && n.trim()) nome = n.trim();
            const e = r?.[SIAP_USER_ESCOLA_STORAGE_KEY];
            if (typeof e === "string" && e.trim()) escola = e.trim();
            resolve();
          },
        );
      });
    }
    if (!nome.trim()) {
      toast.error("Aguarde o SIAP carregar o nome do professor no topo da página ou faça login de novo no portal.");
      return;
    }
    setPairingParearBusy(true);
    try {
      const payload: Record<string, string> = { nome_vinculado_siap: nome.trim() };
      if (escola) payload.escola_vinculada_siap = escola;
      const { error } = await supabase.from("professores").update(payload).eq("id", uid);
      if (error) throw error;
      const nomeNorm = nome.trim().toLowerCase().replace(/\s+/g, " ");
      setProfessorDbVinculo({ nomeNorm });
      toast.success("Pareamento de segurança registrado.");
      setPairingQrOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Não foi possível salvar o pareamento.";
      toast.error(msg);
    } finally {
      setPairingParearBusy(false);
    }
  }, [isSupabaseConfigured, session?.user?.id, supabase]);

  /** Reenvia DADOS_TURMA ao app após o SIAP recarregar (TROCAR_TURMA). */
  const flushEsperandoDadosTurma = useCallback((freshStats: unknown) => {
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem(SIAP_ESPERANDO_DADOS_KEY) !== "true") return;

    const chromeApi = (window as any).chrome;
    if (!chromeApi?.tabs?.query) return;

    if (esperandoTurmaFlushTimerRef.current != null) {
      window.clearTimeout(esperandoTurmaFlushTimerRef.current);
      esperandoTurmaFlushTimerRef.current = null;
    }

    void (async () => {
      const resolved = await resolveSiapSessionFromDom(chromeApi);
      if (!resolved) return;

      esperandoTurmaFlushTimerRef.current = window.setTimeout(() => {
        esperandoTurmaFlushTimerRef.current = null;
        if (typeof sessionStorage === "undefined") return;
        if (sessionStorage.getItem(SIAP_ESPERANDO_DADOS_KEY) !== "true") return;

        const ch = realtimeChannelRef.current;
        if (!ch) return;

        const stats = freshStats as Record<string, unknown> | null | undefined;
        const classesSnap = classesDataRef.current;
        const diasPendentes = stats ? flattenPendingDayNumbers(stats as { pendingMonths?: unknown }) : [];
        const diasPendentesDatas = stats
          ? flattenPendingDayDateStrings(stats as { pendingMonths?: unknown })
          : [];
        const turmasDisponiveis = buildTurmasDisponiveis(classesSnap);
        const alunos =
          stats?.students && Array.isArray(stats.students)
            ? (stats.students as any[]).map((aluno: any) => ({
                id: aluno.matricula || aluno.id || `n-${aluno.number}`,
                numero: aluno.number,
                nome: aluno.name,
              }))
            : [];

        void sendBroadcastDadosTurmaAndProfessor(ch, {
          turma: (stats?.turma as string) || "",
          disciplina: (stats?.disciplina as string) || "",
          alunos,
          diasPendentes,
          diasPendentesDatas,
          turmasDisponiveis,
          diaOficialSiap: getDiaOficialSiapFromStats(stats),
          aulaAtual: getAulaAtualFromStats(stats),
        })
          .then((status) => {
            if (status !== "ok") return;
            try {
              sessionStorage.removeItem(SIAP_ESPERANDO_DADOS_KEY);
            } catch {
              /* ignore */
            }
          })
          .catch(() => {});
      }, 700);
    })();
  }, []);

  tryFlushEsperandoDadosTurmaRef.current = flushEsperandoDadosTurma;

  /** Limpa cache local, storage e avisa o mobile quando a sessão do SIAP cai. */
  const handleSiapSessionLost = useCallback((motivo: string) => {
    console.warn("🚨 [Extensão] Sessão SIAP inválida / deslogado:", motivo);
    setClassesData({});
    const chromeApi = (window as any).chrome;
    try {
      chromeApi?.storage?.local?.remove?.([
        "siap_classes_data",
        SIAP_USER_NAME_STORAGE_KEY,
        SIAP_USER_EMAIL_STORAGE_KEY,
        SIAP_USER_ESCOLA_STORAGE_KEY,
        "siap_user_cpf_vinculado",
      ]);
    } catch {
      /* ignore */
    }
    setIsLoginRequired(true);
    const ch = realtimeChannelRef.current;
    if (ch) {
      void Promise.resolve(
        ch.send({
          type: "broadcast",
          event: "ERRO_SIAP_DESLOGADO",
          payload: { motivo },
        }),
      ).catch(() => {});
    }
  }, []);

  /** Se o painel reabrir com flag pós-troca de turma, tenta reenviar quando `pageStats` existir. */
  useEffect(() => {
    if (!pageStats) return;
    tryFlushEsperandoDadosTurmaRef.current(pageStats);
  }, [pageStats]);

  /**
   * Flush pós-REQUEST_SYNC_TURMAS: quando classesData atualizar (scrape do SIAP concluído),
   * detecta o flag e envia DADOS_TURMA completo ao celular via Supabase Realtime.
   */
  useEffect(() => {
    if (!classesData || Object.keys(classesData).length === 0) return;

    let shouldFlush = false;
    try {
      shouldFlush = sessionStorage.getItem(SIAP_SYNC_TURMAS_KEY) === "true";
    } catch {
      /* ignore */
    }
    if (!shouldFlush) return;

    console.log("🚀 [Extensão] Turmas atualizadas! Enviando agora para o mobile (REQUEST_SYNC_TURMAS pendente)...");

    try {
      sessionStorage.removeItem(SIAP_SYNC_TURMAS_KEY);
    } catch {
      /* ignore */
    }

    const ch = realtimeChannelRef.current;
    if (!ch) return;

    const stats = pageStatsRef.current;
    const turmasDisponiveis = buildTurmasDisponiveis(classesData);
    const diasPendentes = stats ? flattenPendingDayNumbers(stats) : [];
    const diasPendentesDatas = stats ? flattenPendingDayDateStrings(stats) : [];
    const alunos =
      stats?.students && Array.isArray(stats.students)
        ? (stats.students as any[]).map((aluno: any) => ({
            id: aluno.matricula || aluno.id || `n-${aluno.number}`,
            numero: aluno.number,
            nome: aluno.name,
          }))
        : [];

    void sendBroadcastDadosTurmaAndProfessor(ch, {
      turma: (stats?.turma as string) || "",
      disciplina: (stats?.disciplina as string) || "",
      alunos,
      diasPendentes,
      diasPendentesDatas,
      turmasDisponiveis,
      diaOficialSiap: getDiaOficialSiapFromStats(stats),
      aulaAtual: getAulaAtualFromStats(stats),
    })
      .then((status) => {
        if (status === "ok") {
          toast.success("📋 Turmas sincronizadas com o app!");
        }
      })
      .catch(() => {});
  }, [classesData]);

  /**
   * Pós-redirect para DiarioEscolarListagem: consome SIAP_AUTO_CLICK_LISTAR e chama handleLoadClasses
   * (que então cai no ramo de clique em "Listar"). Determinístico — não depende de cache em classesData.
   */
  useEffect(() => {
    const chromeApi = (window as any).chrome;
    if (!chromeApi?.tabs?.onUpdated) return;

    const handleTabComplete = (_tabId: number, changeInfo: { status?: string }, tab: { url?: string }) => {
      const url = (tab?.url ?? "").toLowerCase();
      if (
        changeInfo.status !== "complete" ||
        !url.includes("diarioescolarlistagem.aspx") ||
        !url.includes("siap.educacao.go.gov.br")
      ) {
        return;
      }
      let needsAutoListar = false;
      try {
        needsAutoListar = sessionStorage.getItem(SIAP_AUTO_CLICK_LISTAR_KEY) === "true";
      } catch {
        return;
      }
      if (!needsAutoListar) return;

      console.log("🔄 Página de listagem carregou pós-redirecionamento! Autoclicando...");

      try {
        sessionStorage.removeItem(SIAP_AUTO_CLICK_LISTAR_KEY);
      } catch {
        /* ignore */
      }

      handleLoadClassesRef.current?.();
    };

    chromeApi.tabs.onUpdated.addListener(handleTabComplete);
    return () => {
      chromeApi.tabs.onUpdated.removeListener(handleTabComplete);
    };
  }, []);

  // Load state from chrome.storage.local on mount
  useEffect(() => {
    const chromeApi = (window as any).chrome;
    
    if (chromeApi?.storage?.local) {
      chromeApi.storage.local.get(["selectedDay", "siap_classes_data", "siap_time_saved_stats", "hasSeenOnboarding", "siap_active_tab"], (result: any) => {
        if (result.selectedDay) setSelectedDay(result.selectedDay);
        if (result.siap_classes_data) setClassesData(result.siap_classes_data);
        if (result.siap_time_saved_stats) setTimeSavedStats(result.siap_time_saved_stats);
        if (result.hasSeenOnboarding !== undefined) setHasSeenOnboarding(result.hasSeenOnboarding);
        if (result.siap_active_tab) setActiveTab(result.siap_active_tab);
      });
      chromeApi.storage.onChanged.addListener((changes: any) => {
        if (changes.siap_classes_data) {
          setClassesData(changes.siap_classes_data.newValue);
        }
        if (changes.siap_time_saved_stats) {
          setTimeSavedStats(changes.siap_time_saved_stats.newValue);
        }
        if (changes.siap_active_tab) {
          setActiveTab(changes.siap_active_tab.newValue);
        }
      });
    }

    if (chromeApi?.tabs?.sendMessage) {
      chromeApi.tabs.query({ active: true, currentWindow: true }, ([tab]: any) => {
        if (tab?.id) {
          safeTabsSendMessageCallback(chromeApi, tab.id, { action: "REQUEST_CURRENT_DATE" }, (response: any) => {
            if (response?.day) setSelectedDay(response.day);
          });
          safeTabsSendMessageCallback(chromeApi, tab.id, { action: "REQUEST_PAGE_STATS" }, (response: any) => {
            if (response?.stats) setPageStats(response.stats);
          });
        }
      });
    }

    const messageListener = (message: any) => {
      if (message.action === "UPDATE_PAGE_STATS") {
        setPageStats(message.stats);
        setIsSyncingMonth(false);
        setIsLoginRequired(false);
        tryFlushEsperandoDadosTurmaRef.current(message.stats);

        if (message.stats.pageType) {
          const newType = message.stats.pageType as SiapNavTab;
          const prev = prevSiapPageTypeRef.current;
          // Enquanto REQUEST_SYNC_TURMAS estiver pendente, não troca de aba para preservar o canal Supabase.
          let syncPending = false;
          try { syncPending = sessionStorage.getItem(SIAP_SYNC_TURMAS_KEY) === "true"; } catch { /* ignore */ }
          if (prev !== null && prev !== newType && !syncPending) {
            setActiveTab(newType);
          }
          prevSiapPageTypeRef.current = newType;
        }

        if (message.stats.selectedDay) {
          const dayStr = message.stats.selectedDay.toString();
          const dayInt = parseInt(dayStr, 10);
          const pendingDays = flattenPendingDayNumbers(message.stats);

          setIsSyncingDay(false);
          setSelectedDay(dayStr);
          setSelectedDayNumber(dayInt);

          const isPageDayPending = pendingDays.includes(dayInt);

          const currentReactDay = selectedDayRef.current;
          if (!isPageDayPending && currentReactDay === dayStr) {
            const nextDayArray = pendingDays.filter((d: number) => d > dayInt);
            const nextDay = nextDayArray.length > 0 ? nextDayArray[0] : pendingDays[0];

            if (nextDay) {
              setSelectedDay(nextDay.toString());
              toast.success(`Aula confirmada no SIAP! Avançando para o dia ${nextDay}...`);
            }
          }
        }
      } else if (message.action === "LOGIN_REQUIRED") {
        setIsLoginRequired(true);
      } else if (message.action === "LOGGED_IN") {
        setIsLoginRequired(false);
      } else if (message.action === "QUEUE_PROGRESS") {
        if (!planejamentoInjectionActiveRef.current) {
          setExecutionProgress(message.payload);
        }
      } else if (message.action === "QUEUE_UPDATE") {
        const total = planejamentoInjectionTotalRef.current;
        if (total <= 0) return;
        const remaining = typeof message.remaining === "number" ? message.remaining : 0;
        const processedCount = Math.max(0, total - remaining);
        setPlanejamentoInjectionRows((prev) =>
          prev.map((task, index) => {
            if (index < processedCount) return { ...task, status: "done" as const };
            if (index === processedCount) return { ...task, status: "processing" as const };
            return { ...task, status: "pending" as const };
          }),
        );
      } else if (message.action === "ITEM_PROCESSED") {
        if (!planejamentoInjectionActiveRef.current) {
          setExecutionProgress((prev) => ({
            ...prev,
            current: prev.total - message.remaining,
          }));
        }
      } else if (message.action === "QUEUE_FINISHED") {
        if (planejamentoInjectionActiveRef.current) {
          planejamentoInjectionActiveRef.current = false;
          setPlanejamentoInjectionRows((prev) => prev.map((r) => ({ ...r, status: "done" as const })));
          planejamentoInjectionTotalRef.current = 0;
          toast.success("Sincronização com o SIAP concluída.");
        }
      } else if (message.action === "SYNC_STATUS") {
        setSyncStatus(message);
      } else if (message.action === "INBOX_ZERO") {
        const ch = realtimeChannelRef.current as { send?: (args: Record<string, unknown>) => Promise<unknown> } | null;
        if (ch?.send) {
          void ch
            .send({ type: "broadcast", event: "TODAS_AULAS_CONCLUIDAS", payload: {} })
            .catch(() => {});
        }
      }
    };
    const chromeRuntime = (window as any).chrome?.runtime;
    if (chromeRuntime?.onMessage) {
      chromeRuntime.onMessage.addListener(messageListener);
    }
    return () => {
      if (chromeRuntime?.onMessage) chromeRuntime.onMessage.removeListener(messageListener);
    };
  }, []);

  /**
   * Monitor global: login.aspx na URL + heartbeat periódico da sessão SIAP.
   */
  useEffect(() => {
    const chromeApi = (window as any).chrome;
    if (!chromeApi?.tabs?.onUpdated) return;

    const handleTabUpdate = (_tabId: number, changeInfo: any, tab: any) => {
      const nextUrlRaw = changeInfo?.url ?? tab?.url;
      const nextUrl = String(nextUrlRaw || "").toLowerCase();
      if (!nextUrl || !nextUrl.includes("login.aspx")) return;

      console.warn("🚨 [Extensão] Queda de sessão detectada via URL (login.aspx).");
      handleSiapSessionLost("sessao_expirada");
    };

    chromeApi.tabs.onUpdated.addListener(handleTabUpdate);

    const HEARTBEAT_MS = 30_000;
    const siapSessionInterval = window.setInterval(() => {
      void (async () => {
        const open = await hasSiapTabOpen(chromeApi);
        if (!open) return;
        const ok = await isSiapSessionValid(chromeApi);
        if (!ok) {
          console.warn("🚨 [Extensão] Heartbeat: sessão SIAP inválida.");
          handleSiapSessionLost("sessao_expirada_heartbeat");
        }
      })();
    }, HEARTBEAT_MS);

    return () => {
      chromeApi.tabs.onUpdated.removeListener(handleTabUpdate);
      window.clearInterval(siapSessionInterval);
    };
  }, [handleSiapSessionLost]);

  const normalizeText = (text: string) => {
    if (!text) return "";
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove acentos
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") // Remove TUDO que não for letra ou número (espaços, traços, etc)
      .trim();
  };

  // Preset Memory for Materials
  useEffect(() => {
    const chromeApi = (window as any).chrome;
    if (activeTab === 'conteudo' && pageStats?.turma && pageStats?.materiaisList && chromeApi?.storage?.local) {
      const presetKey = `siap_materiais_padrao_${pageStats.turma}`;
      chromeApi.storage.local.get([presetKey], (result: any) => {
        const savedTexts = (result[presetKey] || []).map((t: string) => normalizeText(t));
        
        console.log(`SIAP [Debug]: Carregando presets para ${pageStats.turma}. Salvos:`, savedTexts);
        
        const toSelect = pageStats.materiaisList
          .filter((m: any) => savedTexts.includes(normalizeText(m.texto)))
          .map((m: any) => m.id); // Guardar o ID persistente (mat_0, etc)
          
        setSelectedMateriais(toSelect);
      });
    }
  }, [activeTab, pageStats?.turma, pageStats?.materiaisList, pageStats?.selectedDay]);

  /** Rótulos dos materiais marcados — exibidos no modal de confirmação em lote (Piloto Automático). */
  const materiaisRotulosLote = useMemo(() => {
    if (!pageStats?.materiaisList?.length) return [];
    return pageStats.materiaisList
      .filter((m: any) => selectedMateriais.includes(m.id))
      .map((m: any) => String(m.texto || "").trim())
      .filter(Boolean);
  }, [pageStats?.materiaisList, selectedMateriais]);

  const saveMaterialsPreset = (selectedItemIds: string[]) => {
    const chromeApi = (window as any).chrome;
    if (!pageStats?.turma || !pageStats?.materiaisList || !chromeApi?.storage?.local) return;
    const presetKey = `siap_materiais_padrao_${pageStats.turma}`;
    const selectedTexts = pageStats.materiaisList
      .filter((m: any) => selectedItemIds.includes(m.id))
      .map((m: any) => m.texto);
    chromeApi.storage.local.set({ [presetKey]: selectedTexts });
  };

  // Save basic state
  useEffect(() => {
    const chromeApi = (window as any).chrome;
    if (chromeApi?.storage?.local) {
      chromeApi.storage.local.set({ selectedDay, hasSeenOnboarding, siap_active_tab: activeTab });
    }
  }, [selectedDay, hasSeenOnboarding, activeTab]);

  const incrementStat = (type: 'extractionsCount' | 'voiceCount' | 'autoFillCount') => {
    const chromeApi = (window as any).chrome;
    const newStats = { ...timeSavedStats, [type]: timeSavedStats[type] + 1 };
    setTimeSavedStats(newStats);
    if (chromeApi?.storage?.local) {
      chromeApi.storage.local.set({ siap_time_saved_stats: newStats });
    }
  };

  const calculateTimeSaved = () => {
    const totalMinutes = (timeSavedStats.extractionsCount * 1) + (timeSavedStats.voiceCount * 0.25);
    if (totalMinutes === 0) return "";
    
    if (totalMinutes < 60) {
      return `${Math.round(totalMinutes)} minutos`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    return `${hours} ${hours === 1 ? 'hora' : 'horas'}${mins > 0 ? ` e ${mins} min` : ''}`;
  };

  const handleFilesSelected = useCallback(async (files: File[]) => {
    if (!selectedDay && !isGhostMode) {
      toast.error("Por favor, selecione um dia no SIAP primeiro.");
      return;
    }
    
    const newImages: string[] = [];
    for (const file of files) {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = (e) => resolve(e.target?.result as string);
      });
      reader.readAsDataURL(file);
      const base64 = await base64Promise;
      newImages.push(base64);
    }
    const updatedImages = [...uploadedImages, ...newImages].slice(-10);
    setUploadedImages(updatedImages);

    const chromeApi = (window as any).chrome;
    chromeApi?.tabs?.query({ active: true, currentWindow: true }, ([tab]: any) => {
      if (tab?.id) {
        safeTabsSendMessage(chromeApi.tabs, tab.id, {
          action: "TOGGLE_SIDE_VIEWER",
          images: updatedImages,
          forceOpen: true,
        });
        setIsViewerOpen(true);
        toast.success("Imagens carregadas no Visualizador! 📂");
      }
    });
  }, [selectedDay, uploadedImages, isGhostMode]);

  const handleRemoveImage = (index: number) => {
    setUploadedImages(prev => {
      const updated = prev.filter((_, i) => i !== index);
      if (updated.length === 0) setIsViewerOpen(false);
      return updated;
    });
  };

  const numberMap: Record<string, number> = {
    'um': 1, 'uma': 1, 'dois': 2, 'duas': 2, 'três': 3, 'tres': 3, 'quatro': 4, 'cinco': 5,
    'seis': 6, 'meia': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10,
    'onze': 11, 'doze': 12, 'treze': 13, 'quatorze': 14, 'catorze': 14,
    'quinze': 15, 'dezesseis': 16, 'dezessete': 17, 'dezoito': 18, 'dezenove': 19,
    'vinte': 20, 'trinta': 30, 'quarenta': 40, 'cinquenta': 50, 'sessenta': 60,
    'setenta': 70, 'oitenta': 80, 'noventa': 90, 'cem': 100, 'cento': 100,
    'zero': 0, 'meu': 0, 'o': 0 // Common misinterpretations
  };

  const isProcessingVoice = useRef(false);

  const processVoiceTranscript = useCallback(async (text: string) => {
    if (!pageStats?.students) return;

    try {
      let preparedText = text.toLowerCase()
        .replace(/[.,!?;:]/g, ' ')
        .replace(/número|numero|aluno|aluna|estudante|matrícula|matricula/g, ' ');
      
      // Convert words to numbers (including compound like "vinte e cinco")
      const words = preparedText.split(/\s+/).filter(w => w.length > 0);
      const stopWords = new Set(['falta', 'faltam', 'para', 'a', 'e', 'chamada', 'faltou', 'de', 'do', 'da', 'marcar']);
      
      const foundStudents: any[] = [];
      const identifiedMatriculas = new Set(markedStudents.map(s => s.matricula));

      // 1. Precise check for literal numbers (regex)
      const literalNumbers = preparedText.match(/\d+/g);
      if (literalNumbers) {
        literalNumbers.forEach(numStr => {
          const num = parseInt(numStr, 10);
          const student = pageStats.students.find((s: any) => s.number === num);
          if (student && !identifiedMatriculas.has(student.matricula)) {
            foundStudents.push({ ...student, confirmed: true });
            identifiedMatriculas.add(student.matricula);
          }
        });
      }

      // 2. Check for number words
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (numberMap[w] !== undefined) {
          let value = numberMap[w];
          // Look ahead for "e" + digit (e.g., "vinte e cinco")
          if (['vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'].includes(w) && words[i+1] === 'e' && numberMap[words[i+2]]) {
            value += numberMap[words[i+2]];
            i += 2;
          }
          
          const student = pageStats.students.find((s: any) => s.number === value);
          if (student && !identifiedMatriculas.has(student.matricula)) {
            foundStudents.push({ ...student, confirmed: true });
            identifiedMatriculas.add(student.matricula);
          }
        } else if (!stopWords.has(w) && w.length > 2) {
          // 3. Fallback: Search by name part
          const matches = pageStats.students.filter((s:any) => 
            normalizeName(s.name).includes(normalizeName(w)) && !identifiedMatriculas.has(s.matricula)
          );
          if (matches.length === 1) {
            foundStudents.push({ ...matches[0], confirmed: true });
            identifiedMatriculas.add(matches[0].matricula);
          }
        }
      }

      if (foundStudents.length > 0) {
        setStudentsDetectedByVoice(prev => {
          const newOnes = foundStudents.filter(fs => !prev.find(ps => ps.matricula === fs.matricula));
          return [...prev, ...newOnes];
        });
        voiceSessionCount.current += foundStudents.length;
      }
    } catch (err) {
      console.error("Voice processing error:", err);
    }
  }, [pageStats, markedStudents]);

  const toggleVoiceCommand = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

    if (isListening) {
      shouldBeListening.current = false;
      try {
        recognitionRef.current?.stop?.();
      } catch {
        try {
          recognitionRef.current?.abort?.();
        } catch {
          /* ignore */
        }
      }
      recognitionRef.current = null;
      setIsListening(false);
      setTranscriptData("");
      return;
    }

    voiceSessionCount.current = 0;
    shouldBeListening.current = true;
    startVoiceEngine();
  };

  const handleConfirmVoiceAbsences = async () => {
    if (studentsDetectedByVoice.length === 0) return;
    
    setIsReviewingVoiceResults(false);
    const studentsToMark = [...studentsDetectedByVoice];
    
    // Switch to Validation View if not already
    setMarkedStudents(prev => {
      const newOnes = studentsToMark.filter(s => !prev.find(p => p.matricula === s.matricula));
      return [...prev, ...newOnes];
    });

    toast.info(`Lançando ${studentsToMark.length} faltas no SIAP...`);

    const chromeApi = (window as any).chrome;
    if (chromeApi?.tabs?.query && chromeApi?.tabs?.sendMessage) {
      chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs: any) => {
        safeTabsSendMessage(chromeApi.tabs, tabs[0].id!, {
          action: "LANCAR_FALTAS",
          tasks: studentsToMark.map((s) => s.number),
        });
      });
    }
    
    setStudentsDetectedByVoice([]);
  };
  
  const handlePlanejamentoDayClick = (dataCanonica: string, displayDay: number) => {
    const chromeApi = (window as any).chrome;
    if (chromeApi?.tabs?.query && chromeApi?.tabs?.sendMessage) {
      setSelectedPlanningCanon(dataCanonica);
      chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs: any) => {
        if (tabs[0]?.id) {
          safeTabsSendMessage(chromeApi.tabs, tabs[0].id, {
            action: "ENTER_PLANEJAMENTO_DAY",
            dataCanonica,
          });
          toast.info(`Abrindo planejamento: ${dataCanonica} (dia ${displayDay})`);
        }
      });
    }
  };

  const handleTurboWizardInject = useCallback(
    ({ payloads, tasks }: { payloads: string[]; tasks: TurboInjectionTask[] }) => {
      if (payloads.length === 0) {
        toast.error("Nada para enviar na fila.");
        return;
      }
      const postBackOnlyCount = payloads.filter(
        (p) => typeof p === "string" && !p.startsWith("INJECT_TEXT_"),
      ).length;
      const target = pageStats?.planejamentoTreeEventTarget;
      if (postBackOnlyCount > 0 && !target) {
        toast.error("TreeView não detectado. Abra a edição no SIAP com a árvore visível.");
        return;
      }

      const rows: PlanejamentoInjectionRow[] = tasks.map((t, i) => ({
        ...t,
        status: (i === 0 ? "processing" : "pending") as PlanejamentoInjectionRow["status"],
      }));
      planejamentoInjectionTotalRef.current = payloads.length;
      setPlanejamentoInjectionRows(rows);
      setIsPlanejamentoInjectionOpen(true);
      planejamentoInjectionActiveRef.current = true;

      const chromeApi = (window as any).chrome;
      if (!chromeApi?.tabs?.query || !chromeApi?.tabs?.sendMessage) return;
      chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs: any) => {
        if (!tabs[0]?.id) return;
        safeTabsSendMessage(chromeApi.tabs, tabs[0].id, {
          action: "ADD_TO_QUEUE",
          payload: payloads,
          ...(target ? { treePostBackTarget: target } : {}),
        });
        toast.success(`Sincronização: ${payloads.length} etapa(s) na fila.`);
      });
    },
    [pageStats?.planejamentoTreeEventTarget],
  );

  const handleUnidadeTematicaChange = useCallback((value: string) => {
    const chromeApi = (window as any).chrome;
    if (!chromeApi?.tabs?.query || !chromeApi?.tabs?.sendMessage) return;
    chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs: any) => {
      if (!tabs[0]?.id) return;
      safeTabsSendMessage(chromeApi.tabs, tabs[0].id, {
        action: "CHANGE_UNIDADE_TEMATICA",
        payload: value,
      });
    });
  }, []);

  const handleLaunchContent = () => {
    const chromeApi = (window as any).chrome;

    // 1. Pegar IDs dos conteúdos selecionados (usando o campo .id que agora vem do content.js)
    const contentBtnIds = selectedConteudos
      .map((id) => {
        const content = pageStats?.conteudosList?.find((c: any) => c.id === id);
        return content ? content.btnId : null;
      })
      .filter(Boolean) as string[];

    // 2. Pegar IDs dos materiais selecionados (cruzando os nomes/id com a lista do SIAP)
    const materialBtnIds: string[] = [];
    if (pageStats?.materiaisList && selectedMateriais) {
      pageStats.materiaisList.forEach((mat: any) => {
        const textoLimpo = mat.texto.trim();
        if (
          selectedMateriais.includes(mat.id) ||
          selectedMateriais.includes(textoLimpo) ||
          selectedMateriais.includes(mat.texto)
        ) {
          if (mat.btnId) materialBtnIds.push(mat.btnId);
        }
      });
    }

    const allBtnIdsToClick = [...contentBtnIds, ...materialBtnIds];

    console.log("--- DEBUG DE DISPARO (ETAPA 1: CONTEÚDO) ---");
    console.log("1. IDs Mapeados:", allBtnIdsToClick);
    console.log("------------------------");

    if (allBtnIdsToClick.length === 0) {
      toast.error("Selecione ao menos um conteúdo ou material.");
      return;
    }

    if (chromeApi?.tabs?.query && chromeApi?.tabs?.sendMessage) {
      chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs: any) => {
        if (tabs[0]?.id) {
          safeTabsSendMessage(chromeApi.tabs, tabs[0].id, {
            action: "ADD_TO_QUEUE",
            payload: allBtnIdsToClick,
          });
        }
      });
    }

    setExecutionProgress({ current: 0, total: allBtnIdsToClick.length });
    setIsContentReviewModalOpen(true);
    toast.success(`Iniciada injeção de ${allBtnIdsToClick.length} itens! Acompanhe no modal.`);
  };

  const handleFinalSave = () => {
    const chromeApi = (window as any).chrome;
    const finalQueue = ['cphFuncionalidade_btnAlterar'];

    console.log("--- DEBUG DE DISPARO (ETAPA 2: SALVAR) ---");
    console.log("Acionando botão Salvar do SIAP...");

    if (chromeApi?.tabs?.query && chromeApi?.tabs?.sendMessage) {
      chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs: any) => {
        if (tabs[0]?.id) {
          safeTabsSendMessage(chromeApi.tabs, tabs[0].id, {
            action: "ADD_TO_QUEUE",
            payload: finalQueue,
          });
        }
      });
    }
    
    setExecutionProgress({ current: 0, total: finalQueue.length });
    toast.success("Comando de salvamento enviado ao SIAP!");
    setIsContentReviewModalOpen(false);
    setSelectedConteudos([]);
    setSelectedMateriais([]);
  };

  handleFinalSaveRef.current = handleFinalSave;

  const startVoiceEngine = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Voz não suportada neste Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const resetSilenceTimer = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        if (shouldBeListening.current) {
          shouldBeListening.current = false;
          recognition.stop();
        }
      }, 3500);
    };

    recognition.onstart = () => {
      setIsListening(true);
      setTranscriptData("Ouvindo...");
      resetSilenceTimer();
    };

    recognition.onresult = (event: any) => {
      resetSilenceTimer();
      let finalTranscript = '';
      let interimTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      
      if (finalTranscript) {
          processVoiceTranscript(finalTranscript);
      }
      if (interimTranscript || finalTranscript) {
          setTranscriptData(interimTranscript || finalTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        shouldBeListening.current = false;
        recognitionRef.current = null;
        setIsListening(false);
        toast.error("Permissão de microfone negada.");
      }
    };

    recognition.onend = () => {
      if (shouldBeListening.current) {
        try {
          recognition.start();
        } catch (e) {
          console.log("Mic restart ignored - already active");
        }
      } else {
        recognitionRef.current = null;
        setIsListening(false);
        if (voiceSessionCount.current > 0) {
          setIsReviewingVoiceResults(true);
          setTranscriptData("");
        }
      }
    };

    recognition.start();
  };

  const handleResolveAmbiguity = (student: any, groupIndex: number) => {
      const chromeApi = (window as any).chrome;
      chromeApi?.tabs?.query({ active: true, currentWindow: true }, ([tab]: any) => {
          if (tab?.id) {
              safeTabsSendMessage(chromeApi.tabs, tab.id, {
                action: "MARK_STUDENT_ABSENT",
                name: student.name,
                number: student.number,
                matricula: student.matricula,
              });
          }
      });
      setMarkedStudents(prev => {
          if (!prev.find(s => s.matricula === student.matricula)) return [...prev, student];
          return prev;
      });
      setVoiceSuggestions(prev => prev.filter((_, i) => i !== groupIndex));
      setVoiceFailCount(0);
      incrementStat('voiceCount');
      toast.success(`${student.name} marcado.`);
  };

  const handleToggleViewer = () => {
    const chromeApi = (window as any).chrome;
    chromeApi?.tabs?.query({ active: true, currentWindow: true }, ([tab]: any) => {
      if (tab?.id) {
        safeTabsSendMessage(chromeApi.tabs, tab.id, {
          action: "TOGGLE_SIDE_VIEWER",
          images: uploadedImages,
        });
        setIsViewerOpen(!isViewerOpen);
      }
    });
  };

  const handleReset = useCallback(() => {
    setUploadedImages([]);
    setMarkedStudents([]);
    setIsViewerOpen(false);
    setClassesData({});
    setPageStats(null);
    setSelectedDay("");
    setSelectedDayNumber(null);
    setSelectedPlanningCanon(null);
    setIsGhostMode(false);
    setHasSeenOnboarding(false);
    
    const chromeApi = (window as any).chrome;
    if (chromeApi?.storage?.local) {
      chromeApi.storage.local.remove(
        [
          "selectedDay",
          "siap_classes_data",
          "siap_user_name",
          "siap_user_email",
          "siap_user_escola_vinculada",
          "siap_user_cpf_vinculado",
          "siap_time_saved_stats",
          "hasSeenOnboarding",
          "siap_active_tab",
        ],
        () => {
        toast.success("Tudo resetado!");
      });
    } else {
      toast.info("Estado local resetado.");
    }
  }, []);

  const navigateSiapForTab = useCallback((tab: SiapNavTab, rowIndex: number | null) => {
    const chromeApi = (window as any).chrome;
    if (!chromeApi?.tabs?.query) return;
    chromeApi.tabs.query({ active: true, currentWindow: true }, ([tabInfo]: any) => {
      if (!tabInfo?.id) return;
      const isListagem =
        tabInfo.url?.includes("DiarioEscolarListagem.aspx") ||
        tabInfo.url?.includes("PlanejamentoProfessorTurmaListagem.aspx");

      if (rowIndex != null) {
        const actionIntent = tab === "conteudo" ? "Conteúdos" : tab === "planejamento" ? "Planejamento" : "Frequência";
        const intent = { action: actionIntent, rowIndex };
        chromeApi.scripting.executeScript({
          target: { tabId: tabInfo.id },
          func: (intData: string, isList: boolean, activeTabName: string) => {
            sessionStorage.setItem("siap_intent", intData);
            if (isList) window.location.reload();
            else {
              const url =
                activeTabName === "planejamento"
                  ? "PlanejamentoProfessorTurmaListagem.aspx"
                  : "DiarioEscolarListagem.aspx";
              window.location.href = url;
            }
          },
          args: [JSON.stringify(intent), isListagem, tab],
        });
      } else {
        chromeApi.scripting.executeScript({
          target: { tabId: tabInfo.id },
          func: (activeTabName: string) => {
            const url =
              activeTabName === "planejamento"
                ? "PlanejamentoProfessorTurmaListagem.aspx"
                : "DiarioEscolarListagem.aspx";
            window.location.href = url;
          },
          args: [tab],
        });
      }
    });
  }, []);

  const handleNavigationTabClick = useCallback(
    (tab: SiapNavTab) => {
      setActiveTab(tab);
      setSelectedDay("");
      setSelectedDayNumber(null);
      setSelectedPlanningCanon(null);
      setIsSyncingDay(false);
      setMarkedStudents([]);
      setSearchStudent("");

      const rowIdx = findRowIndexForCurrentClass(classesData, pageStats);
      navigateSiapForTab(tab, rowIdx);

      if (rowIdx != null) {
        toast.info(
          tab === "planejamento"
            ? "Abrindo planejamento desta turma no SIAP…"
            : tab === "conteudo"
              ? "Abrindo conteúdo programático desta turma…"
              : "Abrindo frequência desta turma…",
        );
      } else {
        toast.info(
          tab === "planejamento"
            ? "Indo para a listagem de planejamento. Depois clique na turma."
            : "Indo para o diário. Use Listar e clique na turma.",
        );
      }
    },
    [classesData, pageStats, navigateSiapForTab],
  );

  const handleClassClick = (rowIndex: number) => {
    navigateSiapForTab(activeTab, rowIndex);
  };

  /** Mesma mensagem `SELECT_CALENDAR_DAY` usada pelos botões do calendário e pelo app mobile (`TROCAR_DIA`). */
  const performSelectCalendarDay = useCallback(
    (day: number, month?: number, year?: number, dataCanonica?: string | null) => {
      const chromeApi = (window as any).chrome;
      chromeApi?.tabs?.query({ active: true, currentWindow: true }, ([tab]: any) => {
        if (tab?.id) {
          const payload: Record<string, unknown> = {
            action: "SELECT_CALENDAR_DAY",
            day,
            month,
            year,
            payload: dataCanonica || String(day),
          };
          if (dataCanonica) payload.dataCanonica = dataCanonica;
          safeTabsSendMessage(chromeApi.tabs, tab.id, payload);
          setSelectedDay(day.toString());
          setSelectedDayNumber(day);
          toast.info(dataCanonica ? `Selecionando ${dataCanonica}…` : `Selecionando dia ${day}...`);
        }
      });
    },
    [],
  );

  const handleMudarMesLocal = useCallback(
    (direcao: "anterior" | "proximo") => {
      if (isSyncingMonth) return;
      const chromeApi = (window as any).chrome;
      if (!chromeApi?.tabs?.query || !chromeApi?.tabs?.sendMessage) return;
      setIsSyncingMonth(true);
      conteudoCalNavGenerationRef.current += 1;
      chromeApi.tabs.query({ active: true, currentWindow: true }, ([tab]: any) => {
        if (tab?.id) {
          safeTabsSendMessage(chromeApi.tabs, tab.id, {
            action: "MUDAR_MES",
            direcao,
          });
          toast.info(
            direcao === "anterior"
              ? "Calendário: mês anterior no SIAP…"
              : "Calendário: próximo mês no SIAP…",
          );
        } else {
          toast.error("Aba do SIAP não encontrada.");
          setIsSyncingMonth(false);
        }
      });
      const rescue = window.setTimeout(() => {
        setIsSyncingMonth(false);
      }, 10_000);
      return () => window.clearTimeout(rescue);
    },
    [isSyncingMonth],
  );

  /**
   * Gerente de broadcast (conteúdo programático): CONTEUDO_CARREGADO + DADOS_CONTEUDO_PAGINA.
   * Não dispara SELECT_CALENDAR_DAY automaticamente — o mês/dia visíveis vêm do SIAP (calendarMonthLabel / stats).
   */
  useEffect(() => {
    if (activeTab !== "conteudo") {
      conteudoAutoDayLockRef.current = null;
      conteudoMobileBroadcastSigRef.current = null;
      return;
    }
    if (pageStats?.pageType !== "conteudo") {
      console.log(
        "[CONTEUDO→MOBILE] Efeito ignorado: ainda não é página de conteúdo no SIAP (pageType=",
        pageStats?.pageType,
        "). activeTab continua 'conteudo' — reload da aba SIAP não mata o painel nem o activeTab.",
        { pageStats, realtimeChannelPresent: Boolean(realtimeChannelRef.current) },
      );
      return;
    }

    const timer = window.setTimeout(() => {
      const ch = realtimeChannelRef.current;

      const broadcastConteudoPayload = (
        conteudos: unknown[],
        materiais: unknown[],
        dedupeKey: string,
        selecionadosOverride?: { conteudos: string[]; materiais: string[] },
      ) => {
        if (!ch) {
          console.warn(
            "🚀 [CONTEUDO→MOBILE] ABORTADO: realtimeChannelRef.current é null (canal não inscrito?). activeTab=",
            activeTab,
            pageStats,
          );
          return;
        }
        if (conteudoMobileBroadcastSigRef.current === dedupeKey) {
          return;
        }
        conteudoMobileBroadcastSigRef.current = dedupeKey;
        const selecionados =
          selecionadosOverride ?? { conteudos: selectedConteudos, materiais: selectedMateriais };
        console.log("🚀 TENTANDO ENVIAR DADOS PARA O MOBILE...", pageStats);
        void ch
          .send({
            type: "broadcast",
            event: "CONTEUDO_CARREGADO",
          })
          .catch((e) => console.warn("[CONTEUDO→MOBILE] CONTEUDO_CARREGADO falhou:", e))
          .then(() => {
            console.log("🚀 TENTANDO ENVIAR DADOS PARA O MOBILE...", pageStats);
            return ch.send({
              type: "broadcast",
              event: "DADOS_CONTEUDO_PAGINA",
              payload: {
                conteudos,
                materiais,
                selecionados: {
                  conteudos: selecionados.conteudos,
                  materiais: selecionados.materiais,
                },
                aulasDisponiveis: Array.isArray(pageStats?.aulasDisponiveis)
                  ? pageStats.aulasDisponiveis
                  : [],
                aulaAtual:
                  pageStats?.aulaAtual != null && String(pageStats.aulaAtual).trim() !== ""
                    ? String(pageStats.aulaAtual)
                    : "",
                /** Contrato único de data — mobile lê exclusivamente este campo. */
                diaOficialSiap: getDiaOficialSiapFromStats(pageStats),
                diasPendentes: flattenPendingDayDateStrings(pageStats),
                pendentes: Array.isArray(pageStats?.pendingMonths)
                  ? (pageStats.pendingMonths as { days?: unknown[] }[]).reduce(
                      (acc, m) => acc + (Array.isArray(m.days) ? m.days.length : 0),
                      0,
                    )
                  : 0,
              },
            });
          })
          .catch((e) => console.warn("[CONTEUDO→MOBILE] DADOS_CONTEUDO_PAGINA falhou:", e));
      };

      const hasDay = pageStatsHasSelectedDay(pageStats);

      // CENÁRIO 1: dia já selecionado no SIAP (campo / calendário)
      if (hasDay) {
        conteudoAutoDayLockRef.current = null;
        console.log("✅ Dia selecionado detectado (conteúdo). Destravando o mobile…", {
          calNavGen: conteudoCalNavGenerationRef.current,
        });
        const list = Array.isArray(pageStats.conteudosList) ? pageStats.conteudosList : [];
        const mats = Array.isArray(pageStats.materiaisList) ? pageStats.materiaisList : [];
        const conteudoIdsPreset = list.length > 0 ? list.map((c: any) => String(c.id)) : [];
        if (list.length > 0) {
          setSelectedConteudos(conteudoIdsPreset);
        }
        const selConteudosKey = (conteudoIdsPreset.length > 0 ? conteudoIdsPreset : selectedConteudos).join(",");
        const selMateriaisKey = [...selectedMateriais].sort().join(",");
        const dedupe = `day|${String(pageStats.selectedDay)}|${list.map((c: any) => c.id).join(",")}|m:${mats.length}|calNav:${conteudoCalNavGenerationRef.current}|selC:${selConteudosKey}|selM:${selMateriaisKey}|aula:${String(pageStats?.aulaAtual ?? "")}|pm:${pendingMonthsDedupeSegment(pageStats)}`;
        broadcastConteudoPayload(list, mats, dedupe, {
          conteudos: conteudoIdsPreset.length > 0 ? conteudoIdsPreset : selectedConteudos,
          materiais: selectedMateriais,
        });
        return;
      }

      // Sem dia selecionado no SIAP: não forçar clique em pendente — empty state (mobile não trava; label = calendarMonthLabel).
      conteudoAutoDayLockRef.current = null;
      console.log("🎉 Sem dia selecionado no SIAP (conteúdo). Empty state no mobile — sem auto-navegação.");
      broadcastConteudoPayload(
        [],
        [],
        `empty|${String(pageStats.turma ?? "")}|${String(pageStats.disciplina ?? "")}|calNav:${conteudoCalNavGenerationRef.current}|selC:${selectedConteudos.join(",")}|selM:${[...selectedMateriais].sort().join(",")}|aula:${String(pageStats?.aulaAtual ?? "")}|pm:${pendingMonthsDedupeSegment(pageStats)}`,
      );
    }, 500);

    return () => window.clearTimeout(timer);
  }, [activeTab, pageStats, selectedConteudos, selectedMateriais]);

  /**
   * Gerente de auto-sync de data para FREQUÊNCIA — espelho do equivalente de Conteúdo.
   * Toda vez que pageStats detectar um dia selecionado na aba frequência, reenvia DADOS_TURMA
   * com diaOficialSiap para o mobile destacar o pill correto automaticamente.
   */
  useEffect(() => {
    if (activeTab !== "frequencia") {
      frequenciaMobileBroadcastSigRef.current = null;
      return;
    }
    if (pageStats?.pageType !== "frequencia") return;

    const ch = realtimeChannelRef.current;
    if (!ch) return;

    const hasDay = pageStatsHasSelectedDay(pageStats);
    if (!hasDay) return;

    const diaOficialSiap = getDiaOficialSiapFromStats(pageStats);
    if (!diaOficialSiap) return;

    const dedupe = `freq|${diaOficialSiap}|${String(pageStats.turma ?? "")}|${String(pageStats.disciplina ?? "")}|aula:${getAulaAtualFromStats(pageStats)}`;
    if (frequenciaMobileBroadcastSigRef.current === dedupe) return;
    frequenciaMobileBroadcastSigRef.current = dedupe;

    console.log("📅 [FREQ→MOBILE] Dia detectado na frequência, enviando DADOS_TURMA com diaOficialSiap:", diaOficialSiap);

    const stats = pageStats;
    const classesSnap = classesDataRef.current;
    const diasPendentes = flattenPendingDayNumbers(stats);
    const diasPendentesDatas = flattenPendingDayDateStrings(stats);
    const turmasDisponiveis = buildTurmasDisponiveis(classesSnap);
    const alunos = Array.isArray(stats?.students)
      ? stats.students.map((aluno: any) => ({
          id: aluno.matricula || aluno.id || `n-${aluno.number}`,
          numero: aluno.number,
          nome: aluno.name,
        }))
      : [];

    void sendBroadcastDadosTurmaAndProfessor(ch, {
      turma: String(stats?.turma || ""),
      disciplina: String(stats?.disciplina || ""),
      alunos,
      diasPendentes,
      diasPendentesDatas,
      turmasDisponiveis,
      diaOficialSiap,
      aulaAtual: getAulaAtualFromStats(stats),
    }).catch(() => {});
  }, [activeTab, pageStats]);

  const handleDayClick = (day: number, month?: number, year?: number, dataCanonica?: string | null) => {
    performSelectCalendarDay(day, month, year, dataCanonica);
  };

  /** `turmaId` = mesmo `id` / rowIndex enviado em `turmasDisponiveis` (clique na listagem SIAP). */
  const trocarTurmaControleRemoto = useCallback(
    (turmaIdRaw: string) => {
      const id = String(turmaIdRaw ?? "").trim();
      const rowIndex = parseInt(id, 10);
      if (!Number.isFinite(rowIndex) || rowIndex < 0) {
        toast.error("Comando remoto: turmaId inválido.");
        return;
      }
      const classes = classesDataRef.current;
      let known = false;
      if (classes && typeof classes === "object") {
        for (const turmas of Object.values(classes)) {
          if (!Array.isArray(turmas)) continue;
          if (turmas.some((t: { rowIndex?: number }) => Number(t?.rowIndex) === rowIndex)) {
            known = true;
            break;
          }
        }
      }
      if (!known && classes && typeof classes === "object" && Object.keys(classes).length > 0) {
        toast.warning("Turma não encontrada na lista carregada; tentando abrir pela linha informada.");
      }
      try {
        sessionStorage.setItem(SIAP_ESPERANDO_DADOS_KEY, "true");
      } catch {
        /* ignore */
      }
      setActiveTab("frequencia");
      navigateSiapForTab("frequencia", rowIndex);
      toast.success(`Comando remoto: abrindo turma (${id})…`);
    },
    [navigateSiapForTab],
  );

  abrirConteudoMobileRef.current = (turmaIdRaw: string) => {
    const id = String(turmaIdRaw ?? "").trim();
    const rowIndex = parseInt(id, 10);
    if (!Number.isFinite(rowIndex) || rowIndex < 0) {
      toast.error("ABRIR_CONTEUDO: turmaId inválido.");
      return;
    }
    setActiveTab("conteudo");
    setSelectedDay("");
    setSelectedDayNumber(null);
    setSelectedPlanningCanon(null);
    setIsSyncingDay(false);
    setMarkedStudents([]);
    setSearchStudent("");
    navigateSiapForTab("conteudo", rowIndex);
    toast.info(`📱 Abrindo conteúdo programático da turma (${id})…`);
  };

  handleUnidadeTematicaChangeMobileRef.current = (value: string) => {
    handleUnidadeTematicaChange(value);
    console.log("📱 [Mobile] Trocou unidade temática:", value);
  };

  abrirPlanejamentoMobileRef.current = (turmaIdRaw: string) => {
    const id = String(turmaIdRaw ?? "").trim();
    const rowIndex = parseInt(id, 10);
    if (!Number.isFinite(rowIndex) || rowIndex < 0) {
      toast.error("ABRIR_PLANEJAMENTO: turmaId inválido.");
      return;
    }
    setActiveTab("planejamento");
    setSelectedDay("");
    setSelectedDayNumber(null);
    setSelectedPlanningCanon(null);
    setIsSyncingDay(false);
    navigateSiapForTab("planejamento", rowIndex);
    toast.info(`📱 Abrindo planejamento da turma (${id})…`);
  };

  const handleStudentClick = (student: any) => {
    const chromeApi = (window as any).chrome;
    chromeApi?.tabs?.query({ active: true, currentWindow: true }, ([tab]: any) => {
      if (tab?.id) {
        safeTabsSendMessage(chromeApi.tabs, tab.id, {
          action: "MARK_STUDENT_ABSENT",
          name: student.name,
          number: student.number,
          matricula: student.matricula,
        });
        
        setMarkedStudents(prev => {
          if (prev.find(s => s.matricula === student.matricula)) return prev;
          return [...prev, student];
        });
        
        setVoiceFailCount(0);
        toast.success(`Falta marcada: ${student.name}`);
        setSearchStudent("");
      }
    });
  };

  /**
   * Mesma lógica do Input Ninja (Enter com números): MARK_STUDENT_ABSENT + estado local.
   * Usada também pelo Supabase Broadcast (controle remoto).
   */
  const marcarFaltasPorNumerosChamada = useCallback(
    (numerosBrutos: number[], fonte: "input-ninja" | "controle-remoto") => {
      const numerosInt = [...new Set(numerosBrutos.map((n) => parseInt(String(n), 10)))].filter(
        (n) => Number.isFinite(n) && n > 0,
      );
      if (numerosInt.length === 0) {
        if (fonte === "input-ninja") toast.error("Nenhum aluno encontrado com esses números.");
        return;
      }

      const students = pageStats?.students;
      if (!students?.length) {
        toast.error("Lista de alunos indisponível.");
        if (fonte === "input-ninja") setSearchStudent("");
        return;
      }

      const chromeApi = (window as any).chrome;
      chromeApi?.tabs?.query({ active: true, currentWindow: true }, ([tab]: any) => {
        if (!tab?.id) {
          toast.error("Aba do SIAP não encontrada.");
          if (fonte === "input-ninja") setSearchStudent("");
          return;
        }

        const mats = new Set(markedStudentsRef.current.map((s) => s.matricula));
        const toAdd: any[] = [];
        for (const num of numerosInt) {
          const student = students.find((s: any) => Number(s.number) === num);
          if (!student || mats.has(student.matricula)) continue;
          mats.add(student.matricula);
          toAdd.push({ ...student, confirmed: true });
        }

        for (const s of toAdd) {
          safeTabsSendMessage(chromeApi.tabs, tab.id, {
            action: "MARK_STUDENT_ABSENT",
            name: s.name,
            number: s.number,
            matricula: s.matricula,
          });
        }

        if (toAdd.length > 0) {
          setMarkedStudents((prev) => [...prev, ...toAdd]);
          setVoiceFailCount(0);
        }

        if (fonte === "input-ninja") {
          setSearchStudent("");
          if (toAdd.length > 0) {
            toast.success(`${toAdd.length} falta(s) marcada(s) com sucesso!`);
          } else {
            toast.error("Nenhum aluno encontrado com esses números.");
          }
        } else {
          if (toAdd.length > 0) {
            toast.success(`Falta marcada remotamente para: ${toAdd.map((s) => s.number).join(", ")}`);
          } else {
            toast.info("Controle remoto: nenhuma falta nova (já marcados ou números inexistentes).");
          }
        }
      });
    },
    [pageStats?.students],
  );

  /** Controle remoto / espelho do fluxo de remoção no painel: UNMARK_STUDENT_ABSENT no SIAP + estado local. */
  const desmarcarFaltasPorNumerosChamada = useCallback(
    (numerosBrutos: number[]) => {
      const numerosInt = [...new Set(numerosBrutos.map((n) => parseInt(String(n), 10)))].filter(
        (n) => Number.isFinite(n) && n > 0,
      );
      if (numerosInt.length === 0) return;

      const students = pageStats?.students;
      if (!students?.length) {
        toast.error("Lista de alunos indisponível.");
        return;
      }

      const chromeApi = (window as any).chrome;
      chromeApi?.tabs?.query({ active: true, currentWindow: true }, ([tab]: any) => {
        if (!tab?.id) {
          toast.error("Aba do SIAP não encontrada.");
          return;
        }

        const toUnmark: any[] = [];
        for (const num of numerosInt) {
          const student = students.find((s: any) => Number(s.number) === num);
          if (student) toUnmark.push(student);
        }

        for (const s of toUnmark) {
          safeTabsSendMessage(chromeApi.tabs, tab.id, {
            action: "UNMARK_STUDENT_ABSENT",
            name: s.name,
            number: s.number,
            matricula: s.matricula,
          });
        }

        const mats = new Set(toUnmark.map((s) => s.matricula).filter(Boolean));
        setMarkedStudents((prev) => prev.filter((st) => !mats.has(st.matricula)));

        if (toUnmark.length > 0) {
          toast.success(
            `Remoto: ${toUnmark.length} falta(s) desmarcada(s) (${toUnmark.map((s) => s.number).join(", ")}).`,
          );
        } else {
          toast.info("Controle remoto: nenhum aluno encontrado com esses números.");
        }
      });
    },
    [pageStats?.students],
  );

  /** Envia SAVE_AND_NEXT_DAY ao content script (mesmo fluxo do botão de finalizar). */
  const performSaveAndNextDay = useCallback((opts?: { fromRemote?: boolean }) => {
    const chromeApi = (window as any).chrome;
    chromeApi?.tabs?.query({ active: true, currentWindow: true }, ([tab]: any) => {
      if (!tab?.id) {
        toast.error("Aba do SIAP não encontrada.");
        return;
      }
      safeTabsSendMessage(chromeApi.tabs, tab.id, { action: "SAVE_AND_NEXT_DAY" });
      setMarkedStudents([]);
      setShowSaveConfirm(false);
      if (opts?.fromRemote) {
        toast.success("Comando de salvamento remoto recebido!");
      } else {
        toast.info("Salvando e avançando para o próximo dia pendente...");
      }
    });
  }, []);

  marcarFaltasPorNumerosChamadaRef.current = marcarFaltasPorNumerosChamada;
  desmarcarFaltasPorNumerosChamadaRef.current = desmarcarFaltasPorNumerosChamada;
  performSaveAndNextDayRef.current = performSaveAndNextDay;
  performSelectCalendarDayRef.current = performSelectCalendarDay;
  trocarTurmaControleRemotoRef.current = trocarTurmaControleRemoto;
  handleMudarMesLocalRef.current = handleMudarMesLocal;
  handleSiapSessionLostRef.current = handleSiapSessionLost;

  // Aviso de carregamento para o mobile: quando o planejamento estiver pronto no SIAP,
  // envia DADOS_PLANEJAMENTO_PAGINA para destravar a tela de loading do app.
  useEffect(() => {
    if (!pageStats || activeTab !== "planejamento") return;
    if (pageStats.pageType !== "planejamento") return;
    const hasPendingDays =
      (Array.isArray(pageStats.pendingDaysList) && pageStats.pendingDaysList.length > 0) ||
      (Array.isArray(pageStats.pendingMonths) &&
        (pageStats.pendingMonths as { days?: unknown[] }[]).some(
          (m) => Array.isArray(m?.days) && m.days.length > 0,
        ));
    const hasData =
      (Array.isArray(pageStats.unidadesTematicas) && pageStats.unidadesTematicas.length > 0) ||
      (pageStats.planejamentoOptions &&
        typeof pageStats.planejamentoOptions === "object" &&
        Object.keys(pageStats.planejamentoOptions as Record<string, unknown>).length > 0) ||
      hasPendingDays;
    if (!hasData) return;

    const ch = realtimeChannelRef.current;
    if (!ch) return;

    console.log("✅ Dados de planejamento detectados. Destravando o mobile…", pageStats);

    void ch
      .send({
        type: "broadcast",
        event: "DADOS_PLANEJAMENTO_PAGINA",
        payload: {
          unidadesTematicas: Array.isArray(pageStats.unidadesTematicas)
            ? pageStats.unidadesTematicas
            : [],
          opcoes: pageStats.planejamentoOptions ?? {},
          unidadeAtiva: pageStats.unidadeAtiva ?? "",
          diaOficialSiap: getDiaOficialSiapFromStats(pageStats),
          turma: pageStats.turma ?? "",
          disciplina: pageStats.disciplina ?? "",
          pendingMonths: Array.isArray(pageStats.pendingMonths) ? pageStats.pendingMonths : [],
        },
      })
      .catch(() => {});
  }, [pageStats, activeTab]);

  /** Enter com apenas números/vírgulas/espaços: marca várias faltas de uma vez (sem alterar o filtro onChange). */
  const handleSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const val = e.currentTarget.value.trim();
      const isCommand = /^[\d,\s]+$/.test(val);
      if (!isCommand) return;

      const numerosDigitados = val.match(/\d+/g);
      if (!numerosDigitados || numerosDigitados.length === 0) return;

      const numerosInt = [...new Set(numerosDigitados.map((n) => parseInt(n, 10)))].filter((n) =>
        Number.isFinite(n),
      );
      marcarFaltasPorNumerosChamada(numerosInt, "input-ninja");
    },
    [marcarFaltasPorNumerosChamada],
  );

  /**
   * Controle remoto: Supabase Realtime Broadcast na sala `roomId`.
   * App mobile: COMANDO_REMOTO — faltas, finalizar, TROCAR_DIA, TROCAR_TURMA (+ payloads por ação).
   */
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setRemoteBroadcastStatus("disabled");
      return;
    }
    if (!session?.user || licencaStatus !== "ativa") {
      setRemoteBroadcastStatus("idle");
      return;
    }

    const room =
      typeof roomId === "string" ? roomId.trim() : String(roomId ?? "").trim();
    if (!room || room === "undefined" || room === "null" || room === "") {
      console.error("🚨 Supabase Abortado: Room ID inválido ou vazio.", roomId);
      setRemoteBroadcastStatus("room_error");
      return;
    }

    setRemoteBroadcastStatus("connecting");

    const channel = supabase.channel(room);
    realtimeChannelRef.current = channel;
    let siapAuthHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
    /** Timer do boot-check pós-reload de REQUEST_SYNC_TURMAS — cancelado no cleanup. */
    let syncBootTimer: ReturnType<typeof setTimeout> | null = null;

    const runSiapAuthHeartbeat = () => {
      const at = activeTabRef.current;
      if (at !== "frequencia" && at !== "conteudo") return;
      const chromeApi = (window as any).chrome;
      if (!chromeApi?.tabs?.query) return;
      void (async () => {
        const resolved = await resolveSiapSessionFromDom(chromeApi);
        const next: SiapAuthHeartbeatStatus = resolved ? "logado" : "deslogado";
        if (lastSiapAuthBroadcastRef.current === next) return;
        lastSiapAuthBroadcastRef.current = next;
        void channel
          .send({
            type: "broadcast",
            event: "STATUS_SIAP",
            payload: { status: next },
          })
          .catch(() => {});
      })();
    };

    const chromeApiRemote = (window as any).chrome;

    const checkAndExecuteRemoteCommand = async (callback: () => void) => {
      const ok = await isSiapSessionValid(chromeApiRemote);
      if (!ok) {
        console.error("🚨 Comando abortado: Sessão do SIAP expirou.");
        handleSiapSessionLostRef.current("sessao_expirada_automaticamente");
        return;
      }
      callback();
    };

    channel
      .on("broadcast", { event: "COMANDO_REMOTO" }, (msg: { payload?: unknown }) => {
        void (async () => {
          const raw = msg?.payload;
          const body =
            raw &&
            typeof raw === "object" &&
            raw !== null &&
            "payload" in raw &&
            (raw as { payload?: unknown }).payload != null
              ? (raw as { payload: Record<string, unknown> }).payload
              : raw;
          if (!body || typeof body !== "object") return;

          const acao = (body as { acao?: string }).acao;
          const numerosRaw = (body as { numeros?: unknown }).numeros;
          const numeros = Array.isArray(numerosRaw)
            ? numerosRaw
                .map((n) => (typeof n === "number" ? n : parseInt(String(n), 10)))
                .filter((n) => Number.isFinite(n))
            : [];

          console.log("Comando recebido do celular:", body);

          const comandosQueExigemSessaoSiap = new Set([
            "MARCAR_FALTA",
            "DESMARCAR_FALTA",
            "FINALIZAR_CHAMADA",
            "SALVAR_FALTA",
            "TROCAR_DIA",
            "TROCAR_TURMA",
            "SALVAR_CONTEUDO",
          ]);

          const precisaValidar = typeof acao === "string" && comandosQueExigemSessaoSiap.has(acao);

          const executar = () => {
            switch (acao) {
              case "MARCAR_FALTA":
                if (numeros.length === 0) return;
                marcarFaltasPorNumerosChamadaRef.current(numeros, "controle-remoto");
                break;
              case "DESMARCAR_FALTA":
                if (numeros.length === 0) return;
                desmarcarFaltasPorNumerosChamadaRef.current(numeros);
                break;
              case "FINALIZAR_CHAMADA":
              case "SALVAR_FALTA":
                performSaveAndNextDayRef.current({ fromRemote: true });
                break;
              case "SALVAR_CONTEUDO":
                handleFinalSaveRef.current();
                break;
              case "TROCAR_DIA": {
                const diaRaw = (body as { dia?: unknown }).dia;
                const diaStr = String(diaRaw ?? "").trim();
                const dayNum = parseInt(diaStr, 10);
                if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) {
                  toast.error("Comando remoto: dia inválido.");
                  break;
                }
                const statsNow = pageStatsRef.current;
                const ctx = findFirstPendingDayContext(statsNow, dayNum);
                if (ctx) {
                  performSelectCalendarDayRef.current(ctx.day, ctx.month, ctx.year, ctx.dataCanonica);
                } else {
                  performSelectCalendarDayRef.current(dayNum, undefined, undefined, null);
                }
                break;
              }
              case "TROCAR_TURMA": {
                const tid = (body as { turmaId?: unknown }).turmaId;
                trocarTurmaControleRemotoRef.current(String(tid ?? ""));
                break;
              }
              default:
                break;
            }
          };

          if (precisaValidar) {
            await broadcastDadosProfessorFromStorage(channel);
            await checkAndExecuteRemoteCommand(executar);
          } else {
            executar();
          }
        })();
      })
      .on("broadcast", { event: "MUDAR_MES" }, (msg: { payload?: unknown }) => {
        const raw = msg?.payload;
        const body =
          raw &&
          typeof raw === "object" &&
          raw !== null &&
          "payload" in raw &&
          (raw as { payload?: unknown }).payload != null
            ? (raw as { payload: Record<string, unknown> }).payload
            : raw;
        if (!body || typeof body !== "object") return;
        const dirRaw = (body as { direcao?: unknown }).direcao;
        const direcao = dirRaw === "anterior" || dirRaw === "proximo" ? dirRaw : null;
        if (!direcao) {
          toast.error('Comando MUDAR_MES: use direcao "anterior" ou "proximo".');
          return;
        }
        handleMudarMesLocalRef.current(direcao);
      })
      .on("broadcast", { event: "REQUEST_SYNC_TURMAS" }, () => {
        void (async () => {
          const resolved = await resolveSiapSessionFromDom(chromeApiRemote);
          if (!resolved) {
            console.error("🚨 REQUEST_SYNC_TURMAS abortado: sessão SIAP inválida.");
            handleSiapSessionLostRef.current("sessao_expirada_automaticamente");
            return;
          }

          const turmasReady = await evaluateTurmasListagemReadyOnTab(
            chromeApiRemote,
            resolved.tabId,
            resolved.url,
          );
          if (!turmasReady) {
            void channel
              .send({
                type: "broadcast",
                event: "SYNC_TURMAS_STATUS",
                payload: {
                  ok: false,
                  errorType: "WRONG_PAGE",
                  message:
                    "Navegue até o menu de Diário (Conteúdo/Frequência) para atualizar a lista.",
                },
              })
              .catch(() => {});
          }

          console.log("📱 [Mobile] Solicitação de turmas recebida.");

          try {
            sessionStorage.setItem(SIAP_SYNC_TURMAS_KEY, "true");
          } catch {
            /* ignore */
          }

          handleLoadClassesRef.current();
        })();
      })
      .on("broadcast", { event: "MOBILE_CONECTADO" }, () => {
        keepTabAwake();
        const stats = pageStatsRef.current;
        const classesSnap = classesDataRef.current;
        console.log("Celular conectado! Enviando DADOS_TURMA (sempre, mesmo com página vazia).");

        const diasPendentes = stats ? flattenPendingDayNumbers(stats) : [];
        const diasPendentesDatas = stats ? flattenPendingDayDateStrings(stats) : [];
        const turmasDisponiveis = buildTurmasDisponiveis(classesSnap);

        const alunos =
          stats?.students && Array.isArray(stats.students)
            ? stats.students.map((aluno: any) => ({
                id: aluno.matricula || aluno.id || `n-${aluno.number}`,
                numero: aluno.number,
                nome: aluno.name,
              }))
            : [];

        void sendBroadcastDadosTurmaAndProfessor(channel, {
          turma: stats?.turma || "",
          disciplina: stats?.disciplina || "",
          alunos,
          diasPendentes,
          diasPendentesDatas,
          turmasDisponiveis,
          diaOficialSiap: getDiaOficialSiapFromStats(stats),
          aulaAtual: getAulaAtualFromStats(stats),
        }).then((status) => {
          if (status === "ok") {
            toast.success("📱 Celular conectado! Pode minimizar esta janela e dar a sua aula.", {
              duration: 6000,
            });
            window.setTimeout(() => {
              setPairingQrOpenRef.current(false);
            }, 1500);
          } else {
            console.error("DADOS_TURMA send:", status);
            toast.error("Falha ao enviar dados da turma para o celular.");
          }
        });
      })
      .on("broadcast", { event: "ABRIR_CONTEUDO" }, (msg: { payload?: unknown }) => {
        void (async () => {
          const raw = msg?.payload;
          const body =
            raw &&
            typeof raw === "object" &&
            raw !== null &&
            "payload" in raw &&
            (raw as { payload?: unknown }).payload != null
              ? (raw as { payload: Record<string, unknown> }).payload
              : raw;
          const fromBody =
            body && typeof body === "object" && body !== null
              ? (body as { turmaId?: unknown }).turmaId
              : undefined;
          const fromRaw =
            raw && typeof raw === "object" && raw !== null
              ? (raw as { turmaId?: unknown }).turmaId
              : undefined;
          const tid = fromBody ?? fromRaw;
          const turmaId = tid != null ? String(tid).trim() : "";
          if (!turmaId) return;

          console.log("📱 [Mobile] Pediu para abrir o conteúdo da turma:", turmaId);

          const ok = await isSiapSessionValid(chromeApiRemote);
          if (!ok) {
            console.error("🚨 ABRIR_CONTEUDO abortado: sessão SIAP inválida.");
            handleSiapSessionLostRef.current("sessao_expirada_automaticamente");
            return;
          }

          abrirConteudoMobileRef.current(turmaId);
        })();
      })
      .on("broadcast", { event: "ABRIR_PLANEJAMENTO" }, (msg: { payload?: unknown }) => {
        void (async () => {
          const raw = msg?.payload;
          const body =
            raw &&
            typeof raw === "object" &&
            raw !== null &&
            "payload" in raw &&
            (raw as { payload?: unknown }).payload != null
              ? (raw as { payload: Record<string, unknown> }).payload
              : raw;
          const fromBody =
            body && typeof body === "object" && body !== null
              ? (body as { turmaId?: unknown }).turmaId
              : undefined;
          const fromRaw =
            raw && typeof raw === "object" && raw !== null
              ? (raw as { turmaId?: unknown }).turmaId
              : undefined;
          const tid = fromBody ?? fromRaw;
          const turmaId = tid != null ? String(tid).trim() : "";
          if (!turmaId) return;

          console.log("📱 [Mobile] Pediu para abrir o planejamento da turma:", turmaId);

          const ok = await isSiapSessionValid(chromeApiRemote);
          if (!ok) {
            console.error("🚨 ABRIR_PLANEJAMENTO abortado: sessão SIAP inválida.");
            handleSiapSessionLostRef.current("sessao_expirada_automaticamente");
            return;
          }

          abrirPlanejamentoMobileRef.current(turmaId);
        })();
      })
      .on("broadcast", { event: "SELECIONAR_DIA_PLANEJAMENTO" }, (msg: { payload?: unknown }) => {
        const raw = msg?.payload;
        const body =
          raw &&
          typeof raw === "object" &&
          raw !== null &&
          "payload" in raw &&
          (raw as { payload?: unknown }).payload != null
            ? (raw as { payload: Record<string, unknown> }).payload
            : raw;
        const dataCanonica =
          body && typeof body === "object" && body !== null
            ? String((body as { dataCanonica?: unknown }).dataCanonica ?? "")
            : "";
        if (!dataCanonica) {
          console.warn("SELECIONAR_DIA_PLANEJAMENTO: dataCanonica ausente.");
          return;
        }
        const displayDay =
          body && typeof body === "object" && body !== null
            ? Number((body as { dia?: unknown }).dia ?? 0)
            : 0;
        console.log("📱 [Mobile] Selecionou dia de planejamento:", dataCanonica);
        handlePlanejamentoDayClick(dataCanonica, displayDay);
      })
      .on("broadcast", { event: "TROCAR_UNIDADE_TEMATICA" }, (msg: { payload?: unknown }) => {
        const raw = msg?.payload;
        const body =
          raw &&
          typeof raw === "object" &&
          raw !== null &&
          "payload" in raw &&
          (raw as { payload?: unknown }).payload != null
            ? (raw as { payload: Record<string, unknown> }).payload
            : raw;
        const value =
          body && typeof body === "object" && body !== null
            ? String((body as { value?: unknown }).value ?? "")
            : typeof raw === "string"
              ? raw
              : "";
        if (!value) return;
        handleUnidadeTematicaChangeMobileRef.current(value);
      })
      .on("broadcast", { event: "PROCESSAR_CONTEUDOS_MOBILE" }, (msg: { payload?: unknown }) => {
        void (async () => {
          const raw = msg?.payload;
          console.log('[🔵 EXTENSÃO] PROCESSAR_CONTEUDOS_MOBILE recebido — payload raw:', JSON.stringify(raw).substring(0, 500));

          const body =
            raw &&
            typeof raw === "object" &&
            raw !== null &&
            "payload" in raw &&
            (raw as { payload?: unknown }).payload != null
              ? (raw as { payload: Record<string, unknown> }).payload
              : raw;
          const fromBody =
            body && typeof body === "object" && body !== null
              ? (body as { botoesParaClicar?: unknown }).botoesParaClicar
              : undefined;
          const fromRaw =
            raw && typeof raw === "object" && raw !== null
              ? (raw as { botoesParaClicar?: unknown }).botoesParaClicar
              : undefined;
          const arr = Array.isArray(fromBody) ? fromBody : Array.isArray(fromRaw) ? fromRaw : [];
          const botoesParaClicar = arr.map((id) => String(id).trim()).filter(Boolean);

          console.log('[🔵 EXTENSÃO] Botoes extraidos:', botoesParaClicar.length, botoesParaClicar);

          if (botoesParaClicar.length === 0) {
            console.warn('[🔵 EXTENSÃO] Nenhum botao para clicar — abortando');
            return;
          }

          const ok = await isSiapSessionValid(chromeApiRemote);
          if (!ok) {
            console.error("🚨 PROCESSAR_CONTEUDOS_MOBILE abortado: sessão SIAP inválida.");
            handleSiapSessionLostRef.current("sessao_expirada_automaticamente");
            return;
          }

          await broadcastDadosProfessorFromStorage(channel);

          const chromeApi = chromeApiRemote;
          if (!chromeApi?.tabs?.query || !chromeApi?.tabs?.sendMessage) {
            console.error('[🔵 EXTENSÃO] Chrome API não disponível para inject na aba SIAP');
            return;
          }

          /** Mesmo id que `handleFinalSave` — um único ADD_TO_QUEUE (cada envio substitui a fila no content script). */
          const SIAP_BTN_SALVAR_CONTEUDO = "cphFuncionalidade_btnAlterar";
          const filaCompleta = [...botoesParaClicar, SIAP_BTN_SALVAR_CONTEUDO];

          console.log('[🔵 EXTENSÃO] Fila completa com', filaCompleta.length, 'itens (', botoesParaClicar.length, 'conteudo + 1 salvar)');

          chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs: { id?: number }[]) => {
            const tabId = tabs[0]?.id;
            if (tabId == null) {
              toast.error("Nenhuma aba ativa para processar conteúdos no SIAP.");
              return;
            }
            console.log('[🔵 EXTENSÃO] Enviando fila para tabId:', tabId);
            const enviarFila = () => {
              safeTabsSendMessage(chromeApi.tabs, tabId, {
                action: "ADD_TO_QUEUE",
                payload: filaCompleta,
              });
              console.log('[🔵 EXTENSÃO] Fila enviada com sucesso para o content script!');
              toast.success(`📱 Fila enviada: ${botoesParaClicar.length} confirmação(ões) + salvar no SIAP.`);
            };
            if (chromeApi.scripting?.executeScript) {
              void chromeApi.scripting
                .executeScript({
                  target: { tabId },
                  world: "MAIN",
                  func: () => {
                    sessionStorage.setItem("SIAP_AVANCAR_APOS_SALVAR", "true");
                  },
                })
                .then(enviarFila)
                .catch((err: unknown) => {
                  console.warn("SIAP_AVANCAR_APOS_SALVAR (conteúdo simples):", err);
                  enviarFila();
                });
            } else {
              enviarFila();
            }
          });
        })();
      })
      // PROCESSAR_CONTEUDOS_GEMINADOS removido: a lógica de Smart Geminada
      // agora vive no content.js. Ao abrir a página de conteúdo, o script detecta
      // se a aula atual já está preenchida e avança para a próxima automaticamente.
      // O mobile sempre emite PROCESSAR_CONTEUDOS_MOBILE (aula individual).
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log("🟢 Conectado na sala:", room);
          setRemoteBroadcastStatus("subscribed");
          if (siapAuthHeartbeatInterval) clearInterval(siapAuthHeartbeatInterval);
          lastSiapAuthBroadcastRef.current = null;
          runSiapAuthHeartbeat();
          siapAuthHeartbeatInterval = setInterval(runSiapAuthHeartbeat, 2500);

          // --- Boot pós-reload: retoma REQUEST_SYNC_TURMAS pendente ---
          let hasSyncFlag = false;
          try { hasSyncFlag = sessionStorage.getItem(SIAP_SYNC_TURMAS_KEY) === "true"; } catch { /* ignore */ }
          if (hasSyncFlag) {
            console.log("🔄 Retomando sincronização de turmas pós-reload...");
            if (syncBootTimer) clearTimeout(syncBootTimer);
            syncBootTimer = setTimeout(() => {
              syncBootTimer = null;
              // Re-verifica (pode ter sido limpo pelo useEffect([classesData]) se chegou antes)
              let stillPending = false;
              try { stillPending = sessionStorage.getItem(SIAP_SYNC_TURMAS_KEY) === "true"; } catch { /* ignore */ }
              if (!stillPending) return;

              try { sessionStorage.removeItem(SIAP_SYNC_TURMAS_KEY); } catch { /* ignore */ }

              const stats = pageStatsRef.current;
              const classesSnap = classesDataRef.current;
              const turmasDisponiveis = buildTurmasDisponiveis(classesSnap);
              const diasPendentes = stats ? flattenPendingDayNumbers(stats) : [];
              const diasPendentesDatas = stats ? flattenPendingDayDateStrings(stats) : [];
              const alunos =
                stats?.students && Array.isArray(stats.students)
                  ? (stats.students as any[]).map((aluno: any) => ({
                      id: aluno.matricula || aluno.id || `n-${aluno.number}`,
                      numero: aluno.number,
                      nome: aluno.name,
                    }))
                  : [];

              void sendBroadcastDadosTurmaAndProfessor(channel, {
                turma: (stats?.turma as string) || "",
                disciplina: (stats?.disciplina as string) || "",
                alunos,
                diasPendentes,
                diasPendentesDatas,
                turmasDisponiveis,
                diaOficialSiap: getDiaOficialSiapFromStats(stats),
                aulaAtual: getAulaAtualFromStats(stats),
              })
                .then((status) => {
                  if (status === "ok") {
                    console.log("✅ Turmas enviadas ao mobile com sucesso (pós-reload)!");
                    toast.success("📋 Turmas sincronizadas com o app!");
                  }
                })
                .catch(() => {});
            }, 1000);
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          console.error(`🔴 Erro Realtime! Status: ${status}`, err, {
            errMessage: err instanceof Error ? err.message : err,
            errStack: err instanceof Error ? err.stack : undefined,
            room,
            viteSupabaseUrlPresent: VITE_SUPABASE_URL_DEFINED,
            viteSupabaseAnonKeyPresent: VITE_SUPABASE_ANON_KEY_DEFINED,
            isSupabaseConfigured,
          });
          setRemoteBroadcastStatus("error");
          if (siapAuthHeartbeatInterval) {
            clearInterval(siapAuthHeartbeatInterval);
            siapAuthHeartbeatInterval = null;
          }
        }
      });

    return () => {
      realtimeChannelRef.current = null;
      if (syncBootTimer) {
        clearTimeout(syncBootTimer);
        syncBootTimer = null;
      }
      if (esperandoTurmaFlushTimerRef.current != null) {
        window.clearTimeout(esperandoTurmaFlushTimerRef.current);
        esperandoTurmaFlushTimerRef.current = null;
      }
      if (siapAuthHeartbeatInterval) {
        clearInterval(siapAuthHeartbeatInterval);
        siapAuthHeartbeatInterval = null;
      }
      lastSiapAuthBroadcastRef.current = null;
      setRemoteBroadcastStatus("idle");
      void supabase.removeChannel(channel);
    };
  }, [roomId, session?.user?.id, licencaStatus, isSupabaseConfigured]);

  const handleRemoveStudent = (student: any) => {
    const chromeApi = (window as any).chrome;
    chromeApi?.tabs?.query({ active: true, currentWindow: true }, ([tab]: any) => {
      if (tab?.id) {
        safeTabsSendMessage(chromeApi.tabs, tab.id, {
          action: "UNMARK_STUDENT_ABSENT",
          name: student.name,
          number: student.number,
          matricula: student.matricula,
        });
        
        setMarkedStudents(prev => prev.filter(s => s.matricula !== student.matricula));
        toast.info(`Falta removida: ${student.name}`);
      }
    });
  };

  /** Visão computacional: números de chamada (Gemini) → marca faltas no SIAP e no painel. */
  const handlePautaVisionAbsences = useCallback(
    (nums: number[]) => {
      if (!pageStats?.students?.length) {
        toast.error("Lista de alunos indisponível.");
        return;
      }
      if (nums.length === 0) {
        const dia = formatDiaParaMensagemUsuario(diaPautaGemini || "—");
        toast.info(`Nenhuma falta encontrada para o dia ${dia} ou coluna não visível na foto.`);
        return;
      }
      const chromeApi = (window as any).chrome;
      chromeApi?.tabs?.query({ active: true, currentWindow: true }, ([tab]: any) => {
        if (!tab?.id) {
          toast.error("Aba do SIAP não encontrada.");
          return;
        }
        let toAdd: any[] = [];
        setMarkedStudents((prev) => {
          const mats = new Set(prev.map((s) => s.matricula));
          toAdd = [];
          for (const num of nums) {
            const student = pageStats.students.find((s: any) => s.number === num);
            if (student && !mats.has(student.matricula)) {
              toAdd.push({ ...student, confirmed: true });
            }
          }
          return toAdd.length ? [...prev, ...toAdd] : prev;
        });
        if (toAdd.length === 0) {
          toast.info("Nenhuma falta nova identificada (ou números já marcados).");
          return;
        }
        toAdd.forEach((s) => {
          safeTabsSendMessage(chromeApi.tabs, tab.id, {
            action: "MARK_STUDENT_ABSENT",
            name: s.name,
            number: s.number,
            matricula: s.matricula,
          });
        });
        incrementStat("extractionsCount");
        toast.success(`Leitura concluída! ${toAdd.length} faltas identificadas.`);
      });
    },
    [pageStats?.students, diaPautaGemini],
  );

  const handleSaveAndNextDay = () => {
    if (markedStudents.length > 0 && !showSaveConfirm) {
      setShowSaveConfirm(true);
      return;
    }
    performSaveAndNextDay();
  };

  const handleLoadClasses = () => {
    const chromeApi = (window as any).chrome;
    if (!chromeApi?.tabs?.query) return;

    void (async () => {
      const resolved = await resolveSiapSessionFromDom(chromeApi);
      if (!resolved) {
        console.error(
          "❌ Aba do SIAP não encontrada ou sessão inválida (esperado #lblNomeUsuario ou logout).",
        );
        return;
      }
      const { tabId, url } = resolved;
      if (!chromeApi.scripting?.executeScript) {
        console.error("❌ chrome.scripting indisponível.");
        return;
      }

      const isListagem = url.toLowerCase().includes("diarioescolarlistagem.aspx");
      if (isListagem) {
        chromeApi.scripting.executeScript({
          target: { tabId },
          func: () => {
            const listBtn =
              (document.querySelector('input[value*=\"Listar\"]') as HTMLInputElement) ||
              (Array.from(document.querySelectorAll("input, button")).find((el: any) =>
                (el.value || el.innerText || "").includes("Listar"),
              ) as HTMLInputElement);
            if (listBtn) listBtn.click();
            else alert("Botão Listar não encontrado.");
          },
        });
      } else {
        try {
          sessionStorage.setItem(SIAP_AUTO_CLICK_LISTAR_KEY, "true");
        } catch {
          /* ignore */
        }
        chromeApi.scripting.executeScript({
          target: { tabId },
          func: () => {
            window.location.href = "DiarioEscolarListagem.aspx";
          },
        });
      }
    })();
  };

  // Mantém a ref sincronizada a cada render — sem dep no array do channel useEffect.
  handleLoadClassesRef.current = handleLoadClasses;

  if (!isSupabaseConfigured || !supabase) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 p-8 text-center">
        <GraduationCap className="h-12 w-12 text-indigo-400 mb-4" />
        <p className="text-sm text-slate-300 max-w-sm">
          Defina <span className="font-mono text-indigo-300">VITE_SUPABASE_URL</span> e{" "}
          <span className="font-mono text-indigo-300">VITE_SUPABASE_ANON_KEY</span> no <span className="font-mono">.env</span> da extensão e gere o build de novo.
        </p>
      </div>
    );
  }

  if (authSessionLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 gap-3">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-400" />
        <p className="text-xs font-medium text-slate-400">Carregando sessão…</p>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-900/40">
            <GraduationCap className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-xl font-black tracking-tight text-white">SIAP Turbo</h1>
          <p className="text-center text-xs text-slate-400">Entre ou crie sua conta para usar o painel.</p>
        </div>
        <Card className="w-full max-w-md border-slate-700/80 bg-slate-900/90 text-slate-100 shadow-2xl">
          <CardHeader>
            <CardTitle className="text-lg text-white">{authMode === "signin" ? "Entrar" : "Criar conta"}</CardTitle>
            <CardDescription className="text-slate-400">
              {authMode === "signin" ? "Acesse com o e-mail cadastrado no SaaS." : "Use o mesmo e-mail da sua compra, quando houver."}
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleAuthSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="siap-auth-email" className="text-slate-300">
                  E-mail
                </Label>
                <Input
                  id="siap-auth-email"
                  type="email"
                  autoComplete="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="border-slate-600 bg-slate-950/50 text-white placeholder:text-slate-500"
                  placeholder="professor@escola.edu.br"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="siap-auth-password" className="text-slate-300">
                  Senha
                </Label>
                <Input
                  id="siap-auth-password"
                  type="password"
                  autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="border-slate-600 bg-slate-950/50 text-white placeholder:text-slate-500"
                  placeholder="••••••••"
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3 border-t border-slate-700/80 bg-slate-900/50 pt-6">
              <Button
                type="submit"
                className="w-full rounded-xl bg-indigo-600 font-bold hover:bg-indigo-500"
                disabled={authBusy}
              >
                {authBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : authMode === "signin" ? "Entrar" : "Cadastrar"}
              </Button>
              <button
                type="button"
                className="text-center text-xs font-semibold text-indigo-400 hover:text-indigo-300"
                onClick={() => setAuthMode(authMode === "signin" ? "signup" : "signin")}
              >
                {authMode === "signin" ? "Não tem conta? Criar conta" : "Já tenho conta — Entrar"}
              </button>
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  if (licencaStatus !== "ativa" && licencaStatus !== "bloqueada") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 gap-3">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-400" />
        <p className="text-xs font-medium text-slate-400">Verificando sua licença…</p>
      </div>
    );
  }

  if (licencaStatus === "bloqueada") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 to-slate-900 p-6">
        <Card className="w-full max-w-md border-amber-500/40 bg-slate-900/50 shadow-xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/20">
              <Lock className="h-7 w-7 text-amber-400" />
            </div>
            <CardTitle className="text-xl text-white">Sua licença não está ativa.</CardTitle>
            <CardDescription className="text-slate-400">
              Renove ou adquira sua assinatura para usar o SIAP Mobile e o controle remoto.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col gap-2">
            <Button
              type="button"
              className="w-full rounded-xl bg-amber-500 font-bold text-slate-950 hover:bg-amber-400"
              onClick={() => window.open(LANDING_PAGE_URL, "_blank", "noopener,noreferrer")}
            >
              Quero assinar
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-slate-400 hover:text-white"
              onClick={() => void handleSignOut()}
              disabled={authBusy}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sair da conta
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (licencaStatus === "ativa" && perfilSiapDivergente) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 to-slate-900 p-6">
        <Card className="w-full max-w-md border-rose-500/40 bg-slate-900/50 shadow-xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/20">
              <UserX className="h-7 w-7 text-rose-400" />
            </div>
            <CardTitle className="text-xl text-white">Perfil SIAP não confere</CardTitle>
            <CardDescription className="text-slate-400">
              O nome visível no SIAP não bate com o vínculo desta conta Turbo. Entre no SIAP com o mesmo professor ou refaça o pareamento.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col gap-2">
            <Button
              type="button"
              variant="ghost"
              className="w-full text-slate-400 hover:text-white"
              onClick={() => void handleSignOut()}
              disabled={authBusy}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sair da conta
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (isLoginRequired) {
    return (
      <div className="h-screen bg-slate-50 p-6 flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in duration-500">
        <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center shadow-inner">
          <MonitorSmartphone className="w-10 h-10 text-indigo-600 animate-pulse" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-slate-900">Sessão Expirada</h2>
          <p className="text-sm text-slate-600 leading-relaxed">Faça o login no SIAP na tela ao lado para continuarmos o lançamento de faltas.</p>
        </div>
        <div className="p-4 bg-white rounded-2xl border-2 border-indigo-100 shadow-sm text-[10px] text-indigo-600 font-bold italic">
          "O Chrome preencherá sua senha. Basta digitar o código de imagem (Captcha) e dar Enter."
        </div>
        <Button onClick={() => window.location.reload()} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8 shadow-lg shadow-indigo-100">Já fiz o login! Recarregar</Button>
      </div>
    );
  }

  if (!hasSeenOnboarding && !isGhostMode && (!classesData || Object.keys(classesData).length === 0)) {
    return (
      <div className="h-screen bg-gradient-to-b from-slate-50 to-white p-6 flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in zoom-in-95 duration-700">
        <div className="space-y-4">
          <div className="w-20 h-20 bg-gradient-to-tr from-indigo-100 to-indigo-50 rounded-[1.5rem] flex items-center justify-center mx-auto shadow-xl border-2 border-white rotate-3">
            <GraduationCap className="w-10 h-10 text-indigo-600" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black tracking-tight text-slate-950">SIAP Turbo</h1>
            <p className="text-xs font-medium text-slate-600 px-4 leading-relaxed">A ferramenta que devolve ao professor o tempo perdido com burocracia.</p>
          </div>
        </div>
        <div className="w-full aspect-video bg-slate-100/50 rounded-2xl border-2 border-slate-200/50 shadow-inner flex flex-col items-center justify-center gap-2 overflow-hidden relative group">
          <img src="/demo.gif" alt="Demonstração" className="w-full h-full object-cover opacity-30 grayscale saturate-50" />
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/5 backdrop-blur-[1px]">
             <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center shadow-lg border-2 border-slate-100">
                <FileText className="w-6 h-6 text-indigo-500 ml-0.5" />
             </div>
             <p className="text-[10px] font-black text-slate-400 uppercase mt-2 tracking-widest">[ Espaço para o GIF da Extensão ]</p>
          </div>
        </div>
        <div className="w-full space-y-3">
          <button onClick={() => { setIsGhostMode(true); setRunTour(true); handleLoadClasses(); }} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 px-6 rounded-2xl shadow-xl shadow-indigo-100 flex flex-col items-center justify-center transition-all active:scale-95 group">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-200 group-hover:animate-spin-slow" />
              <span className="text-lg uppercase">Testar na Prática</span>
            </div>
            <span className="text-[10px] text-indigo-200/60 font-bold uppercase tracking-widest">(Modo Seguro)</span>
          </button>
          <button onClick={() => { setHasSeenOnboarding(true); handleLoadClasses(); }} className="w-full bg-white border-2 border-slate-200 hover:border-indigo-400 text-slate-700 font-bold py-3.5 px-6 rounded-2xl shadow-sm text-sm flex items-center justify-center gap-2 transition-all">Pular e usar de verdade 🚀</button>
        </div>
        <p className="text-[9px] text-slate-400 font-medium">🛡️ Versão 1.8 - Processado localmente com IA Gemini.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen min-w-0 max-w-full flex-col items-start justify-start overflow-x-hidden bg-white p-3">
      {(Joyride as any) && (
        <Joyride
          steps={tourSteps}
          run={runTour}
          continuous={true}
          onEvent={handleJoyrideEvent}
          locale={{ back: 'Voltar', close: 'Fechar', last: 'Finalizar', next: 'Próximo', skip: 'Pular Tour' }}
        />
      )}
      {isGhostMode && (
        <div className="w-full mb-3 p-3 bg-gradient-to-r from-indigo-600 to-indigo-500 border-2 border-indigo-400/30 rounded-2xl flex items-center justify-between shadow-lg animate-in slide-in-from-top-4">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-white/20 rounded-lg"><Sparkles className="w-4 h-4 text-white" /></div>
            <div>
              <p className="text-[9px] font-black text-indigo-100 uppercase tracking-widest leading-none mb-0.5">Teste em Andamento</p>
              <p className="text-[11px] font-bold text-white tracking-tight">🛡️ MODO SEGURO: Nada será salvo no SIAP.</p>
            </div>
          </div>
          <button onClick={() => { setIsGhostMode(false); setHasSeenOnboarding(true); }} className="text-[9px] font-black uppercase bg-white/10 hover:bg-white/20 text-white px-2.5 py-1.5 rounded-lg border border-white/20 transition-all active:scale-95">Sair do Teste</button>
        </div>
      )}
      {syncStatus.status === "OFFLINE" && (
        <div className="w-full mb-3 p-2 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-[10px] text-rose-600 font-bold animate-in fade-in slide-in-from-top-2">
          <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span></span>
          🔴 SIAP Offline - {syncStatus.count || 0} faltas na fila. Tentando reconectar...
        </div>
      )}
      <header className="w-full mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-100"><GraduationCap className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="text-sm font-black text-slate-950 tracking-tight leading-none mb-0.5">SIAP Frequência</h1>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">Lançamento Turbo</p>
            {(activeTab === "frequencia" || activeTab === "conteudo") && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {remoteBroadcastStatus === "subscribed" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[8px] font-black uppercase tracking-tight text-emerald-800">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    <Radio className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
                    Sala: {roomId.slice(0, 8)}…
                  </span>
                )}
                {remoteBroadcastStatus === "connecting" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[8px] font-black uppercase tracking-tight text-amber-900">
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                    Conectando sala…
                  </span>
                )}
                {remoteBroadcastStatus === "error" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[8px] font-black uppercase text-rose-800">
                    Erro Realtime — verifique o projeto Supabase
                  </span>
                )}
                {remoteBroadcastStatus === "room_error" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[8px] font-black uppercase text-orange-900">
                    Sala inválida — recarregue o painel da extensão
                  </span>
                )}
                {remoteBroadcastStatus === "disabled" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[8px] font-bold text-slate-500">
                    Controle remoto: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
                  </span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pairingParearBusy || !session?.user || siapProfessorNome.trim().length < 2}
                  className="h-7 gap-1.5 rounded-full border-indigo-200 bg-indigo-50/80 px-2.5 text-[8px] font-black uppercase tracking-tight text-indigo-900 shadow-sm hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-indigo-50/80"
                  onClick={() => void handleParearCelular()}
                >
                  <QrCode className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Parear celular
                </Button>
                {siapProfessorNome.trim().length < 2 && (
                  <p className="basis-full max-w-[16rem] text-[8px] font-bold leading-snug text-amber-800">
                    Aguarde o SIAP exibir seu nome no portal para parear com segurança.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={authBusy}
            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all shadow-sm bg-white"
            title="Sair da conta"
          >
            <LogOut className="w-4 h-4" />
          </button>
          <button onClick={handleReset} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-xl transition-all shadow-sm bg-white" title="Reiniciar Total"><RotateCcw className="w-4 h-4" /></button>
        </div>
      </header>

      <Dialog open={pairingQrOpen} onOpenChange={setPairingQrOpen}>
        <DialogContent className="sm:max-w-sm rounded-3xl border border-slate-200 bg-slate-950 text-slate-100 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-center text-base font-black uppercase tracking-tight text-white">
              Parear SIAP Mobile
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-slate-400">
              Sala: <span className="font-mono font-bold text-indigo-300">{roomId}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            <p className="text-center text-[11px] font-medium leading-snug text-slate-300">
              Aponte a câmera do celular para abrir o controle remoto — não é preciso digitar o código da sala.
            </p>
            <div
              className="rounded-2xl border-[10px] border-white bg-white p-2 shadow-lg ring-2 ring-white/30"
              role="img"
              aria-label="QR Code para abrir o app mobile com esta sala"
            >
              <QRCodeSVG
                value={mobilePairingUrl}
                size={208}
                level="M"
                includeMargin
                bgColor="#ffffff"
                fgColor="#0f172a"
              />
            </div>
            <p className="max-w-[240px] text-center text-[9px] text-slate-500 break-all">
              {mobilePairingUrl}
            </p>
            {remoteBroadcastStatus === "disabled" && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-950/50 px-3 py-2 text-center text-[10px] font-semibold text-amber-200">
                Configure as variáveis Supabase na extensão para o realtime funcionar após abrir o app.
              </p>
            )}
          </div>
          <DialogFooter className="sm:justify-center">
            <Button
              type="button"
              variant="secondary"
              className="rounded-xl font-bold"
              onClick={() => setPairingQrOpen(false)}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {calculateTimeSaved() && (
        <div className="w-full mb-4 group relative overflow-hidden bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm transition-all hover:border-indigo-200 hover:shadow-indigo-50/50">
          <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:scale-125 transition-transform"><Sparkles className="w-10 h-10 text-indigo-600" /></div>
          <div className="relative flex flex-col gap-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Painel de Produtividade</p>
            <div className="flex items-baseline gap-1.5"><span className="text-3xl font-black text-indigo-600 tracking-tighter">{calculateTimeSaved()}</span><span className="text-[11px] font-bold text-slate-500 uppercase tracking-tight">de tempo salvo ✨</span></div>
            <div className="flex gap-3 pt-1 border-t border-slate-50 mt-1">
              <div className="flex flex-col"><span className="text-xs font-black text-slate-700">{(timeSavedStats.extractionsCount || 0) + (timeSavedStats.voiceCount || 0)}</span><span className="text-[8px] font-bold text-slate-400 uppercase leading-none">Ações Tomadas</span></div>
              <div className="flex flex-col"><span className="text-xs font-black text-emerald-600">Alta</span><span className="text-[8px] font-bold text-slate-400 uppercase leading-none">Precisão IA</span></div>
            </div>
          </div>
        </div>
      )}
      <div className="w-full flex-1 flex flex-col gap-4">
        <div className="bg-white rounded-[1.5rem] border border-slate-200 p-4 shadow-sm space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-4 w-4 rounded-full bg-indigo-100 flex items-center justify-center border border-indigo-200"><div className="h-1.5 w-1.5 rounded-full bg-indigo-600" /></div>
            <h2 className="text-sm font-bold text-slate-950 uppercase tracking-tight">Navegação SIAP</h2>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3 bg-white p-2.5 rounded-2xl border border-slate-100 tour-step-navegacao">
            <button 
              type="button"
              onClick={() => handleNavigationTabClick("conteudo")}
              className={`flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all group ${activeTab === 'conteudo' ? 'bg-white border border-indigo-200 shadow-sm' : 'hover:bg-slate-50 opacity-60'}`}
            >
              <div className={`p-2 rounded-lg ${activeTab === 'conteudo' ? 'bg-indigo-50' : 'bg-slate-50'}`}>
                <BookOpen className={`w-4 h-4 ${activeTab === 'conteudo' ? 'text-indigo-600' : 'text-slate-400'}`} />
              </div>
              <span className={`text-[8px] font-black uppercase ${activeTab === 'conteudo' ? 'text-indigo-950' : 'text-slate-500'}`}>Conteúdo</span>
            </button>
            <button 
              type="button"
              onClick={() => handleNavigationTabClick("planejamento")}
              className={`flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all group ${activeTab === 'planejamento' ? 'bg-white border border-indigo-200 shadow-sm' : 'hover:bg-slate-50 opacity-60'}`}
            >
              <div className={`p-2 rounded-lg ${activeTab === 'planejamento' ? 'bg-indigo-50' : 'bg-slate-50'}`}>
                <Calendar className={`w-4 h-4 ${activeTab === 'planejamento' ? 'text-indigo-600' : 'text-slate-400'}`} />
              </div>
              <span className={`text-[8px] font-black uppercase ${activeTab === 'planejamento' ? 'text-indigo-950' : 'text-slate-500'}`}>Planejam.</span>
            </button>
            <button 
              type="button"
              onClick={() => handleNavigationTabClick("frequencia")}
              className={`flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all group ${activeTab === 'frequencia' ? 'bg-white border border-indigo-200 shadow-sm' : 'hover:bg-slate-50 opacity-60'}`}
            >
              <div className={`p-2 rounded-lg ${activeTab === 'frequencia' ? 'bg-indigo-50' : 'bg-slate-50'}`}>
                <Calendar className={`w-4 h-4 ${activeTab === 'frequencia' ? 'text-indigo-600' : 'text-slate-400'}`} />
              </div>
              <span className={`text-[8px] font-black uppercase ${activeTab === 'frequencia' ? 'text-indigo-950' : 'text-slate-500'}`}>Frequência</span>
            </button>
          </div>
          <div className="pt-2 border-t border-slate-100 tour-step-turmas">
            <div className="flex items-center justify-between pb-2">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Suas Turmas</h3>
              <Button variant="ghost" size="sm" onClick={handleLoadClasses} className={`h-6 text-[9px] font-black text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 tour-step-atualizar ${(!classesData || Object.keys(classesData).length === 0) ? 'animate-pulse bg-indigo-600 text-white ring-4 ring-indigo-100' : ''}`}>ATUALIZAR LISTA</Button>
            </div>
            <div className="space-y-3 max-h-[180px] overflow-y-auto pr-2 custom-scrollbar">
              {(!classesData || Object.keys(classesData).length === 0) ? (
                <div className="bg-white border-2 border-dashed border-slate-200 p-4 rounded-xl flex flex-col items-center gap-3 animate-in fade-in zoom-in duration-500">
                  <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm text-indigo-600"><Info className="w-5 h-5" /></div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-black text-slate-950 leading-tight">👈 Onde estão suas turmas?</p>
                    <p className="text-[10px] text-slate-500 font-medium leading-relaxed">Preencha os filtros do SIAP na tela ao lado e clique em <span className="font-black text-indigo-700 uppercase">Listar</span>. Nós puxaremos automaticamente!</p>
                  </div>
                </div>
              ) : (
                <>{Object.entries(classesData).map(([disc, turmas]: [string, any]) => (
                    <div key={disc} className="bg-white p-2 rounded-xl border border-slate-100 mb-3">
                      <h3 className="text-[9px] font-black text-slate-400 uppercase mb-1.5 truncate border-b border-slate-100 pb-1">{disc}</h3>
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {turmas.map((t: any) => {
                          const isActive = pageStats?.turma && t.name.includes(pageStats.turma) && (!pageStats.disciplina || disc.toUpperCase().includes(pageStats.disciplina.toUpperCase()) || pageStats.disciplina.toUpperCase().includes(disc.toUpperCase()));
                          return (<button key={`${disc}-${t.name}`} onClick={() => handleClassClick(t.rowIndex)} className={`py-1.5 px-3 rounded-lg font-bold text-[10px] transition-all shadow-sm ${isActive ? 'bg-indigo-600 text-white ring-4 ring-indigo-100 scale-105 z-10' : 'bg-white text-slate-700 border border-slate-100 hover:border-indigo-300'}`}>{t.name}</button>);
                        })}
                      </div>
                    </div>
                  ))}</>
              )}
            </div>
          </div>
        </div>
        
        {(activeTab === 'frequencia' || activeTab === 'conteudo') && (pageStats?.students || pageStats?.pageType === 'conteudo') && (
          <div className="p-4 rounded-[1.5rem] border bg-white border-slate-200 shadow-sm transition-all duration-500 tour-step-calendario animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-4 w-4 rounded-full flex items-center justify-center border bg-emerald-100 border-emerald-200">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
              </div>
              <h2 className="text-sm font-bold text-slate-950 uppercase tracking-tight">Calendário SIAP</h2>
            </div>

            <div className="flex items-center justify-between gap-2 mb-4 rounded-xl border border-slate-200 bg-gradient-to-r from-indigo-50/60 via-white to-white px-1.5 py-1.5 shadow-sm">
              <button
                type="button"
                disabled={isSyncingMonth}
                onClick={() => handleMudarMesLocal("anterior")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-all hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Mês anterior"
              >
                <ChevronLeft className="w-4 h-4" strokeWidth={2.5} />
              </button>
              <div className="min-w-0 flex-1 text-center">
                {isSyncingMonth ? (
                  <div className="flex items-center justify-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" strokeWidth={2.5} />
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wide">Sincronizando…</span>
                  </div>
                ) : (
                  <p className="text-[11px] font-black text-slate-800 uppercase tracking-wide truncate">
                    {pageStats.calendarMonthLabel
                      ? pageStats.calendarMonthLabel
                      : pageStats.pendingMonths?.length > 0
                        ? `${pageStats.pendingMonths[0].monthName} ${pageStats.pendingMonths[0].year}`
                        : "Mês visível no SIAP"}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={isSyncingMonth}
                onClick={() => handleMudarMesLocal("proximo")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-all hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Próximo mês"
              >
                <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>
            
            <div className="mb-4 animate-in fade-in duration-500">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Aulas Pendentes</p>
                <div className="flex gap-2 text-[8px] font-black uppercase">
                  <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded border border-indigo-100">{pageStats.turma}</span>
                  <span className="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded border border-emerald-100">{pageStats.pendentes} pendentes</span>
                </div>
              </div>
              {pageStats.pendingMonths?.length > 0 && (
                <div className="space-y-5 max-h-[140px] overflow-y-auto pr-1 custom-scrollbar">
                    {pageStats.pendingMonths.map((m: any) => (
                      <div key={`${m.year}-${m.month}`} className="space-y-2">
                        <p className="text-[9px] font-black text-slate-900 uppercase tracking-widest px-2.5 py-2 rounded-lg bg-slate-100 border border-slate-200/90 text-center shadow-sm">{m.monthName} {m.year}</p>
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {m.days.map((dayEntry: SiapPendingDayEntry) => {
                            const d = siapDayEntryDay(dayEntry);
                            const canon = siapDayEntryCanon(dayEntry);
                            const btnKey = canon || `${m.year}-${m.month}-${d}`;
                            return (
                              <button
                                key={btnKey}
                                type="button"
                                onClick={() => handleDayClick(d, m.month, m.year, canon ?? null)}
                                className={`flex-shrink-0 w-8 h-8 rounded-full font-black text-[10px] transition-all flex items-center justify-center shadow-sm ${selectedDayNumber === d ? "bg-indigo-600 text-white ring-4 ring-indigo-100 scale-110" : "bg-white text-slate-600 border border-slate-200 hover:border-indigo-300"}`}
                              >
                                {d}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {(() => {
              const jaEnviado =
                !!selectedDay &&
                selectedDayNumber != null &&
                !(pageStats?.pendingMonths ?? []).some((m: any) =>
                  m.days.some((d: any) => siapDayEntryDay(d) === selectedDayNumber),
                );
              return (
                <div className="flex items-center gap-3 relative">
                  <div className={`flex-1 p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${jaEnviado ? 'bg-emerald-50/40 border-emerald-200' : (selectedDay || isGhostMode) ? 'bg-indigo-50/30 border-indigo-100' : 'bg-white border-slate-100'}`}>
                    <div className={`p-2 rounded-lg ${jaEnviado ? 'bg-emerald-500 shadow-lg shadow-emerald-100' : (selectedDay || isGhostMode) ? 'bg-indigo-600 shadow-lg shadow-indigo-100' : 'bg-slate-100'}`}><CalendarDays className={`w-5 h-5 ${(selectedDay || isGhostMode || jaEnviado) ? 'text-white' : 'text-slate-400'}`} /></div>
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Dia Selecionado</p>
                      <p className={`text-xs font-black ${jaEnviado ? 'text-emerald-700' : 'text-slate-900'}`}>{selectedDay ? `Dia ${selectedDay}` : (isGhostMode ? "Modo Teste" : "Aguardando...")}</p>
                      {jaEnviado && <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest mt-0.5">Já enviado ✓</p>}
                    </div>
                  </div>
              
              {isSyncingDay && (
                <div className="absolute inset-0 bg-white/60 backdrop-blur-sm rounded-xl flex items-center justify-center border-2 border-amber-300 animate-in fade-in duration-300 z-10">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
                    <span className="text-[10px] font-black text-amber-700 uppercase tracking-tight">Sincronizando SIAP...</span>
                  </div>
                </div>
              )}
                </div>
              );
            })()}
          </div>
        )}
        
        {activeTab === 'frequencia' && (selectedDay || isGhostMode) && pageStats?.students && (
          <div className="mt-0 animate-in slide-in-from-top-2 space-y-4">
              <div className="p-4 bg-white rounded-xl border-2 border-slate-100 space-y-4 shadow-inner tour-step-busca">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-600">1</div>
                  <span className="text-[10px] font-black text-slate-800 uppercase tracking-wider">Opção 1: Digitar</span>
                </div>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                  </div>
                  <input type="text" className="w-full h-11 pl-10 pr-4 bg-slate-50 border-2 border-slate-100 rounded-xl text-sm font-medium placeholder:text-slate-300 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all" placeholder="Buscar aluno ou digite números e dê Enter (ex: 1, 4, 7)..." value={searchStudent} onChange={(e) => setSearchStudent(e.target.value)} onKeyDown={handleSearchKeyDown} />
                  {searchStudent && filteredStudents.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-slate-200 rounded-xl shadow-2xl z-50 max-h-48 overflow-y-auto custom-scrollbar ring-8 ring-slate-900/5">
                      {filteredStudents.map((s: any) => (
                        <button key={s.matricula} onClick={() => handleStudentClick(s)} className="w-full p-3 text-left text-xs hover:bg-indigo-50 border-b border-slate-50 last:border-0 transition-all flex items-center gap-3 group"><span className="font-black text-slate-300 min-w-[20px] group-hover:text-indigo-400">{s.number}.</span><span className="truncate flex-1 font-bold text-slate-700 group-hover:text-indigo-900">{s.name}</span><ArrowRight className="w-3.5 h-3.5 text-slate-200 group-hover:text-indigo-500 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" /></button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="my-3 flex items-center gap-2 px-1"><div className="h-[1px] flex-1 bg-slate-100"></div><span className="text-[9px] font-black text-slate-300 uppercase">Ou use IA Turbo</span><div className="h-[1px] flex-1 bg-slate-100"></div></div>
              <div className="grid gap-3">
                <div className="tour-step-voz relative">
                  <button onClick={toggleVoiceCommand} className={`w-full group relative overflow-hidden p-4 rounded-xl border-2 transition-all active:scale-95 ${isListening ? 'bg-rose-50 border-rose-500 ring-4 ring-rose-100' : 'bg-white border-slate-100 hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-50/50'}`}>
                    <div className="flex items-center gap-4">
                      <div className={`p-4 rounded-xl transition-all duration-500 ${isListening ? 'bg-rose-500 animate-pulse' : 'bg-slate-50 group-hover:bg-indigo-50'}`}><Mic className={`w-8 h-8 ${isListening ? 'text-white' : 'text-indigo-500 group-hover:scale-110'}`} /></div>
                      <div className="text-left">
                        <p className={`text-lg font-black uppercase tracking-tight ${isListening ? 'text-rose-600' : 'text-slate-900'}`}>
                          {isListening ? '🎙️ Ouvindo…' : 'Lançar por Voz'}
                        </p>
                        <p className={`text-[10px] font-bold uppercase tracking-wider ${isListening ? 'text-rose-500' : 'text-slate-400 opacity-80'}`}>
                          {isListening
                            ? transcriptData || 'Toque de novo neste botão para parar o microfone'
                            : 'Toque e fale o nome ou as faltas'}
                        </p>
                      </div>
                    </div>
                  </button>
                  {voiceSuggestions.length > 0 && (
                    <div className="mt-2 p-3 bg-white border-2 border-indigo-100 rounded-xl shadow-lg animate-in slide-in-from-top-2"><p className="text-[9px] font-black text-indigo-400 uppercase mb-2">Quem você quis dizer?</p><div className="space-y-1.5">{voiceSuggestions.map((group, groupIdx) => (<div key={groupIdx} className="flex flex-wrap gap-1.5">{group.matches.map((s: any) => (<button key={s.matricula} onClick={() => handleResolveAmbiguity(s, groupIdx)} className="px-2 py-1 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded-lg border border-indigo-100 hover:bg-indigo-600 hover:text-white transition-all">{s.number}. {s.name.split(' ')[0]}</button>))}</div>))}</div></div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPautaCameraOpen(true)}
                  disabled={(!selectedDay && !isGhostMode) || !pageStats?.students?.length}
                  className="w-full group relative overflow-hidden rounded-xl border-2 border-slate-100 bg-white p-4 text-left transition-all hover:border-violet-400 hover:shadow-lg hover:shadow-violet-50/50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex gap-1.5 rounded-xl bg-slate-50 p-3 transition-all group-hover:bg-violet-50">
                      <Camera className="h-7 w-7 shrink-0 text-violet-600 group-hover:scale-105" />
                      <Upload className="h-7 w-7 shrink-0 text-violet-500 group-hover:scale-105" />
                    </div>
                    <div>
                      <p className="text-lg font-black uppercase tracking-tight text-slate-900">Ler pauta com IA</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 opacity-80">
                        Câmera ou arquivo (JPG/PNG) — faltas na lista automaticamente
                      </p>
                    </div>
                  </div>
                </button>
                <PautaCameraVisionDialog
                  open={pautaCameraOpen}
                  onOpenChange={setPautaCameraOpen}
                  students={pageStats?.students ?? []}
                  diaSelecionado={diaPautaGemini}
                  disabled={(!selectedDay && !isGhostMode) || !pageStats?.students?.length}
                  onAbsenceNumbersDetected={handlePautaVisionAbsences}
                />
                <div className="tour-step-upload p-4 bg-white rounded-xl border-2 border-slate-100 space-y-3">
                  <div className="flex items-center gap-2 px-1"><ImageIcon className="w-3.5 h-3.5 text-indigo-400" /><span className="text-[10px] font-black text-slate-700 uppercase tracking-widest leading-none">Imagens da Chamada ({uploadedImages.length})</span>{uploadedImages.length > 0 && (<button onClick={handleToggleViewer} className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-rose-600 text-white rounded-lg text-[9px] font-black uppercase hover:bg-rose-700 transition-all shadow-sm">{isViewerOpen ? 'Fechar' : 'Abrir'}</button>)}</div>
                  {uploadedImages.length > 0 && (<div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">{uploadedImages.map((img, idx) => (<div key={idx} className="relative flex-none group"><img src={img} className="w-14 h-14 rounded-xl object-cover border border-slate-200 shadow-sm" /><button onClick={() => handleRemoveImage(idx)} className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"><XCircle className="w-3 h-3" /></button></div>))}</div>)}
                  <DropZone onFilesSelected={handleFilesSelected} disabled={!selectedDay && !isGhostMode} />
                </div>
              </div>
          </div>
        )}
        
        {activeTab === 'planejamento' && (
          <div className="relative bg-white border-2 border-slate-100 rounded-[1.5rem] overflow-hidden shadow-sm flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="p-6 space-y-6">
              <div className="flex flex-col items-center text-center space-y-3 py-4">
                <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center shadow-inner border border-indigo-100 group-hover:scale-110 transition-transform">
                  <Calendar className="w-8 h-8 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tighter">Automação de Aula</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mt-1">Módulo Planejamento</p>
                </div>
              </div>

              {pageStats?.pageType === 'planejamento' ? (
                <div className="space-y-4">
                  <div className="p-4 bg-indigo-50/50 border-2 border-dashed border-indigo-100 rounded-2xl space-y-3">
                    <p className="text-[11px] font-medium text-indigo-900 leading-relaxed text-center">
                      <strong className="font-black">1.</strong> Selecione um dia pendente abaixo. Só depois o Planejamento Turbo (habilidades, matriz, etc.) será exibido.
                    </p>
                    {pageStats?.pendingMonths && pageStats.pendingMonths.length > 0 && (
                      <div className="space-y-5 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
                        {pageStats.pendingMonths.map((m: any) => (
                          <div key={`${m.year}-${m.month}`} className="space-y-2.5">
                            <p className="text-[9px] font-black text-indigo-950 uppercase tracking-widest text-center px-3 py-2.5 rounded-lg bg-slate-100 border border-slate-200/90 shadow-sm">{m.monthName} {m.year}</p>
                            <div className="flex flex-wrap justify-center gap-2 pt-1 border-t border-slate-200/60">
                              {m.days.map((dayEntry: SiapPendingDayEntry) => {
                                const d = siapDayEntryDay(dayEntry);
                                const canon = siapDayEntryCanon(dayEntry) || "";
                                const btnKey = canon || `${m.year}-${m.month}-${d}`;
                                return (
                                  <button
                                    key={btnKey}
                                    type="button"
                                    onClick={() => {
                                      if (!canon) {
                                        toast.error("Esta célula não tem data canônica; atualize a página do SIAP.");
                                        return;
                                      }
                                      handlePlanejamentoDayClick(canon, d);
                                    }}
                                    className={`w-9 h-9 border-2 rounded-xl font-black text-xs transition-all shadow-sm active:scale-90 ${
                                      selectedPlanningCanon === canon && canon
                                        ? "bg-indigo-600 text-white border-indigo-600 ring-4 ring-indigo-100"
                                        : "bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white hover:border-indigo-600"
                                    }`}
                                  >
                                    {d}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {!selectedPlanningCanon ? (
                    <p className="text-center text-[10px] font-semibold text-slate-500 px-2">
                      Toque em um dia no calendário acima para liberar o assistente de planejamento.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="mx-auto flex w-full min-w-0 max-w-full items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2">
                        <p className="min-w-0 truncate text-[10px] font-bold text-indigo-950">
                          Data: <span className="font-mono text-indigo-800">{selectedPlanningCanon}</span>
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 border-indigo-200 text-[9px] font-black uppercase"
                          onClick={() => setSelectedPlanningCanon(null)}
                        >
                          Trocar data
                        </Button>
                      </div>
                      <div className="mx-auto w-full min-w-0 max-w-full">
                        <PlanejamentoTurboWizard
                          key={selectedPlanningCanon}
                          scrapedOptions={pageStats?.planejamentoOptions}
                          unidadesTematicas={pageStats?.unidadesTematicas}
                          unidadeAtiva={pageStats?.unidadeAtiva ?? null}
                          onUnidadeTematicaChange={handleUnidadeTematicaChange}
                          contextSubtitle={
                            [pageStats?.turma, selectedPlanningCanon].filter(Boolean).join(" • ") || undefined
                          }
                          onInject={handleTurboWizardInject}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 text-center space-y-4 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-100">
                  <Info className="w-8 h-8 text-slate-300 mx-auto" />
                  <div>
                    <p className="text-xs font-bold text-slate-600 leading-tight">Funcionalidade Indisponível</p>
                    <p className="text-[10px] font-medium text-slate-400 mt-1">
                      Navegue até a tela de <span className="text-indigo-600 font-bold font-sans">Planejamento</span> no SIAP para ativar este botão.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {isPlanejamentoInjectionOpen && planejamentoInjectionRows.length > 0 && (
              <div className="absolute inset-0 z-[60] flex flex-col bg-white/95 backdrop-blur-sm">
                <div className="flex min-h-0 flex-1 flex-col border-b border-indigo-100 bg-gradient-to-b from-indigo-50/90 to-white px-3 py-3 sm:px-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-indigo-950">
                      Sincronização com o SIAP
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[9px] font-bold text-slate-500"
                      onClick={() => {
                        setIsPlanejamentoInjectionOpen(false);
                        planejamentoInjectionActiveRef.current = false;
                        planejamentoInjectionTotalRef.current = 0;
                        setPlanejamentoInjectionRows([]);
                      }}
                    >
                      Fechar
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-indigo-100/80 bg-white shadow-inner custom-scrollbar">
                    <table className="w-full text-left text-[10px]">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/90 text-[9px] font-black uppercase tracking-wide text-slate-500">
                          <th className="px-2 py-2">Status</th>
                          <th className="px-2 py-2">Etapa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {planejamentoInjectionRows.map((row) => (
                          <tr
                            key={row.id}
                            className={`border-b border-slate-50 ${
                              row.status === "processing" ? "bg-indigo-50/50" : ""
                            }`}
                          >
                            <td className="align-top px-2 py-2">
                              {row.status === "done" && (
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                              )}
                              {row.status === "processing" && (
                                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-600" aria-hidden />
                              )}
                              {row.status === "pending" && (
                                <Clock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                              )}
                            </td>
                            <td
                              className={`px-2 py-2 leading-snug ${
                                row.status === "done"
                                  ? "text-slate-500 line-through decoration-slate-300"
                                  : row.status === "processing"
                                    ? "font-bold text-indigo-950"
                                    : "text-slate-600"
                              }`}
                            >
                              {row.label}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
            
            <div className="bg-slate-50 p-4 border-t border-slate-100 italic">
               <p className="text-[9px] text-slate-400 font-medium text-center leading-tight">
                 O SIAP Turbo clicará no dia azul e na aula "Não Planejada" automaticamente para você. ⚡
               </p>
            </div>
          </div>
        )}

        {activeTab === 'conteudo' && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-500">
            {/* Área Superior (Seleção) */}
            <div className="p-4 space-y-5 flex-1 max-h-[400px] overflow-y-auto custom-scrollbar">
              
              {/* Conteúdos do Dia */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block px-1">Conteúdo do Dia</span>
                <div className="grid grid-cols-1 gap-2">
                  {pageStats?.conteudosList?.map((item: any) => (
                    <label 
                      key={item.id} 
                      className={`flex items-start gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer group ${selectedConteudos.includes(item.id) ? 'bg-indigo-50/30 border-indigo-200 ring-4 ring-indigo-50/20' : 'bg-white border-slate-50 hover:border-slate-200'}`}
                    >
                      <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${selectedConteudos.includes(item.id) ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-200 group-hover:border-indigo-300'}`}>
                        {selectedConteudos.includes(item.id) && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <input 
                        type="checkbox" 
                        className="hidden" 
                        checked={selectedConteudos.includes(item.id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedConteudos(prev => [...prev, item.id]);
                          else setSelectedConteudos(prev => prev.filter(id => id !== item.id));
                        }}
                      />
                      <span className={`text-[11px] font-bold leading-snug flex-1 ${selectedConteudos.includes(item.id) ? 'text-indigo-900' : 'text-slate-600'}`}>
                        {item.texto}
                      </span>
                    </label>
                  ))}
                  {(!pageStats?.conteudosList || pageStats.conteudosList.length === 0) && (
                    <div className="py-8 text-center border-2 border-dashed border-slate-100 rounded-2xl bg-slate-50/30">
                      <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest italic">Nenhum conteúdo planejado para hoje</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Materiais (Preset) */}
              <div className="space-y-3">
                <div className="flex justify-between items-center mb-1 px-1">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Materiais (Preset)</span>
                  <span className="text-[10px] text-amber-600 font-bold bg-amber-100 px-2 py-0.5 rounded shadow-sm border border-amber-200/50 animate-pulse">AUTO-SALVO</span>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {pageStats?.materiaisList?.filter((m: any) => showAllMateriais || selectedMateriais.includes(m.id)).map((item: any) => (
                    <label 
                      key={item.id} 
                      className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer group ${selectedMateriais.includes(item.id) ? 'bg-slate-50 border-slate-200 shadow-sm' : 'bg-white border-slate-100 hover:border-slate-200'}`}
                    >
                      <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${selectedMateriais.includes(item.id) ? 'bg-slate-800 border-slate-800' : 'bg-white border-slate-200 group-hover:border-slate-300'}`}>
                        {selectedMateriais.includes(item.id) && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <input 
                        type="checkbox" 
                        className="hidden" 
                        checked={selectedMateriais.includes(item.id)}
                        onChange={(e) => {
                          let newList;
                          if (e.target.checked) newList = [...selectedMateriais, item.id];
                          else newList = selectedMateriais.filter(id => id !== item.id);
                          setSelectedMateriais(newList);
                          saveMaterialsPreset(newList);
                        }}
                      />
                      <span className={`text-[11px] font-medium leading-snug flex-1 ${selectedMateriais.includes(item.id) ? 'text-slate-900 font-bold' : 'text-slate-500'}`}>
                        {item.texto}
                      </span>
                    </label>
                  ))}
                  
                  {/* Botão de Expansão */}
                  {!showAllMateriais && pageStats?.materiaisList?.length > selectedMateriais.length && (
                    <button 
                      onClick={() => setShowAllMateriais(true)}
                      className="w-full py-3 px-4 border-2 border-dashed border-slate-100 rounded-xl text-slate-400 hover:text-indigo-600 hover:border-indigo-100 hover:bg-indigo-50/30 transition-all flex items-center justify-center gap-2 group"
                    >
                      <PlusCircle className="w-4 h-4 group-hover:rotate-90 transition-transform" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Adicionar outros materiais</span>
                    </button>
                  )}

                  {showAllMateriais && (
                    <button 
                      onClick={() => setShowAllMateriais(false)}
                      className="w-full py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors"
                    >
                      Recolher lista ↑
                    </button>
                  )}

                  {(!pageStats?.materiaisList || pageStats.materiaisList.length === 0) && (
                    <div className="py-4 text-center border border-dashed border-slate-100 rounded-xl">
                      <p className="text-[9px] font-bold text-slate-300 uppercase italic leading-none">Aba materiais vazia</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Área Inferior (Fluxo de Revisão) */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-col gap-3">
              <div className="flex justify-between items-center px-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Resumo da Seleção</span>
                <div className="flex gap-2">
                  <span className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full border border-indigo-100">{selectedConteudos.length} conts</span>
                  <span className="text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full border border-amber-100">{selectedMateriais.length} mats</span>
                </div>
              </div>
              
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleLaunchContent}
                  disabled={(selectedConteudos.length + selectedMateriais.length) === 0}
                  className="h-12 w-full border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                >
                  Confirmar apenas nesta turma
                </Button>
                <button
                  type="button"
                  onClick={() => setConfirmacaoLoteOpen(true)}
                  disabled={(selectedConteudos.length + selectedMateriais.length) === 0}
                  className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-700 py-4 font-black uppercase tracking-tight text-white shadow-xl shadow-indigo-300/25 transition-all hover:from-indigo-500 hover:via-violet-500 hover:to-indigo-600 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-35 disabled:grayscale"
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  <Zap className="relative h-4 w-4 shrink-0 text-amber-300 drop-shadow-sm" />
                  <Rocket className="relative h-4 w-4 shrink-0 text-amber-200 transition-transform group-hover:scale-110" />
                  <span className="relative text-xs sm:text-sm">🚀 Iniciar Confirmação em Lote</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <ConfirmacaoLoteModal
          open={confirmacaoLoteOpen}
          onOpenChange={setConfirmacaoLoteOpen}
          materiaisSelecionadosTexto={materiaisRotulosLote}
        />

        {markedStudents.length > 0 && (
          <div className="animate-in slide-in-from-bottom-4 duration-500 tour-step-finalizar">
            <ValidationPanel imageSource={uploadedImages.length > 0 ? uploadedImages[0] : ""} absences={markedStudents.map(s => ({ numero: s.number || 0, nome: s.name || "Desconhecido", confirmed: s.confirmed !== undefined ? s.confirmed : true }))} onRemove={(num) => { const s = markedStudents.find(st => st.number === num); if (s) handleRemoveStudent(s); }} onToggleConfirm={(num) => { setMarkedStudents(prev => prev.map(s => { if (s.number === num) return { ...s, confirmed: s.confirmed === false ? true : false }; return s; })); }} onSubmit={handleSaveAndNextDay} isSubmitting={isExtracting} turma={pageStats?.turma} disciplina={pageStats?.disciplina} data={selectedDay} isGhostMode={isGhostMode} onExitGhostMode={() => { setIsGhostMode(false); setHasSeenOnboarding(true); setMarkedStudents([]); }} />
            {showSaveConfirm && (
              <div className="mt-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-emerald-800 animate-in zoom-in"><p className="text-[10px] font-bold">Confirma o lançamento de {markedStudents.length} faltas?</p><div className="flex gap-2"><button onClick={() => setShowSaveConfirm(false)} className="text-[9px] font-black uppercase px-2 py-1 text-slate-400 hover:text-slate-600">Cancelar</button><button onClick={handleSaveAndNextDay} className="bg-emerald-600 text-white text-[9px] font-black uppercase px-3 py-1 rounded-lg shadow-sm">Sim, Salvar!</button></div></div>
            )}
          </div>
        )}

        {/* Modal de Revisão de Conteúdo (Recibo) */}
        <Dialog open={isContentReviewModalOpen} onOpenChange={setIsContentReviewModalOpen}>
          <DialogContent className="sm:max-w-md border-0 shadow-2xl rounded-3xl p-0 overflow-hidden bg-white">
            <div className="bg-slate-900 p-6 text-white overflow-hidden relative">
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
              <div className="relative z-10">
                <h3 className="text-xl font-black tracking-tighter uppercase flex items-center gap-2">
                  <FileCheck2 className="w-6 h-6 text-indigo-400" />
                  Revisar Lançamento
                </h3>
                <p className="text-slate-400 text-xs mt-1 font-medium">Confirme os detalhes antes de injetar no SIAP</p>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="bg-[#fdfbf2] border-2 border-dashed border-[#e8dcb8] p-5 font-mono text-sm text-slate-700 rounded-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-2 opacity-10 font-black text-4xl">SIAP</div>
                
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Progresso do Lançamento:</p>
                
                <div className="space-y-3 relative z-10">
                  <div className="flex justify-between py-1 items-center border-b border-[#e8dcb8]/50">
                    <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest leading-none">Injeção em Lote</span> 
                    <span className={`font-bold transition-colors ${executionProgress.current === executionProgress.total ? 'text-emerald-600' : 'text-indigo-600'}`}>
                      {executionProgress.current} de {executionProgress.total} processados
                    </span>
                  </div>
                  
                  {/* Barra de Progresso Visual */}
                  <div className="w-full h-2 bg-white rounded-full border border-[#e8dcb8] overflow-hidden">
                    <div 
                      className="h-full bg-indigo-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                      style={{ width: `${executionProgress.total > 0 ? (executionProgress.current / executionProgress.total) * 100 : 0}%` }}
                    ></div>
                  </div>

                  <div className="pt-4 mt-2 font-black flex flex-col gap-1 text-slate-900 border-t-2 border-[#e8dcb8]">
                    <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Ação Final Pendente:</span> 
                    <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-[#e8dcb8]">
                      <span className="text-xs">💾 SALVAR NO SIAP</span>
                      {executionProgress.current < executionProgress.total ? (
                        <span className="text-indigo-500 text-[10px] font-black animate-pulse flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> PROCESSANDO...
                        </span>
                      ) : (
                        <span className="text-emerald-600 text-[10px] font-black underline">PRONTO PARA SALVAR!</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={handleFinalSave}
                  disabled={executionProgress.current < executionProgress.total}
                  className="w-full bg-emerald-600 text-white font-sans font-black py-4 rounded-2xl hover:bg-emerald-500 active:scale-95 transition-all shadow-xl shadow-emerald-100 disabled:opacity-30 disabled:grayscale disabled:scale-100 flex items-center justify-center gap-3 uppercase tracking-tighter text-sm"
                >
                  <SaveIcon className="w-5 h-5 text-white" />
                  Confirmar e Salvar no SIAP
                </button>
                <button 
                  onClick={() => {
                    setIsContentReviewModalOpen(false);
                    setExecutionProgress({ current: 0, total: 0 });
                  }}
                  className="w-full py-2 text-slate-400 text-[10px] font-black uppercase tracking-widest hover:text-slate-600 transition-colors"
                >
                  Fechar sem salvar
                </button>
              </div>
            </div>
            
            <div className="bg-slate-50 p-4 flex gap-3 border-t border-slate-100">
              <div className="bg-amber-100 p-2 rounded-xl">
                <Zap className="w-4 h-4 text-amber-600" />
              </div>
              <p className="text-[10px] text-slate-500 font-medium leading-tight">
                <span className="font-bold text-slate-700 block mb-0.5">AVANÇO AUTOMÁTICO ATIVO</span>
                Ao confirmar, a extensão processará esta aula e o painel avançará para o próximo dia letivo automaticamente.
              </p>
            </div>
          </DialogContent>
        </Dialog>

        {/* Modal de Revisão de Voz */}
        <Dialog open={isReviewingVoiceResults} onOpenChange={setIsReviewingVoiceResults}>
          <DialogContent className="sm:max-w-md border-2 border-indigo-100 shadow-2xl rounded-3xl">
            <DialogHeader className="space-y-3">
              <div className="mx-auto w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center mb-2">
                <Mic className="w-6 h-6 text-indigo-600" />
              </div>
              <DialogTitle className="text-xl font-black text-slate-900 text-center uppercase tracking-tight">
                📝 Resumo do Lançamento por Voz
              </DialogTitle>
              <DialogDescription className="text-center space-y-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-full border border-slate-100 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                   {selectedDay ? `Dia ${selectedDay}` : 'Hoje'} • {pageStats?.turma || 'Turma não identificada'}
                </div>
                <p className="text-xs text-slate-400 font-medium">Revisão de faltas detectadas pelo sistema de áudio.</p>
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 max-h-[300px] overflow-y-auto px-1 custom-scrollbar">
              <div className="space-y-2">
                {studentsDetectedByVoice.map((s) => (
                  <div key={s.matricula} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100 group hover:border-indigo-200 hover:bg-white transition-all">
                    <div className="h-8 w-8 bg-white rounded-lg border border-slate-200 flex items-center justify-center text-xs font-black text-indigo-600 shadow-sm group-hover:shadow-indigo-50">
                      {s.number}
                    </div>
                    <span className="text-xs font-bold text-slate-700 truncate flex-1">{s.name}</span>
                    <button 
                      onClick={() => setStudentsDetectedByVoice(prev => prev.filter(p => p.matricula !== s.matricula))}
                      className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-2">
              <Button 
                variant="outline" 
                onClick={() => { setIsReviewingVoiceResults(false); setStudentsDetectedByVoice([]); }}
                className="w-full sm:flex-1 h-12 rounded-2xl border-2 border-slate-100 font-black uppercase text-[10px] tracking-widest text-slate-400 hover:bg-slate-50"
              >
                Cancelar / Editar
              </Button>
              <Button 
                onClick={handleConfirmVoiceAbsences}
                className="w-full sm:flex-1 h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-[10px] tracking-widest shadow-lg shadow-indigo-100 transition-all active:scale-95"
              >
                ✅ Confirmar e Lançar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <div className="flex items-center justify-center gap-1.5 py-4 opacity-50"><div className="w-1 h-1 bg-emerald-500 rounded-full" /><span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">🛡️ Proteção Ativa - Local IA Processed</span></div>
      </div>
    </div>
  );
};

export default Index;