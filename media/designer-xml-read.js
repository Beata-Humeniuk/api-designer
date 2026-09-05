function stripPrefix(v) { return v ? String(v).split(':').pop() : v; }
function nsHint(ns) {
  const parts = String(ns || '').split(/[/:]/).filter(function (x) { return x; });
  return parts.length ? parts[parts.length - 1] : '';
}

function schemaSourceName(name) {
  const s = host()[name];
  return (s && s['x-xsd-name']) || name;
}
function schemaSourceNs(name) {
  const s = host()[name];
  return (s && s['x-xsd-ns']) || '';
}
const XSD_PRIMS = {
  string: 'string', normalizedString: 'string', token: 'string', anyURI: 'string', QName: 'string',
  int: 'integer', integer: 'integer', long: 'integer', short: 'integer', byte: 'integer',
  nonNegativeInteger: 'integer', positiveInteger: 'integer', unsignedInt: 'integer', unsignedLong: 'integer',
  decimal: 'number', double: 'number', float: 'number',
  boolean: 'boolean',
  date: 'date', dateTime: 'date-time', time: 'string', duration: 'string',
  base64Binary: 'string', hexBinary: 'string'
};

function xsdToSchemas(roots, opts) {
  opts = opts || {};
  const editableCount = opts.editableCount == null ? roots.length : opts.editableCount;
  const out = {};
  const elementType = {};
  const editableElements = {};
  const origin = {};

  const nodes = opts.trackNodes ? {} : null;
  const elementNodes = opts.trackNodes ? {} : null;
  let curRi = 0;
  const tnsOf = roots.map(function (r) { return (r.getAttribute && r.getAttribute('targetNamespace')) || ''; });

  const defs = {};
  roots.forEach(function (root, ri) {
    Array.prototype.forEach.call(root.children, function (node) {
      const name = node.getAttribute && node.getAttribute('name');
      if (!name) return;
      if (node.localName === 'complexType' || node.localName === 'simpleType' ||
          (node.localName === 'element' && !node.getAttribute('type') && node.getElementsByTagNameNS('*', 'complexType')[0])) {
        (defs[name] = defs[name] || []).push(ri);
      }
    });
  });
  const renames = roots.map(function () { return {}; });
  const taken = {};
  Object.keys(defs).forEach(function (name) {
    const ris = defs[name];
    const namespaces = [];
    ris.forEach(function (ri) { if (namespaces.indexOf(tnsOf[ri]) < 0) namespaces.push(tnsOf[ri]); });
    if (namespaces.length < 2) return;
    const editableRis = ris.filter(function (ri) { return ri < editableCount; });

    const primaryNs = editableRis.length ? tnsOf[editableRis[0]] : null;
    ris.forEach(function (ri) {
      if (primaryNs !== null && tnsOf[ri] === primaryNs) return;
      let alias = name + ' (' + (nsHint(tnsOf[ri]) || 'ns' + (ri + 1)) + ')';
      while (taken[alias] && taken[alias] !== tnsOf[ri] + '|' + name) alias += '*';
      taken[alias] = tnsOf[ri] + '|' + name;
      renames[ri][name] = alias;
    });
  });
  let curRenames = {};
  const resolveRef = function (typeAttr, node) {
    const t = stripPrefix(typeAttr);
    if (curRenames[t]) return curRenames[t];
    const ris = defs[t];
    if (ris && node && node.lookupNamespaceURI) {
      const pfx = String(typeAttr).indexOf(':') >= 0 ? String(typeAttr).split(':')[0] : null;
      const ns = node.lookupNamespaceURI(pfx);
      if (ns) {
        for (let i = 0; i < ris.length; i++) {
          if (tnsOf[ris[i]] === ns && renames[ris[i]][t]) return renames[ris[i]][t];
        }
      }
    }
    return t;
  };
  const prop = function (typeAttr, node) {
    const t = stripPrefix(typeAttr);
    if (!t) return { type: 'object', properties: {} };
    if (XSD_PRIMS[t]) {
      const mapped = XSD_PRIMS[t];
      if (mapped === 'date') return { type: 'string', format: 'date', 'x-xsd': t };
      if (mapped === 'date-time') return { type: 'string', format: 'date-time', 'x-xsd': t };
      return { type: mapped, 'x-xsd': t };
    }
    return { $ref: refPrefix() + resolveRef(typeAttr, node) };
  };
  const complex = function (ct) {
    const schema = { type: 'object', properties: {} };
    const req = [];
    const ext = ct.getElementsByTagNameNS('*', 'extension')[0];
    if (ext && ext.getAttribute('base')) {
      const base = stripPrefix(ext.getAttribute('base'));
      if (!XSD_PRIMS[base]) schema.allOf = [{ $ref: refPrefix() + resolveRef(ext.getAttribute('base'), ext) }];
    }
    const choiceNodes = [];
    const choiceGroups = [];
    Array.prototype.forEach.call(ct.getElementsByTagNameNS('*', 'element'), function (e) {
      const name = e.getAttribute('name') || stripPrefix(e.getAttribute('ref'));
      if (!name) return;

      let anc = e.parentNode, chNode = null, nested = false;
      while (anc && anc !== ct) {
        if (anc.localName === 'complexType' || anc.localName === 'element') { nested = true; break; }
        if (anc.localName === 'choice' && !chNode) chNode = anc;
        anc = anc.parentNode;
      }
      if (nested) return;
      if (chNode) {
        let gi = choiceNodes.indexOf(chNode);
        if (gi < 0) { gi = choiceNodes.length; choiceNodes.push(chNode); choiceGroups.push([]); }
        choiceGroups[gi].push(name);
      }
      let p = prop(e.getAttribute('type') || e.getAttribute('ref'), e);
      const inline = e.getElementsByTagNameNS('*', 'complexType')[0];
      if (!e.getAttribute('type') && inline) {
        const nested = name.charAt(0).toUpperCase() + name.slice(1);
        if (!out[nested]) {
          if (nodes && curRi < editableCount) nodes[nested] = { kind: 'inline', node: inline, tns: tnsOf[curRi] };
          out[nested] = complex(inline);
        }
        p = { $ref: refPrefix() + nested };
      }

      if (e.getAttribute('nillable') === 'true') p.nullable = true;
      const max = e.getAttribute('maxOccurs');
      const min = e.getAttribute('minOccurs');
      if (max === 'unbounded' || (max && parseInt(max, 10) > 1)) {
        p = { type: 'array', items: p };
        if (min !== '0') p.minItems = 1;
      } else if (min !== '0' && !chNode) req.push(name);
      schema.properties[name] = p;
    });
    if (choiceGroups.length) schema['x-xsd-choice'] = choiceGroups;
    Array.prototype.forEach.call(ct.children, function (c) {
      if (c.localName !== 'attribute') return;
      const name = c.getAttribute('name');
      if (!name) return;
      const ap = prop(c.getAttribute('type'), c);
      ap['x-xsd-attribute'] = true;
      schema.properties[name] = ap;
      if (c.getAttribute('use') === 'required') req.push(name);
    });
    if (req.length) schema.required = req;
    return schema;
  };
  roots.forEach(function (root, ri) {
    curRenames = renames[ri];
    curRi = ri;
    const track = function (name, kind, n, host) {
      if (nodes && ri < editableCount) nodes[name] = { kind: kind, node: n, host: host || null, tns: tnsOf[ri] };
    };
    Array.prototype.forEach.call(root.children, function (node) {
      const raw = node.getAttribute && node.getAttribute('name');
      if (!raw) return;
      const name = curRenames[raw] || raw;
      const stamp = function () {
        if (name !== raw && out[name] && typeof out[name] === 'object') {
          out[name]['x-xsd-name'] = raw;
          out[name]['x-xsd-ns'] = tnsOf[ri];
        }
      };
      if (node.localName === 'complexType') { track(name, 'ct', node); out[name] = complex(node); origin[name] = ri; stamp(); }
      else if (node.localName === 'simpleType') {
        const restr = node.getElementsByTagNameNS('*', 'restriction')[0];
        const schema = prop(restr ? restr.getAttribute('base') : 'string', restr);
        if (schema.$ref) { delete schema.$ref; schema.type = 'string'; }
        const enums = restr ? restr.getElementsByTagNameNS('*', 'enumeration') : [];
        if (enums.length) {
          schema.enum = Array.prototype.map.call(enums, function (e) { return e.getAttribute('value'); });
          const ds = Array.prototype.map.call(enums, function (e) {
            const docEl = e.getElementsByTagNameNS('*', 'documentation')[0];
            return docEl ? (docEl.textContent || '').trim() : '';
          });
          if (ds.some(function (x) { return x; })) schema['x-enum-descriptions'] = ds;
        }
        const pat = restr && restr.getElementsByTagNameNS('*', 'pattern')[0];
        if (pat) schema.pattern = pat.getAttribute('value');
        const maxLen = restr && restr.getElementsByTagNameNS('*', 'maxLength')[0];
        if (maxLen) schema.maxLength = Number(maxLen.getAttribute('value'));
        out[name] = schema;
        origin[name] = ri;
        track(name, 'st', node);
        stamp();
      } else if (node.localName === 'element') {
        const inline = node.getElementsByTagNameNS('*', 'complexType')[0];
        let typeName = null;
        if (!node.getAttribute('type') && inline) { track(name, 'el', inline, node); out[name] = complex(inline); origin[name] = ri; typeName = name; stamp(); }
        else if (node.getAttribute('type')) typeName = resolveRef(node.getAttribute('type'), node);
        if (typeName) {
          elementType[raw] = typeName;
          if (tnsOf[ri]) elementType[tnsOf[ri] + '|' + raw] = typeName;
          if (ri < editableCount) editableElements[raw] = typeName;
        }
        if (elementNodes && ri < editableCount) elementNodes[raw] = node;
      }
    });
  });
  return { schemas: out, elementType: elementType, editableElements: editableElements, origin: origin, nodes: nodes, elementNodes: elementNodes };
}

