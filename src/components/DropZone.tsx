import { useCallback, useState } from "react";
import { Upload, Image } from "lucide-react";

interface DropZoneProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

const DropZone = ({ onFilesSelected, disabled }: DropZoneProps) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [onFilesSelected]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [onFilesSelected]
  );

  return (
    <div
      onDragEnter={handleDragIn}
      onDragLeave={handleDragOut}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={`
        relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-10 transition-all duration-300
        ${disabled ? "opacity-50 cursor-not-allowed grayscale" : "cursor-pointer"}
        ${
          isDragging && !disabled
            ? "border-primary bg-primary/5 scale-[1.02] shadow-lg"
            : "border-border bg-card hover:border-primary/50 hover:bg-primary/[0.02]"
        }
      `}
    >
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileInput}
        disabled={disabled}
        className={`absolute inset-0 w-full h-full opacity-0 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      />

      <div
        className={`rounded-xl p-4 transition-colors duration-300 ${
          isDragging ? "bg-primary/10" : "bg-muted"
        }`}
      >
        {isDragging ? (
          <Image className="h-8 w-8 text-primary" />
        ) : (
          <Upload className="h-8 w-8 text-muted-foreground" />
        )}
      </div>

      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-foreground">
          {isDragging ? "Solte as imagens aqui" : "Arraste as fotos da chamada"}
        </p>
        <p className="text-xs text-muted-foreground">
          ou clique para selecionar • PNG, JPG
        </p>
      </div>
    </div>
  );
};

export default DropZone;
