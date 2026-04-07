/**
 * Wizard multi-etapas — Planejamento Turbo (painel da extensão, largura fixa 400px).
 *
 * DADOS REAIS: injete `scrapedOptions` a partir de `pageStats.planejamentoOptions` (content.js).
 * Cada item raspado deve trazer { categoria, texto, postBackArg } alinhado às categorias abaixo.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// --- Tipos -----------------------------------------------------------------

export type TurboScrapedOption = {
  categoria: string;
  texto: string;
  postBackArg: string;
};

export type WizardItem = {
  id: string;
  label: string;
  /** Se ausente, o item não entra na fila __doPostBack (só exibição / metodologia livre). */
  postBackArg?: string;
};

/** Itens do &lt;select id="ddlEixo"&gt; — ver content.js `scrapeDdlEixo` / `scrapePlanejamentoTreeOptions`. */
export type UnidadeTematicaItem = { value: string; text: string };

/** Uma linha da tabela de sincronização (status preenchido no painel). */
export type TurboInjectionTask = { id: string; label: string };

export type PlanejamentoTurboWizardProps = {
  /** Opções vindas do scrape `a.EstiloNoFolha` — ver content.js `planejamentoOptions`. */
  scrapedOptions?: TurboScrapedOption[];
  /** Lista do SIAP (ddlEixo). */
  unidadesTematicas?: UnidadeTematicaItem[];
  /** Valor selecionado no SIAP após o último UPDATE_PAGE_STATS. */
  unidadeAtiva?: string | null;
  /** Dispara postback no SIAP para trocar a unidade (content.js: CHANGE_UNIDADE_TEMATICA). */
  onUnidadeTematicaChange?: (value: string) => void;
  contextSubtitle?: string;
  /**
   * `payloads`: ordem fixa — Habilidades → Matriz → Conteúdo → Metodologias SIAP → Avaliações SIAP → textos livres (sempre no fim).
   * `tasks`: rótulos para a tabela de sincronização (1:1 com payloads).
   */
  onInject: (plan: { payloads: string[]; tasks: TurboInjectionTask[] }) => void;
  className?: string;
};

// --- MOCK: remover ou manter como fallback quando o scrape não trouxer itens na categoria ---
const MOCK_SKILLS: WizardItem[] = [
  {
    id: "mock-skill-1",
    postBackArg: "sHabilidades\\MOCK01",
    label:
      "(EF69LP02-C) Perceber a construção composicional e o estilo dos gêneros em questão, em textos de divulgação científica.",
  },
  {
    id: "mock-skill-2",
    postBackArg: "sHabilidades\\MOCK02",
    label:
      "(EF69LP03) Identificar, em notícias, o fato central, suas principais circunstâncias e eventuais decorrências.",
  },
  {
    id: "mock-skill-3",
    postBackArg: "sHabilidades\\MOCK03",
    label:
      "(EF89LP03-A) Analisar textos de opinião (artigos de opinião, comentários, posts de blogs e similares).",
  },
];

const MOCK_MATRIX: WizardItem[] = [
  { id: "mock-mx-1", postBackArg: "sMatriz SAEB\\MOCKD1", label: "D1 — Localizar informações explícitas em um texto." },
  { id: "mock-mx-2", postBackArg: "sMatriz SAEB\\MOCKD2", label: "D2 — Estabelecer relações entre partes de um texto." },
  { id: "mock-mx-3", postBackArg: "sMatriz SAEB\\MOCKD3", label: "D3 — Identificar o efeito de sentido de recursos expressivos." },
];

const MOCK_CONTENTS: WizardItem[] = [
  { id: "mock-ct-1", postBackArg: "sObjetivos\\MOCK1", label: "Leitura e interpretação de texto noticioso." },
  { id: "mock-ct-2", postBackArg: "sObjetivos\\MOCK2", label: "Produção de texto de divulgação científica." },
  { id: "mock-ct-3", postBackArg: "sObjetivos\\MOCK3", label: "Gênero textual: notícia e reportagem." },
];

const MOCK_METHODOLOGIES: WizardItem[] = [
  { id: "mock-met-1", postBackArg: "sMetodologias\\MOCK1", label: "Aula expositiva" },
  { id: "mock-met-2", postBackArg: "sMetodologias\\MOCK2", label: "Debate" },
  { id: "mock-met-3", postBackArg: "sMetodologias\\MOCK3", label: "Estudo de caso" },
  { id: "mock-met-4", postBackArg: "sMetodologias\\MOCK4", label: "Rotação por estações" },
];

