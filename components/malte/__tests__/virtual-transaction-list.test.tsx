// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { computeVirtualWindow } from "@/components/malte/virtual-window";
import { TransactionList } from "@/components/malte/RecordLists";
import type { Entity, Transaction } from "@/forensic";

function makeEntities(count: number): Entity[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `entity-${i}`,
    name: `Subjekt ${i}`,
    kind: "company" as const,
    role: "test",
    country: "SK",
    x: 0,
    y: 0,
  }));
}

function makeTransactions(count: number): Transaction[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `tx-${i}`,
    date: "2026-03-05",
    amount: 100 + i,
    currency: "EUR",
    method: "transfer" as const,
    fromId: "entity-0",
    toId: "entity-1",
    originCountry: "SK",
    destinationCountry: "SK",
    description: `Popis ${i}`,
  }));
}

describe("computeVirtualWindow (P3-02)", () => {
  it("prázdny zoznam nemá žiadne viditeľné riadky", () => {
    const win = computeVirtualWindow({
      itemCount: 0,
      rowHeight: 76,
      viewportHeight: 640,
      scrollTop: 0,
      overscan: 8,
    });
    expect(win).toEqual({
      startIndex: 0,
      endIndex: -1,
      totalHeight: 0,
      offsetTop: 0,
    });
  });

  it("na začiatku renderuje len prvé okno + overscan", () => {
    const win = computeVirtualWindow({
      itemCount: 12_000,
      rowHeight: 76,
      viewportHeight: 640,
      scrollTop: 0,
      overscan: 8,
    });
    // ceil(640/76) = 9 viditeľných + 8 overscan nad rámec
    expect(win.startIndex).toBe(0);
    expect(win.endIndex).toBe(9 + 8);
    expect(win.totalHeight).toBe(12_000 * 76);
    expect(win.offsetTop).toBe(0);
  });

  it("pri scrollovaní do prostredia presunie okno a offset", () => {
    const win = computeVirtualWindow({
      itemCount: 12_000,
      rowHeight: 76,
      viewportHeight: 640,
      scrollTop: 76 * 5_000,
      overscan: 8,
    });
    expect(win.startIndex).toBe(5_000 - 8);
    expect(win.endIndex).toBe(5_000 + 9 + 8);
    expect(win.offsetTop).toBe((5_000 - 8) * 76);
  });

  it("na konci zoznamu okno nepretiekne za posledný riadok", () => {
    const win = computeVirtualWindow({
      itemCount: 100,
      rowHeight: 76,
      viewportHeight: 640,
      scrollTop: 100 * 76,
      overscan: 8,
    });
    expect(win.endIndex).toBe(99);
    expect(win.startIndex).toBe(92);
  });
});

describe("VirtualTransactionList (P3-02 — 12 000 transakcií)", () => {
  const bigProps = {
    caseId: "case-1",
    entities: makeEntities(2),
    transactions: makeTransactions(12_000),
    baseCurrency: "EUR",
    revisions: {} as Record<string, number>,
    onChanged: () => {},
  };

  it("renderuje len viditeľné okno, nie všetkých 12 000 riadkov", () => {
    const { container, unmount } = render(<TransactionList {...bigProps} />);

    const rendered = container.querySelectorAll("[data-transaction-id]");
    // Konštantne ohraničený DOM (okno + overscan) namiesto 12 000 uzlov.
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(60);

    const scroller = container.querySelector('[role="list"]');
    expect(scroller?.getAttribute("data-virtual-count")).toBe(
      String(rendered.length),
    );
    unmount();
  });

  it("po scrollovaní na koniec zobrazí posledné transakcie a zabudne prvé", () => {
    const { container, unmount } = render(<TransactionList {...bigProps} />);

    const scroller = container.querySelector('[role="list"]') as HTMLElement;
    const rowHeight = 76;
    const total = 12_000;

    act(() => {
      scroller.scrollTop = (total - 5) * rowHeight;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    const rendered = Array.from(
      container.querySelectorAll("[data-transaction-id]"),
    ).map((el) => el.getAttribute("data-transaction-id"));
    expect(rendered).toContain(`tx-${total - 1}`);
    expect(rendered).not.toContain("tx-0");
    expect(rendered.length).toBeLessThan(60);
    unmount();
  });

  it("malý zoznam pod prahom sa nerenderuje virtualizovane", () => {
    const { container, unmount } = render(
      <TransactionList
        {...bigProps}
        transactions={bigProps.transactions.slice(0, 50)}
      />,
    );
    // Malý zoznam: všetkých 50 riadkov priamo v DOM (bez scroll kontajnera).
    expect(
      container.querySelectorAll("[data-transaction-id]").length,
    ).toBe(50);
    expect(container.querySelector('[role="list"]')).toBeNull();
    unmount();
  });
});
