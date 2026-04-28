import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Copy,
  FileJson,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { api } from "@/services/api";
import type {
  ElasticsearchIndexInfo,
  ElasticsearchSearchHit,
} from "@/services/api";
import { toast } from "sonner";
import { cn } from "@/components/ui/utils";

const PAGE_SIZE = 50;
const DEFAULT_DOCUMENT_SOURCE = "{\n  \n}";

interface Props {
  connectionId: number;
  index: string;
}

function previewSource(source: unknown): string {
  if (source === null || source === undefined) return "";
  if (typeof source !== "object") return String(source);
  const object = source as Record<string, unknown>;
  const entries = Object.entries(object).slice(0, 4);
  return entries
    .map(([key, value]) => {
      const rendered =
        typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : String(value);
      return `${key}: ${rendered}`;
    })
    .join(" · ");
}

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

export function ElasticsearchIndexView({ connectionId, index }: Props) {
  const [indices, setIndices] = useState<ElasticsearchIndexInfo[]>([]);
  const [query, setQuery] = useState("");
  const [dsl, setDsl] = useState("");
  const [from, setFrom] = useState(0);
  const [result, setResult] = useState<{
    hits: ElasticsearchSearchHit[];
    total: number;
    tookMs: number;
  }>({ hits: [], total: 0, tookMs: 0 });
  const [selectedHit, setSelectedHit] = useState<ElasticsearchSearchHit | null>(
    null,
  );
  const [mapping, setMapping] = useState<unknown>(null);
  const [detailMode, setDetailMode] = useState<"document" | "mapping" | "console">(
    "document",
  );
  const [documentIdInput, setDocumentIdInput] = useState("");
  const [editorDocumentId, setEditorDocumentId] = useState("");
  const [editorSource, setEditorSource] = useState(DEFAULT_DOCUMENT_SOURCE);
  const [rawMethod, setRawMethod] = useState("GET");
  const [rawPath, setRawPath] = useState(`/${index}/_search`);
  const [rawBody, setRawBody] = useState("{\n  \"query\": {\n    \"match_all\": {}\n  }\n}");
  const [rawResponse, setRawResponse] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
  const [isSavingDocument, setIsSavingDocument] = useState(false);
  const [isDeletingDocument, setIsDeletingDocument] = useState(false);
  const [isExecutingRaw, setIsExecutingRaw] = useState(false);

  const selectedJson = useMemo(() => {
    if (!selectedHit) return "";
    return formatJson({
      _index: selectedHit.index,
      _id: selectedHit.id,
      _score: selectedHit.score,
      _source: selectedHit.source,
      fields: selectedHit.fields,
    });
  }, [selectedHit]);

  const syncEditorFromHit = useCallback((hit: ElasticsearchSearchHit | null) => {
    setSelectedHit(hit);
    setDetailMode("document");
    setEditorDocumentId(hit?.id ?? "");
    setDocumentIdInput(hit?.id ?? "");
    setEditorSource(hit ? formatJson(hit.source) : DEFAULT_DOCUMENT_SOURCE);
  }, []);

  const loadMetadata = useCallback(async () => {
    setIsLoadingMeta(true);
    try {
      const [nextIndices, nextMapping] = await Promise.all([
        api.elasticsearch.listIndices(connectionId),
        api.elasticsearch.getIndexMapping(connectionId, index),
      ]);
      setIndices(nextIndices);
      setMapping(nextMapping);
    } catch (e) {
      toast.error("Failed to load Elasticsearch metadata", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsLoadingMeta(false);
    }
  }, [connectionId, index]);

  const search = useCallback(
    async (nextFrom: number) => {
      setIsSearching(true);
      try {
        const response = await api.elasticsearch.searchDocuments({
          id: connectionId,
          index,
          query: query.trim() || undefined,
          dsl: dsl.trim() || undefined,
          from: nextFrom,
          size: PAGE_SIZE,
        });
        setFrom(nextFrom);
        setResult(response);
        syncEditorFromHit(response.hits[0] ?? null);
      } catch (e) {
        toast.error("Elasticsearch search failed", {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setIsSearching(false);
      }
    },
    [connectionId, index, query, dsl, syncEditorFromHit],
  );

  useEffect(() => {
    void loadMetadata();
    void search(0);
    // Load once per opened index; query inputs search only on explicit action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, index]);

  const currentIndex = indices.find((item) => item.name === index);
  const page = Math.floor(from / PAGE_SIZE) + 1;
  const canPrev = from > 0;
  const canNext = from + PAGE_SIZE < result.total;

  const copySelected = async () => {
    const text =
      detailMode === "mapping"
        ? formatJson(mapping)
        : detailMode === "console"
          ? rawResponse
          : selectedJson || editorSource;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  const openDocumentById = async (documentId = documentIdInput) => {
    const id = documentId.trim();
    if (!id) return;
    setIsLoadingDocument(true);
    try {
      const doc = await api.elasticsearch.getDocument(connectionId, index, id);
      if (!doc.found || !doc.source) {
        toast.error("Document not found");
        return;
      }
      syncEditorFromHit({
        index: doc.index,
        id: doc.id,
        score: null,
        source: doc.source,
        fields: doc.fields,
      });
    } catch (e) {
      toast.error("Failed to load document", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsLoadingDocument(false);
    }
  };

  const newDocument = () => {
    syncEditorFromHit(null);
    setDetailMode("document");
  };

  const saveDocument = async () => {
    setIsSavingDocument(true);
    try {
      const source = JSON.parse(editorSource);
      const saved = await api.elasticsearch.upsertDocument({
        id: connectionId,
        index,
        documentId: editorDocumentId.trim() || undefined,
        source,
        refresh: true,
      });
      toast.success(
        `${saved.result || "saved"}${saved.id ? ` · ${saved.id}` : ""}`,
      );
      if (saved.id) {
        await openDocumentById(saved.id);
      }
      await search(from);
      await loadMetadata();
    } catch (e) {
      toast.error("Failed to save document", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsSavingDocument(false);
    }
  };

  const deleteDocument = async () => {
    const id = editorDocumentId.trim();
    if (!id) return;
    if (!window.confirm(`Delete document "${id}" from ${index}?`)) return;
    setIsDeletingDocument(true);
    try {
      await api.elasticsearch.deleteDocument({
        id: connectionId,
        index,
        documentId: id,
        refresh: true,
      });
      toast.success("Document deleted");
      syncEditorFromHit(null);
      await search(Math.max(0, from));
      await loadMetadata();
    } catch (e) {
      toast.error("Failed to delete document", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsDeletingDocument(false);
    }
  };

  const executeRaw = async () => {
    setIsExecutingRaw(true);
    try {
      const response = await api.elasticsearch.executeRaw({
        id: connectionId,
        method: rawMethod,
        path: rawPath,
        body: rawBody.trim() || undefined,
      });
      setRawResponse(
        response.json ? formatJson(response.json) : response.body || "",
      );
      toast.success(`HTTP ${response.status} · ${response.tookMs}ms`);
    } catch (e) {
      toast.error("Elasticsearch request failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsExecutingRaw(false);
    }
  };

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel defaultSize={42} minSize={30} maxSize={60}>
        <div className="flex h-full flex-col border-r">
          <div className="space-y-3 border-b p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{index}</div>
                <div className="text-xs text-muted-foreground">
                  {currentIndex?.docsCount ?? result.total} docs
                  {currentIndex?.storeSize ? ` · ${currentIndex.storeSize}` : ""}
                  {result.tookMs ? ` · ${result.tookMs}ms` : ""}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => {
                  void loadMetadata();
                  void search(from);
                }}
                disabled={isLoadingMeta || isSearching}
                title="Refresh"
              >
                {isLoadingMeta || isSearching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-8 font-mono text-xs"
                  placeholder="query_string, e.g. status:200 AND user:kimchy"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void search(0);
                  }}
                />
              </div>
              <Button
                size="sm"
                className="h-8"
                onClick={() => void search(0)}
                disabled={isSearching}
              >
                {isSearching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Search
              </Button>
            </div>
            <Textarea
              className="min-h-24 resize-none font-mono text-xs"
              placeholder='Optional JSON DSL, e.g. {"query":{"match_all":{}}}'
              value={dsl}
              onChange={(e) => setDsl(e.target.value)}
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {result.hits.length === 0 && !isSearching ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No documents
              </div>
            ) : (
              result.hits.map((hit) => (
                <button
                  key={`${hit.index}:${hit.id}`}
                  type="button"
                  className={cn(
                    "block w-full border-b px-3 py-2 text-left hover:bg-muted/50",
                    selectedHit?.id === hit.id && "bg-muted",
                  )}
                  onClick={() => void openDocumentById(hit.id)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-xs">{hit.id}</span>
                    <span className="text-xs text-muted-foreground">
                      {hit.score ?? "-"}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {previewSource(hit.source)}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t p-2 text-xs text-muted-foreground">
            <span>
              Page {page} · {result.total} hits
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                disabled={!canPrev || isSearching}
                onClick={() => void search(Math.max(0, from - PAGE_SIZE))}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                disabled={!canNext || isSearching}
                onClick={() => void search(from + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={58} minSize={40}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex min-w-0 items-center gap-1">
              <Button
                variant={detailMode === "document" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={() => setDetailMode("document")}
              >
                <FileJson className="mr-1.5 h-3.5 w-3.5" />
                Document
              </Button>
              <Button
                variant={detailMode === "mapping" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={() => setDetailMode("mapping")}
              >
                Mapping
              </Button>
              <Button
                variant={detailMode === "console" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={() => setDetailMode("console")}
              >
                <SquareTerminal className="mr-1.5 h-3.5 w-3.5" />
                Console
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={
                detailMode === "document" && !selectedHit && !editorSource.trim()
              }
              onClick={() => void copySelected()}
            >
              <Copy className="mr-2 h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
          {detailMode === "document" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex gap-2 border-b p-3">
                <Input
                  className="h-8 font-mono text-xs"
                  placeholder="Document ID"
                  value={documentIdInput}
                  onChange={(e) => setDocumentIdInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void openDocumentById();
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={isLoadingDocument || !documentIdInput.trim()}
                  onClick={() => void openDocumentById()}
                >
                  {isLoadingDocument ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  Open
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={newDocument}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New
                </Button>
              </div>
              <div className="flex gap-2 border-b p-3">
                <Input
                  className="h-8 font-mono text-xs"
                  placeholder="Leave blank to auto-generate ID"
                  value={editorDocumentId}
                  onChange={(e) => setEditorDocumentId(e.target.value)}
                />
                <Button
                  size="sm"
                  className="h-8"
                  disabled={isSavingDocument}
                  onClick={() => void saveDocument()}
                >
                  {isSavingDocument ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8"
                  disabled={isDeletingDocument || !editorDocumentId.trim()}
                  onClick={() => void deleteDocument()}
                >
                  {isDeletingDocument ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete
                </Button>
              </div>
              <Textarea
                className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-xs focus-visible:ring-0"
                value={editorSource}
                onChange={(e) => setEditorSource(e.target.value)}
              />
            </div>
          ) : detailMode === "mapping" ? (
            <pre className="min-h-0 flex-1 overflow-auto p-3 text-xs">
              {formatJson(mapping)}
            </pre>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex gap-2 border-b p-3">
                <Input
                  className="h-8 w-24 font-mono text-xs uppercase"
                  value={rawMethod}
                  onChange={(e) => setRawMethod(e.target.value.toUpperCase())}
                />
                <Input
                  className="h-8 font-mono text-xs"
                  value={rawPath}
                  onChange={(e) => setRawPath(e.target.value)}
                  placeholder="/_cluster/health"
                />
                <Button
                  size="sm"
                  className="h-8"
                  disabled={isExecutingRaw}
                  onClick={() => void executeRaw()}
                >
                  {isExecutingRaw ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <SquareTerminal className="mr-2 h-4 w-4" />
                  )}
                  Send
                </Button>
              </div>
              <ResizablePanelGroup direction="vertical" className="min-h-0 flex-1">
                <ResizablePanel defaultSize={45} minSize={20}>
                  <Textarea
                    className="h-full resize-none rounded-none border-0 font-mono text-xs focus-visible:ring-0"
                    value={rawBody}
                    onChange={(e) => setRawBody(e.target.value)}
                    placeholder="Optional JSON request body"
                  />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel defaultSize={55} minSize={20}>
                  <pre className="h-full overflow-auto p-3 text-xs">
                    {rawResponse}
                  </pre>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