const MOCK_EVALUATIONS: WizardItem[] = [
  { id: "mock-ev-1", postBackArg: "sAvaliações\\MOCK1", label: "Observação participante" },
  { id: "mock-ev-2", postBackArg: "sAvaliações\\MOCK2", label: "Produção escrita" },
  { id: "mock-ev-3", postBackArg: "sAvaliações\\MOCK3", label: "Autoavaliação" },
];

const CAT = {
  skill: "Habilidades",
  matrix: "Matriz SAEB",
  content: "Conteúdos",
  method: "Metodologias",
  eval: "Avaliações",
} as const;

function scrapedToWizardItems(scraped: TurboScrapedOption[] | undefined, categoria: string): WizardItem[] {
  if (!scraped?.length) return [];
  return scraped
    .filter((o) => o.categoria === categoria)
    .map((o, i) => ({
      id: `scrape-${categoria}-${i}-${o.postBackArg}`,
      label: o.texto,
      postBackArg: o.postBackArg,
    }));
}

function mergeItems(scraped: WizardItem[], mocks: WizardItem[]): WizardItem[] {
  return scraped.length > 0 ? scraped : mocks;
}

const TOTAL_PROGRESS = 7; // 0 unidade + 6 passos

function truncateTurboLabel(s: string, max: number): string {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + "…";
}

/** Evita que espaços / diferenças mínimas entre scrape e Select bloqueiem "Próximo". */
function normalizeUtValue(v: string | null | undefined): string {
  return String(v ?? "").trim();
}

