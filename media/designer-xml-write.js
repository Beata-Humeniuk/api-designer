function buildSchemaString() {
  const q = xmlMeta.xsdPfx ? xmlMeta.xsdPfx + ':' : '';
  const tp = xmlMeta.tnsPfx ? xmlMeta.tnsPfx + ':' : '';
  const attrs = xmlMeta.attrs.map(function (a) { return ' ' + a.name + '="' + xmlEsc(a.value) + '"'; }).join('');
  const imports = (xmlMeta.importDecls || []).map(function (d) {
    return '  <' + q + d.kind +
      (d.namespace ? ' namespace="' + xmlEsc(d.namespace) + '"' : '') +
      (d.schemaLocation ? ' schemaLocation="' + xmlEsc(d.schemaLocation) + '"' : '') + '/>';
  });
  return '<' + q + 'schema' + attrs + '>\n' + imports.concat(buildXsdBody(q, tp, '  ')).join('\n') + '\n</' + q + 'schema>';
}

const XSD_NS = 'http:' + '//www.w3.org/2001/XMLSchema';

function xmlOwnedBy(e, ct) {
  let anc = e.parentNode;
  while (anc && anc !== ct) {
    if (anc.localName === 'complexType' || anc.localName === 'element') return false;
    anc = anc.parentNode;
  }
  return anc === ct;
}

function findOwnElementNode(ct, name) {
  const list = ct.getElementsByTagNameNS('*', 'element');
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!xmlOwnedBy(e, ct)) continue;
    if ((e.getAttribute('name') || stripPrefix(e.getAttribute('ref'))) === name) return e;
  }
  return null;
}

function findOwnAttributeNode(ct, name) {
  for (let i = 0; i < ct.children.length; i++) {
    const c = ct.children[i];
    if (c.localName === 'attribute' && c.getAttribute('name') === name) return c;
  }
  return null;
}

function findOwnGroupNode(ct) {
  let found = null;
  const walk = function (node) {
    for (let i = 0; i < node.children.length && !found; i++) {
      const c = node.children[i];
      if (c.localName === 'sequence' || c.localName === 'all') { found = c; return; }
      if (c.localName === 'complexContent' || c.localName === 'extension' || c.localName === 'restriction') walk(c);
    }
  };
  walk(ct);
  return found;
}

function findOwnExtensionNode(ct) {
  const list = ct.getElementsByTagNameNS('*', 'extension');
  for (let i = 0; i < list.length; i++) {
    if (xmlOwnedBy(list[i], ct)) return list[i];
  }
  return null;
}

function xmlIndentOf(node) {
  const t = node.previousSibling;
  if (t && t.nodeType === 3) {
    const m = /\n([ \t]*)$/.exec(t.nodeValue);
    if (m) return m[1];
  }
  return '';
}

function xmlRemoveNode(node) {
  const t = node.previousSibling;
  if (t && t.nodeType === 3 && !t.nodeValue.trim()) t.parentNode.removeChild(t);
  node.parentNode.removeChild(node);
}

function parseXsdFragment(doc, contextEl, xml) {
  let decls = '';
  const seen = {};
  let n = contextEl;
  while (n && n.attributes) {
    for (let i = 0; i < n.attributes.length; i++) {
      const a = n.attributes[i];
      if ((a.name === 'xmlns' || a.name.indexOf('xmlns:') === 0) && !seen[a.name]) {
        seen[a.name] = 1;
        decls += ' ' + a.name + '="' + xmlEsc(a.value) + '"';
      }
    }
    n = n.parentNode && n.parentNode.attributes ? n.parentNode : null;
  }
  const d = new DOMParser().parseFromString('<x' + decls + '>' + xml + '</x>', 'text/xml');
  if (d.getElementsByTagName('parsererror').length) throw new Error(M('error.writeBack'));
  return Array.prototype.slice.call(d.documentElement.childNodes).map(function (c) { return doc.importNode(c, true); });
}

function xmlAppendLines(parent, lines) {
  const doc = parent.ownerDocument;
  const frag = parseXsdFragment(doc, parent, '\n' + lines.join('\n'));
  let anchor = parent.lastChild;
  if (!(anchor && anchor.nodeType === 3 && !anchor.nodeValue.trim() && anchor.nodeValue.indexOf('\n') >= 0)) anchor = null;
  for (let i = 0; i < frag.length; i++) parent.insertBefore(frag[i], anchor);
  if (!anchor) parent.appendChild(doc.createTextNode('\n' + xmlIndentOf(parent)));
}

