import React from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface MobilePairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  mobilePairingUrl: string;
  remoteBroadcastStatus: string;
}

export const MobilePairingModal: React.FC<MobilePairingModalProps> = ({
  isOpen,
  onClose,
  roomId,
  mobilePairingUrl,
  remoteBroadcastStatus,
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
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
            onClick={onClose}
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
