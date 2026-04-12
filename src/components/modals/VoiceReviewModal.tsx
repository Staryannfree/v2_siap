import React from "react";
import { Mic, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface VoiceReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDay: string;
  pageStats: any;
  studentsDetectedByVoice: any[];
  setStudentsDetectedByVoice: React.Dispatch<React.SetStateAction<any[]>>;
  onConfirm: () => void;
}

export const VoiceReviewModal: React.FC<VoiceReviewModalProps> = ({
  isOpen,
  onClose,
  selectedDay,
  pageStats,
  studentsDetectedByVoice,
  setStudentsDetectedByVoice,
  onConfirm,
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md border-2 border-indigo-100 shadow-2xl rounded-3xl">
        <DialogHeader className="space-y-3">
          <div className="mx-auto w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center mb-2">
            <Mic className="w-6 h-6 text-indigo-600" />
          </div>
          <DialogTitle className="text-xl font-black text-slate-900 text-center uppercase tracking-tight">
            📝 Resumo do Lançamento por Voz
          </DialogTitle>
          <DialogDescription className="text-center space-y-1" asChild>
            <div className="flex flex-col items-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-full border border-slate-100 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                {selectedDay ? `Dia ${selectedDay}` : 'Hoje'} • {pageStats?.turma || 'Turma não identificada'}
              </div>
              <p className="text-xs text-slate-400 font-medium mt-1">Revisão de faltas detectadas pelo sistema de áudio.</p>
            </div>
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
            onClick={() => { onClose(); setStudentsDetectedByVoice([]); }}
            className="w-full sm:flex-1 h-12 rounded-2xl border-2 border-slate-100 font-black uppercase text-[10px] tracking-widest text-slate-400 hover:bg-slate-50"
          >
            Cancelar / Editar
          </Button>
          <Button 
            onClick={onConfirm}
            className="w-full sm:flex-1 h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-[10px] tracking-widest shadow-lg shadow-indigo-100 transition-all active:scale-95"
          >
            ✅ Confirmar e Lançar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
