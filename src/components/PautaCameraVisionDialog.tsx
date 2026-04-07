import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Loader2, Upload, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  extractAbsentNumbersFromPautaImage,
  type PautaAlunoRef,
} from "@/lib/gemini-pauta-camera";
import { toast } from "sonner";

type StudentRow = PautaAlunoRef & { matricula?: string };

type PautaCameraVisionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: StudentRow[];
  /** Dia do calendário SIAP (ex.: "04", "23") — coluna da pauta a ler. */
  diaSelecionado: string;
  disabled?: boolean;
  /** Números de chamada que faltaram (após IA) — o pai aplica marcação no SIAP + estado. */
  onAbsenceNumbersDetected: (numbers: number[]) => void | Promise<void>;
};

export function PautaCameraVisionDialog({
  open,
  onOpenChange,
  students,
  diaSelecionado,
  disabled,
  onAbsenceNumbersDetected,
}: PautaCameraVisionDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [streamReady, setStreamReady] = useState(false);
  /** Inicializando stream, ao vivo, ou indisponível (permissão / hardware / constraints). */
  const [cameraPhase, setCameraPhase] = useState<"starting" | "live" | "unavailable">("starting");
  const [isCapturing, setIsCapturing] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreamReady(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  /** Fluxo único: base64 (data URL ou raw) + mime → Gemini → pai. Usado por webcam e upload. */
  const processImageDataUrl = useCallback(
    async (dataUrl: string, mimeType: string) => {
      if (students.length === 0) {
        toast.error("Lista de alunos indisponível.");
        return;
      }
      const dia = diaSelecionado.trim();
      if (!dia) {
        toast.error("Selecione o dia no calendário antes de ler a pauta.");
        return;
      }
      const lista: PautaAlunoRef[] = students.map((s) => ({
        number: s.number,
        name: s.name,
      }));
      const nums = await extractAbsentNumbersFromPautaImage(dataUrl, mimeType, lista, dia);
      await onAbsenceNumbersDetected(nums);
      stopStream();
      onOpenChange(false);
    },
    [students, diaSelecionado, onAbsenceNumbersDetected, stopStream, onOpenChange],
  );

  const runWithLoading = useCallback(
    async (fn: () => Promise<void>) => {
      setIsCapturing(true);
      try {
        await fn();
      } catch (err) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Falha na leitura da pauta.");
      } finally {
        setIsCapturing(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      stopStream();
      setCameraPhase("starting");
      return;
    }

    let cancelled = false;
    setCameraPhase("starting");
    (async () => {
      const tryStream = async (constraints: MediaStreamConstraints): Promise<MediaStream | null> => {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          return null;
        }
      };

      // 1) Traseira (celular / tablet) — em notebook costuma falhar por OverconstrainedError.
      let stream =
        (await tryStream({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })) ??
        (await tryStream({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        }));

      // 2) Qualquer câmera padrão (webcam em PC).
      if (!stream) {
        stream = await tryStream({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      }
      if (!stream) {
        stream = await tryStream({ video: true, audio: false });
      }

      if (cancelled) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }

      if (!stream) {
        console.error("getUserMedia: todas as tentativas falharam");
        setStreamReady(false);
        setCameraPhase("unavailable");
        toast.error(
          "Não foi possível usar a câmera (permissão ou dispositivo). Use “Carregar arquivo” com uma foto da pauta.",
          { duration: 6000 },
        );
        return;
      }

      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
      setStreamReady(true);
      setCameraPhase("live");
    })();

    return () => {
      cancelled = true;
    };
  }, [open, stopStream]);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamReady || students.length === 0) {
      toast.error("Câmera ou lista de alunos indisponível.");
      return;
    }

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      toast.error("Aguarde a câmera focar e tente de novo.");
      return;
    }

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    void runWithLoading(() => processImageDataUrl(dataUrl, "image/jpeg"));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem (JPG, PNG, etc.).");
      return;
    }
    if (students.length === 0) {
      toast.error("Lista de alunos indisponível.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        toast.error("Não foi possível ler o arquivo.");
        return;
      }
      stopStream();
      const mime = file.type && file.type.startsWith("image/") ? file.type : "image/jpeg";
      void runWithLoading(() => processImageDataUrl(result, mime));
    };
    reader.onerror = () => {
      toast.error("Erro ao ler o arquivo.");
    };
    reader.readAsDataURL(file);
  };

  const triggerFilePicker = () => {
    fileInputRef.current?.click();
  };

  const canProcess = students.length > 0 && !disabled && !isCapturing;

  return (
    <Dialog open={open} onOpenChange={(v) => !isCapturing && onOpenChange(v)}>
      <DialogContent className="max-h-[95vh] w-[min(100%,380px)] gap-0 overflow-hidden border-slate-200 p-0 sm:max-w-[380px]">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileUpload}
          aria-hidden
        />

        <DialogHeader className="sr-only">
          <DialogTitle>Ler pauta com IA</DialogTitle>
          <DialogDescription>
            Use a câmera ou carregue uma imagem. Enquadre nomes e coluna de faltas de hoje.
          </DialogDescription>
        </DialogHeader>

        <div className="relative min-h-[200px] bg-black">
          <video
            ref={videoRef}
            className={
              cameraPhase === "live"
                ? "aspect-[3/4] w-full object-cover"
                : "pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0"
            }
            playsInline
            muted
            autoPlay
          />

          {cameraPhase === "starting" && (
            <div className="absolute inset-0 flex aspect-[3/4] w-full flex-col items-center justify-center gap-3 bg-slate-900 text-white">
              <Loader2 className="h-10 w-10 animate-spin text-violet-400" />
              <p className="px-4 text-center text-[11px] font-bold leading-snug">Abrindo câmera…</p>
              <p className="px-6 text-center text-[9px] font-medium text-slate-400">
                Se o navegador pedir permissão, autorize o uso da câmera para esta extensão.
              </p>
            </div>
          )}

          {cameraPhase === "unavailable" && (
            <div className="absolute inset-0 flex aspect-[3/4] w-full flex-col items-center justify-center gap-4 bg-slate-900 px-4 text-center text-white">
              <Camera className="h-10 w-10 text-slate-500" />
              <p className="text-[12px] font-bold leading-snug">
                Câmera não disponível. Você pode enviar uma foto da pauta pelo botão abaixo.
              </p>
              <Button
                type="button"
                className="h-10 gap-2 bg-violet-600 font-bold hover:bg-violet-700"
                disabled={!canProcess || isCapturing}
                onClick={triggerFilePicker}
              >
                <Upload className="h-4 w-4" />
                Carregar foto da pauta
              </Button>
            </div>
          )}

          {/* Máscara tipo scanner: área central transparente + bordas escuras */}
          <div
            className={`pointer-events-none absolute inset-0 flex items-center justify-center ${cameraPhase !== "live" ? "hidden" : ""}`}
            aria-hidden
          >
            <div
              className="relative aspect-[3/4] w-[82%] max-w-[300px] rounded-md"
              style={{
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
              }}
            >
              <span className="absolute left-0 top-0 z-10 h-8 w-8 rounded-tl-md border-l-4 border-t-4 border-white" />
              <span className="absolute right-0 top-0 z-10 h-8 w-8 rounded-tr-md border-r-4 border-t-4 border-white" />
              <span className="absolute bottom-0 left-0 z-10 h-8 w-8 rounded-bl-md border-b-4 border-l-4 border-white" />
              <span className="absolute bottom-0 right-0 z-10 h-8 w-8 rounded-br-md border-b-4 border-r-4 border-white" />
            </div>
          </div>

          {cameraPhase === "live" && (
            <p className="pointer-events-none absolute left-2 right-2 top-3 rounded-lg bg-black/55 px-2 py-2 text-center text-[10px] font-bold leading-snug text-white backdrop-blur-[2px]">
              Aproxime a câmera e enquadre <span className="text-amber-200">APENAS</span> a lista de nomes e a
              coluna de faltas de hoje.
            </p>
          )}

          <button
            type="button"
            className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white backdrop-blur-sm hover:bg-black/70"
            onClick={() => {
              stopStream();
              onOpenChange(false);
            }}
            disabled={isCapturing}
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 bg-white p-3">
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              className="h-11 w-full gap-2 bg-indigo-600 font-black uppercase tracking-tight hover:bg-indigo-700"
              disabled={!canProcess || !streamReady}
              onClick={handleCapture}
            >
              {isCapturing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Lendo pauta…
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4" />
                  Capturar foto
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="h-11 w-full gap-2 border-slate-200 font-bold uppercase tracking-tight text-slate-700 hover:bg-slate-50"
              disabled={!canProcess || isCapturing}
              onClick={triggerFilePicker}
            >
              <Upload className="h-4 w-4 shrink-0" />
              <ImageIcon className="h-4 w-4 shrink-0 opacity-80" />
              Ou Carregar Arquivo
            </Button>
          </div>

          <p className="text-center text-[9px] font-medium text-slate-400">
            {students.length === 0
              ? "Carregue a turma no SIAP para obter a lista de alunos."
              : `${students.length} alunos na lista oficial.`}
          </p>
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </DialogContent>
    </Dialog>
  );
}
