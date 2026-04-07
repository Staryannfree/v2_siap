/**
 * Piloto Automático — Confirmação em lote de conteúdos (UI + simulação local).
 *
 * TODO (integração futura):
 * - Ler turmas pendentes reais + agrupamento por série via content script / chrome.storage.
 * - Persistir presets de material por série em chrome.storage.local (ex.: siap_materiais_serie_8).
 * - Disparar navegação na aba SIAP (troca de turma na listagem + reexecução da fila ADD_TO_QUEUE).
 * - Sincronizar estado do terminal com QUEUE_PROGRESS / mensagens do content.js.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Zap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type ConfirmacaoLoteModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Textos dos materiais marcados na aba Conteúdo (ex.: "Revisa Goiás"). Vazio = usa fallback de demo. */
  materiaisSelecionadosTexto?: string[];
};

type TurmaItemMock = {
  id: string;
  /** Rótulo curto ex.: "8B - Pendente" */
  label: string;
  defaultChecked: boolean;
};

type BlocoSerieMock = {
  id: string;
  titulo: string;
  subtitulo: string;
  /** true = bloco da série da turma atual (mesmo preset de material) */
  isSerieAtual: boolean;
  badgeVariant: "material" | "warning";
  badgeText: string;
  turmas: TurmaItemMock[];
};

/** Dados mockados: agrupamento por série (regra de negócio — mesma série compartilha sugestão de material). */
const MOCK_BLOCOS: BlocoSerieMock[] = [
  {
    id: "serie-8",
    titulo: "8º Ano",
    subtitulo: "Turma atual",
    isSerieAtual: true,
    badgeVariant: "material",
    badgeText: "", // preenchido com materiaisSelecionadosTexto ou fallback
    turmas: [
      { id: "t-8b", label: "8B — Pendente", defaultChecked: true },
      { id: "t-8c", label: "8C — Pendente", defaultChecked: true },
      { id: "t-8d", label: "8D — Pendente", defaultChecked: true },
    ],
  },
  {
    id: "serie-9",
    titulo: "9º Ano",
    subtitulo: "Outra série",
    isSerieAtual: false,
    badgeVariant: "warning",
    badgeText: "Atenção: Revise os materiais de apoio ao chegar nesta turma.",
    turmas: [
      { id: "t-9a", label: "9A — Pendente", defaultChecked: false },
      { id: "t-9b", label: "9B — Pendente", defaultChecked: false },
    ],
  },
];

type TerminalLine = {
  id: string;
  text: string;
  status: "done" | "running" | "pending";
};

const FALLBACK_MATERIAL_DEMO = "Revisa Goiás";

/** Linhas fixas de demo para o terminal (substituir pela fila real vinda do content script). */
const DEMO_TURMAS_TERMINAL = ["8º Ano A", "8º Ano B", "8º Ano C", "8º Ano D"];

function buildTerminalLines(step: number): TerminalLine[] {
  return DEMO_TURMAS_TERMINAL.map((name, i) => {
    if (i === 0) {
      return {
        id: `term-${i}`,
        text: `${name}: Conteúdo confirmado.`,
        status: "done",
      };
    }
    if (i <= step) {
      return {
        id: `term-${i}`,
        text: `${name}: Conteúdo confirmado.`,
        status: "done",
      };
    }
    if (i === step + 1) {
      return {
        id: `term-${i}`,
        text: `Navegando para ${name}…`,
        status: "running",
      };
    }
    return {
      id: `term-${i}`,
      text: `${name}: Aguardando fila…`,
      status: "pending",
    };
  });
}

function buildInitialSelection(): Record<string, boolean> {
  const m: Record<string, boolean> = {};
  for (const bloco of MOCK_BLOCOS) {
    for (const t of bloco.turmas) {
      m[t.id] = t.defaultChecked;
    }
  }
  return m;
}