function xsdChildIndent(group) {
  for (let i = 0; i < group.children.length; i++) {
    const ind = xmlIndentOf(group.children[i]);
    if (ind) return ind;
  }
  return (xmlIndentOf(group) || '') + '  ';
}

function xsdPatchCtx(schemaEl) {
  const q = schemaEl.prefix ? schemaEl.prefix + ':' : '';
  const tns = schemaEl.getAttribute('targetNamespace') || '';
  let tp = '';
  if (tns) {
    const pfx = schemaEl.lookupPrefix(tns);
    if (pfx) tp = pfx + ':';
    else if (schemaEl.lookupNamespaceURI(null) === tns) tp = '';
    else { schemaEl.setAttribute('xmlns:tns', tns); tp = 'tns:'; }
  }
  return { q: q, tp: tp, tns: tns, schemaEl: schemaEl };
}

function refBaseOf(s) {
  const a = s.allOf || [];
  for (let i = 0; i < a.length; i++) if (a[i] && a[i].$ref) return a[i].$ref.split('/').pop();
  return null;
}

function xsdCoreKey(p) {
  if (!p) return 'prim:string';
  if (p.$ref) return 'ref:' + p.$ref.split('/').pop();
  if (p.type === 'object') return 'object';
  return 'prim:' + xsdPrimName(p);
}

function xsdTypeAttrFor(ctx, node, core) {
  if (core.$ref) {
    const n = core.$ref.split('/').pop();
    const s = host()[n];
    if (s && s['x-xsd-name']) {
      const pfx = node.lookupPrefix(s['x-xsd-ns']);
      if (!pfx) return null;
      return pfx + ':' + s['x-xsd-name'];
    }
    if (/[^A-Za-z0-9_.-]/.test(n)) return null;
    return ctx.tp + n;
  }
  return ctx.q + xsdPrimName(core);
}

function renameXsdType(doc, entry, from, to) {
  if (entry.kind === 'el') entry.host.setAttribute('name', to);
  else if (entry.kind !== 'inline') entry.node.setAttribute('name', to);

  const attrs = entry.kind === 'el' ? ['ref', 'element'] : ['type', 'base'];
  const tns = entry.tns || '';
  const all = doc.getElementsByTagNameNS('*', '*');
  for (let i = 0; i < all.length; i++) {
    for (let j = 0; j < attrs.length; j++) {
      const v = all[i].getAttribute(attrs[j]);
      if (!v || stripPrefix(v) !== from) continue;
      const pfx = v.indexOf(':') >= 0 ? v.split(':')[0] : null;
      if ((all[i].lookupNamespaceURI(pfx) || '') !== tns) continue;
      all[i].setAttribute(attrs[j], (pfx ? pfx + ':' : '') + to);
    }
  }
}

function createXsdGroupNode(ct, ctx) {
  const doc = ct.ownerDocument;
  const holder = findOwnExtensionNode(ct) || ct;
  const seq = doc.createElementNS(XSD_NS, ctx.q + 'sequence');
  const pad = (xmlIndentOf(holder) || '') + '  ';
  let anchor = null;
  for (let i = 0; i < holder.children.length; i++) {
    const ln = holder.children[i].localName;
    if (ln === 'attribute' || ln === 'attributeGroup' || ln === 'anyAttribute') { anchor = holder.children[i]; break; }
  }
  if (anchor) {
    const ws = anchor.previousSibling && anchor.previousSibling.nodeType === 3 && !anchor.previousSibling.nodeValue.trim() ? anchor.previousSibling : anchor;
    holder.insertBefore(doc.createTextNode('\n' + pad), ws);
    holder.insertBefore(seq, ws);
  } else {
    const tail = holder.lastChild;
    if (tail && tail.nodeType === 3 && !tail.nodeValue.trim() && tail.nodeValue.indexOf('\n') >= 0) {
      holder.insertBefore(doc.createTextNode('\n' + pad), tail);
      holder.insertBefore(seq, tail);
    } else {
      holder.appendChild(doc.createTextNode('\n' + pad));
      holder.appendChild(seq);
      holder.appendChild(doc.createTextNode('\n' + (xmlIndentOf(holder) || '')));
    }
  }
  return seq;
}

