import { Loader2, ScanEye } from "lucide-react";

const LoadingState = () => {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-12">
      <div className="relative">
        <div className="rounded-2xl bg-primary/10 p-5">
          <ScanEye className="h-10 w-10 text-primary" />
        </div>
        <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin text-primary" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-foreground">
          Lendo a pauta com IA...
        </p>
        <p className="text-xs text-muted-foreground">
          Identificando faltas na folha de frequência
        </p>
      </div>
    </div>
  );
};

export default LoadingState;
