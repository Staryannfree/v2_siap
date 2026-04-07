import { X, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StudentAbsence } from "@/lib/mock-api";

interface AbsenceListProps {
  absences: StudentAbsence[];
  onRemove: (numero: number) => void;
  onToggleConfirm?: (numero: number) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  onWhatsAppReport?: () => void;
}

const AbsenceList = ({
  absences,
  onRemove,
  onToggleConfirm,
  onSubmit,
  isSubmitting,
  onWhatsAppReport,
}: AbsenceListProps) => {
  return (
    <div className="space-y-4 flex flex-col h-full">
      <div className="flex items-center gap-2">
        <UserX className="h-4 w-4 text-rose-500" />
        <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight">
          Alunos com falta ({absences.length})
        </h2>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
        {absences.map((student) => (
          <div
            key={student.numero}
            className={`flex items-center justify-between rounded-xl border px-3 py-2.5 group transition-all duration-200 ${
              student.confirmed === false 
                ? "bg-slate-50 border-dashed border-slate-200 opacity-60" 
                : "bg-white border-slate-100 hover:border-indigo-300 hover:shadow-sm"
            }`}
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={student.confirmed !== false}
                onChange={() => onToggleConfirm?.(student.numero)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20 cursor-pointer"
              />
              <div className="flex items-center gap-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-lg text-[10px] font-bold transition-colors ${student.confirmed === false ? 'bg-slate-100 text-slate-400' : 'bg-indigo-50 text-indigo-600'}`}>
                  {student.numero}
                </span>
                <span className={`text-xs font-bold tracking-tight ${student.confirmed === false ? "line-through text-slate-400" : "text-slate-700"}`}>
                  {student.nome}
                </span>
              </div>
            </div>
            <button
              onClick={() => onRemove(student.numero)}
              className="rounded-lg p-1.5 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600 transition-all active:scale-95"
              title="Remover da lista"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {absences.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 opacity-40">
            <UserX className="h-10 w-10 text-slate-300 mb-2" />
            <p className="text-center text-[10px] font-black uppercase tracking-widest text-slate-400">
              Nenhuma falta marcada
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {onWhatsAppReport && (
          <Button
            onClick={onWhatsAppReport}
            variant="outline"
            className="flex-1 h-11 rounded-xl font-black text-[10px] border-2 border-slate-100 text-slate-600 bg-white hover:bg-slate-50 hover:border-indigo-200 transition-all uppercase tracking-widest"
          >
            📋 Copiar Relatório
          </Button>
        )}
        <Button
          onClick={onSubmit}
          disabled={absences.length === 0 || isSubmitting}
          className="flex-[1.5] h-11 rounded-xl font-black text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-100 transition-all active:scale-[0.98] uppercase tracking-widest"
          size="lg"
        >
          {isSubmitting ? "Processando..." : "Finalizar Lançamento"}
        </Button>
      </div>
    </div>
  );
};

export default AbsenceList;
