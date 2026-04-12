import React from "react";
import { 
  ChevronLeft, 
  ChevronRight, 
  Loader2, 
  CalendarDays, 
  Search, 
  ArrowRight, 
  Mic, 
  Camera, 
  Upload, 
  Image as ImageIcon, 
  XCircle 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PautaCameraVisionDialog } from "@/components/PautaCameraVisionDialog";
import DropZone from "@/components/DropZone";

type SiapPendingDayEntry = number | { day: number; dataCanonica?: string | null };

function siapDayEntryDay(d: SiapPendingDayEntry): number {
  return typeof d === "number" ? d : d.day;
}

function siapDayEntryCanon(d: SiapPendingDayEntry): string | undefined {
  if (typeof d === "number") return undefined;
  const c = d.dataCanonica;
  return c ? String(c) : undefined;
}

interface FrequencyTabProps {
  activeTab: string;
  isSyncingMonth: boolean;
  isSyncingDay: boolean;
  pageStats: any;
  selectedDay: string;
  selectedDayNumber: number | null;
  isGhostMode: boolean;
  searchStudent: string;
  filteredStudents: any[];
  isListening: boolean;
  transcriptData: string;
  voiceSuggestions: any[];
  uploadedImages: string[];
  isViewerOpen: boolean;
  pautaCameraOpen: boolean;
  diaPautaGemini: string;
  onMudarMesLocal: (direcao: "anterior" | "proximo") => void;
  onDayClick: (day: number, month: number, year: number, canon: string | null) => void;
  onSearchStudentChange: (val: string) => void;
  onSearchKeyDown: (e: React.KeyboardEvent) => void;
  onStudentClick: (s: any) => void;
  onToggleVoiceCommand: () => void;
  onResolveAmbiguity: (s: any, idx: number) => void;
  onSetPautaCameraOpen: (open: boolean) => void;
  onPautaVisionAbsences: (numbers: number[]) => void;
  onToggleViewer: () => void;
  onRemoveImage: (idx: number) => void;
  onFilesSelected: (files: File[]) => void;
}

