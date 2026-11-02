import { expect, test } from "bun:test";
import { markdownLinks } from "./markdown-links";

test("links include reference definitions and images, and skip code and comments", () => {
  const text = [
    "[inline](guide.md) ![image](diagram.png) [reference][guide] [shortcut]",
    "[guide]: details.md", "[shortcut]: other.md", "<!-- [hidden](missing.md) -->",
    "```md", "[fenced](absent.md)", "```", "~~~md", "[tilde](absent.md)", "~~~",
    "`[code](absent.md)`", "", "    [indented](absent.md)",
  ].join("\n");
  expect(markdownLinks(text).sort()).toEqual(["details.md", "diagram.png", "guide.md", "other.md"]);
});


test("link extraction skips fences inside blockquotes and list containers", () => {
  for (const prefix of ["> ", "> > ", "- ", "> - "]) {
    const continuation = prefix.replace("-", " ");
    const text = `${prefix}\`\`\`md\n${continuation}[hidden](missing.md)\n${continuation}\`\`\`\n[shown](guide.md)`;
    expect(markdownLinks(text)).toEqual(["guide.md"]);
  }
});
