/**
 * P3-02 — čisté výpočtové jadro windowing virtualizácie.
 *
 * Určuje, ktoré riadky sú viditeľné v okne s daným scroll offsetom; používam ho
 * VirtualTransactionList pre zoznamy 10 000+ transakcií, aby DOM obsahoval len
 * pár desiatok riadkov namiesto všetkých (plynulé 60 FPS scrollovanie).
 */
export type VirtualWindowInput = {
  itemCount: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  /** Koľko riadkov navyš renderovať nad/pod oknom (default 0). */
  overscan?: number;
};

export type VirtualWindow = {
  /** Prvý renderovaný riadok (index). */
  startIndex: number;
  /** Posledný renderovaný riadok (index); -1 pri prázdnom zozname. */
  endIndex: number;
  /** Celková výška virtuálneho zoznamu (scrollTop rozsah). */
  totalHeight: number;
  /** translate offset prvého renderovaného riadku. */
  offsetTop: number;
};

export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const overscan = Math.max(0, Math.floor(input.overscan ?? 0));
  if (input.itemCount <= 0 || input.rowHeight <= 0) {
    return { startIndex: 0, endIndex: -1, totalHeight: 0, offsetTop: 0 };
  }

  const rowHeight = input.rowHeight;
  const totalHeight = input.itemCount * rowHeight;
  const scrollTop = Math.max(0, input.scrollTop);
  const firstVisible = Math.floor(scrollTop / rowHeight);
  const viewportRows = Math.max(1, Math.ceil(input.viewportHeight / rowHeight));

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(
    input.itemCount - 1,
    firstVisible + viewportRows + overscan,
  );

  return {
    startIndex,
    endIndex,
    totalHeight,
    offsetTop: startIndex * rowHeight,
  };
}
