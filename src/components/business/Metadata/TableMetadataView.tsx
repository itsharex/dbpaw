import { useEffect, useMemo, useState } from "react";
import { api, type TableMetadata } from "@/services/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function extractCreateTableStatement(ddl: string): string {
  const trimmed = ddl.trim();
  if (!trimmed) return "";

  const match = trimmed.match(/create\s+table\b[\s\S]*?;/i);
  return (match?.[0] ?? trimmed).trim();
}

interface CopyButtonProps {
  text: string | null;
}

function CopyButton({ text }: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t("tableMetadata.copy.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("tableMetadata.copy.failed"));
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      disabled={!text}
      className="h-7 px-2 text-xs"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 mr-1" />
      ) : (
        <Copy className="h-3.5 w-3.5 mr-1" />
      )}
      {copied ? t("tableMetadata.copy.copiedShort") : t("tableMetadata.copy.copy")}
    </Button>
  );
}

interface TableMetadataViewProps {
  connectionId: number;
  database: string;
  schema: string;
  table: string;
}

export function TableMetadataView({
  connectionId,
  database,
  schema,
  table,
}: TableMetadataViewProps) {
  const { t } = useTranslation();
  const [metadata, setMetadata] = useState<TableMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ddl, setDdl] = useState<string | null>(null);
  const [ddlLoading, setDdlLoading] = useState(false);
  const [ddlError, setDdlError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMetadata(null);
    setDdlLoading(true);
    setDdlError(null);
    setDdl(null);

    api.metadata
      .getTableMetadata(connectionId, database, schema, table)
      .then((res) => {
        if (cancelled) return;
        setMetadata(res);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    api.metadata
      .getTableDDL(connectionId, database, schema, table)
      .then((res) => {
        if (cancelled) return;
        setDdl(extractCreateTableStatement(res));
      })
      .catch((e) => {
        if (cancelled) return;
        setDdlError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setDdlLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connectionId, database, schema, table]);

  const fkColumns = useMemo(() => {
    const set = new Set<string>();
    for (const fk of metadata?.foreignKeys ?? []) {
      set.add(fk.column);
    }
    return set;
  }, [metadata]);
  const clickhouseExtra = metadata?.clickhouseExtra ?? null;
  const specialTypeSummaries = metadata?.specialTypeSummaries ?? [];

  const categoryLabel = (category: string) => {
    switch (category) {
      case "bitmap":
        return t("tableMetadata.specialTypes.categories.bitmap");
      case "geo":
        return t("tableMetadata.specialTypes.categories.geo");
      case "hyperloglog":
        return t("tableMetadata.specialTypes.categories.hyperloglog");
      default:
        return category;
    }
  };

  const formatMemoryUsage = (memoryUsageBytes?: number | null) => {
    if (memoryUsageBytes == null) {
      return t("tableMetadata.specialTypes.unavailable");
    }
    return `${memoryUsageBytes.toLocaleString()} B`;
  };

  return (
    <div className="h-full overflow-auto bg-background p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground truncate">
            {schema}.{table}
          </div>
          <div className="text-lg font-semibold truncate">
            {t("tableMetadata.title")}
          </div>
        </div>
        {loading && <Badge variant="secondary">{t("tableMetadata.loading")}</Badge>}
        {error && <Badge variant="destructive">{t("tableMetadata.error")}</Badge>}
      </div>

      {error && (
        <div className="text-sm text-destructive break-words">{error}</div>
      )}

      <section className="space-y-2">
        <div className="text-sm font-semibold">{t("tableMetadata.columns.title")}</div>
        <div className="border border-border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">{t("tableMetadata.columns.columnName")}</TableHead>
                <TableHead className="w-[220px]">{t("tableMetadata.columns.type")}</TableHead>
                <TableHead className="w-[90px]">{t("tableMetadata.columns.nullable")}</TableHead>
                <TableHead className="w-[220px]">{t("tableMetadata.columns.defaultValue")}</TableHead>
                <TableHead className="w-[160px]">{t("tableMetadata.columns.keys")}</TableHead>
                <TableHead>{t("tableMetadata.columns.description")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(metadata?.columns ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    {t("tableMetadata.columns.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                (metadata?.columns ?? []).map((col) => {
                  const isFk = fkColumns.has(col.name);
                  return (
                    <TableRow key={col.name}>
                      <TableCell className="font-mono">{col.name}</TableCell>
                      <TableCell className="font-mono">{col.type}</TableCell>
                      <TableCell>
                        {col.nullable
                          ? t("tableMetadata.common.yes")
                          : t("tableMetadata.common.no")}
                      </TableCell>
                      <TableCell className="font-mono">
                        {col.defaultValue ?? ""}
                      </TableCell>
                      <TableCell className="flex items-center gap-2">
                        {col.primaryKey && (
                          <Badge variant="default">{t("tableMetadata.columns.pk")}</Badge>
                        )}
                        {isFk && (
                          <Badge variant="outline">{t("tableMetadata.columns.fk")}</Badge>
                        )}
                      </TableCell>
                      <TableCell>{col.comment ?? ""}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {specialTypeSummaries.length > 0 && (
        <section className="space-y-2">
          <div className="text-sm font-semibold">
            {t("tableMetadata.specialTypes.title")}
          </div>
          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">
                    {t("tableMetadata.specialTypes.column")}
                  </TableHead>
                  <TableHead className="w-[140px]">
                    {t("tableMetadata.specialTypes.category")}
                  </TableHead>
                  <TableHead className="w-[180px]">
                    {t("tableMetadata.specialTypes.type")}
                  </TableHead>
                  <TableHead className="w-[140px]">
                    {t("tableMetadata.specialTypes.length")}
                  </TableHead>
                  <TableHead className="w-[180px]">
                    {t("tableMetadata.specialTypes.memoryUsage")}
                  </TableHead>
                  <TableHead>{t("tableMetadata.specialTypes.notes")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {specialTypeSummaries.map((summary) => (
                  <TableRow key={`${summary.columnName}-${summary.category}`}>
                    <TableCell className="font-mono">{summary.columnName}</TableCell>
                    <TableCell>{categoryLabel(summary.category)}</TableCell>
                    <TableCell className="font-mono">{summary.typeName}</TableCell>
                    <TableCell className="font-mono">
                      {summary.declaredLength ??
                        t("tableMetadata.specialTypes.unavailable")}
                    </TableCell>
                    <TableCell className="font-mono">
                      {summary.memoryUsageDisplay ??
                        formatMemoryUsage(summary.memoryUsageBytes)}
                    </TableCell>
                    <TableCell>{summary.notes ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <section className="space-y-2">
        {clickhouseExtra && (
          <>
            <div className="text-sm font-semibold">{t("tableMetadata.clickhouse.title")}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="border border-border rounded-md p-2">
                <div className="text-xs text-muted-foreground">
                  {t("tableMetadata.clickhouse.engine")}
                </div>
                <div className="font-mono text-sm break-words">
                  {clickhouseExtra.engine}
                </div>
              </div>
              {clickhouseExtra.partitionKey && (
                <div className="border border-border rounded-md p-2">
                  <div className="text-xs text-muted-foreground">
                    {t("tableMetadata.clickhouse.partitionKey")}
                  </div>
                  <div className="font-mono text-sm break-words">
                    {clickhouseExtra.partitionKey}
                  </div>
                </div>
              )}
              {clickhouseExtra.sortingKey && (
                <div className="border border-border rounded-md p-2">
                  <div className="text-xs text-muted-foreground">
                    {t("tableMetadata.clickhouse.sortingKey")}
                  </div>
                  <div className="font-mono text-sm break-words">
                    {clickhouseExtra.sortingKey}
                  </div>
                </div>
              )}
              {clickhouseExtra.primaryKeyExpr && (
                <div className="border border-border rounded-md p-2">
                  <div className="text-xs text-muted-foreground">
                    {t("tableMetadata.clickhouse.primaryKeyExpr")}
                  </div>
                  <div className="font-mono text-sm break-words">
                    {clickhouseExtra.primaryKeyExpr}
                  </div>
                </div>
              )}
              {clickhouseExtra.samplingKey && (
                <div className="border border-border rounded-md p-2">
                  <div className="text-xs text-muted-foreground">
                    {t("tableMetadata.clickhouse.samplingKey")}
                  </div>
                  <div className="font-mono text-sm break-words">
                    {clickhouseExtra.samplingKey}
                  </div>
                </div>
              )}
              {clickhouseExtra.ttlExpr && (
                <div className="border border-border rounded-md p-2 md:col-span-2">
                  <div className="text-xs text-muted-foreground">
                    {t("tableMetadata.clickhouse.ttl")}
                  </div>
                  <div className="font-mono text-sm break-words">
                    {clickhouseExtra.ttlExpr}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <section className="space-y-2">
        <div className="text-sm font-semibold">{t("tableMetadata.indexes.title")}</div>
        <div className="border border-border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[240px]">{t("tableMetadata.indexes.indexName")}</TableHead>
                <TableHead className="w-[120px]">{t("tableMetadata.indexes.unique")}</TableHead>
                <TableHead className="w-[160px]">{t("tableMetadata.indexes.type")}</TableHead>
                <TableHead>{t("tableMetadata.indexes.columns")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(metadata?.indexes ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    {t("tableMetadata.indexes.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                (metadata?.indexes ?? []).map((idx) => (
                  <TableRow key={idx.name}>
                    <TableCell className="font-mono">{idx.name}</TableCell>
                    <TableCell>
                      {idx.unique ? (
                        <Badge variant="secondary">
                          {t("tableMetadata.common.yes")}
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          {t("tableMetadata.common.no")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono">
                      {idx.indexType ?? ""}
                    </TableCell>
                    <TableCell className="font-mono">
                      {(idx.columns ?? []).join(", ")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-sm font-semibold">{t("tableMetadata.foreignKeys.title")}</div>
        <div className="border border-border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[240px]">{t("tableMetadata.foreignKeys.fkName")}</TableHead>
                <TableHead className="w-[180px]">{t("tableMetadata.foreignKeys.localColumn")}</TableHead>
                <TableHead className="w-[320px]">{t("tableMetadata.foreignKeys.references")}</TableHead>
                <TableHead className="w-[140px]">{t("tableMetadata.foreignKeys.onUpdate")}</TableHead>
                <TableHead className="w-[140px]">{t("tableMetadata.foreignKeys.onDelete")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(metadata?.foreignKeys ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    {t("tableMetadata.foreignKeys.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                (metadata?.foreignKeys ?? []).map((fk, i) => (
                  <TableRow key={`${fk.name}-${fk.column}-${i}`}>
                    <TableCell className="font-mono">{fk.name}</TableCell>
                    <TableCell className="font-mono">{fk.column}</TableCell>
                    <TableCell className="font-mono">
                      {(fk.referencedSchema ? `${fk.referencedSchema}.` : "") +
                        fk.referencedTable}
                      ({fk.referencedColumn})
                    </TableCell>
                    <TableCell>{fk.onUpdate ?? ""}</TableCell>
                    <TableCell>{fk.onDelete ?? ""}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">{t("tableMetadata.ddl.title")}</div>
          <CopyButton text={ddl} />
        </div>
        <div className="border border-border rounded-md bg-muted/10">
          {ddlLoading ? (
            <div className="p-3 text-sm text-muted-foreground">
              {t("tableMetadata.ddl.loading")}
            </div>
          ) : ddlError ? (
            <div className="p-3 text-sm text-destructive break-words">
              {ddlError}
            </div>
          ) : ddl ? (
            <pre className="p-3 text-sm font-mono whitespace-pre-wrap break-words overflow-auto max-h-80">
              <code>{ddl}</code>
            </pre>
          ) : (
            <div className="p-3 text-sm text-muted-foreground">
              {t("tableMetadata.ddl.empty")}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
