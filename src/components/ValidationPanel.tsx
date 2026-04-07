import { useState, useRef, useEffect } from "react";
import { ZoomIn, ZoomOut, Maximize, CheckCircle2, Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import AbsenceList from "./AbsenceList";
import type { StudentAbsence } from "@/lib/mock-api";

interface ValidationPanelProps {
  imageSource: string;
  absences: StudentAbsence[];
  onRemove: (numero: number) => void;
  onToggleConfirm: (numero: number) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  turma?: string;
  disciplina?: string;
  data?: string;
  isGhostMode?: boolean;
  onExitGhostMode?: () => void;
}

const ValidationPanel = ({
  imageSource,
  absences,
  onRemove,
  onToggleConfirm,
  onSubmit,
  isSubmitting,
  turma,
  disciplina,
  data,
  isGhostMode,
  onExitGhostMode,
}: ValidationPanelProps) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [showCelebration, setShowCelebration] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.2, 3));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.2, 0.5));
  const handleResetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale === 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleSubmit = () => {
    if (isGhostMode) {
      setIsSimulating(true);
      setTimeout(() => {
        setIsSimulating(false);
        setShowCelebration(true);
      }, 1200);
    } else {
      onSubmit();
    }
  };

  const generateWhatsAppReport = () => {
    const activeAbsences = absences.filter(a => a.confirmed !== false);
    const reportDate = data || new Date().toLocaleDateString('pt-BR');
    
    const report = 
`📅 *Relatório de Faltas*
🏫 Turma: *${turma || 'Não informada'}*
📚 Disciplina: *${disciplina || 'Não informada'}*
📆 Data: ${reportDate}

*Alunos Ausentes:*
${activeAbsences.length > 0 
  ? activeAbsences.map(a => `${a.numero}. ${a.nome}`).join('\n')
  : '_Nenhuma falta registrada._'}

🛑 *Total:* ${activeAbsences.length} faltas`;

    navigator.clipboard.writeText(report).then(() => {
      import('sonner').then(({ toast }) => {
        toast.success('Relatório copiado! Cole no WhatsApp da coordenação.');
      });
    });
  };

  return (
    <div className="flex flex-col gap-4 relative">
      {/* Ghost Mode Success Modal */}
      {showCelebration && (
        <div className="absolute inset-0 z-[100] bg-white/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in duration-300 rounded-2xl border-4 border-indigo-100 shadow-2xl">
          <div className="relative mb-4">
             <div className="absolute -inset-4 bg-indigo-100 rounded-full animate-ping opacity-20"></div>
             <div className="relative w-20 h-20 bg-indigo-600 rounded-full flex items-center justify-center shadow-lg shadow-indigo-200">
                <CheckCircle2 className="w-10 h-10 text-white" />
             </div>
             <Sparkles className="absolute -top-2 -right-2 w-8 h-8 text-amber-400 animate-bounce" />
          </div>
          
          <div className="space-y-2 mb-6">
            <h2 className="text-2xl font-black text-indigo-950">🎉 Teste Concluído!</h2>
            <p className="text-sm text-indigo-800 font-medium leading-relaxed px-2">
              Na vida real, o <span className="font-black">SIAP</span> já estaria preenchido e as faltas lançadas automaticamente.
            </p>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 rounded-full border border-indigo-100 mt-2">
              <ShieldCheck className="w-3 h-3 text-indigo-600" />
              <span className="text-[10px] font-black text-indigo-600 uppercase tracking-wider">Nada foi salvo no SIAP oficial</span>
            </div>
          </div>

          <button 
            onClick={onExitGhostMode}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-xl shadow-xl shadow-indigo-200 uppercase tracking-widest text-xs transition-all active:scale-95"
          >
            Sair do Teste e Usar de Verdade 🚀
          </button>
        </div>
      )}

      {/* Top Section: Image Viewer or Audio Feedback */}
      <div className="relative h-[300px] w-full rounded-xl border border-border bg-black/5 overflow-hidden group">
        {imageSource ? (
          <div 
            ref={containerRef}
            className="w-full h-full cursor-grab active:cursor-grabbing flex items-center justify-center overflow-hidden"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <img
              src={imageSource}
              alt="Pauta"
              className="max-w-none transition-transform duration-200"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                pointerEvents: scale === 1 ? "none" : "auto",
              }}
            />
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-indigo-50/50 gap-4">
            <div className="p-6 rounded-full bg-white shadow-xl shadow-indigo-100/50 animate-pulse">
               <ShieldCheck className="w-12 h-12 text-indigo-500" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-black text-indigo-950 uppercase tracking-tight">Captura por Voz Ativa 🎙️</p>
              <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest px-8">Confirme os alunos identificados abaixo antes de salvar.</p>
            </div>
          </div>
        )}

        {/* Controls (only visible with image) */}
        {imageSource && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 p-1.5 rounded-full bg-background/80 backdrop-blur shadow-lg border border-border opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={handleZoomOut}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={handleResetZoom}>
              <Maximize className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={handleZoomIn}>
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Bottom Section: List Verification */}
      <div className="w-full">
        <AbsenceList
          absences={absences}
          onRemove={onRemove}
          onToggleConfirm={onToggleConfirm}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting || isSimulating}
          onWhatsAppReport={generateWhatsAppReport}
        />
      </div>
    </div>
  );
};

export default ValidationPanel;
