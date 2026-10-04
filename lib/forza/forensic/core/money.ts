/**
 * Peňažná aritmetika s pevnou presnosťou.
 *
 * Konvencia znamienok: suma transakcie je *podpísaná* a vždy sa vzťahuje na smer
 * `fromId → toId`. Kladná suma = peniaze odišli od `fromId` k `toId`.
 * Záporná suma = opačný tok (storno, vrátka, odchádzajúca korekcia) — je povolená.
 * Pre objemové ukazovatele sa preto používa absolútna hodnota.
 *
 * Rôzne meny sa nikdy nesčítavajú do jednej sumy. Súčty sa počítajú vždy
 * per mena; „objem prípadu" je objem v základnej mene prípadu.
 */

export const MONEY_SCALE = 2;
const CENT_FACTOR = 10 ** MONEY_SCALE;

export function moneyToCents(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Peňažná hodnota musí byť konečné číslo.");
  }
  const scaled = Number((Math.abs(value) * CENT_FACTOR).toPrecision(12));
  const cents = Math.sign(value) * Math.round(scaled);
  if (!Number.isSafeInteger(cents)) {
    throw new Error("Peňažná hodnota presahuje bezpečný rozsah centov.");
  }
  return cents;
}

export function centsToMoney(cents: number): number {
  if (!Number.isSafeInteger(cents)) {
    throw new Error("Suma v centoch musí byť bezpečné celé číslo.");
  }
  return cents / CENT_FACTOR;
}

/** Zaokrúhli na 2 desatinné miesta (half-up na kladných aj záporných hodnotách). */
export function roundMoney(value: number): number {
  // toPrecision odstráni binárnu odchýlku (1.005 je v plávajúcej čiarke 1.00499…),
  // aby zaokrúhlenie zodpovedalo desatinnému zápisu, ktorý zadal používateľ.
  return centsToMoney(moneyToCents(value));
}

/** Súčet v jednej mene — sčítava v centoch, aby nevznikala chyba plávajúcej čiarky. */
export function sumMoney(values: number[]): number {
  return centsToMoney(values.reduce((sum, value) => sum + moneyToCents(value), 0));
}

/** Objem = súčet absolútnych hodnôt (smer neurčuje veľkosť toku). */
export function sumVolume(values: number[]): number {
  return sumMoney(values.map((value) => Math.abs(value)));
}

/** Rozdelí sumy podľa meny. Nikdy nekonvertuje — konverzia musí byť explicitná. */
export function sumByCurrency<T extends { amount: number; currency: string }>(
  items: T[],
): Record<string, number> {
  const centsByCurrency: Record<string, number> = {};
  for (const item of items) {
    const key = item.currency || "EUR";
    centsByCurrency[key] =
      (centsByCurrency[key] ?? 0) + moneyToCents(Math.abs(item.amount));
  }
  return Object.fromEntries(
    Object.entries(centsByCurrency).map(([currency, cents]) => [
      currency,
      centsToMoney(cents),
    ]),
  );
}

export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: MONEY_SCALE,
  }).format(value);
}
