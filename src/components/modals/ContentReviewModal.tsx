import React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FileCheck2, Loader2, Save as SaveIcon, Zap } from "lucide-react";

interface ContentReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  executionProgress: {
    current: number;
    total: number;
  };
  handleFinalSave: () => void;
  onClose: () => void;
}

export const ContentReviewModal: React.FC<ContentReviewModalProps> = ({
  open,
  onOpenChange,
  executionProgress,
  handleFinalSave,
  onClose,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                  style={{ width: `${executionProgress.total > 1 ? (executionProgress.current / executionProgress.total) * 100 : executionProgress.current === executionProgress.total ? 100 : 0}%` }}
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
              onClick={onClose}
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
  );
};
