"use client";

import React, { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useBrowserActions } from "@/lib/hooks";
import { useBrowserStore } from "@/lib/store";
import { TabItem } from "./tab-item";
import { Plus } from "lucide-react";
import { Tab } from "@/lib/storage";

export function TabsManager() {
  const { activeSpace, tabs: allTabs } = useBrowserStore();
  const {
    activeTabId,
    moveTab,
    switchTab,
    closeTab,
    closeOtherTabs,
    pinTab,
    duplicateTab,
    addTab,
    reload,
  } = useBrowserActions();

  // Filter tabs by space
  const tabs = allTabs.filter((t) => (t.spaceId || "default") === activeSpace);

  // Calculate global indices for moveTab
  // This is tricky: moveTab expects indices in the global array if not careful,
  // OR the store handles it. useBrowserActions.moveTab usually takes fromIndex / toIndex.
  // If the store's moveTab implementation just swaps in the array, passing filtered indices will brake it.
  // We strictly need to implement filtering in the store or handle index mapping.
  // Let's check browser-store definition...
  // The store's reorderTabs does: newTabs.splice(fromIndex, 1); newTabs.splice(toIndex, 0, movedTab);
  // So it expects GLOBAL indices.

  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Avoid accidental drags when clicking
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: any) => {
    setActiveDragId(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldLocalIndex = tabs.findIndex((t) => t.id === active.id);
      const newLocalIndex = tabs.findIndex((t) => t.id === over.id);

      // Map to global indices
      const oldGlobalIndex = allTabs.findIndex((t) => t.id === active.id);
      // We need to find where the "over" tab is in the global list to drop it there.
      const overGlobalIndex = allTabs.findIndex((t) => t.id === over.id);

      // Wait, standard arrayMove logic uses swapping.
      // If I just swap global indices it should be fine IF the relative order is preserved.
      // But if I move a tab from pos 0 to 5 in "filtered", it might mean 0 to 10 in global.

      // Let's use the ACTION from useBrowserActions if it supports IDs, or update store to support moving by ID.
      // Currently useBrowserStore has: reorderTabs: (fromIndex: number, toIndex: number)
      // It uses indices. This is dangerous with filtering.

      // Safer approach: Calculate the target index in the global array.
      // When we drop 'A' over 'B', we want 'A' to take 'B's place.
      moveTab(oldGlobalIndex, overGlobalIndex);
    }
    setActiveDragId(null);
  };

  return (
    <div className="flex h-10 w-full items-end gap-1 px-2 pt-1 relative app-region-drag">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabs.map((t) => t.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex flex-1 items-end gap-1 overflow-x-auto no-scrollbar pb-[1px]">
            {tabs.map((tab: Tab) => (
              <TabItem
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onClose={() => closeTab(tab.id)}
                onActivate={() => switchTab(tab.id)}
                onPin={() => pinTab(tab.id)}
                onDuplicate={() => duplicateTab(tab.id)}
                onCloseOthers={() => closeOtherTabs(tab.id)}
                onReload={() => reload()}
              />
            ))}
          </div>
        </SortableContext>

        <DragOverlay adjustScale={true}>
          {activeDragId ? (
            <TabItem
              tab={tabs.find((t) => t.id === activeDragId)!}
              isActive={true}
              onClose={() => {}}
              onActivate={() => {}}
              onPin={() => {}}
              onDuplicate={() => {}}
              onCloseOthers={() => {}}
              onReload={() => {}}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* New Tab Button */}
      <button
        onClick={() => addTab()}
        className="flex items-center justify-center w-8 h-8 mb-1 rounded-md hover:bg-muted text-muted-foreground transition-colors"
        title="New Tab (Ctrl+T)"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
