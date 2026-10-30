/**
 * Tiny tolerant XML tokenizer, enough for SVG files. It does not need the DOM, so the SVG
 * importer also runs in Node (tests) and in Web Workers.
 */
export interface XmlNode {
  /** local name without namespace prefix, original case */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** concatenated character data directly inside the element */
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, g: string) => {
    if (g[0] === '#') {
      const code = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[g] ?? m;
  });
}

function localName(n: string): string {
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
}

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?[^>]*>|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let last = 0;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  const top = () => stack[stack.length - 1];
  while ((m = TOKEN.exec(src))) {
    if (m.index > last) top().text += decode(src.slice(last, m.index));
    last = TOKEN.lastIndex;
    if (m[1] !== undefined) {
      top().text += m[1];
    } else if (m[2] !== undefined) {
      const name = localName(m[2]);
      // close up to the matching element; tolerate stray closing tags
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
    } else if (m[3] !== undefined) {
      const node: XmlNode = { name: localName(m[3]), attrs: {}, children: [], text: '' };
      const attrSrc = m[4] ?? '';
      ATTR.lastIndex = 0;
      let a: RegExpExecArray | null;
      while ((a = ATTR.exec(attrSrc))) {
        const key = a[1];
        const value = a[2] ?? a[3] ?? a[4] ?? '';
        // keep the prefix for xlink:href but drop it for everything else
        node.attrs[key === 'xlink:href' ? 'href' : localName(key)] = decode(value);
      }
      top().children.push(node);
      if (!m[5]) stack.push(node);
    }
  }
  return root;
}

export function findFirst(node: XmlNode, name: string): XmlNode | null {
  for (const c of node.children) {
    if (c.name.toLowerCase() === name) return c;
    const f = findFirst(c, name);
    if (f) return f;
  }
  return null;
}