function patchXsdPropNode(ctx, ct, node, name, bpv, cpv, bR, cR) {
  if (node.localName === 'attribute') {
    if (xsdCoreKey(bpv) !== xsdCoreKey(cpv)) {
      if (xsdCoreKey(cpv) === 'object') return false;
      const v = xsdTypeAttrFor(ctx, node, cpv);
      if (v == null) return false;
      node.setAttribute('type', v);
    }
    if (bR !== cR) { if (cR) node.setAttribute('use', 'required'); else node.removeAttribute('use'); }
    return true;
  }
  const bWrap = !!(bpv && bpv.type === 'array'), cWrap = !!(cpv && cpv.type === 'array');
  const bCore = bWrap ? (bpv.items || {}) : (bpv || {});
  const cCore = cWrap ? (cpv.items || {}) : (cpv || {});
  let inChoice = false;
  let anc = node.parentNode;
  while (anc && anc !== ct) { if (anc.localName === 'choice') { inChoice = true; break; } anc = anc.parentNode; }
  if (bWrap !== cWrap || (cWrap && !!(bpv && bpv.minItems) !== !!cpv.minItems)) {
    if (cWrap) {
      node.setAttribute('maxOccurs', 'unbounded');
      node.setAttribute('minOccurs', cpv.minItems ? '1' : '0');
    } else {
      node.removeAttribute('maxOccurs');
      if (cR || inChoice) node.removeAttribute('minOccurs'); else node.setAttribute('minOccurs', '0');
    }
  } else if (!cWrap && bR !== cR && !inChoice) {
    if (cR) node.removeAttribute('minOccurs'); else node.setAttribute('minOccurs', '0');
  }
  if (!!bCore.nullable !== !!cCore.nullable) {
    if (cCore.nullable) node.setAttribute('nillable', 'true');
    else node.removeAttribute('nillable');
  }
  if (xsdCoreKey(bCore) !== xsdCoreKey(cCore)) {
    if (xsdCoreKey(cCore) === 'object') return false;
    const v = xsdTypeAttrFor(ctx, node, cCore);
    if (v == null) return false;

    for (let i = node.children.length - 1; i >= 0; i--) {
      if (node.children[i].localName === 'complexType' || node.children[i].localName === 'simpleType') xmlRemoveNode(node.children[i]);
    }
    if (!node.firstElementChild) { while (node.firstChild) node.removeChild(node.firstChild); }
    if (!node.getAttribute('name') && node.getAttribute('ref')) { node.setAttribute('name', name); node.removeAttribute('ref'); }
    node.setAttribute('type', v);
  }
  return true;
}

function patchXsdComplex(doc, ctx, ct, b, c) {
  const bBase = refBaseOf(b), cBase = refBaseOf(c);
  if (bBase !== cBase) {
    if (!bBase || !cBase) return false;
    const ext = findOwnExtensionNode(ct);
    if (!ext) return false;
    const old = ext.getAttribute('base') || '';
    const pfx = old.indexOf(':') >= 0 ? old.split(':')[0] + ':' : ctx.tp;
    ext.setAttribute('base', pfx + cBase);
  }
  if (JSON.stringify(b['x-xsd-choice'] || []) !== JSON.stringify(c['x-xsd-choice'] || [])) return false;
  const bp = b.properties || {}, cp = c.properties || {};
  const bReq = b.required || [], cReq = c.required || [];
  const removed = [], added = [];
  Object.keys(bp).forEach(function (k) { if (!(k in cp)) removed.push(k); });
  Object.keys(cp).forEach(function (k) { if (!(k in bp)) added.push(k); });

  const pairs = [];
  for (let i = removed.length - 1; i >= 0; i--) {
    for (let j = 0; j < added.length; j++) {
      if (JSON.stringify(bp[removed[i]]) !== JSON.stringify(cp[added[j]])) continue;
      pairs.push({ from: removed[i], to: added[j] });
      removed.splice(i, 1);
      added.splice(j, 1);
      break;
    }
  }
  for (let i = 0; i < pairs.length; i++) {
    const node = findOwnElementNode(ct, pairs[i].from) || findOwnAttributeNode(ct, pairs[i].from);
    if (!node || !node.getAttribute('name')) return false;
    node.setAttribute('name', pairs[i].to);
    const bR = bReq.indexOf(pairs[i].from) >= 0, cR = cReq.indexOf(pairs[i].to) >= 0;
    if (bR !== cR && !patchXsdPropNode(ctx, ct, node, pairs[i].to, bp[pairs[i].from], cp[pairs[i].to], bR, cR)) return false;
  }
  for (let i = 0; i < removed.length; i++) {
    const node = findOwnElementNode(ct, removed[i]) || findOwnAttributeNode(ct, removed[i]);
    if (!node) return false;
    xmlRemoveNode(node);
  }
  if (added.length) {
    const w = xsdWriter(ctx.q, ctx.tp);
    let group = findOwnGroupNode(ct);
    if (!group) group = createXsdGroupNode(ct, ctx);
    const ind = xsdChildIndent(group);
    for (let i = 0; i < added.length; i++) {
      xmlAppendLines(group, w.elementLines(added[i], cp[added[i]], cReq.indexOf(added[i]) >= 0, ind));
    }
  }
  const keys = Object.keys(cp);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!(k in bp)) continue;
    const bR = bReq.indexOf(k) >= 0, cR = cReq.indexOf(k) >= 0;
    if (bR === cR && JSON.stringify(bp[k]) === JSON.stringify(cp[k])) continue;
    const node = findOwnElementNode(ct, k) || findOwnAttributeNode(ct, k);
    if (!node) return false;
    if (!patchXsdPropNode(ctx, ct, node, k, bp[k], cp[k], bR, cR)) return false;
  }
  return true;
}

