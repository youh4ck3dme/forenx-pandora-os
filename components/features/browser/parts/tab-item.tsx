"use client";
import NextImage from "next/image";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  X,
  Volume2,
  Lock,
  Pin,
  RotateCw,
  Copy,
  Shield,
  Trash2,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Tab } from "@/lib/storage";
import { motion } from "framer-motion";
import { FaviconService } from "@/lib/services";

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onClose: (e?: React.MouseEvent | { stopPropagation: () => void }) => void;
  onActivate: () => void;
  onPin: () => void;
  onDuplicate: () => void;
  onCloseOthers: () => void;
  onReload: () => void;
}

export function TabItem({
  tab,
  isActive,
  onClose,
  onActivate,
  onPin,
  onDuplicate,
  onCloseOthers,
  onReload,
}: TabItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : "auto",
  };

  const faviconUrl = tab.favicon || FaviconService.getFaviconUrl(tab.url);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          onClick={onActivate}
          suppressHydrationWarning
          className={cn(
            "group relative flex items-center h-9 px-3 gap-2 text-sm font-medium transition-all duration-300 select-none cursor-default min-w-[160px] max-w-[240px] rounded-t-lg border-t border-x",
            isActive
              ? "bg-background text-foreground border-border z-10 shadow-[0_-2px_10px_rgba(0,0,0,0.1)]"
              : "bg-black/60 text-gray-500 hover:bg-black/80 hover:text-gray-200 border-white/5 hover:border-white/20 hover:shadow-[0_0_15px_rgba(255,255,255,0.05)] border-b-border z-0",
            isDragging && "opacity-50 scale-95",
          )}
        >
          {/* Loading / Favicon / Pin */}
          <div className="flex items-center justify-center w-4 h-4 shrink-0 overflow-hidden rounded-sm">
            {tab.isLoading ? (
              <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : tab.isPinned ? (
              <Pin size={12} className="text-primary rotate-45" />
            ) : faviconUrl ? (
              <NextImage
                src={faviconUrl}
                alt=""
                width={14}
                height={14}
                className="w-3.5 h-3.5 object-contain"
                unoptimized
              />
            ) : (
              <Layers size={12} className="text-muted-foreground/40" />
            )}
          </div>

          {/* Title */}
          <span className="flex-1 truncate text-[11px] leading-none mb-[1px] font-medium tracking-tight">
            {tab.title ||
              (tab.url === "pandora://newtab" ? "New Tab" : "Loading...")}
          </span>

          {/* Audio Indicator */}
          {tab.isMuted !== undefined && (
            <Volume2
              size={11}
              className={cn(
                "text-muted-foreground shrink-0",
                tab.isMuted && "opacity-30",
              )}
            />
          )}

          {/* Close Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose(e);
            }}
            className={cn(
              "p-0.5 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive shrink-0",
              isActive && "opacity-100",
            )}
          >
            <X size={12} />
          </button>

          {/* Active Indicator Line */}
          {isActive && (
            <motion.div
              layoutId="activeTabIndicator"
              className="absolute top-0 left-0 right-0 h-[2.5px] bg-primary rounded-t-full shadow-[0_0_8px_rgba(var(--primary),0.4)]"
            />
          )}
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-[200px] bg-[#0a0a0f]/90 backdrop-blur-2xl rounded-xl border border-white/10 p-1.5 shadow-2xl z-[100] animate-in fade-in zoom-in-95 duration-150">
          <ContextMenu.Item
            className="flex items-center gap-2 px-2.5 py-2 text-xs text-gray-300 outline-none cursor-default select-none rounded-lg hover:bg-white/10 hover:text-white data-[highlighted]:bg-white/10 data-[highlighted]:text-white transition-all"
            onSelect={onReload}
          >
            <RotateCw size={14} className="opacity-60" />
            <span>Reload Tab</span>
          </ContextMenu.Item>

          <ContextMenu.Item
            className="flex items-center gap-2 px-2.5 py-2 text-xs text-gray-300 outline-none cursor-default select-none rounded-lg hover:bg-white/10 hover:text-white data-[highlighted]:bg-white/10 data-[highlighted]:text-white transition-all"
            onSelect={onDuplicate}
          >
            <Copy size={14} className="opacity-60" />
            <span>Duplicate Tab</span>
          </ContextMenu.Item>

          <ContextMenu.Item
            className="flex items-center gap-2 px-2.5 py-2 text-xs text-gray-300 outline-none cursor-default select-none rounded-lg hover:bg-white/10 hover:text-white data-[highlighted]:bg-white/10 data-[highlighted]:text-white transition-all"
            onSelect={onPin}
          >
            <Pin size={14} className="opacity-60" />
            <span>{tab.isPinned ? "Unpin Tab" : "Pin Tab"}</span>
          </ContextMenu.Item>

          <ContextMenu.Separator className="h-px bg-white/5 my-1.5" />

          <ContextMenu.Item
            className="flex items-center gap-2 px-2.5 py-2 text-xs text-gray-300 outline-none cursor-default select-none rounded-lg hover:bg-white/10 hover:text-white data-[highlighted]:bg-white/10 data-[highlighted]:text-white transition-all"
            onSelect={onCloseOthers}
          >
            <Shield size={14} className="opacity-60" />
            <span>Close Other Tabs</span>
          </ContextMenu.Item>

          <ContextMenu.Item
            className="flex items-center gap-2 px-2.5 py-2 text-xs text-red-400 outline-none cursor-default select-none rounded-lg hover:bg-red-500/20 data-[highlighted]:bg-red-500/20 transition-all font-medium"
            onSelect={() => onClose()}
          >
            <Trash2 size={14} className="opacity-80" />
            <span>Close Tab</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
