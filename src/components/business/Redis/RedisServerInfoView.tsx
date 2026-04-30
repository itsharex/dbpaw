import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type RedisClusterInfo, type RedisServerInfo, type RedisSlowlogEntry } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  RefreshCw,
  Server,
  Database,
  Users,
  Clock,
  MemoryStick,
  Search,
  ChevronDown,
  ChevronRight,
  Loader2,
  Network,
} from "lucide-react";

interface Props {
  connectionId: number;
  database: string;
}

const HIGHLIGHT_KEYS: Record<string, string[]> = {
  Server: ["redis_version", "os", "tcp_port", "uptime_in_seconds"],
  Clients: ["connected_clients", "blocked_clients", "maxclients"],
  Memory: ["used_memory_human", "used_memory_peak_human", "used_memory_rss_human", "mem_fragmentation_ratio"],
  Stats: ["total_connections_received", "total_commands_processed", "instantaneous_ops_per_sec", "keyspace_hits", "keyspace_misses"],
  Replication: ["role", "connected_slaves"],
  Keyspace: [],
};

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

export function RedisServerInfoView({ connectionId, database }: Props) {
  const [info, setInfo] = useState<RedisServerInfo | null>(null);
  const [config, setConfig] = useState<Record<string, string> | null>(null);
  const [slowlog, setSlowlog] = useState<RedisSlowlogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configFilter, setConfigFilter] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [slowlogLoading, setSlowlogLoading] = useState(false);
  const [clusterData, setClusterData] = useState<RedisClusterInfo | null>(null);
  const [clusterLoading, setClusterLoading] = useState(false);

  const loadInfo = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.redis.serverInfo(connectionId, database || undefined);
      setInfo(data);
      setExpandedSections(new Set(Object.keys(data.sections)));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [connectionId, database]);

  const loadConfig = useCallback(async () => {
    try {
      const data = await api.redis.serverConfig(connectionId, database || undefined);
      setConfig(data);
    } catch {
      // Config may fail on restricted servers, silently ignore
    }
  }, [connectionId, database]);

  const loadSlowlog = useCallback(async () => {
    try {
      setSlowlogLoading(true);
      const data = await api.redis.slowlogGet(connectionId, database || undefined, 50);
      setSlowlog(data);
    } catch {
      // Slowlog may not be available
    } finally {
      setSlowlogLoading(false);
    }
  }, [connectionId, database]);

  const loadClusterInfo = useCallback(async () => {
    try {
      setClusterLoading(true);
      const data = await api.redis.clusterInfo(connectionId, database || undefined);
      setClusterData(data);
    } catch {
      // Cluster info may not be available on non-cluster servers
    } finally {
      setClusterLoading(false);
    }
  }, [connectionId, database]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const handleTabChange = useCallback(
    (tab: string) => {
      if (tab === "config" && config === null) loadConfig();
      if (tab === "slowlog" && slowlog === null) loadSlowlog();
      if (tab === "cluster" && clusterData === null) loadClusterInfo();
    },
    [config, slowlog, clusterData, loadConfig, loadSlowlog, loadClusterInfo],
  );

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  const filteredConfig = useMemo(() => {
    if (!config) return [];
    const entries = Object.entries(config);
    if (!configFilter) return entries;
    const lower = configFilter.toLowerCase();
    return entries.filter(
      ([k, v]) => k.toLowerCase().includes(lower) || v.toLowerCase().includes(lower),
    );
  }, [config, configFilter]);

  const sections = info?.sections ?? {};
  const serverSection = sections["Server"] ?? {};
  const memorySection = sections["Memory"] ?? {};
  const clientsSection = sections["Clients"] ?? {};
  const keyspaceSection = sections["Keyspace"] ?? {};
  const replicationSection = sections["Replication"] ?? {};
  const isCluster = replicationSection["cluster_enabled"] === "1";

  const dbsize = info?.dbsize ?? 0;
  const usedMemory = memorySection["used_memory"];
  const connectedClients = clientsSection["connected_clients"];
  const uptimeSeconds = serverSection["uptime_in_seconds"];

  const totalKeys = Object.entries(keyspaceSection)
    .filter(([k]) => k.startsWith("db"))
    .reduce((sum, [, v]) => {
      const match = v.match(/keys=(\d+)/);
      return sum + (match ? parseInt(match[1], 10) : 0);
    }, 0);

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading server info...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={loadInfo}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold tracking-tight">
              Server Info
              {serverSection["redis_version"] && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  v{serverSection["redis_version"]}
                </Badge>
              )}
            </h2>
          </div>
          <Button variant="outline" size="sm" onClick={loadInfo}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            icon={<Database className="h-4 w-4" />}
            label="Total Keys"
            value={totalKeys > 0 ? totalKeys.toLocaleString() : dbsize.toLocaleString()}
            sub={totalKeys > 0 ? `DBSIZE: ${dbsize.toLocaleString()}` : undefined}
          />
          <MetricCard
            icon={<MemoryStick className="h-4 w-4" />}
            label="Used Memory"
            value={usedMemory ? formatBytes(parseInt(usedMemory, 10)) : "N/A"}
            sub={memorySection["used_memory_peak_human"]}
          />
          <MetricCard
            icon={<Users className="h-4 w-4" />}
            label="Connected Clients"
            value={connectedClients ?? "N/A"}
            sub={clientsSection["blocked_clients"] ? `${clientsSection["blocked_clients"]} blocked` : undefined}
          />
          <MetricCard
            icon={<Clock className="h-4 w-4" />}
            label="Uptime"
            value={uptimeSeconds ? formatUptime(parseInt(uptimeSeconds, 10)) : "N/A"}
            sub={serverSection["tcp_port"] ? `Port: ${serverSection["tcp_port"]}` : undefined}
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="info" onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="config">Config</TabsTrigger>
            <TabsTrigger value="slowlog">Slow Log</TabsTrigger>
            {isCluster && <TabsTrigger value="cluster">Cluster</TabsTrigger>}
          </TabsList>

          {/* Info Tab */}
          <TabsContent value="info" className="space-y-3 mt-3">
            {Object.entries(sections).map(([section, pairs]) => (
              <SectionCard
                key={section}
                title={section}
                pairs={pairs}
                highlightKeys={HIGHLIGHT_KEYS[section]}
                expanded={expandedSections.has(section)}
                onToggle={() => toggleSection(section)}
              />
            ))}
          </TabsContent>

          {/* Config Tab */}
          <TabsContent value="config" className="mt-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter config..."
                value={configFilter}
                onChange={(e) => setConfigFilter(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            {config === null ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading config...
              </div>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {filteredConfig.map(([key, value]) => (
                      <div key={key} className="flex items-start gap-3 px-4 py-2 text-sm">
                        <span className="font-mono text-xs text-muted-foreground min-w-[200px] shrink-0">
                          {key}
                        </span>
                        <span className="font-mono text-xs break-all">{value}</span>
                      </div>
                    ))}
                    {filteredConfig.length === 0 && (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        No matching config entries
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Slow Log Tab */}
          <TabsContent value="slowlog" className="mt-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {slowlog ? `${slowlog.length} entries` : ""}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadSlowlog}
                  disabled={slowlogLoading}
                >
                  {slowlogLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Refresh
                </Button>
              </div>
            </div>
            {slowlog === null ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading slow log...
              </div>
            ) : slowlog.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No slow queries recorded
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="px-4 py-2 font-medium text-xs">ID</th>
                        <th className="px-4 py-2 font-medium text-xs">Duration</th>
                        <th className="px-4 py-2 font-medium text-xs">Time</th>
                        <th className="px-4 py-2 font-medium text-xs">Command</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {slowlog.map((entry) => (
                        <tr key={entry.id} className="hover:bg-muted/30">
                          <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                            {entry.id}
                          </td>
                          <td className="px-4 py-2">
                            <Badge
                              variant={entry.durationMs > 10000 ? "destructive" : entry.durationMs > 1000 ? "secondary" : "outline"}
                              className="text-xs font-mono"
                            >
                              {entry.durationMs >= 1000
                                ? `${(entry.durationMs / 1000).toFixed(1)}ms`
                                : `${entry.durationMs}μs`}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {formatTimestamp(entry.timestamp)}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs max-w-[400px] truncate">
                            {entry.command}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Cluster Tab */}
          {isCluster && (
            <TabsContent value="cluster" className="mt-3 space-y-3">
              {clusterLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Loading cluster info...
                </div>
              ) : clusterData ? (
                <>
                  {/* Cluster overview metrics */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <MetricCard
                      icon={<Network className="h-4 w-4" />}
                      label="Cluster State"
                      value={clusterData.info["cluster_state"] ?? "N/A"}
                      sub={clusterData.info["cluster_slots_ok"] ? `${clusterData.info["cluster_slots_ok"]} slots` : undefined}
                    />
                    <MetricCard
                      icon={<Database className="h-4 w-4" />}
                      label="Known Nodes"
                      value={clusterData.info["cluster_known_nodes"] ?? String(clusterData.nodes.length)}
                      sub={`${clusterData.nodes.filter((n) => n.linkState === "connected").length} connected`}
                    />
                    <MetricCard
                      icon={<Server className="h-4 w-4" />}
                      label="Slots Assigned"
                      value={clusterData.info["cluster_slots_assigned"] ?? "N/A"}
                      sub={clusterData.info["cluster_slots_pfail"] ? `${clusterData.info["cluster_slots_pfail"]} pfail` : undefined}
                    />
                    <MetricCard
                      icon={<Clock className="h-4 w-4" />}
                      label="Current Epoch"
                      value={clusterData.info["cluster_current_epoch"] ?? "N/A"}
                      sub={clusterData.info["cluster_my_epoch"] ? `My epoch: ${clusterData.info["cluster_my_epoch"]}` : undefined}
                    />
                  </div>

                  {/* Nodes table */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Cluster Nodes</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="px-4 py-2 font-medium text-xs">Address</th>
                            <th className="px-4 py-2 font-medium text-xs">ID</th>
                            <th className="px-4 py-2 font-medium text-xs">Role</th>
                            <th className="px-4 py-2 font-medium text-xs">Link</th>
                            <th className="px-4 py-2 font-medium text-xs">Slots</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {clusterData.nodes.map((node) => {
                            const role = node.flags.includes("master")
                              ? "master"
                              : node.flags.includes("slave") || node.flags.includes("replica")
                                ? "replica"
                                : node.flags.join(", ");
                            return (
                              <tr key={node.id} className="hover:bg-muted/30">
                                <td className="px-4 py-2 font-mono text-xs">{node.addr}</td>
                                <td className="px-4 py-2 font-mono text-xs text-muted-foreground max-w-[120px] truncate" title={node.id}>
                                  {node.id.substring(0, 8)}…
                                </td>
                                <td className="px-4 py-2">
                                  <Badge variant={role === "master" ? "default" : "secondary"} className="text-xs">
                                    {role}
                                  </Badge>
                                </td>
                                <td className="px-4 py-2">
                                  <Badge variant={node.linkState === "connected" ? "outline" : "destructive"} className="text-xs">
                                    {node.linkState}
                                  </Badge>
                                </td>
                                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                                  {node.slotRange ?? "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    No cluster info available
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </ScrollArea>
  );
}

function MetricCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <CardTitle className="text-xs font-medium">{label}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function SectionCard({
  title,
  pairs,
  highlightKeys,
  expanded,
  onToggle,
}: {
  title: string;
  pairs: Record<string, string>;
  highlightKeys?: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const entries = Object.entries(pairs);
  const highlighted = highlightKeys
    ? entries.filter(([k]) => highlightKeys.includes(k))
    : [];
  const hasHighlight = highlighted.length > 0;

  return (
    <Card>
      <button
        className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-t-xl"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </button>
      {!expanded && hasHighlight && (
        <div className="px-4 pb-3 flex flex-wrap gap-x-6 gap-y-1">
          {highlighted.map(([k, v]) => (
            <span key={k} className="text-xs">
              <span className="text-muted-foreground">{k}: </span>
              <span className="font-mono">{v}</span>
            </span>
          ))}
        </div>
      )}
      {expanded && (
        <div className="divide-y">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-start gap-3 px-4 py-1.5 text-sm">
              <span className="font-mono text-xs text-muted-foreground min-w-[220px] shrink-0">
                {key}
              </span>
              <span className="font-mono text-xs break-all">{value}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