export const FrequencyTab: React.FC<FrequencyTabProps> = ({
  activeTab,
  isSyncingMonth,
  isSyncingDay,
  pageStats,
  selectedDay,
  selectedDayNumber,
  isGhostMode,
  searchStudent,
  filteredStudents,
  isListening,
  transcriptData,
  voiceSuggestions,
  uploadedImages,
  isViewerOpen,
  pautaCameraOpen,
  diaPautaGemini,
  onMudarMesLocal,
  onDayClick,
  onSearchStudentChange,
  onSearchKeyDown,
  onStudentClick,
  onToggleVoiceCommand,
  onResolveAmbiguity,
  onSetPautaCameraOpen,
  onPautaVisionAbsences,
  onToggleViewer,
  onRemoveImage,
  onFilesSelected,
}) => {
  if (activeTab !== "frequencia" && activeTab !== "conteudo") return null;

  return (
    <div className="p-4 rounded-[1.5rem] border bg-white border-slate-200 shadow-sm transition-all duration-500 tour-step-calendario animate-in fade-in slide-in-from-top-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-4 w-4 rounded-full flex items-center justify-center border bg-emerald-100 border-emerald-200">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
        </div>
        <h2 className="text-sm font-bold text-slate-950 uppercase tracking-tight">Calendário SIAP</h2>
      </div>

      {/* Bloco de Calendário */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 mb-4 rounded-xl border border-slate-200 bg-gradient-to-r from-indigo-50/60 via-white to-white px-1.5 py-1.5 shadow-sm">
          <button
            type="button"
            disabled={isSyncingMonth}
            onClick={() => onMudarMesLocal("anterior")}
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
            onClick={() => onMudarMesLocal("proximo")}
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
                            onClick={() => onDayClick(d, m.month, m.year, canon ?? null)}
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
      
      {/* Controles de Lançamento (Apenas na aba frequência) */}
      {activeTab === "frequencia" && (selectedDay || isGhostMode) && pageStats?.students && (
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
              <input 
                type="text" 
                className="w-full h-11 pl-10 pr-4 bg-slate-50 border-2 border-slate-100 rounded-xl text-sm font-medium placeholder:text-slate-300 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all" 
                placeholder="Buscar aluno ou digite números e dê Enter (ex: 1, 4, 7)..." 
                value={searchStudent} 
                onChange={(e) => onSearchStudentChange(e.target.value)} 
                onKeyDown={onSearchKeyDown} 
              />
              {searchStudent && filteredStudents.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-slate-200 rounded-xl shadow-2xl z-50 max-h-48 overflow-y-auto custom-scrollbar ring-8 ring-slate-900/5">
                  {filteredStudents.map((s: any) => (
                    <button key={s.matricula} onClick={() => onStudentClick(s)} className="w-full p-3 text-left text-xs hover:bg-indigo-50 border-b border-slate-50 last:border-0 transition-all flex items-center gap-3 group">
                      <span className="font-black text-slate-300 min-w-[20px] group-hover:text-indigo-400">{s.number}.</span>
                      <span className="truncate flex-1 font-bold text-slate-700 group-hover:text-indigo-900">{s.name}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-200 group-hover:text-indigo-500 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="my-3 flex items-center gap-2 px-1">
            <div className="h-[1px] flex-1 bg-slate-100"></div>
            <span className="text-[9px] font-black text-slate-300 uppercase">Ou use IA Turbo</span>
            <div className="h-[1px] flex-1 bg-slate-100"></div>
          </div>

          <div className="grid gap-3">
            <div className="tour-step-voz relative">
              <button 
                onClick={onToggleVoiceCommand} 
                className={`w-full group relative overflow-hidden p-4 rounded-xl border-2 transition-all active:scale-95 ${isListening ? 'bg-rose-50 border-rose-500 ring-4 ring-rose-100' : 'bg-white border-slate-100 hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-50/50'}`}
              >
                <div className="flex items-center gap-4">
                  <div className={`p-4 rounded-xl transition-all duration-500 ${isListening ? 'bg-rose-500 animate-pulse' : 'bg-slate-50 group-hover:bg-indigo-50'}`}>
                    <Mic className={`w-8 h-8 ${isListening ? 'text-white' : 'text-indigo-500 group-hover:scale-110'}`} />
                  </div>
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
                <div className="mt-2 p-3 bg-white border-2 border-indigo-100 rounded-xl shadow-lg animate-in slide-in-from-top-2">
                  <p className="text-[9px] font-black text-indigo-400 uppercase mb-2">Quem você quis dizer?</p>
                  <div className="space-y-1.5">
                    {voiceSuggestions.map((group, groupIdx) => (
                      <div key={groupIdx} className="flex flex-wrap gap-1.5">
                        {group.matches.map((s: any) => (
                          <button 
                            key={s.matricula} 
                            onClick={() => onResolveAmbiguity(s, groupIdx)} 
                            className="px-2 py-1 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded-lg border border-indigo-100 hover:bg-indigo-600 hover:text-white transition-all"
                          >
                            {s.number}. {s.name.split(' ')[0]}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => onSetPautaCameraOpen(true)}
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

            <div className="tour-step-upload p-4 bg-white rounded-xl border-2 border-slate-100 space-y-3">
              <div className="flex items-center gap-2 px-1">
                <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest leading-none">
                  Imagens da Chamada ({uploadedImages.length})
                </span>
                {uploadedImages.length > 0 && (
                  <button onClick={onToggleViewer} className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-rose-600 text-white rounded-lg text-[9px] font-black uppercase hover:bg-rose-700 transition-all shadow-sm">
                    {isViewerOpen ? 'Fechar' : 'Abrir'}
                  </button>
                )}
              </div>
              {uploadedImages.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                  {uploadedImages.map((img, idx) => (
                    <div key={idx} className="relative flex-none group">
                      <img src={img} className="w-14 h-14 rounded-xl object-cover border border-slate-200 shadow-sm" />
                      <button onClick={() => onRemoveImage(idx)} className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <XCircle className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <DropZone onFilesSelected={onFilesSelected} disabled={!selectedDay && !isGhostMode} />
            </div>
          </div>
        </div>
      )}

      <PautaCameraVisionDialog
        open={pautaCameraOpen}
        onOpenChange={onSetPautaCameraOpen}
        students={pageStats?.students ?? []}
        diaSelecionado={diaPautaGemini}
        disabled={(!selectedDay && !isGhostMode) || !pageStats?.students?.length}
        onAbsenceNumbersDetected={onPautaVisionAbsences}
      />
    </div>
  );
};