function parseWsdl(doc) {
  const defs = doc.documentElement;
  const meta = {
    name: defs.getAttribute('name') || 'Service',
    namespace: defs.getAttribute('targetNamespace') || '',
    documentation: '',
    operations: []
  };
  Array.prototype.forEach.call(defs.children, function (c) {
    if (c.localName === 'documentation') meta.documentation = (c.textContent || '').trim();
  });
  const messages = {};
  Array.prototype.forEach.call(defs.getElementsByTagNameNS('*', 'message'), function (msg) {
    const part = msg.getElementsByTagNameNS('*', 'part')[0];
    const q = part && (part.getAttribute('element') || part.getAttribute('type'));
    if (!q) return;
    const pfx = q.indexOf(':') >= 0 ? q.split(':')[0] : null;
    messages[msg.getAttribute('name')] = { name: stripPrefix(q), ns: part.lookupNamespaceURI(pfx) || '' };
  });
  const soap = defs.getElementsByTagNameNS('*', 'binding');
  let protocol = '—';
  Array.prototype.forEach.call(soap, function (b) {
    Array.prototype.forEach.call(b.children, function (c) {
      if (c.localName === 'binding' && c.namespaceURI && c.namespaceURI.indexOf('wsdl/soap12') >= 0) protocol = 'SOAP 1.2';
      else if (c.localName === 'binding' && c.namespaceURI && c.namespaceURI.indexOf('wsdl/soap') >= 0 && protocol === '—') protocol = 'SOAP 1.1';
    });
  });
  Array.prototype.forEach.call(defs.getElementsByTagNameNS('*', 'portType'), function (pt) {
    Array.prototype.forEach.call(pt.getElementsByTagNameNS('*', 'operation'), function (op) {
      const entry = { name: op.getAttribute('name'), documentation: '', portType: pt.getAttribute('name') || '', protocol: protocol, input: null, output: null, faults: [] };
      Array.prototype.forEach.call(op.children, function (c) {
        if (c.localName === 'documentation') entry.documentation = (c.textContent || '').trim();
        if (c.localName === 'input') { entry.inputMsg = stripPrefix(c.getAttribute('message')) || ''; entry.input = messages[entry.inputMsg] || null; }
        if (c.localName === 'output') { entry.outputMsg = stripPrefix(c.getAttribute('message')) || ''; entry.output = messages[entry.outputMsg] || null; }
        if (c.localName === 'fault') {
          const fm = stripPrefix(c.getAttribute('message')) || '';
          entry.faults.push({ name: c.getAttribute('name') || '', msgName: fm, className: messages[fm] || null });
        }
      });
      meta.operations.push(entry);
    });
  });
  return meta;
}

