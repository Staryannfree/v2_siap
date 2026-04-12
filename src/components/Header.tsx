import React from "react";
import { 
  LogOut, 
  RotateCcw, 
  RefreshCw, 
  QrCode, 
  Loader2, 
  Radio,
  RefreshCw as RefreshIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Session } from "@supabase/supabase-js";

interface HeaderProps {
  portalStatus: "ok" | "error";
  remoteBroadcastStatus: string;
  pairingParearBusy: boolean;
  session: Session | null;
  siapProfessorNome: string;
  authBusy: boolean;
  roomId: string;
  onSignOut: () => void;
  onReset: () => void;
  onParearCelular: () => void;
  onMagicReload: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  portalStatus,
  remoteBroadcastStatus,
  pairingParearBusy,
  session,
  siapProfessorNome,
  authBusy,
  roomId,
  onSignOut,
  onReset,
  onParearCelular,
  onMagicReload,
}) => {
  return (
    <header className="w-full mb-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-100 shrink-0 overflow-hidden">
            <img 
              src={typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getURL('icon-48.png') : '/icon-48.png'} 
              className="w-6 h-6 object-contain" 
              alt="Planejamento Turbo" 
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h1 className="text-sm font-black text-slate-950 tracking-tight leading-none truncate">Planejamento Turbo</h1>
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-50 border border-slate-100 shrink-0">
                <div className={`w-1.5 h-1.5 rounded-full ${portalStatus === "ok" ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" : "bg-amber-500 animate-pulse shadow-[0_0_6px_rgba(245,158,11,0.4)]"}`} />
                <span className="text-[7px] font-bold text-slate-500 uppercase tracking-tight">
                  {portalStatus === "ok" ? "Portal Estável" : "Portal Instável"}
                </span>
              </div>
            </div>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none truncate review-hidden">Simples. Rápido. Automático.</p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onMagicReload}
            className="h-7 px-2 text-[9px] font-black uppercase bg-white border-slate-200 hover:bg-slate-50 text-slate-600 gap-1.5 shadow-sm active:scale-95 transition-all"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            Reparar
          </Button>
          <button
            onClick={onReset}
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition-all"
            title="Reiniciar Painel"
          >
            <RefreshIcon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onSignOut}
            disabled={authBusy}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
            title="Sair da conta"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
        <div className="flex flex-wrap items-center gap-1.5">
          {remoteBroadcastStatus === "subscribed" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50/50 px-2 py-0.5 text-[8px] font-bold uppercase tracking-tight text-emerald-700">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Sala Conectada
            </span>
          )}
          {remoteBroadcastStatus === "connecting" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-100 bg-amber-50/50 px-2 py-0.5 text-[8px] font-bold uppercase tracking-tight text-amber-700">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Sincronizando...
            </span>
          )}
          {remoteBroadcastStatus === "error" && (
            <span className="text-[7px] font-bold uppercase text-rose-500">Erro Realtime</span>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pairingParearBusy || !session?.user || siapProfessorNome.trim().length < 2}
          className="h-6 gap-1 rounded-full px-2 text-[8px] font-black uppercase tracking-tight text-indigo-600 hover:bg-indigo-50"
          onClick={onParearCelular}
        >
          <QrCode className="h-3 w-3" />
          {siapProfessorNome.trim().length < 2 ? "Aguardando Identificação..." : "Parear Celular"}
        </Button>
      </div>
    </header>
  );
};
