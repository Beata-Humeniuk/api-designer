function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function localName(tag) {
  const i = tag.indexOf(':');
  return i < 0 ? tag : tag.slice(i + 1);
}

function parseAttrs(s) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    attrs[m[1] || m[3]] = decodeEntities(m[2] !== undefined ? m[2] : m[4]);
  }
  return attrs;
}

function parseXml(text) {
  const src = String(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<\s*(\/?)\s*([\w:.-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)\s*>|([^<]+)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      const t = m[5];
      if (t.trim()) top.text += decodeEntities(t);
      continue;
    }
    if (m[1] === '/') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = { tag: m[2], attrs: parseAttrs(m[3] || ''), children: [], text: '' };
    top.children.push(node);
    if (m[4] !== '/') stack.push(node);
  }
  return root;
}

function findAll(node, local, out) {
  out = out || [];
  for (const c of node.children || []) {
    if (localName(c.tag) === local) out.push(c);
    findAll(c, local, out);
  }
  return out;
}

module.exports = { parseXml, localName, findAll };
