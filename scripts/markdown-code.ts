// Use the same container and fence rules for link extraction and path rewriting.
export function markdownLines(text: string): { line: string; content: string; code: boolean }[] {
  let fence = "";
  let listIndent = 0;
  let blank = true;
  let indentedCode = false;
  return text.split(/(?<=\n)/).map((line) => {
    const content = line.replace(/^(?: {0,3}>[ \t]?)+/, "");
    const indent = content.match(/^[ \t]*/)?.[0].replace(/\t/g, "    ").length ?? 0;
    const list = content.match(/^( *)(?:[-+*]|\d+[.)]) +/);
    if (list && !fence) listIndent = list[0].length;
    else if (content.trim() && indent < listIndent) listIndent = 0;
    const body = content.slice(list ? list[0].length : listIndent);
    const marker = body.match(/^ {0,3}(`{3,}|~{3,})([^\n]*)/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = "";
      return { line, content, code: true };
    }
    if (marker && (marker[1][0] !== "`" || !marker[2].includes("`"))) {
      fence = marker[1];
      blank = true;
      return { line, content, code: true };
    }
    if (!content.trim()) { blank = true; return { line, content, code: false }; }
    if (indent >= listIndent + 4 && (blank || indentedCode)) {
      indentedCode = true;
      return { line, content, code: true };
    }
    blank = false;
    indentedCode = false;
    return { line, content, code: false };
  });
}