export function ConfirmacaoLoteModal({
  open,
  onOpenChange,
  materiaisSelecionadosTexto = [],
}: ConfirmacaoLoteModalProps) {
  const [fase, setFase] = useState<"selecao" | "execucao">("selecao");
  const [turmasMarcadas, setTurmasMarcadas] = useState<Record<string, boolean>>(buildInitialSelection);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const textoMateriaisBadge = useMemo(() => {
    if (materiaisSelecionadosTexto.length > 0) {
      return materiaisSelecionadosTexto.join(", ");
    }
    return FALLBACK_MATERIAL_DEMO;
  }, [materiaisSelecionadosTexto]);

  const totalTurmasVarredura = useMemo(() => {
    // 1 = turma atual (sempre) + turmas adicionais com checkbox marcado
    const extras = Object.values(turmasMarcadas).filter(Boolean).length;
    return 1 + extras;
  }, [turmasMarcadas]);

  const resetModal = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setFase("selecao");
    setTurmasMarcadas(buildInitialSelection());
    setTerminalLines([]);
  }, []);

  useEffect(() => {
    if (!open) resetModal();
  }, [open, resetModal]);

  /** Avança o demo do terminal a cada 1,4s até todas as turmas estarem "confirmadas". */
  useEffect(() => {
    if (fase !== "execucao") return;

    let step = 0;
    setTerminalLines(buildTerminalLines(step));
    const maxStep = DEMO_TURMAS_TERMINAL.length - 1;

    intervalRef.current = setInterval(() => {
      step += 1;
      setTerminalLines(buildTerminalLines(step));
      if (step >= maxStep && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, 1400);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fase]);

  const toggleTurma = (id: string, checked: boolean) => {
    setTurmasMarcadas((prev) => ({ ...prev, [id]: checked }));
  };

  const handleIniciarVarredura = () => {
    setFase("execucao");
    // TODO: persistir turmasMarcadas + materiais em chrome.storage antes de disparar a varredura real.
  };

  const handleCancelar = () => {
    resetModal();
    onOpenChange(false);
  };

  const iconForStatus = (status: TerminalLine["status"]) => {
    if (status === "done") return <span className="text-emerald-500">🟢</span>;
    if (status === "running")
      return (
        <span className="inline-flex text-amber-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </span>
      );
    return <span className="text-slate-400">⚪</span>;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetModal();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] w-[min(100%,440px)] gap-0 overflow-hidden border-slate-200 p-0 sm:max-w-[440px]">
        <DialogHeader className="space-y-2 border-b border-slate-100 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-5 text-left text-white">
          <DialogTitle className="text-lg font-black tracking-tight text-white">
            Piloto Automático: Confirmar Conteúdos
          </DialogTitle>
          <DialogDescription className="text-xs font-medium leading-relaxed text-indigo-100/90">
            A extensão navegará pelas turmas selecionadas confirmando os conteúdos previstos para o dia.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(52vh,420px)] overflow-y-auto p-4">
          {fase === "selecao" && (
            <div className="space-y-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Agrupamento por série
              </p>

              {MOCK_BLOCOS.map((bloco) => (
                <div
                  key={bloco.id}
                  className={cn(
                    "rounded-2xl border-2 p-4 shadow-sm transition-shadow",
                    bloco.isSerieAtual
                      ? "border-indigo-200 bg-indigo-50/40 ring-1 ring-indigo-100"
                      : "border-amber-100 bg-amber-50/20",
                  )}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-black text-slate-900">{bloco.titulo}</h3>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide",
                        bloco.isSerieAtual
                          ? "bg-indigo-600 text-white"
                          : "bg-slate-200 text-slate-600",
                      )}
                    >
                      {bloco.subtitulo}
                    </span>
                  </div>

                  {bloco.badgeVariant === "material" && (
                    <div className="mb-3 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-[11px] font-bold text-indigo-900 shadow-sm">
                      <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400">
                        Materiais definidos nesta aba
                      </span>
                      <p className="mt-1 leading-snug">{textoMateriaisBadge}</p>
                    </div>
                  )}

                  {bloco.badgeVariant === "warning" && (
                    <div className="mb-3 rounded-xl border border-amber-300 bg-amber-100/80 px-3 py-2 text-[11px] font-bold text-amber-950">
                      {bloco.badgeText}
                    </div>
                  )}

                  <div className="space-y-2">
                    {bloco.turmas.map((t) => (
                      <label
                        key={t.id}
                        className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 transition-colors hover:border-indigo-200 hover:bg-indigo-50/30"
                      >
                        <Checkbox
                          checked={turmasMarcadas[t.id] ?? false}
                          onCheckedChange={(c) => toggleTurma(t.id, c === true)}
                        />
                        <span className="text-xs font-bold text-slate-800">{t.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {fase === "execucao" && (
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Execução
              </p>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-200 shadow-inner">
                {terminalLines.length === 0 ? (
                  <div className="flex items-center gap-2 text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Inicializando fila…
                  </div>
                ) : (
                  <ul className="space-y-2.5">
                    {terminalLines.map((line) => (
                      <li key={line.id} className="flex gap-2.5">
                        <span className="shrink-0 pt-0.5">{iconForStatus(line.status)}</span>
                        <span
                          className={cn(
                            line.status === "running" && "font-bold text-amber-300",
                            line.status === "done" && "text-emerald-100",
                            line.status === "pending" && "text-slate-500",
                          )}
                        >
                          {line.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="text-[9px] font-medium italic text-slate-400">
                Simulação local — conectar aqui os eventos reais de navegação e fila SIAP.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 border-t border-slate-100 bg-slate-50/80 p-4 sm:flex-col">
          {fase === "selecao" ? (
            <>
              <Button type="button" variant="ghost" className="order-1 text-xs font-bold text-slate-500" onClick={handleCancelar}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleIniciarVarredura}
                className="order-2 h-12 w-full animate-pulse bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 font-black uppercase tracking-tight text-white shadow-lg shadow-indigo-200/50 [animation-duration:2.2s] hover:from-indigo-500 hover:via-violet-500 hover:to-indigo-500 hover:shadow-indigo-300/40"
              >
                <Zap className="h-4 w-4 shrink-0 text-amber-300" />
                Iniciar Varredura ({totalTurmasVarredura}{" "}
                {totalTurmasVarredura === 1 ? "turma" : "turmas"})
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" className="w-full font-bold" onClick={handleCancelar}>
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