function avroToSchemas(root) {
  const out = {};
  function typeOf(t) {
    if (Array.isArray(t)) {
      const nn = t.filter(function (x) { return x !== 'null'; });
      return { prop: typeOf(nn[0] || 'string').prop, optional: t.indexOf('null') >= 0 };
    }
    if (typeof t === 'object' && t) {
      if (t.type === 'record') { walk(t); return { prop: { $ref: refPrefix() + t.name } }; }
      if (t.type === 'enum') { out[t.name] = { type: 'string', enum: t.symbols || [] }; return { prop: { $ref: refPrefix() + t.name } }; }
      if (t.type === 'array') { const inner = typeOf(t.items); return { prop: { type: 'array', items: inner.prop } }; }
      if (t.type === 'map') return { prop: { type: 'object', properties: {} } };
      if (t.type === 'fixed') { out[t.name] = { type: 'string' }; return { prop: { $ref: refPrefix() + t.name } }; }

      if (typeof t.type === 'string' && (AVRO_PRIM_MAP[t.type] || t.logicalType) && Object.keys(t).length > 1) {
        return { prop: avroAnnotatedProp(t) };
      }
      return typeOf(t.type);
    }
    return { prop: AVRO_PRIM_MAP[t] ? { type: AVRO_PRIM_MAP[t], 'x-avro': t } : { type: 'string' } };
  }
  function walk(rec) {
    const schema = { type: 'object', properties: {} };
    const req = [];
    (rec.fields || []).forEach(function (f) {
      const r = typeOf(f.type);
      if (f.doc) r.prop.description = f.doc;
      schema.properties[f.name] = r.prop;
      if (!r.optional) req.push(f.name);
    });
    if (req.length) schema.required = req;
    if (rec.doc) schema.description = rec.doc;
    out[rec.name] = schema;
  }
  if (root && root.type === 'record') walk(root);
  return out;
}