function ReviewSection({
  title,
  count,
  labels,
}: {
  title: string;
  count: number;
  labels: string[];
}) {
  return (
    <Collapsible className="group rounded-lg border border-slate-200 bg-white shadow-sm">
      <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left hover:bg-slate-50/80">
        <span className="min-w-0 flex-1 text-[11px] font-semibold text-slate-700">{title}</span>
        <span className="shrink-0 text-[11px] font-black text-indigo-700">{count}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-slate-100 px-2.5 py-2">
        <ul className="space-y-2">
          {labels.length === 0 ? (
            <li className="text-[10px] text-slate-400">Nenhum item selecionado.</li>
          ) : (
            labels.map((label, i) => (
              <li
                key={`${title}-${i}`}
                className="break-words border-l-2 border-indigo-200 pl-2 text-[10px] leading-snug text-slate-700"
              >
                {label}
              </li>
            ))
          )}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function PlanejamentoTurboWizard({
  scrapedOptions,
  unidadesTematicas: unidadesTematicasProp,
  unidadeAtiva: unidadeAtivaProp,
  onUnidadeTematicaChange,
  contextSubtitle,
  onInject,
  className,
}: PlanejamentoTurboWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [unidadeTematica, setUnidadeTematica] = useState("");

  const [searchSkill, setSearchSkill] = useState("");
  const [searchMatrix, setSearchMatrix] = useState("");
  const [searchContent, setSearchContent] = useState("");

  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [selectedMatrix, setSelectedMatrix] = useState<Set<string>>(new Set());
  const [selectedContents, setSelectedContents] = useState<Set<string>>(new Set());
  const [selectedMethods, setSelectedMethods] = useState<Set<string>>(new Set());
  const [customMethodologyText, setCustomMethodologyText] = useState("");
  const [selectedEvals, setSelectedEvals] = useState<Set<string>>(new Set());
  const [customEvaluationText, setCustomEvaluationText] = useState("");

  const [isMethodologyDrawerOpen, setIsMethodologyDrawerOpen] = useState(false);
  const [isEvaluationDrawerOpen, setIsEvaluationDrawerOpen] = useState(false);
  const [searchMethodDrawer, setSearchMethodDrawer] = useState("");
  const [searchEvalDrawer, setSearchEvalDrawer] = useState("");

  /** Opções para o Select (value + label a partir de `text`). */
  const unidadeTematicaOptions = useMemo(() => {
    const raw = unidadesTematicasProp ?? [];
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const o of raw) {
      const v = normalizeUtValue(o?.value);
      if (!o || v === "" || seen.has(v)) continue;
      seen.add(v);
      out.push({ value: v, label: (o.text || v).trim() });
    }
    return out;
  }, [unidadesTematicasProp]);

  useEffect(() => {
    const a = normalizeUtValue(unidadeAtivaProp);
    if (a) setUnidadeTematica(a);
  }, [unidadeAtivaProp]);

  useEffect(() => {
    setIsMethodologyDrawerOpen(false);
    setIsEvaluationDrawerOpen(false);
  }, [currentStep]);

  const handleUnidadeSelectChange = (value: string) => {
    const v = normalizeUtValue(value);
    setUnidadeTematica(v);
    if (v !== normalizeUtValue(unidadeAtivaProp) && onUnidadeTematicaChange) {
      onUnidadeTematicaChange(v);
    }
  };

  const itemsStep1 = useMemo(
    () => mergeItems(scrapedToWizardItems(scrapedOptions, CAT.skill), MOCK_SKILLS),
    [scrapedOptions],
  );
  const itemsStep2 = useMemo(
    () => mergeItems(scrapedToWizardItems(scrapedOptions, CAT.matrix), MOCK_MATRIX),
    [scrapedOptions],
  );
  const itemsStep3 = useMemo(
    () => mergeItems(scrapedToWizardItems(scrapedOptions, CAT.content), MOCK_CONTENTS),
    [scrapedOptions],
  );
  const itemsStep4 = useMemo(
    () => mergeItems(scrapedToWizardItems(scrapedOptions, CAT.method), MOCK_METHODOLOGIES),
    [scrapedOptions],
  );
  const itemsStep5 = useMemo(
    () => mergeItems(scrapedToWizardItems(scrapedOptions, CAT.eval), MOCK_EVALUATIONS),
    [scrapedOptions],
  );

  const filteredSkills = useMemo(() => {
    const q = searchSkill.trim().toLowerCase();
    if (!q) return itemsStep1;
    return itemsStep1.filter((it) => it.label.toLowerCase().includes(q));
  }, [itemsStep1, searchSkill]);

  const filteredMatrix = useMemo(() => {
    const q = searchMatrix.trim().toLowerCase();
    if (!q) return itemsStep2;
    return itemsStep2.filter((it) => it.label.toLowerCase().includes(q));
  }, [itemsStep2, searchMatrix]);

  const filteredContents = useMemo(() => {
    const q = searchContent.trim().toLowerCase();
    if (!q) return itemsStep3;
    return itemsStep3.filter((it) => it.label.toLowerCase().includes(q));
  }, [itemsStep3, searchContent]);

  const filteredMethodDrawer = useMemo(() => {
    const q = searchMethodDrawer.trim().toLowerCase();
    if (!q) return itemsStep4;
    return itemsStep4.filter((it) => it.label.toLowerCase().includes(q));
  }, [itemsStep4, searchMethodDrawer]);

  const filteredEvalDrawer = useMemo(() => {
    const q = searchEvalDrawer.trim().toLowerCase();
    if (!q) return itemsStep5;
    return itemsStep5.filter((it) => it.label.toLowerCase().includes(q));
  }, [itemsStep5, searchEvalDrawer]);

  const reviewSkillLabels = useMemo(
    () => itemsStep1.filter((it) => selectedSkills.has(it.id)).map((it) => it.label),
    [itemsStep1, selectedSkills],
  );
  const reviewMatrixLabels = useMemo(
    () => itemsStep2.filter((it) => selectedMatrix.has(it.id)).map((it) => it.label),
    [itemsStep2, selectedMatrix],
  );
  const reviewContentLabels = useMemo(
    () => itemsStep3.filter((it) => selectedContents.has(it.id)).map((it) => it.label),
    [itemsStep3, selectedContents],
  );
  const reviewMethodLabels = useMemo(
    () => itemsStep4.filter((it) => selectedMethods.has(it.id)).map((it) => it.label),
    [itemsStep4, selectedMethods],
  );
  const reviewEvalLabels = useMemo(
    () => itemsStep5.filter((it) => selectedEvals.has(it.id)).map((it) => it.label),
    [itemsStep5, selectedEvals],
  );

  const allItemsById = useMemo(() => {
    const map = new Map<string, WizardItem>();
    [...itemsStep1, ...itemsStep2, ...itemsStep3, ...itemsStep4, ...itemsStep5].forEach((it) => map.set(it.id, it));
    return map;
  }, [itemsStep1, itemsStep2, itemsStep3, itemsStep4, itemsStep5]);

  /**
   * Ordem determinística: categorias na sequência do planejamento; textos livres sempre no final
   * (evita que o postback sobrescreva o textarea após reload).
   */
  const buildInjectionPlan = useCallback((): { payloads: string[]; tasks: TurboInjectionTask[] } => {
    const payloads: string[] = [];
    const tasks: TurboInjectionTask[] = [];
    const mkId = () =>
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    const add = (label: string, payload: string) => {
      tasks.push({ id: mkId(), label });
      payloads.push(payload);
    };

    itemsStep1.forEach((it) => {
      if (selectedSkills.has(it.id) && it.postBackArg) add(`Habilidade: ${truncateTurboLabel(it.label, 40)}`, it.postBackArg);
    });
    itemsStep2.forEach((it) => {
      if (selectedMatrix.has(it.id) && it.postBackArg) add(`Matriz SAEB: ${truncateTurboLabel(it.label, 40)}`, it.postBackArg);
    });
    itemsStep3.forEach((it) => {
      if (selectedContents.has(it.id) && it.postBackArg) add(`Conteúdo: ${truncateTurboLabel(it.label, 40)}`, it.postBackArg);
    });
    itemsStep4.forEach((it) => {
      if (selectedMethods.has(it.id) && it.postBackArg) add(`Metodologia (SIAP): ${truncateTurboLabel(it.label, 40)}`, it.postBackArg);
    });
    itemsStep5.forEach((it) => {
      if (selectedEvals.has(it.id) && it.postBackArg) add(`Avaliação (SIAP): ${truncateTurboLabel(it.label, 40)}`, it.postBackArg);
    });

    const mt = customMethodologyText.trim();
    const ev = customEvaluationText.trim();
    if (mt) add("Texto livre: Metodologia", `INJECT_TEXT_METODOLOGIA|||${mt}`);
    if (ev) add("Texto livre: Avaliação", `INJECT_TEXT_AVALIACAO|||${ev}`);

    return { payloads, tasks };
  }, [
    itemsStep1,
    itemsStep2,
    itemsStep3,
    itemsStep4,
    itemsStep5,
    selectedSkills,
    selectedMatrix,
    selectedContents,
    selectedMethods,
    selectedEvals,
    customMethodologyText,
    customEvaluationText,
  ]);

  const toggle = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const unidadeLabelDisplay = useMemo(() => {
    const u = normalizeUtValue(unidadeTematica);
    const hit = unidadeTematicaOptions.find((o) => normalizeUtValue(o.value) === u);
    return hit?.label ?? unidadeTematica;
  }, [unidadeTematicaOptions, unidadeTematica]);

  const canAdvanceFromIntro = useMemo(() => {
    const u = normalizeUtValue(unidadeTematica);
    if (!u) return false;
    if (unidadeTematicaOptions.length === 0) {
      return normalizeUtValue(unidadeAtivaProp) === u;
    }
    return unidadeTematicaOptions.some((o) => normalizeUtValue(o.value) === u);
  }, [unidadeTematica, unidadeTematicaOptions, unidadeAtivaProp]);

  const progressIndex = currentStep; // 0..6

  const handleNext = () => {
    if (currentStep === 0 && !canAdvanceFromIntro) return;
    if (currentStep < 6) setCurrentStep((s) => s + 1);
  };

  const handleBack = () => {
    if (currentStep === 4 && isMethodologyDrawerOpen) {
      setIsMethodologyDrawerOpen(false);
      return;
    }
    if (currentStep === 5 && isEvaluationDrawerOpen) {
      setIsEvaluationDrawerOpen(false);
      return;
    }
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  };

  const handleInject = () => {
    const plan = buildInjectionPlan();
    if (plan.payloads.length === 0) {
      toast.error("Marque itens com ação no SIAP, preencha texto livre em Metodologia/Avaliação ou use dados mock.");
      return;
    }
    onInject(plan);
  };

  const injectPlan = buildInjectionPlan();

  const renderCheckboxList = (items: WizardItem[], selected: Set<string>, update: (s: Set<string>) => void) => (
    <div className="space-y-2 pr-1">
      {items.map((it) => (
        <label
          key={it.id}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50/30",
            selected.has(it.id) && "border-indigo-300 bg-indigo-50/50",
          )}
        >
          <Checkbox
            checked={selected.has(it.id)}
            onCheckedChange={() => toggle(selected, it.id, update)}
            className="mt-0.5 shrink-0"
          />
          <span className="min-w-0 flex-1 break-words text-[11px] leading-snug text-slate-800">{it.label}</span>
        </label>
      ))}
    </div>
  );

  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xl",
        className,
      )}
      style={{ maxHeight: "min(720px, calc(100vh - 100px))" }}
    >
      {/* Cabeçalho fixo */}
      <div className="shrink-0 border-b border-slate-100 bg-white px-3 pb-3 pt-3 sm:px-4 sm:pt-4">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[13px] font-black uppercase tracking-tight text-indigo-950">Planejamento Turbo</h2>
            {contextSubtitle ? (
              <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">{contextSubtitle}</p>
            ) : null}
          </div>
        </div>
        {/* Indicador de progresso: 7 segmentos (unidade + 6 passos) */}
        <div className="mt-3 flex gap-1">
          {Array.from({ length: TOTAL_PROGRESS }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i <= progressIndex ? "bg-indigo-600" : "bg-slate-200",
              )}
            />
          ))}
        </div>
      </div>

      {/* Unidade temática — sempre visível no topo (fora do cartão por etapa, mas dentro do painel) */}
      <div className="shrink-0 border-b border-slate-100 bg-slate-50/80 px-3 py-3 sm:px-4">
        <Label htmlFor="unidade-tematica" className="text-[10px] font-black uppercase tracking-widest text-slate-600">
          Unidade temática
        </Label>
        {unidadeTematicaOptions.length > 0 ? (
          <Select
            value={unidadeTematica || undefined}
            onValueChange={handleUnidadeSelectChange}
            disabled={currentStep > 0}
          >
            <SelectTrigger
              id="unidade-tematica"
              className="mt-1.5 h-9 w-full min-w-0 max-w-full border-slate-200 text-left text-xs font-medium"
            >
              <SelectValue placeholder="Escolha a unidade (lista do SIAP)" />
            </SelectTrigger>
            <SelectContent
              position="popper"
              className="z-[100] max-h-[min(280px,50vh)] w-[var(--radix-select-trigger-width)] max-w-[min(100%,360px)]"
            >
              {unidadeTematicaOptions.map((opt, idx) => (
                <SelectItem key={`${idx}-${opt.value}`} value={opt.value} className="text-xs">
                  <span className="line-clamp-3 break-words">{opt.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50/80 px-2 py-2 text-[10px] font-medium leading-snug text-amber-950">
            Não foi possível ler o <span className="font-mono">ddlEixo</span> no SIAP. Abra a edição do planejamento da aula e atualize o painel.
          </p>
        )}
        {currentStep > 0 && unidadeTematica.trim() ? (
          <p className="mt-1.5 truncate text-[10px] font-semibold text-indigo-700" title={unidadeLabelDisplay}>
            {unidadeLabelDisplay}
          </p>
        ) : null}
      </div>

      {/* Uma única coluna com scroll: cabeçalho da etapa fixo + lista rolável */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          key={currentStep}
          className="flex min-h-0 flex-1 flex-col overflow-hidden animate-in fade-in slide-in-from-right-2 duration-200"
        >
          {currentStep === 0 && (
            <div className="flex flex-1 flex-col justify-center overflow-y-auto custom-scrollbar px-3 py-5 text-center sm:px-4">
              <p className="break-words text-[11px] font-medium leading-relaxed text-slate-600">
                Escolha a <strong className="text-slate-900">unidade temática</strong> acima e clique em{" "}
                <strong className="text-indigo-700">Próximo</strong> para continuar.
              </p>
              <p className="mt-3 break-words text-[10px] leading-relaxed text-slate-500">
                As caixas azuis do SIAP (Habilidades, Matriz, Conteúdos) só são preenchidas no fim do fluxo, ao clicar em{" "}
                <strong className="text-slate-700">Injetar no SIAP</strong> — não ao escolher a unidade aqui.
              </p>
            </div>
          )}

          {currentStep === 1 && (
            <>
              <div className="shrink-0 space-y-2 border-b border-slate-100 bg-white px-3 py-3 sm:px-4">
                <h3 className="text-sm font-black text-indigo-950">Habilidades</h3>
                <p className="text-[10px] font-medium text-slate-500">Selecione as habilidades focais desta aula.</p>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={searchSkill}
                    onChange={(e) => setSearchSkill(e.target.value)}
                    placeholder="Buscar habilidade (ex: EF69LP02)…"
                    className="h-9 border-slate-200 pl-8 text-xs"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 custom-scrollbar">
                {renderCheckboxList(filteredSkills, selectedSkills, setSelectedSkills)}
              </div>
            </>
          )}

          {currentStep === 2 && (
            <>
              <div className="shrink-0 space-y-2 border-b border-slate-100 bg-white px-3 py-3 sm:px-4">
                <h3 className="text-sm font-black text-indigo-950">Matriz</h3>
                <p className="text-[10px] font-medium text-slate-500">Descritores SAEB e correlatos.</p>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={searchMatrix}
                    onChange={(e) => setSearchMatrix(e.target.value)}
                    placeholder="Buscar descritores (ex: D1, inferir)…"
                    className="h-9 border-slate-200 pl-8 text-xs"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 custom-scrollbar">
                {renderCheckboxList(filteredMatrix, selectedMatrix, setSelectedMatrix)}
              </div>
            </>
          )}

          {currentStep === 3 && (
            <>
              <div className="shrink-0 space-y-2 border-b border-slate-100 bg-white px-3 py-3 sm:px-4">
                <h3 className="text-sm font-black text-indigo-950">Conteúdo</h3>
                <p className="text-[10px] font-medium text-slate-500">Objetos de conhecimento / conteúdos.</p>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={searchContent}
                    onChange={(e) => setSearchContent(e.target.value)}
                    placeholder="Buscar conteúdo…"
                    className="h-9 border-slate-200 pl-8 text-xs"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 custom-scrollbar">
                {renderCheckboxList(filteredContents, selectedContents, setSelectedContents)}
              </div>
            </>
          )}

          {currentStep === 4 && (
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3 sm:px-4">
                <div>
                  <h3 className="text-sm font-black text-indigo-950">Metodologia</h3>
                  <p className="mt-0.5 text-[10px] font-medium leading-snug text-slate-500">
                    Combine itens do SIAP com sua descrição livre. Abra a lista quando precisar marcar opções na árvore.
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="h-auto w-full justify-center gap-2 border-indigo-200 bg-indigo-50 py-2.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 hover:text-indigo-900"
                  onClick={() => setIsMethodologyDrawerOpen(true)}
                >
                  Explorar lista do SIAP
                  {selectedMethods.size > 0 ? (
                    <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-black text-white">
                      {selectedMethods.size}
                    </span>
                  ) : null}
                </Button>

                <div className="min-h-[2.5rem] max-h-24 overflow-y-auto custom-scrollbar">
                  {selectedMethods.size === 0 ? (
                    <p className="text-[10px] text-slate-400">Nenhum item da lista ainda.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(selectedMethods).map((id) => {
                        const it = itemsStep4.find((x) => x.id === id);
                        if (!it) return null;
                        return (
                          <span
                            key={id}
                            className="inline-flex max-w-full items-center gap-1 rounded-full border border-indigo-200 bg-white pl-2 pr-0.5 py-0.5 text-[10px] font-medium text-indigo-900 shadow-sm"
                          >
                            <span className="min-w-0 max-w-[240px] truncate">{it.label}</span>
                            <button
                              type="button"
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-indigo-600 hover:bg-indigo-100 hover:text-indigo-950"
                              aria-label="Remover"
                              onClick={() => toggle(selectedMethods, id, setSelectedMethods)}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor="metodologia-livre" className="text-[10px] font-black uppercase tracking-wide text-slate-600">
                    Metodologia em texto livre
                  </Label>
                  <Textarea
                    id="metodologia-livre"
                    value={customMethodologyText}
                    onChange={(e) => setCustomMethodologyText(e.target.value)}
                    placeholder="Descreva como será conduzida a aula (estratégias, momentos, agrupamentos…)"
                    className="min-h-[120px] flex-1 resize-none border-slate-200 text-xs leading-relaxed"
                  />
                </div>
              </div>

              <div
                role="presentation"
                className={cn(
                  "absolute inset-0 z-40 bg-slate-900/25 transition-opacity duration-300",
                  isMethodologyDrawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
                )}
                onClick={() => setIsMethodologyDrawerOpen(false)}
              />

              <div
                className={cn(
                  "absolute inset-x-0 bottom-0 top-12 z-50 flex flex-col rounded-t-2xl bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.15)] transition-transform duration-300 ease-in-out",
                  isMethodologyDrawerOpen ? "translate-y-0" : "pointer-events-none translate-y-full",
                )}
              >
                <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300" aria-hidden />
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                  <h4 className="text-[12px] font-black text-indigo-950">Lista do SIAP — Metodologias</h4>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[10px] font-black uppercase"
                    onClick={() => setIsMethodologyDrawerOpen(false)}
                  >
                    Concluído
                  </Button>
                </div>
                <div className="shrink-0 border-b border-slate-50 px-3 py-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={searchMethodDrawer}
                      onChange={(e) => setSearchMethodDrawer(e.target.value)}
                      placeholder="Buscar na lista…"
                      className="h-9 border-slate-200 pl-8 text-xs"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 custom-scrollbar">
                  {renderCheckboxList(filteredMethodDrawer, selectedMethods, setSelectedMethods)}
                </div>
              </div>
            </div>
          )}

          {currentStep === 5 && (
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3 sm:px-4">
                <div>
                  <h3 className="text-sm font-black text-indigo-950">Avaliação</h3>
                  <p className="mt-0.5 text-[10px] font-medium leading-snug text-slate-500">
                    Escolha instrumentos do SIAP e registre observações ou critérios em texto livre.
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="h-auto w-full justify-center gap-2 border-indigo-200 bg-indigo-50 py-2.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 hover:text-indigo-900"
                  onClick={() => setIsEvaluationDrawerOpen(true)}
                >
                  Explorar lista do SIAP
                  {selectedEvals.size > 0 ? (
                    <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-black text-white">
                      {selectedEvals.size}
                    </span>
                  ) : null}
                </Button>

                <div className="min-h-[2.5rem] max-h-24 overflow-y-auto custom-scrollbar">
                  {selectedEvals.size === 0 ? (
                    <p className="text-[10px] text-slate-400">Nenhum item da lista ainda.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(selectedEvals).map((id) => {
                        const it = itemsStep5.find((x) => x.id === id);
                        if (!it) return null;
                        return (
                          <span
                            key={id}
                            className="inline-flex max-w-full items-center gap-1 rounded-full border border-indigo-200 bg-white pl-2 pr-0.5 py-0.5 text-[10px] font-medium text-indigo-900 shadow-sm"
                          >
                            <span className="min-w-0 max-w-[240px] truncate">{it.label}</span>
                            <button
                              type="button"
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-indigo-600 hover:bg-indigo-100 hover:text-indigo-950"
                              aria-label="Remover"
                              onClick={() => toggle(selectedEvals, id, setSelectedEvals)}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor="avaliacao-livre" className="text-[10px] font-black uppercase tracking-wide text-slate-600">
                    Avaliação em texto livre
                  </Label>
                  <Textarea
                    id="avaliacao-livre"
                    value={customEvaluationText}
                    onChange={(e) => setCustomEvaluationText(e.target.value)}
                    placeholder="Critérios, instrumentos complementares, observações para a turma…"
                    className="min-h-[120px] flex-1 resize-none border-slate-200 text-xs leading-relaxed"
                  />
                </div>
              </div>

              <div
                role="presentation"
                className={cn(
                  "absolute inset-0 z-40 bg-slate-900/25 transition-opacity duration-300",
                  isEvaluationDrawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
                )}
                onClick={() => setIsEvaluationDrawerOpen(false)}
              />

              <div
                className={cn(
                  "absolute inset-x-0 bottom-0 top-12 z-50 flex flex-col rounded-t-2xl bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.15)] transition-transform duration-300 ease-in-out",
                  isEvaluationDrawerOpen ? "translate-y-0" : "pointer-events-none translate-y-full",
                )}
              >
                <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300" aria-hidden />
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                  <h4 className="text-[12px] font-black text-indigo-950">Lista do SIAP — Avaliações</h4>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[10px] font-black uppercase"
                    onClick={() => setIsEvaluationDrawerOpen(false)}
                  >
                    Concluído
                  </Button>
                </div>
                <div className="shrink-0 border-b border-slate-50 px-3 py-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={searchEvalDrawer}
                      onChange={(e) => setSearchEvalDrawer(e.target.value)}
                      placeholder="Buscar na lista…"
                      className="h-9 border-slate-200 pl-8 text-xs"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 custom-scrollbar">
                  {renderCheckboxList(filteredEvalDrawer, selectedEvals, setSelectedEvals)}
                </div>
              </div>
            </div>
          )}

          {currentStep === 6 && (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 custom-scrollbar">
              <div className="space-y-3">
                <h3 className="text-sm font-black text-indigo-950">Revisão</h3>
                <p className="text-[10px] text-slate-600">
                  Confira os totais e abra cada bloco para ver o texto completo dos itens marcados.
                </p>

                <div className="rounded-lg border border-slate-200 bg-slate-50/90 px-2.5 py-2 text-[11px]">
                  <div className="flex justify-between gap-2">
                    <span className="shrink-0 font-semibold text-slate-600">Unidade temática</span>
                    <span className="min-w-0 max-w-[70%] text-right text-[10px] font-medium leading-snug text-slate-900 break-words">
                      {unidadeLabelDisplay || "—"}
                    </span>
                  </div>
                </div>

                <ReviewSection
                  title="Habilidades"
                  count={selectedSkills.size}
                  labels={reviewSkillLabels}
                />
                <ReviewSection
                  title="Matriz SAEB"
                  count={selectedMatrix.size}
                  labels={reviewMatrixLabels}
                />
                <ReviewSection
                  title="Conteúdos"
                  count={selectedContents.size}
                  labels={reviewContentLabels}
                />

                <Collapsible className="group rounded-lg border border-slate-200 bg-white shadow-sm">
                  <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left hover:bg-slate-50/80">
                    <span className="min-w-0 flex-1 text-[11px] font-semibold text-slate-700">Metodologia</span>
                    <span className="shrink-0 text-[11px] font-black text-indigo-700">
                      {selectedMethods.size + (customMethodologyText.trim() ? 1 : 0)}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-t border-slate-100 px-2.5 py-2">
                    <ul className="space-y-2 text-[10px] leading-snug text-slate-700">
                      {reviewMethodLabels.length === 0 && !customMethodologyText.trim() ? (
                        <li className="text-slate-400">Nenhuma metodologia selecionada.</li>
                      ) : null}
                      {reviewMethodLabels.map((label, i) => (
                        <li key={`m-${i}`} className="break-words border-l-2 border-indigo-200 pl-2">
                          {label}
                        </li>
                      ))}
                      {customMethodologyText.trim() ? (
                        <li className="break-words border-l-2 border-violet-200 pl-2 text-slate-800">
                          <span className="font-semibold text-slate-600">Personalizado: </span>
                          {customMethodologyText.trim()}
                        </li>
                      ) : null}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible className="group rounded-lg border border-slate-200 bg-white shadow-sm">
                  <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left hover:bg-slate-50/80">
                    <span className="min-w-0 flex-1 text-[11px] font-semibold text-slate-700">Avaliações</span>
                    <span className="shrink-0 text-[11px] font-black text-indigo-700">
                      {selectedEvals.size + (customEvaluationText.trim() ? 1 : 0)}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-t border-slate-100 px-2.5 py-2">
                    <ul className="space-y-2 text-[10px] leading-snug text-slate-700">
                      {reviewEvalLabels.length === 0 && !customEvaluationText.trim() ? (
                        <li className="text-slate-400">Nenhuma avaliação selecionada.</li>
                      ) : null}
                      {reviewEvalLabels.map((label, i) => (
                        <li key={`e-${i}`} className="break-words border-l-2 border-indigo-200 pl-2">
                          {label}
                        </li>
                      ))}
                      {customEvaluationText.trim() ? (
                        <li className="break-words border-l-2 border-violet-200 pl-2 text-slate-800">
                          <span className="font-semibold text-slate-600">Texto livre: </span>
                          {customEvaluationText.trim()}
                        </li>
                      ) : null}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>

                <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/50 px-2.5 py-2">
                  <div className="flex justify-between gap-2 text-[11px]">
                    <span className="font-semibold text-emerald-900">Itens na fila</span>
                    <span className="font-black text-emerald-700">{injectPlan.payloads.length}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Barra de ações fixa */}
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-200 bg-white px-3 py-2.5 sm:px-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-w-0 px-2 text-[10px] font-bold sm:text-xs"
          onClick={handleBack}
          disabled={currentStep === 0}
        >
          Voltar
        </Button>
        {currentStep < 6 ? (
          <Button
            type="button"
            size="sm"
            className="min-w-0 bg-indigo-600 px-2 text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 sm:px-3 sm:text-xs"
            onClick={handleNext}
            disabled={
              (currentStep === 0 && !canAdvanceFromIntro) ||
              (currentStep === 4 && isMethodologyDrawerOpen) ||
              (currentStep === 5 && isEvaluationDrawerOpen)
            }
          >
            Próximo
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="min-w-0 bg-violet-600 px-2 text-[10px] font-black uppercase tracking-tight hover:bg-violet-700 sm:px-3 sm:text-xs"
            onClick={handleInject}
            disabled={injectPlan.payloads.length === 0}
          >
            Injetar no SIAP
          </Button>
        )}
      </div>
    </div>
  );
}