function patchXsdSimple(doc, ctx, st, b, c) {
  const restr = st.getElementsByTagNameNS('*', 'restriction')[0];
  if (!restr) return false;
  if (xsdPrimName(b) !== xsdPrimName(c)) restr.setAttribute('base', ctx.q + xsdPrimName(c));
  const bE = b.enum || [], cE = c.enum || [];
  const bD = b['x-enum-descriptions'] || [], cD = c['x-enum-descriptions'] || [];
  if (JSON.stringify([bE, bD]) !== JSON.stringify([cE, cD])) {
    const byVal = {};
    const enNodes = [];
    for (let i = 0; i < restr.children.length; i++) {
      if (restr.children[i].localName === 'enumeration') enNodes.push(restr.children[i]);
    }
    for (let i = 0; i < enNodes.length; i++) {
      const v = enNodes[i].getAttribute('value');
      if (cE.indexOf(v) < 0) xmlRemoveNode(enNodes[i]);
      else byVal[v] = enNodes[i];
    }
    const ind = xsdChildIndent(restr);
    for (let i = 0; i < cE.length; i++) {
      const v = cE[i];
      const want = (cD[i] || '').trim();
      const n = byVal[v];
      if (!n) {
        const L = [];
        if (want) {
          L.push(ind + '<' + ctx.q + 'enumeration value="' + xmlEsc(v) + '">');
          L.push(ind + '  <' + ctx.q + 'annotation><' + ctx.q + 'documentation>' + xmlEsc(want) + '</' + ctx.q + 'documentation></' + ctx.q + 'annotation>');
          L.push(ind + '</' + ctx.q + 'enumeration>');
        } else {
          L.push(ind + '<' + ctx.q + 'enumeration value="' + xmlEsc(v) + '"/>');
        }
        xmlAppendLines(restr, L);
        continue;
      }
      const bIdx = bE.indexOf(v);
      const had = bIdx >= 0 ? (bD[bIdx] || '').trim() : '';
      if (had === want) continue;
      const docEl = n.getElementsByTagNameNS('*', 'documentation')[0];
      if (want) {
        if (docEl) docEl.textContent = want;
        else xmlAppendLines(n, [ind + '  <' + ctx.q + 'annotation><' + ctx.q + 'documentation>' + xmlEsc(want) + '</' + ctx.q + 'documentation></' + ctx.q + 'annotation>']);
      } else if (docEl) {
        const ann = docEl.parentNode && docEl.parentNode.localName === 'annotation' ? docEl.parentNode : docEl;
        xmlRemoveNode(ann);
        if (!n.firstElementChild) { while (n.firstChild) n.removeChild(n.firstChild); }
      }
    }
  }
  const setFacet = function (local, bV, cV) {
    if (bV === cV || (bV == null && cV == null)) return;
    let f = null;
    for (let i = 0; i < restr.children.length; i++) {
      if (restr.children[i].localName === local) { f = restr.children[i]; break; }
    }
    if (cV == null || cV === '') { if (f) xmlRemoveNode(f); return; }
    if (f) { f.setAttribute('value', String(cV)); return; }
    xmlAppendLines(restr, [xsdChildIndent(restr) + '<' + ctx.q + local + ' value="' + xmlEsc(String(cV)) + '"/>']);
  };
  setFacet('pattern', b.pattern, c.pattern);
  setFacet('minLength', b.minLength, c.minLength);
  setFacet('maxLength', b.maxLength, c.maxLength);
  setFacet('minInclusive', b.minimum, c.minimum);
  setFacet('maxInclusive', b.maximum, c.maximum);
  return true;
}

