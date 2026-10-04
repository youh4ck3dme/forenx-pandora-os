"use client";

import { useEffect, useRef, useState } from "react";
import { SectionTitle } from "@/components/malte/Shell";
import { TransactionRow } from "@/components/malte/RecordLists";
import { computeVirtualWindow } from "@/components/malte/virtual-window";
import type { Entity, Transaction } from "@/forensic";

/**
 * P3-02 — virtualizovaný zoznam transakcií pre veľké prípady (10 000+).
 *
 * Renderuje len viditeľné okno riadkov (+ overscan), takže DOM obsahuje
 * konštantne pár desiatok uzlov bez ohľadu na počet transakcií — scrollovanie
 * zostáva plynulé (60 FPS) aj pri 100 000 položkách.
 */

const ROW_HEIGHT = 76;
const OVERSCAN = 8;
const DEFAULT_VIEWPORT_HEIGHT = 640;

type ListProps = {
  caseId: string;
  entities: Entity[];
  transactions: Transaction[];
  baseCurrency: string;
  revisions: Record<string, number>;
  onChanged: () => void;
};

export function VirtualTransactionList({
  caseId,
  entities,
  transactions,
  baseCurrency,
  revisions,
  onChanged,
}: ListProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const names = new Map(entities.map((entity) => [entity.id, entity.name]));

  // Reálne výška viewportu po pripojení (v jsdom/testoch ostane default).
  useEffect(() => {
    const el = containerRef.current;
    if (el && el.clientHeight > 0) {
      setViewportHeight(el.clientHeight);
    }
  }, []);

  const win = computeVirtualWindow({
    itemCount: transactions.length,
    rowHeight: ROW_HEIGHT,
    viewportHeight,
    scrollTop,
    overscan: OVERSCAN,
  });

  const visible = transactions.slice(win.startIndex, win.endIndex + 1);

  return (
    <>
      <SectionTitle>Zadané transakcie ({transactions.length.toLocaleString("sk-SK")})</SectionTitle>
      <p className="text-caption mb-2">
        Virtuálny zoznam — renderuje sa len viditeľná časť, pre plynulé
        scrollovanie veľkého objemu dát.
      </p>
      <div
        ref={containerRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        style={{ overflowY: "auto", maxHeight: viewportHeight }}
        role="list"
        aria-label="Virtuálny zoznam transakcií"
        data-virtual-count={visible.length}
      >
        <div style={{ height: win.totalHeight, position: "relative" }}>
          <div style={{ transform: `translateY(${win.offsetTop}px)` }}>
            {visible.map((transaction, index) => (
              <div
                key={transaction.id}
                style={{ height: ROW_HEIGHT }}
                className="pb-2"
              >
                <TransactionRow
                  transaction={transaction}
                  caseId={caseId}
                  entities={entities}
                  baseCurrency={baseCurrency}
                  names={names}
                  revision={revisions[transaction.id]}
                  editing={editing === transaction.id}
                  onEdit={setEditing}
                  onChanged={onChanged}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
