// A tiny regex-based XML tokenizer, for tests only: it lets renderSvg's own tests parse the SVG it
// produces and assert the structure in design.md §7.1, without adding a dependency. Not exported
// from the package; imported only by *.test.ts files in this directory.

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated direct text content (not including descendants'). */
  text: string;
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Parse a single well-formed XML document (as renderSvg produces) into a tree rooted at its one root element. */
export function parseXml(source: string): XmlNode {
  const tokenRe = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[^>]+>|[^<]+/g;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(source))) {
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;

    if (token.startsWith('</')) {
      if (!stack.pop()) throw new Error(`parseXml: unmatched closing tag ${token}`);
      continue;
    }

    if (token.startsWith('<')) {
      const selfClosing = /\/>\s*$/.test(token);
      const inner = token.replace(/^<\/?/, '').replace(/\/?>$/, '');
      const spaceIdx = inner.search(/\s/);
      const tag = spaceIdx === -1 ? inner : inner.slice(0, spaceIdx);
      const attrsSrc = spaceIdx === -1 ? '' : inner.slice(spaceIdx);
      const attrs: Record<string, string> = {};
      const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attrRe.exec(attrsSrc))) {
        attrs[attrMatch[1]!] = decodeXmlEntities(attrMatch[2]!);
      }
      const node: XmlNode = { tag, attrs, children: [], text: '' };
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
      else if (root) throw new Error('parseXml: more than one root element');
      else root = node;
      if (!selfClosing) stack.push(node);
      continue;
    }

    // Plain text between tags.
    const parent = stack[stack.length - 1];
    if (parent) parent.text += decodeXmlEntities(token);
  }

  if (stack.length) throw new Error(`parseXml: unclosed tag <${stack[stack.length - 1]!.tag}>`);
  if (!root) throw new Error('parseXml: no root element found');
  return root;
}

/** All descendants (including the node itself) matching `pred`, in document order. */
export function findAll(node: XmlNode, pred: (n: XmlNode) => boolean): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (current: XmlNode) => {
    if (pred(current)) out.push(current);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return out;
}

export function findOne(node: XmlNode, pred: (n: XmlNode) => boolean): XmlNode | undefined {
  return findAll(node, pred)[0];
}

/** The concatenated text of a node's direct text plus all descendants', in document order. */
export function textContent(node: XmlNode): string {
  let out = node.text;
  for (const child of node.children) out += textContent(child);
  return out;
}