function xmlSchemaMeta(schemaEl, doc, elementType) {
  const meta = { attrs: [], xsdPfx: null, tnsPfx: null, elements: elementType || {}, importDecls: [] };
  if (!schemaEl) return meta;
  const tns = schemaEl.getAttribute('targetNamespace') || '';
  Array.prototype.forEach.call(schemaEl.attributes, function (a) { meta.attrs.push({ name: a.name, value: a.value }); });
  Array.prototype.forEach.call(schemaEl.children, function (c) {
    if (c.localName !== 'import' && c.localName !== 'include') return;
    meta.importDecls.push({
      kind: c.localName,
      namespace: c.getAttribute('namespace') || '',
      schemaLocation: c.getAttribute('schemaLocation') || ''
    });
  });
  const scan = function (el) {
    if (!el || !el.attributes) return;
    Array.prototype.forEach.call(el.attributes, function (a) {
      if (a.name.indexOf('xmlns:') === 0) {
        if (meta.xsdPfx === null && a.value.indexOf('XMLSchema') >= 0 && a.value.indexOf('-instance') < 0) meta.xsdPfx = a.name.slice(6);
        if (meta.tnsPfx === null && tns && a.value === tns) meta.tnsPfx = a.name.slice(6);
      } else if (a.name === 'xmlns' && meta.xsdPfx === null && a.value.indexOf('XMLSchema') >= 0 && a.value.indexOf('-instance') < 0) {
        meta.xsdPfx = '';
      }
    });
  };
  scan(schemaEl);
  scan(doc.documentElement);
  if (meta.xsdPfx === null) {
    meta.xsdPfx = 'xsd';
    meta.attrs.push({ name: 'xmlns:xsd', value: 'http:' + '//www.w3.org/2001/XMLSchema' });
  }
  if (meta.tnsPfx === null && tns) {
    const defNs = schemaEl.getAttribute('xmlns') || (doc.documentElement.getAttribute && doc.documentElement.getAttribute('xmlns'));
    if (defNs === tns) meta.tnsPfx = '';
    else { meta.tnsPfx = 'tns'; }
  }
  if (meta.tnsPfx === null) meta.tnsPfx = '';
  const hasAttr = function (n) { return meta.attrs.some(function (a) { return a.name === n; }); };
  if (meta.xsdPfx && !hasAttr('xmlns:' + meta.xsdPfx)) meta.attrs.push({ name: 'xmlns:' + meta.xsdPfx, value: 'http:' + '//www.w3.org/2001/XMLSchema' });
  if (meta.tnsPfx && tns && !hasAttr('xmlns:' + meta.tnsPfx)) meta.attrs.push({ name: 'xmlns:' + meta.tnsPfx, value: tns });
  return meta;
}