function rebuildXsdType(doc, ctx, entry, name) {
  const pad = xmlIndentOf(entry.node) || '  ';
  const w = xsdWriter(ctx.q, ctx.tp);
  const frag = parseXsdFragment(doc, entry.node, w.typeLines(name, pad).join('\n'));
  let el = null;
  for (let i = 0; i < frag.length; i++) if (frag[i].nodeType === 1) { el = frag[i]; break; }
  if (!el) throw new Error(M('error.writeBack'));
  if (entry.kind === 'el' || entry.kind === 'inline') {
    if (el.localName !== 'complexType') throw new Error(M('error.writeBack'));
    el.removeAttribute('name');
  }
  entry.node.parentNode.replaceChild(el, entry.node);
  entry.node = el;
}

function patchXsdType(doc, ctx, entry, name, b, c) {
  const bObj = objLike(b), cObj = objLike(c);
  let ok = false;
  if (bObj && cObj) ok = patchXsdComplex(doc, ctx, entry.node, b, c);
  else if (!bObj && !cObj && entry.kind === 'st') ok = patchXsdSimple(doc, ctx, entry.node, b, c);
  if (!ok) rebuildXsdType(doc, ctx, entry, name);
}

function appendXsdType(doc, ctx, name) {
  const schemaEl = ctx.schemaEl;
  let pad = '  ';
  for (let i = schemaEl.children.length - 1; i >= 0; i--) {
    const ind = xmlIndentOf(schemaEl.children[i]);
    if (ind) { pad = ind; break; }
  }
  const w = xsdWriter(ctx.q, ctx.tp);
  xmlAppendLines(schemaEl, w.typeLines(name, pad));
}

function patchXmlTypes(doc, schemaEls) {
  const importedEls = [];
  (xmlIncludeTexts || []).forEach(function (t) {
    try {
      const d = new DOMParser().parseFromString(t, 'text/xml');
      if (d.getElementsByTagName('parsererror').length) return;
      Array.prototype.push.apply(importedEls, Array.prototype.slice.call(d.getElementsByTagNameNS('*', 'schema')));
    } catch (e) { }
  });
  const conv = xsdToSchemas(schemaEls.concat(importedEls), { editableCount: schemaEls.length, trackNodes: true });
  const base = conv.schemas;
  const nodes = conv.nodes;
  const cur = host();
  const ctx = xsdPatchCtx(schemaEls[0]);
  let changed = false;

  (xmlRenames || []).forEach(function (r) {
    const entry = nodes[r.from];
    if (!entry || base[r.from] == null || base[r.to] != null) return;
    base[r.to] = base[r.from]; delete base[r.from];
    nodes[r.to] = entry; delete nodes[r.from];
    Object.keys(conv.editableElements).forEach(function (k) {
      if (conv.editableElements[k] === r.from) conv.editableElements[k] = r.to;
    });
    renameXsdType(doc, entry, r.from, r.to);
    changed = true;
  });

  Object.keys(nodes).forEach(function (n) {
    if (cur[n] != null || base[n] == null) return;
    xmlRemoveNode(nodes[n].kind === 'el' ? nodes[n].host : nodes[n].node);
    changed = true;
  });
  Object.keys(cur).forEach(function (n) {
    if (base[n] != null) return;
    if (xmlMeta.imported && xmlMeta.imported[n]) return;
    appendXsdType(doc, ctx, n);
    changed = true;
  });
  Object.keys(nodes).forEach(function (n) {
    if (cur[n] == null || base[n] == null) return;
    if (JSON.stringify(base[n]) === JSON.stringify(cur[n])) return;
    patchXsdType(doc, ctx, nodes[n], n, base[n], cur[n]);
    changed = true;
  });

  const bEl = conv.editableElements || {};
  const cEl = (xmlMeta && xmlMeta.elements) || {};
  Object.keys(cEl).forEach(function (k) {
    const node = conv.elementNodes && conv.elementNodes[k];
    if (!node || !(k in bEl) || !node.getAttribute('type')) return;
    const tn = cEl[k];
    if (bEl[k] === tn && cur[tn]) return;
    const want = cur[tn] ? ctx.tp + tn : ctx.q + 'string';
    if (node.getAttribute('type') === want) return;
    if (bEl[k] === tn && !cur[tn] && XSD_PRIMS[stripPrefix(node.getAttribute('type'))]) return;
    node.setAttribute('type', want);
    changed = true;
  });
  return changed;
}

