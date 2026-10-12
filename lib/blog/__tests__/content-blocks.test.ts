// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseBlogContent } from "@/lib/blog/content-blocks";
import { blogPosts } from "@/lib/utils";

describe("parseBlogContent", () => {
  it("zoskupí súvislé '- ' riadky do jedného zoznamu", () => {
    expect(parseBlogContent("# T\n\nÚvod\n\n## S\n- a\n- b\n- c")).toEqual([
      { type: "h1", text: "T" },
      { type: "p", text: "Úvod" },
      { type: "h2", text: "S" },
      { type: "ul", items: ["a", "b", "c"] },
    ]);
  });

  it("prázdny alebo iný riadok zoznam ukončí", () => {
    expect(parseBlogContent("- a\n\n- b\ntext\n- c")).toEqual([
      { type: "ul", items: ["a"] },
      { type: "ul", items: ["b"] },
      { type: "p", text: "text" },
      { type: "ul", items: ["c"] },
    ]);
  });

  it("žiadna položka zoznamu v reálnych článkoch neostane mimo ul", () => {
    for (const post of blogPosts) {
      const blocks = parseBlogContent(post.content);
      const bullets = post.content.split("\n").filter((l) => l.startsWith("- ")).length;
      const listed = blocks.flatMap((b) => (b.type === "ul" ? b.items : [])).length;
      expect(listed).toBe(bullets);
    }
  });
});
