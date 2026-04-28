import { useEffect, useState } from "react";
import { api, type RoutineType } from "@/services/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface RoutineMetadataViewProps {
  connectionId: number;
  database: string;
  schema: string;
  name: string;
  routineType: RoutineType;
}

export function RoutineMetadataView({
  connectionId,
  database,
  schema,
  name,
  routineType,
}: RoutineMetadataViewProps) {
  const { t } = useTranslation();
  const [ddl, setDdl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDdl(null);

    api.metadata
      .getRoutineDDL(connectionId, database, schema, name, routineType)
      .then((res) => {
        if (cancelled) return;
        setDdl(res.trim());
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connectionId, database, schema, name, routineType]);

  const handleCopy = async () => {
    if (!ddl) return;
    try {
      await navigator.clipboard.writeText(ddl);
      setCopied(true);
      toast.success(t("routineMetadata.copy.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("routineMetadata.copy.failed"));
    }
  };

  return (
    <div className="h-full overflow-auto bg-background p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground truncate">
            {schema}.{name}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-lg font-semibold truncate">
              {t("routineMetadata.title")}
            </div>
            <Badge variant="secondary">
              {routineType === "procedure"
                ? t("routineMetadata.type.procedure")
                : t("routineMetadata.type.function")}
            </Badge>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          disabled={!ddl}
          className="h-7 px-2 text-xs shrink-0"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 mr-1" />
          ) : (
            <Copy className="h-3.5 w-3.5 mr-1" />
          )}
          {copied
            ? t("routineMetadata.copy.copiedShort")
            : t("routineMetadata.copy.copy")}
        </Button>
      </div>

      <div className="border border-border rounded-md bg-muted/10">
        {loading ? (
          <div className="p-3 text-sm text-muted-foreground">
            {t("routineMetadata.loading")}
          </div>
        ) : error ? (
          <div className="p-3 text-sm text-destructive break-words">
            {error}
          </div>
        ) : ddl ? (
          <pre className="p-3 text-sm font-mono whitespace-pre-wrap break-words overflow-auto">
            <code>{ddl}</code>
          </pre>
        ) : (
          <div className="p-3 text-sm text-muted-foreground">
            {t("routineMetadata.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