function xmlStartTagAt(text, tagName, from) {
  const m = new RegExp('<' + tagName + '(?:"[^"]*"|\'[^\']*\'|[^>\'"])*>').exec(text.slice(from));
  return m && m.index === 0 ? m[0] : null;
}

function xmlAttrSnapshot(el) {
  const a = [];
  for (let i = 0; i < el.attributes.length; i++) a.push(el.attributes[i].name + '=' + el.attributes[i].value);
  return a.join('');
}

function reserializeRoot(origText, rootEl, attrSnapshotBefore) {
  const rootStart = origText.indexOf('<' + rootEl.tagName);
  const prefix = rootStart >= 0 ? origText.slice(0, rootStart) : '<?xml version="1.0" encoding="UTF-8"?>\n';
  const rootEnd = origText.lastIndexOf('</' + rootEl.tagName);
  let suffix = '\n';
  if (rootEnd >= 0) {
    const gt = origText.indexOf('>', rootEnd);
    if (gt >= 0) suffix = origText.slice(gt + 1);
  }
  let root = new XMLSerializer().serializeToString(rootEl);
  if (rootStart >= 0 && xmlAttrSnapshot(rootEl) === attrSnapshotBefore) {
    const origTag = xmlStartTagAt(origText, rootEl.tagName, rootStart);
    const newTag = xmlStartTagAt(root, rootEl.tagName, 0);
    if (origTag && newTag) root = origTag + root.slice(newTag.length);
  }
  let text = prefix + root + suffix;
  if (text.slice(-1) !== '\n') text += '\n';
  return text;
}

function serializeXsd() {
  const doc = new DOMParser().parseFromString(xsdOrigText, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(M('error.writeBack'));
  const schemaEl = doc.documentElement;
  if (schemaEl.localName !== 'schema') throw new Error(M('error.writeBack'));
  const rootAttrs = xmlAttrSnapshot(schemaEl);
  const changed = patchXmlTypes(doc, [schemaEl]);
  if (!changed) return { text: xsdOrigText };
  return { text: reserializeRoot(xsdOrigText, schemaEl, rootAttrs) };
}

function jsonSpanTree(text) {
  let i = 0;
  const ws = function () { while (i < text.length && ' \t\n\r'.indexOf(text[i]) >= 0) i++; };
  const str = function () {
    const from = i;
    i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === '"') { i++; break; }
      i++;
    }
    return JSON.parse(text.slice(from, i));
  };
  const node = function (start) {
    const n = { start: start, end: i, text: text.slice(start, i) };
    n.inline = n.text.indexOf('\n') < 0;
    return n;
  };
  const value = function () {
    ws();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i++;
      const props = {}, seps = {};
      let comma = null;
      for (;;) {
        ws();
        if (i >= text.length || text[i] === '}') { i++; break; }
        if (text[i] === ',') {
          const cs = i;
          i++;
          ws();
          if (comma === null) comma = text.slice(cs, i);
          continue;
        }
        const k = str();
        const sepStart = i;
        ws();
        i++;
        const v = value();
        seps[k] = text.slice(sepStart, v.start);
        props[k] = v;
      }
      const n = node(start);
      n.kind = 'object'; n.props = props; n.seps = seps; n.comma = comma;
      return n;
    }
    if (c === '[') {
      i++;
      const items = [];
      let comma = null;
      for (;;) {
        ws();
        if (i >= text.length || text[i] === ']') { i++; break; }
        if (text[i] === ',') {
          const cs = i;
          i++;
          ws();
          if (comma === null) comma = text.slice(cs, i);
          continue;
        }
        items.push(value());
      }
      const n = node(start);
      n.kind = 'array'; n.items = items; n.comma = comma;
      return n;
    }
    if (c === '"') {
      const v = str();
      const n = node(start);
      n.kind = 'scalar'; n.value = v;
      return n;
    }
    while (i < text.length && '},] \t\n\r'.indexOf(text[i]) < 0) i++;
    const n = node(start);
    n.kind = 'scalar';
    try { n.value = JSON.parse(n.text); } catch (e) { n.value = undefined; }
    return n;
  };
  try { return value(); } catch (e) { return null; }
}

function repeatStr(unit, n) {
  let out = '';
  for (let k = 0; k < n; k++) out += unit;
  return out;
}

