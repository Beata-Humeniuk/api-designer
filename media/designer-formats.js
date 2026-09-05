function serializeWsdl() {
  const doc = new DOMParser().parseFromString(wsdlOrigText, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(M('error.writeBack'));
  const rootEl = doc.documentElement;
  const rootAttrs = xmlAttrSnapshot(rootEl);
  const schemaEls = Array.prototype.slice.call(doc.getElementsByTagNameNS('*', 'schema'));
  if (schemaEls.length) {
    let patched = false;
    try { patchXmlTypes(doc, schemaEls); patched = true; } catch (e) {  }
    if (!patched) {
      const nd = new DOMParser().parseFromString(buildSchemaString(), 'text/xml');
      if (nd.getElementsByTagName('parsererror').length) throw new Error(M('error.writeBack'));
      schemaEls[0].parentNode.replaceChild(doc.importNode(nd.documentElement, true), schemaEls[0]);
      for (let i = 1; i < schemaEls.length; i++) schemaEls[i].parentNode.removeChild(schemaEls[i]);
    }
  }
  const setDocEl = function (parent, text) {
    let d = null;
    Array.prototype.forEach.call(parent.children, function (c) { if (c.localName === 'documentation') d = c; });
    if (text) {
      if (!d) {
        d = doc.createElementNS(parent.namespaceURI, (parent.prefix ? parent.prefix + ':' : '') + 'documentation');
        parent.insertBefore(d, parent.firstChild);
      }
      d.textContent = text;
    } else if (d) {
      parent.removeChild(d);
    }
  };
  setDocEl(doc.documentElement, wsdlMeta.documentation);
  wsdlMeta.operations.forEach(function (o) {
    if (!o._orig) return;
    Array.prototype.forEach.call(doc.getElementsByTagNameNS('*', 'operation'), function (opEl) {
      if (opEl.getAttribute('name') !== o._orig) return;
      opEl.setAttribute('name', o.name);
      if (opEl.parentNode && opEl.parentNode.localName === 'portType') setDocEl(opEl, o.documentation);
    });
  });
  return { text: reserializeRoot(wsdlOrigText, rootEl, rootAttrs) };
}

function serializeDoc() {
  if (docKind === 'avro') return serializeAvro();
  if (docKind === 'xsd') {
    try {
      return serializeXsd();
    } catch (e) {
      return {
        text: '<?xml version="1.0" encoding="UTF-8"?>\n' + buildSchemaString() + '\n',
        warn: M('warn.xsdRebuilt', { error: e.message || String(e) })
      };
    }
  }
  if (docKind === 'wsdl') return serializeWsdl();
  throw new Error(M('error.writeBack'));
}

function avroView() {
  const wrap = el('div', { style: 'height:100%;display:flex;flex-direction:column;overflow:hidden' });
  const head = el('div', { id: 'ophead' });
  head.appendChild(el('div', { cls: 'titlerow' },
    el('span', { style: 'color:var(--fg-bright);font-size:20px;font-weight:600', text: avroMeta.rootName })));
  head.appendChild(el('div', { cls: 'secheadrow' }, el('div', { cls: 'sechead', text: 'Information' })));
  const grid = el('div', { cls: 'grid' });
  if (avroMeta.namespace) {
    grid.appendChild(fld({ label: 'namespace', kind: 'text', mono: true, disabled: true, value: avroMeta.namespace, onChange: function () {} }));
  }
  head.appendChild(grid);
  wrap.appendChild(head);
  const cols = el('div', { cls: 'col3' });
  const center = el('div', { id: 'opprops' });
  const rootSchema = spec.components && spec.components.schemas && spec.components.schemas[avroMeta.rootName];
  center.appendChild(el('div', { cls: 'sechead', text: 'Fields' }));
  if (rootSchema && rootSchema.type === 'object' && rootSchema.properties) {
    const grid2 = el('div', { cls: 'grid2' });
    Object.keys(rootSchema.properties).forEach(function (propName) {
      const prop = rootSchema.properties[propName];
      const isRequired = rootSchema.required && rootSchema.required.indexOf(propName) >= 0;
      const typeStr = typeLabelOf(prop) + (prop.type === 'array' ? '[]' : '');
      const cell = el('div', { cls: 'fieldrow' },
        el('span', { style: 'font-weight:500;flex:1', text: propName }),
        el('span', { style: 'font-size:12px;color:var(--fg-dim);font-family:monospace', text: typeStr }),
        el('span', { style: 'font-size:11px;color:var(--fg-dim)', text: isRequired ? 'required' : 'optional' }));
      if (prop.description) {
        const desc = el('div', { style: 'grid-column:1 / span 2;font-size:12px;color:var(--fg-dim);padding:4px 8px 8px' });
        desc.textContent = prop.description;
        grid2.appendChild(cell);
        grid2.appendChild(desc);
      } else {
        grid2.appendChild(cell);
      }
    });
    center.appendChild(grid2);
  } else {
    center.appendChild(el('div', { style: 'color:var(--fg-dim);font-size:12px', text: M('empty.noFields') }));
  }
  cols.appendChild(center);
  const right = el('div', { id: 'reqresp' });
  const inner = el('div', { cls: 'inner' });
  right.appendChild(inner);
  const otherSchemas = spec.components && spec.components.schemas ? Object.keys(spec.components.schemas).filter(function (n) { return n !== avroMeta.rootName; }) : [];
  if (otherSchemas.length) {
    inner.appendChild(el('div', { cls: 'sechead', style: 'margin-bottom:8px', text: 'Types' }));
    otherSchemas.forEach(function (name) {
      const item = el('div', { cls: 'respitem', style: 'margin-bottom:6px' },
        el('span', { style: 'width:11px;height:11px;border-radius:2px;background:var(--green);flex:none' }),
        el('span', { cls: 'model', style: 'flex:1;font-size:13px', text: name }));
      if (host()[name]) {
        item.appendChild(el('span', { cls: 'openbtn', title: 'Open', text: '→', onClick: function () { openStructure({ kind: 'model', name: name }); } }));
      }
      inner.appendChild(item);
    });
  }
  cols.appendChild(right);
  wrap.appendChild(cols);
  return wrap;
}

function wsdlView() {
  const wrap = el('div', { style: 'height:100%;display:flex;flex-direction:column;overflow:hidden' });
  const head = el('div', { id: 'ophead' });
  head.appendChild(el('div', { cls: 'titlerow' },
    el('span', { style: 'color:var(--fg-bright);font-size:20px;font-weight:600', text: wsdlMeta.name })));
  const grid = el('div', { cls: 'grid' });
  grid.appendChild(fld({ label: 'namespace', kind: 'text', mono: true, disabled: true, value: wsdlMeta.namespace, onChange: function () {} }));
  grid.appendChild(fld({ label: 'documentation', kind: 'text', value: wsdlMeta.documentation, onChange: function (v) { wsdlMeta.documentation = v.trim(); markDirty(); } }));
  head.appendChild(grid);
  wrap.appendChild(head);
  const cols = el('div', { cls: 'col3' });
  const op = wsdlMeta.operations.find(function (o) { return o.name === S.wsdlSelOp; }) || wsdlMeta.operations[0];
  const center = el('div', { id: 'opprops' });
  center.appendChild(el('div', { cls: 'sechead', text: op ? op.name : 'Operation' }));
  if (!op) center.appendChild(el('div', { style: 'color:var(--fg-dim);font-size:12px', text: M('error.noOperations') }));
  cols.appendChild(center);
  const right = el('div', { id: 'reqresp' });
  const inner = el('div', { cls: 'inner' });
  right.appendChild(inner);
  if (op) {

    const tile = function (label, msgName, className, ns, dot, tight) {
      if (label) inner.appendChild(el('div', { cls: 'sechead', style: 'margin-bottom:8px', text: label }));
      const typeLabel = className ? schemaSourceName(className) : '';
      const main = msgName || typeLabel || '(none)';
      const item = el('div', { cls: 'respitem', style: 'margin-bottom:' + (tight ? '6px' : '16px') },
        el('span', { style: 'width:11px;height:11px;border-radius:2px;background:' + dot + ';flex:none' }),
        el('span', { cls: 'model', style: 'flex:1;font-size:13px', title: ns || '', text: main }));
      const hint = ns && ns !== wsdlMeta.namespace ? nsHint(ns) : '';
      if (typeLabel && typeLabel !== main) {
        item.appendChild(el('span', { style: 'font-size:11px;color:var(--fg-dim);flex:none', title: ns || '', text: typeLabel }));
      }
      if (hint && main.indexOf(hint) < 0 && (!typeLabel || typeLabel === main || typeLabel.indexOf(hint) < 0)) {
        item.appendChild(el('span', { style: 'font-size:11px;color:var(--fg-dim);flex:none', title: ns, text: hint }));
      }
      if (className && host()[className]) {
        item.appendChild(el('span', { cls: 'openbtn', title: 'Open', text: '→', onClick: function () {

          const sk = 'model:' + className;
          if (xmlMeta && xmlMeta.imported && xmlMeta.imported[className] && xmlMeta.origin && !S.extra[sk]) {
            const ri = xmlMeta.origin[className];
            S.extra[sk] = Object.keys(xmlMeta.origin).filter(function (n) {
              return xmlMeta.origin[n] === ri && n !== className && objLike(host()[n]);
            });
          }
          openStructure({ kind: 'model', name: className });
        } }));
      }
      inner.appendChild(item);
    };
    tile('Request', op.inputMsg, op.input, op.inputNs, 'var(--mget)');
    tile('Response', op.outputMsg, op.output, op.outputNs, 'var(--mpost)');
    if (op.faults.length) {
      inner.appendChild(el('div', { cls: 'sechead', style: 'margin-bottom:8px', text: 'Faults' }));
      op.faults.forEach(function (f) {
        tile(null, f.msgName || f.name, f.className, f.ns, 'var(--mdel)', true);
      });
    }
  }
  cols.appendChild(right);
  wrap.appendChild(cols);
  return wrap;
}

render();
