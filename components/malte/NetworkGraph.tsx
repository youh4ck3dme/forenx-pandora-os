import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Building2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CaseAnalysis } from "@/forensic";
import { formatEur } from "@/forensic";

type EntityNodeData = {
  label: string;
  role: string;
  score: number;
  isShell: boolean;
  isPerson: boolean;
  selected: boolean;
  onPathHighlight: boolean;
};

function EntityNode({ data }: NodeProps) {
  const d = data as unknown as EntityNodeData;
  return (
    <div
      className={cn(
        "w-[132px] rounded-xl border-2 bg-card px-2 py-1.5 text-center shadow-card transition-colors",
        d.isShell ? "border-risk-high" : "border-border",
        d.selected && "ring-2 ring-primary",
        d.onPathHighlight && "bg-risk-high/10",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !bg-muted-foreground"
      />
      <div className="flex items-center justify-center gap-1">
        {d.isPerson ? (
          <User className="h-3 w-3 text-primary" aria-hidden />
        ) : (
          <Building2 className="h-3 w-3 text-primary" aria-hidden />
        )}
        <p className="truncate text-[10px] font-semibold">{d.label}</p>
      </div>
      <p className="truncate text-[9px] text-muted-foreground">{d.role}</p>
      <p
        className={cn(
          "text-[9px] font-semibold tnum",
          d.score >= 80
            ? "text-risk-high"
            : d.score >= 60
              ? "text-risk-medium"
              : "text-risk-low",
        )}
      >
        {d.score}/100
      </p>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !bg-muted-foreground"
      />
    </div>
  );
}

const nodeTypes = { entity: EntityNode };

export function NetworkGraph({
  analysis,
  selectedId,
  highlightedPathIds,
  onSelect,
}: {
  analysis: CaseAnalysis;
  selectedId?: string;
  highlightedPathIds?: string[];
  onSelect: (entityId: string) => void;
}) {
  const highlighted = useMemo(
    () => new Set(highlightedPathIds ?? []),
    [highlightedPathIds],
  );

  // Pri veľkých prípadoch vykreslíme len 80 najrizikovejších entít —
  // mobilné prehliadače inak nezvládnu stovky uzlov naraz.
  const MAX_NODES = 80;
  const isLarge =
    analysis.entities.length > MAX_NODES || analysis.transactions.length > 200;

  const visibleEntities = useMemo(() => {
    if (!isLarge) return analysis.entities;
    return [...analysis.entities]
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_NODES);
  }, [analysis, isLarge]);

  const hiddenCount = analysis.entities.length - visibleEntities.length;

  const visibleIds = useMemo(
    () => new Set(visibleEntities.map((item) => item.entity.id)),
    [visibleEntities],
  );

  const nodes = useMemo<Node[]>(
    () =>
      visibleEntities.map((item) => ({
        id: item.entity.id,
        type: "entity",
        position: { x: item.entity.x * 6.4, y: item.entity.y * 6.4 },
        data: {
          label: item.entity.name,
          role: item.entity.role,
          score: item.score,
          isShell: item.isShell,
          isPerson: item.entity.kind === "person",
          selected: item.entity.id === selectedId,
          onPathHighlight: highlighted.has(item.entity.id),
        } satisfies EntityNodeData as unknown as Record<string, unknown>,
      })),
    [visibleEntities, selectedId, highlighted],
  );

  const edges = useMemo<Edge[]>(() => {
    const visible = (a: string, b: string) =>
      visibleIds.has(a) && visibleIds.has(b);

    const relationEdges: Edge[] = analysis.case.relations
      .filter((r) => visible(r.fromId, r.toId))
      .map((r) => ({
        id: `rel-${r.fromId}-${r.toId}-${r.label}`,
        source: r.fromId,
        target: r.toId,
        label: r.label,
        animated: false,
        style: { stroke: "var(--border)", strokeDasharray: "4 4" },
        labelStyle: { fontSize: 8, fill: "var(--muted-foreground)" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10 },
      }));

    const flowEdges: Edge[] = analysis.transactions
      .filter((t) => visible(t.transaction.fromId, t.transaction.toId))
      .map((t) => {
        const onPath =
          highlighted.has(t.transaction.fromId) &&
          highlighted.has(t.transaction.toId);
        return {
          id: `tx-${t.transaction.id}`,
          source: t.transaction.fromId,
          target: t.transaction.toId,
          label: formatEur(t.transaction.amount),
          animated: onPath,
          style: {
            stroke: onPath
              ? "var(--risk-high)"
              : t.level === "critical" || t.level === "high"
                ? "var(--risk-medium)"
                : "var(--primary)",
            strokeWidth: onPath ? 2.5 : 1.5,
          },
          labelStyle: { fontSize: 8, fill: "var(--muted-foreground)" },
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        };
      });

    return [...relationEdges, ...flowEdges];
  }, [analysis, highlighted, visibleIds]);

  return (
    <div className="relative h-[420px] w-full">
      {hiddenCount > 0 && (
        <p className="absolute left-2 top-2 z-10 rounded-full border border-border bg-card/90 px-3 py-1 text-[11px] text-muted-foreground shadow-card">
          Zobrazených {visibleEntities.length} najrizikovejších — ďalších{" "}
          {hiddenCount} skrytých
        </p>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => onSelect(node.id)}
      >
        <Background gap={16} color="var(--border)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default NetworkGraph;
