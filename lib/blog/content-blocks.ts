/**
 * Jednoduchý "markdown-like" parser obsahu blogu. Súvislé riadky začínajúce
 * "- " sa zoskupia do jedného zoznamu, aby sa <li> nikdy nevykreslilo mimo
 * <ul> (axe `listitem`, WCAG 1.3.1). Prázdny alebo iný riadok zoznam ukončí.
 */
export type BlogBlock =
  | { type: "h1" | "h2" | "p"; text: string }
  | { type: "ul"; items: string[] };

export function parseBlogContent(content: string): BlogBlock[] {
  const blocks: BlogBlock[] = [];
  let openList: { type: "ul"; items: string[] } | null = null;

  for (const line of content.split("\n")) {
    if (line.startsWith("- ")) {
      if (!openList) {
        openList = { type: "ul", items: [] };
        blocks.push(openList);
      }
      openList.items.push(line.slice(2));
      continue;
    }
    openList = null;
    if (line.startsWith("# ")) blocks.push({ type: "h1", text: line.slice(2) });
    else if (line.startsWith("## ")) blocks.push({ type: "h2", text: line.slice(3) });
    else if (line.trim()) blocks.push({ type: "p", text: line });
  }
  return blocks;
}
