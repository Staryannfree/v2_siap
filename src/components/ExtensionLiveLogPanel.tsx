import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bug, ChevronDown, ClipboardCopy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  clearExtensionLiveLog,
  formatExtensionLiveLogForCopy,
  getExtensionLiveLogSnapshot,
  subscribeExtensionLiveLog,
} from "@/lib/extensionLiveLog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function ExtensionLiveLogPanel() {
  const logList = useSyncExternalStore(
    subscribeExtensionLiveLog,
    getExtensionLiveLogSnapshot,
    () => [],
  );
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !scrollRef.current) return;
    const el = scrollRef.current;
    el.scrollTop = el.scrollHeight;
  }, [open, logList.length]);

  const handleCopy = useCallback(async () => {
    const text = formatExtensionLiveLogForCopy(getExtensionLiveLogSnapshot());
    if (!text.trim()) {
      toast.message("Nada para copiar", { description: "O buffer de logs está vazio." });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Logs copiados", { description: `${logList.length} linha(s) na área de transferência.` });
    } catch {
      toast.error("Não foi possível copiar", { description: "Permissão de clipboard negada." });
    }
  }, [logList.length]);

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-[9999] flex flex-col items-end gap-2">
      {open && (
        <div
          className="pointer-events-auto flex max-h-[min(55vh,420px)] w-[min(100vw-1.5rem,420px)] flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur-sm"
          role="dialog"
          aria-label="Logs da extensão em tempo real"
        >
          <div className="border-b border-border px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground">Logs em tempo real</span>
              <span className="text-[10px] text-muted-foreground">{logList.length} linhas</span>
            </div>
            <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
              Inclui o painel React e o <code className="rounded bg-muted px-0.5">content.js</code> da aba SIAP (prefixo{" "}
              <code className="rounded bg-muted px-0.5">[content]</code>). DevTools da aba ainda mostra tudo também.
            </p>
          </div>
          <div
            ref={scrollRef}
            className="min-h-[120px] flex-1 overflow-y-auto overflow-x-auto p-2 font-mono text-[10px] leading-relaxed text-foreground"
          >
            {logList.length === 0 ? (
              <p className="text-muted-foreground">Aguardando mensagens do console…</p>
            ) : (
              logList.map((e, i) => {
                const d = new Date(e.ts);
                const pad = (n: number) => String(n).padStart(2, "0");
                const stamp = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                const levelCls =
                  e.level === "error"
                    ? "text-red-600 dark:text-red-400"
                    : e.level === "warn"
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-muted-foreground";
                return (
                  <div key={`${e.ts}-${i}`} className="whitespace-pre-wrap break-all border-b border-border/40 py-0.5 last:border-0">
                    <span className="text-muted-foreground">[{stamp}]</span>{" "}
                    <span className={cn("font-semibold", levelCls)}>[{e.level}]</span> {e.text}
                  </div>
                );
              })
            )}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border p-2">
            <Button type="button" size="sm" variant="default" className="h-8 text-xs" onClick={() => void handleCopy()}>
              <ClipboardCopy className="size-3.5" />
              Copiar tudo
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => {
                clearExtensionLiveLog();
                toast.message("Buffer limpo");
              }}
            >
              <Trash2 className="size-3.5" />
              Limpar
            </Button>
            <Button type="button" size="sm" variant="ghost" className="ml-auto h-8 text-xs" onClick={() => setOpen(false)}>
              <ChevronDown className="size-3.5" />
              Recolher
            </Button>
          </div>
        </div>
      )}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className={cn(
          "pointer-events-auto h-9 gap-1.5 border border-border shadow-md",
          open && "ring-2 ring-ring",
        )}
        onClick={() => setOpen((v) => !v)}
        title={open ? "Recolher painel de logs" : "Abrir logs em tempo real"}
      >
        <Bug className="size-4" />
        Logs
      </Button>
    </div>
  );
}