function loadPreview(m) {
  fileName = m.fileName || '';
  hasDoc = !!m.hasDoc;
  RO = false;
  try {
    if (m.avro) {
      docKind = 'avro';
      roFormat = 'Avro';
      avroMeta = { rootName: m.avro.name || 'Record', namespace: m.avro.namespace || null };
      avroOrig = JSON.parse(JSON.stringify(m.avro));
      avroOrigText = typeof m.avroText === 'string' ? m.avroText : null;
      lastWrittenText = avroOrigText;
      spec = { info: { title: m.avro.name || fileName }, components: { schemas: avroToSchemas(m.avro) } };
    } else {
      lastWrittenText = typeof m.xmlText === 'string' ? m.xmlText : null;
      const doc = new DOMParser().parseFromString(m.xmlText, 'text/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new Error(M('error.writeBack'));

      const importedEls = [];
      xmlIncludeTexts = m.xmlIncludes || [];
      (m.xmlIncludes || []).forEach(function (t) {
        try {
          const d = new DOMParser().parseFromString(t, 'text/xml');
          if (d.getElementsByTagName('parsererror').length) return;
          Array.prototype.push.apply(importedEls, Array.prototype.slice.call(d.getElementsByTagNameNS('*', 'schema')));
        } catch (e) {  }
      });
      const markImported = function (conv, editableCount) {
        const imported = {};
        Object.keys(conv.origin).forEach(function (n) { if (conv.origin[n] >= editableCount) imported[n] = true; });
        return imported;
      };
      if (m.xmlFormat === 'wsdl') {
        docKind = 'wsdl';
        roFormat = 'WSDL 1.1';
        wsdlOrigText = m.xmlText;
        wsdlMeta = parseWsdl(doc);
        const schemaEls = Array.prototype.slice.call(doc.getElementsByTagNameNS('*', 'schema'));
        const conv = xsdToSchemas(schemaEls.concat(importedEls), { editableCount: schemaEls.length });
        xmlMeta = xmlSchemaMeta(schemaEls[0] || null, doc, conv.editableElements);
        xmlMeta.imported = markImported(conv, schemaEls.length);
        xmlMeta.origin = conv.origin;
        spec = { info: { title: wsdlMeta.name }, components: { schemas: conv.schemas } };
        const resolveCls = function (msg) {
          if (!msg) return null;
          return conv.elementType[msg.ns + '|' + msg.name] || conv.elementType[msg.name] || msg.name;
        };
        wsdlMeta.operations.forEach(function (o) {
          o._orig = o.name;
          o.inputNs = o.input ? o.input.ns : '';
          o.outputNs = o.output ? o.output.ns : '';
          o.input = resolveCls(o.input);
          o.output = resolveCls(o.output);
          o.faults.forEach(function (f) { f.ns = f.className ? f.className.ns : ''; f.className = resolveCls(f.className); });
        });
        S.selOp = null;
        S.wsdlSelOp = wsdlMeta.operations.length ? wsdlMeta.operations[0].name : null;
        S.view = 'contract';
      } else {
        docKind = 'xsd';
        roFormat = 'XSD';
        xsdOrigText = m.xmlText;
        const conv = xsdToSchemas([doc.documentElement].concat(importedEls), { editableCount: 1 });
        xmlMeta = xmlSchemaMeta(doc.documentElement, doc, conv.editableElements);
        xmlMeta.imported = markImported(conv, 1);
        xmlMeta.origin = conv.origin;
        spec = { info: { title: fileName }, components: { schemas: conv.schemas } };
      }
    }
  } catch (e) {
    spec = null;
    toast(M('error.readFailed', { error: e.message || String(e) }));
    S.view = 'create';
    render();
    return;
  }
  saveStatus = hasDoc ? 'All changes saved' : M('status.preview');
  S.propsOpen = true;
  S.propTarget = { kind: 'interface' };
  if (m.xmlFormat === 'wsdl' || docKind === 'avro') S.view = 'contract';
  else openStructure({ kind: 'models' });
  if (docKind === 'avro') S.propTarget = { kind: 'event' };
  render();
}

function xmlEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xsdPrimName(p) {
  if (!p) return 'string';
  if (p['x-xsd']) return p['x-xsd'];
  if (p.format === 'date') return 'date';
  if (p.format === 'date-time') return 'dateTime';
  if (p.type === 'integer') return 'int';
  if (p.type === 'number') return 'decimal';
  if (p.type === 'boolean') return 'boolean';
  return 'string';
}

function flatProps(s, includeBase) {
  const props = {};
  const req = [];
  const absorb = function (x, depth) {
    if (!x || depth > 12) return;
    if (x.$ref) {
      if (includeBase) absorb(host()[x.$ref.split('/').pop()], depth + 1);
      return;
    }
    (x.allOf || []).forEach(function (y) { absorb(y, depth + 1); });
    Object.keys(x.properties || {}).forEach(function (k) { props[k] = x.properties[k]; });
    (x.required || []).forEach(function (r) { if (req.indexOf(r) < 0) req.push(r); });
  };
  absorb(s, 0);
  return { properties: props, required: req };
}

function xsdWriter(q, tp) {
  const schemas = host();
  const typeAttr = function (p) {
    if (p && p.$ref) return tp + p.$ref.split('/').pop();
    return q + xsdPrimName(p);
  };
  const w = {};
  w.elementLines = function (name, p, required, ind) {
    const L = [];

    let occ = ' minOccurs="' + (required ? '1' : '0') + '" maxOccurs="1"';
    let t = p;
    if (p && p.type === 'array') {
      t = p.items || {};
      occ = ' minOccurs="' + (p.minItems ? '1' : '0') + '" maxOccurs="unbounded"';
    }

    const nil = t && t.nullable === true ? ' nillable="true"' : '';
    if (t && t.type === 'object' && !t.$ref) {
      L.push(ind + '<' + q + 'element name="' + xmlEsc(name) + '"' + occ + nil + '>');
      L.push(ind + '  <' + q + 'complexType>');
      Array.prototype.push.apply(L, w.seqLines(t, ind + '    '));
      L.push(ind + '  </' + q + 'complexType>');
      L.push(ind + '</' + q + 'element>');
      return L;
    }
    L.push(ind + '<' + q + 'element name="' + xmlEsc(name) + '" type="' + xmlEsc(typeAttr(t)) + '"' + occ + nil + '/>');
    return L;
  };
  w.seqLines = function (schema, ind) {
    const L = [];
    const fp = flatProps(schema, false);
    const groups = (schema['x-xsd-choice'] || []).map(function (g) {
      return g.filter(function (n) { return fp.properties[n]; });
    });
    const groupOf = {};
    groups.forEach(function (g, gi) { g.forEach(function (n) { groupOf[n] = gi; }); });
    const emitted = {};
    L.push(ind + '<' + q + 'sequence>');
    Object.keys(fp.properties).forEach(function (n) {
      const gi = groupOf[n];
      if (gi == null) { Array.prototype.push.apply(L, w.elementLines(n, fp.properties[n], fp.required.indexOf(n) >= 0, ind + '  ')); return; }
      if (emitted[gi] || !groups[gi].length) return;
      emitted[gi] = true;
      L.push(ind + '  <' + q + 'choice>');
      groups[gi].forEach(function (m) { Array.prototype.push.apply(L, w.elementLines(m, fp.properties[m], true, ind + '    ')); });
      L.push(ind + '  </' + q + 'choice>');
    });
    L.push(ind + '</' + q + 'sequence>');
    return L;
  };
  w.typeLines = function (n, pad) {
    const L = [];
    const s = schemas[n];
    if (objLike(s)) {
      const base = (s.allOf || []).map(function (x) { return x.$ref ? x.$ref.split('/').pop() : null; }).filter(Boolean)[0];
      L.push(pad + '<' + q + 'complexType name="' + xmlEsc(n) + '">');
      if (base) {
        L.push(pad + '  <' + q + 'complexContent>');
        L.push(pad + '    <' + q + 'extension base="' + xmlEsc(tp + base) + '">');
        Array.prototype.push.apply(L, w.seqLines(s, pad + '      '));
        L.push(pad + '    </' + q + 'extension>');
        L.push(pad + '  </' + q + 'complexContent>');
      } else {
        Array.prototype.push.apply(L, w.seqLines(s, pad + '  '));
      }
      L.push(pad + '</' + q + 'complexType>');
    } else if (s.enum) {
      const ds = s['x-enum-descriptions'] || [];
      L.push(pad + '<' + q + 'simpleType name="' + xmlEsc(n) + '">');
      L.push(pad + '  <' + q + 'restriction base="' + q + 'string">');
      s.enum.forEach(function (v, i) {
        if (ds[i]) {
          L.push(pad + '    <' + q + 'enumeration value="' + xmlEsc(v) + '">');
          L.push(pad + '      <' + q + 'annotation><' + q + 'documentation>' + xmlEsc(ds[i]) + '</' + q + 'documentation></' + q + 'annotation>');
          L.push(pad + '    </' + q + 'enumeration>');
        } else {
          L.push(pad + '    <' + q + 'enumeration value="' + xmlEsc(v) + '"/>');
        }
      });
      L.push(pad + '  </' + q + 'restriction>');
      L.push(pad + '</' + q + 'simpleType>');
    } else {
      L.push(pad + '<' + q + 'simpleType name="' + xmlEsc(n) + '">');
      L.push(pad + '  <' + q + 'restriction base="' + q + xsdPrimName(s) + '">');
      if (s.pattern) L.push(pad + '    <' + q + 'pattern value="' + xmlEsc(s.pattern) + '"/>');
      if (s.minLength != null) L.push(pad + '    <' + q + 'minLength value="' + s.minLength + '"/>');
      if (s.maxLength != null) L.push(pad + '    <' + q + 'maxLength value="' + s.maxLength + '"/>');
      if (s.minimum != null) L.push(pad + '    <' + q + 'minInclusive value="' + s.minimum + '"/>');
      if (s.maximum != null) L.push(pad + '    <' + q + 'maxInclusive value="' + s.maximum + '"/>');
      L.push(pad + '  </' + q + 'restriction>');
      L.push(pad + '</' + q + 'simpleType>');
    }
    return L;
  };
  return w;
}

function buildXsdBody(q, tp, pad) {
  const schemas = host();
  const w = xsdWriter(q, tp);
  const L = [];
  Object.keys(xmlMeta.elements || {}).forEach(function (en) {
    const tn = xmlMeta.elements[en];
    const t = schemas[tn] ? tp + tn : q + 'string';
    L.push(pad + '<' + q + 'element name="' + xmlEsc(en) + '" type="' + xmlEsc(t) + '"/>');
  });
  Object.keys(schemas).forEach(function (n) {
    if (xmlMeta.imported && xmlMeta.imported[n]) return;
    Array.prototype.push.apply(L, w.typeLines(n, pad));
  });
  return L;
}