function jsonSrcItem(src, item, idx) {
  if (!src || src.kind !== 'array') return null;
  if (item && typeof item === 'object' && !Array.isArray(item) && typeof item.name === 'string') {
    for (let k = 0; k < src.items.length; k++) {
      const it = src.items[k];
      if (it.kind === 'object' && it.props.name && it.props.name.value === item.name) return it;
    }
  }
  return src.items[idx] || null;
}

function jsonSame(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let k = 0; k < a.length; k += 1) if (!jsonSame(a[k], b[k])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!jsonSame(a[k], b[k])) return false;
  }
  return true;
}

function spanValue(src) {
  if (!src || !src.text) return undefined;
  if (src.parsed === undefined) {
    try { src.parsed = JSON.parse(src.text); } catch (e) { src.parsed = null; }
  }
  return src.parsed;
}

function emitJson(node, src, depth, unit, donor, parentInline) {
  const style = src || donor || null;
  if (node === null || typeof node !== 'object') {
    if (src && src.kind === 'scalar' && src.value === node) return src.text;
    return JSON.stringify(node);
  }
  if (src && src.text && jsonSame(node, spanValue(src))) return src.text;
  const inline = style ? style.inline : !!parentInline;
  const padIn = repeatStr(unit, depth + 1);
  const padOut = repeatStr(unit, depth);
  const spaced = style && style.text.slice(1, 2) === ' ' ? ' ' : '';
  const comma = (style && style.comma) || ', ';
  if (Array.isArray(node)) {
    if (!node.length) return '[]';
    const itemDonor = function (own) {
      if (own) return null;
      if (src && src.items && src.items.length) return src.items[0];
      return donor && donor.items && donor.items.length ? donor.items[0] : null;
    };
    const parts = node.map(function (item, k) {
      const own = jsonSrcItem(src, item, k);
      return emitJson(item, own, depth + 1, unit, itemDonor(own), inline);
    });
    if (!inline) return '[\n' + padIn + parts.join(',\n' + padIn) + '\n' + padOut + ']';
    return '[' + spaced + parts.join(comma) + spaced + ']';
  }
  const keys = Object.keys(node);
  if (!keys.length) return '{}';
  const sepOf = function (k) {
    const seps = (src && src.seps) || (donor && donor.seps);
    if (seps) {
      if (seps[k]) return seps[k];
      const first = Object.keys(seps)[0];
      if (first) return seps[first];
    }
    return ': ';
  };
  const parts = keys.map(function (k) {
    const own = src && src.props ? src.props[k] : null;
    const kd = own ? null : (donor && donor.props ? donor.props[k] : null);
    return JSON.stringify(k) + sepOf(k) + emitJson(node[k], own, depth + 1, unit, kd, inline);
  });
  if (!inline) return '{\n' + padIn + parts.join(',\n' + padIn) + '\n' + padOut + '}';
  return '{' + spaced + parts.join(comma) + spaced + '}';
}

function jsonInLayoutOf(value, origText) {
  const crlf = !!origText && origText.indexOf('\r\n') >= 0;
  const text = crlf ? origText.replace(/\r\n/g, '\n') : origText;
  const src = text ? jsonSpanTree(text) : null;
  const m = text && text.match(/\n([ \t]+)[^ \t\n]/);
  const body = emitJson(value, src, 0, m ? m[1] : '  ', null, false);
  const tail = text ? text.slice(text.replace(/\s+$/, '').length) : '\n';
  const out = body + tail;
  return crlf ? out.replace(/\n/g, '\r\n') : out;
}

function avroBaseOf(t) {
  if (t == null) return null;
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) {
    const nn = t.filter(function (x) { return x !== 'null'; });
    return nn.length ? avroBaseOf(nn[0]) : 'null';
  }
  if (typeof t === 'object') return avroBaseOf(t.type);
  return null;
}
function copyKeys(o) {
  const c = {};
  Object.keys(o).forEach(function (k) { c[k] = o[k]; });
  return c;
}

function serializeAvro() {
  const schemas = host();
  let rootName = avroMeta.rootName;
  if (!schemas[rootName] || !objLike(schemas[rootName])) {
    rootName = Object.keys(schemas).filter(function (n) { return objLike(schemas[n]); })[0];
    if (!rootName) throw new Error(M('error.writeBack'));
    avroMeta.rootName = rootName;
  }
  const defined = {};
  const prim = function (p) {
    if (!p) return 'string';

    if (p['x-avro-raw']) return JSON.parse(JSON.stringify(p['x-avro-raw']));
    if (p['x-avro']) return p['x-avro'];
    if (p.type === 'integer') return 'long';
    if (p.type === 'number') return 'double';
    if (p.type === 'boolean') return 'boolean';
    return 'string';
  };

  const primOf = function (p, ot) {

    if (p && p['x-avro-raw']) return prim(p);
    const base = prim(p);
    return ot != null && typeof base === 'string' && avroBaseOf(ot) === base ? ot : base;
  };
  let recordFor;
  const typeFor = function (p, ot) {
    if (!p) return 'string';
    if (p.$ref) {
      const n = p.$ref.split('/').pop();
      const s = schemas[n];
      if (!s) return 'string';
      if (defined[n]) return n;
      const named = ot && typeof ot === 'object' && !Array.isArray(ot) && ot.name === n ? ot : null;
      if (s.enum) {
        defined[n] = 1;
        const symbols = (s.enum || []).map(String);
        if (named && named.type === 'enum') {
          const e = copyKeys(named);
          e.symbols = symbols;
          if (e.default != null && symbols.indexOf(e.default) < 0) delete e.default;
          return e;
        }
        return { type: 'enum', name: n, symbols: symbols };
      }
      if (objLike(s)) return recordFor(n, named && named.type === 'record' ? named : null);
      return primOf(s, named && named.type === 'fixed' ? named : null);
    }
    if (p.type === 'array') {
      const oa = ot && typeof ot === 'object' && ot.type === 'array' ? ot : null;
      const a = oa ? copyKeys(oa) : { type: 'array' };
      a.items = typeFor(p.items, oa ? oa.items : null);
      return a;
    }
    if (p.type === 'object') {
      if (!p.properties || !Object.keys(p.properties).length) {
        return ot && avroBaseOf(ot) === 'map' ? ot : { type: 'map', values: 'string' };
      }
      throw new Error(M('error.avroAnonObject'));
    }
    return primOf(p, ot);
  };

  const fieldType = function (p, ot, optional) {
    const union = Array.isArray(ot) ? ot : null;
    const hadNull = !!union && union.indexOf('null') >= 0;
    const inner = typeFor(p, union ? union.filter(function (x) { return x !== 'null'; })[0] : ot);
    if (!optional) return inner;
    if (!union || !hadNull) return ['null', inner];
    if (union.length > 2) return union.indexOf(inner) >= 0 ? union : ['null', inner];
    return union[0] === 'null' ? ['null', inner] : [inner, 'null'];
  };
  recordFor = function (n, orec) {
    defined[n] = 1;
    const s = schemas[n];
    const rec = orec ? copyKeys(orec) : { type: 'record', name: n };
    rec.type = 'record';
    rec.name = n;
    if (n === rootName) {
      if (avroMeta.namespace) rec.namespace = avroMeta.namespace;
      else delete rec.namespace;
    }
    if (s.description) rec.doc = s.description;
    else delete rec.doc;
    const ofields = orec && Array.isArray(orec.fields) ? orec.fields : [];
    const fp = flatProps(s, true);
    const names = Object.keys(fp.properties);
    const taken = {};
    const origField = function (fname, idx) {
      for (let k = 0; k < ofields.length; k++) {
        if (!taken[k] && ofields[k] && ofields[k].name === fname) { taken[k] = true; return ofields[k]; }
      }

      const cand = ofields[idx];
      if (cand && !taken[idx] && names.indexOf(cand.name) < 0) { taken[idx] = true; return cand; }
      return null;
    };
    rec.fields = names.map(function (fn, idx) {
      const p = fp.properties[fn];
      const of = origField(fn, idx);
      const optional = fp.required.indexOf(fn) < 0;
      const f = of ? copyKeys(of) : {};
      f.name = fn;
      f.type = fieldType(p, of ? of.type : null, optional);
      if (p.description) f.doc = p.description;
      else delete f.doc;
      if (optional) { if (f.default === undefined) f.default = null; }
      else if (f.default === null) delete f.default;
      return f;
    });
    return rec;
  };
  const root = recordFor(rootName, avroOrig && avroOrig.type === 'record' ? avroOrig : null);
  const un = Object.keys(schemas).filter(function (n) { return !defined[n] && objLike(schemas[n]); });
  return {
    text: jsonInLayoutOf(root, avroOrigText),
    warn: un.length ? M('warn.avroUnreachable', { names: un.join(', '), root: rootName }) : null
  };
}
