function deriveClassModel() {
  const nodes = [], links = [], byId = {};
  const lt = linkTypes();

  function addNode(id, name, schema, named) {
    if (byId[id]) return byId[id];
    const n = { id: id, name: name, schema: schema, named: named };
    byId[id] = n;
    nodes.push(n);
    return n;
  }
  function linkType(fromId, prop, fallback) {
    return lt[fromId + '|' + prop] || fallback;
  }
  function processInto(node, schema, depth) {
    if (!schema || typeof schema !== 'object' || depth > 6) return;
    const ph = propsHost(schema);
    (schema.allOf || []).forEach(function (part) {
      const parent = refName(part.$ref);
      if (parent) {
        ensureNamed(parent, depth + 1);
        links.push({ from: node.id, to: parent, type: 'inheritance', mult: '', prop: null, name: '' });
      } else if (part !== ph) {
        processInto(node, part, depth + 1);
      }
    });
    const req = ph.required || [];
    Object.keys(ph.properties || {}).forEach(function (fname) {
      const prop = ph.properties[fname];
      if (!prop || typeof prop !== 'object') return;
      const isReq = req.indexOf(fname) >= 0;
      const target = refName(prop.$ref);
      const itemTarget = prop.type === 'array' && prop.items ? refName(prop.items.$ref) : null;
      const plainType = function (name) { const ts = host()[name]; return !!(ts && primLike(ts) && !ts.enum); };
      if (target && !plainType(target)) {
        ensureNamed(target, depth + 1);
        links.push({ from: node.id, to: target, type: linkType(node.id, fname, 'association'), mult: isReq ? '1' : '0..1', prop: fname, name: fname });
      } else if (itemTarget && !plainType(itemTarget)) {
        ensureNamed(itemTarget, depth + 1);
        links.push({ from: node.id, to: itemTarget, type: linkType(node.id, fname, 'association'), mult: (prop.minItems >= 1 || isReq) ? '1..*' : '0..*', prop: fname, name: fname });
      } else if (target || itemTarget) {
      } else if (prop.properties || (prop.type === 'array' && prop.items && prop.items.properties)) {
        const inner = prop.properties ? prop : prop.items;
        const cid = node.id + '.' + fname;
        const child = addNode(cid, node.name + '.' + fname, inner, false);
        links.push({ from: node.id, to: cid, type: linkType(node.id, fname, 'composition'), mult: prop.type === 'array' ? attrMult(prop, isReq).replace(/[\[\]]/g, '') : (isReq ? '1' : '0..1'), prop: fname, name: fname });
        processInto(child, inner, depth + 1);
      }
    });
  }
  function ensureNamed(name, depth) {
    if (byId[name]) return;
    const s = host()[name];
    if (!s) { addNode(name, name, null, true); return; }
    const n = addNode(name, name, s, true);
    processInto(n, s, depth || 0);
  }

  if (S.scope.kind === 'models') {
    Object.keys(host()).forEach(function (name) { if (objLike(host()[name])) ensureNamed(name, 0); });
  } else if (S.scope.kind === 'model') {
    if (host()[S.scope.name]) ensureNamed(S.scope.name, 0);
    (S.extra[scopeKey(S.scope)] || []).forEach(function (name) { ensureNamed(name, 0); });
  } else {
    const root = scopeRootSchema(S.scope);
    if (root) {
      const direct = schemaRefName(root) || (root.type === 'array' && root.items && schemaRefName(root.items));
      if (direct) ensureNamed(direct, 0);
      else {
        const label = S.scope.kind === 'req' ? 'Request' : 'Response ' + S.scope.code;
        const core = root.type === 'array' ? (root.items = root.items || {}) : root;
        const n = addNode('@root', label, core, false);
        processInto(n, core, 0);
      }
    }
    (S.extra[scopeKey(S.scope)] || []).forEach(function (name) { ensureNamed(name, 0); });
  }
  return { nodes: nodes, links: links };
}

function attrRows(node) {
  const out = [];
  if (!node.schema) return out;
  if (node.schema.enum) {
    const descs = node.schema['x-enum-descriptions'] || [];
    node.schema.enum.forEach(function (v, i) { out.push({ name: String(v), type: descs[i] || '', mult: '', readonly: true }); });
    return out;
  }
  if (primLike(node.schema)) {
    out.push({ name: 'extends', type: node.schema.type + (node.schema.format ? ' (' + node.schema.format + ')' : ''), mult: '', readonly: true });
    return out;
  }
  const fp = propsHost(node.schema);
  const req = fp.required || [];
  const names = Object.keys(fp.properties || {});

  const choiceOf = {};
  (fp['x-xsd-choice'] || node.schema['x-xsd-choice'] || []).forEach(function (g) {
    if (!Array.isArray(g)) return;
    const members = g.filter(function (n) { return names.indexOf(n) >= 0; });
    if (members.length < 2) return;
    members.forEach(function (n) { choiceOf[n] = members.length; });
  });
  names.forEach(function (name) {
    const p = fp.properties[name];
    if (!p || typeof p !== 'object') return;
    out.push({
      name: name, prop: p, type: typeLabelOf(p),
      mult: attrMult(p, req.indexOf(name) >= 0 || !!choiceOf[name]),
      choice: choiceOf[name] ? M('choice.caption', { count: choiceOf[name] }) : ''
    });
  });
  return out;
}

function pushHistory() {
  S.past.push(JSON.stringify(spec));
  if (S.past.length > 60) S.past.shift();
  S.future = [];
}
function undo() {
  if (!S.past.length) return;
  S.future.push(JSON.stringify(spec));
  spec = JSON.parse(S.past.pop());
  S.selClass = null; S.selAttr = null;
  markDirty();
}
function redo() {
  if (!S.future.length) return;
  S.past.push(JSON.stringify(spec));
  spec = JSON.parse(S.future.pop());
  S.selClass = null; S.selAttr = null;
  markDirty();
}

function nodeSchema(d, id) {
  const n = d.nodes.find(function (x) { return x.id === id; });
  return n ? n.schema : null;
}

function deleteSelected(d) {
  if (RO) return;
  if (S.selAttr != null && S.selClass) {
    const s = propsHost(nodeSchema(d, S.selClass));
    if (s && s.properties) {
      pushHistory();
      const name = Object.keys(s.properties)[S.selAttr];
      delete s.properties[name];
      dropRequired(s, name);
      S.selAttr = null;
      markDirty();
    }
    return;
  }
  if (S.selClass) {
    const id = S.selClass;
    if (id.indexOf('.') >= 0 || id[0] === '@') { toast(M('error.nestedClassDelete')); return; }
    const used = d.links.filter(function (l) { return l.to === id && l.from !== id; });
    if (used.length) { toast(M('error.inUse', { name: id, by: used.map(function (l) { return l.from; }).join(', ') })); return; }
    pushHistory();
    delete host()[id];
    delete positions()[id];
    S.selClass = null;
    S.propTarget = { kind: 'none' };
    markDirty();
  }
}

function treeMultText(mult) {
  const m = String(mult || '').replace(/[\[\]]/g, '').replace(/\*/g, '∞');
  return m === '1' ? '' : m;
}

function treeOpenState(key) {
  if (Object.prototype.hasOwnProperty.call(S.treeOpen, key)) return S.treeOpen[key];
  return S.treeAll;
}

function treeRoots() {
  const roots = [];
  const seen = {};
  const add = function (id, name, schema, named) {
    if (seen[id]) return;
    seen[id] = true;
    roots.push({ id: id, name: name, schema: schema, named: named });
  };
  const addExtras = function () {
    (S.extra[scopeKey(S.scope)] || []).forEach(function (name) { if (host()[name]) add(name, name, host()[name], true); });
  };
  if (S.scope.kind === 'models') {
    const all = Object.keys(host()).filter(function (name) { return objLike(host()[name]); });
    const referenced = {};
    all.forEach(function (name) {
      const into = {};
      collectRefNames(host()[name], into);
      Object.keys(into).forEach(function (r) { if (r !== name) referenced[r] = true; });
    });
    let tops = all.filter(function (n) { return !referenced[n]; });
    if (!tops.length) tops = all;
    tops.forEach(function (name) { add(name, name, host()[name], true); });
  } else if (S.scope.kind === 'model') {
    if (host()[S.scope.name]) add(S.scope.name, S.scope.name, host()[S.scope.name], true);
    addExtras();
  } else {
    const root = scopeRootSchema(S.scope);
    if (root) {
      const direct = schemaRefName(root) || (root.type === 'array' && root.items && schemaRefName(root.items));
      if (direct && host()[direct]) add(direct, direct, host()[direct], true);
      else {
        const core = root.type === 'array' ? (root.items = root.items || {}) : root;
        add('@root', S.scope.kind === 'req' ? 'Request' : 'Response ' + S.scope.code, core, false);
      }
    }
    addExtras();
  }
  return roots;
}

function treeSelectClass(id, named, isPrim, pathKey) {
  S.selClass = id; S.selAttr = null;
  S.treePath = pathKey || null;
  selectProps(isPrim && named ? { kind: 'customtype', name: id } : { kind: 'class' });
  render();
}

function treeRow(box, kids) {
  const row = el('div', { cls: 'xrow' });
  row.appendChild(box);
  if (kids && kids.length) {
    row.appendChild(el('div', { cls: 'xstem' }));
    const col = el('div', { cls: 'xkids' });
    kids.forEach(function (k) { col.appendChild(el('div', { cls: 'xkid' }, k)); });
    row.appendChild(col);
  }
  return row;
}

function treeExpander(open, key) {
  const b = el('div', { cls: 'xexp', text: open ? '−' : '+', title: open ? 'Collapse' : 'Expand', onClick: function (e) {
    e.stopPropagation();
    S.treeOpen[key] = !open;
    render();
  } });
  b.addEventListener('mousedown', function (e) { e.stopPropagation(); });
  return b;
}

function treeEnumValues(schema, onPick) {
  const vals = schema.enum || [];
  const descs = schema['x-enum-descriptions'] || [];
  const rows = vals.slice(0, 20).map(function (v, i) {
    const label = String(v) + (descs[i] ? ' — ' + descs[i] : '');
    const b = el('div', { cls: 'xbox xval', title: label, onClick: function (e) { e.stopPropagation(); onPick(); } });
    b.appendChild(el('div', { cls: 'xv', text: label }));
    return treeRow(b, null);
  });
  if (vals.length > 20) {
    const b = el('div', { cls: 'xbox xval', onClick: function (e) { e.stopPropagation(); onPick(); } });
    b.appendChild(el('div', { cls: 'xv', style: 'color:var(--fg-dim)', text: M('tree.more', { count: vals.length - 20 }) }));
    rows.push(treeRow(b, null));
  }
  return rows;
}
function treeEnumRow(name, schema, named, pathKey) {
  const sel = S.selClass === name && S.selAttr == null;
  const pick = function () { treeSelectClass(name, named, true, pathKey); };
  const box = el('div', { title: name + ' («enum»)', 'data-id': name, cls: 'xbox xenum' + (sel ? ' sel' : ''), onClick: function (e) {
    e.stopPropagation();
    pick();
  } });
  box.appendChild(el('div', { cls: 'xn', text: name }));
  box.appendChild(el('div', { cls: 'xt', text: '«enum»' }));
  const open = treeOpenState(pathKey);
  if ((schema.enum || []).length) box.appendChild(treeExpander(open, pathKey));
  return treeRow(box, open ? treeEnumValues(schema, pick) : null);
}

function treeChoiceRow(memberRows, label) {
  const row = el('div', { cls: 'xrow' });
  row.appendChild(el('div', { cls: 'xchoicelab', text: label }));
  const col = el('div', { cls: 'xkids' });
  memberRows.forEach(function (k) { col.appendChild(el('div', { cls: 'xkid' }, k)); });
  row.appendChild(col);
  return row;
}

function treeVariantRow(name, ts, key, depth, visited) {
  const sel = S.selClass === name && S.selAttr == null;
  const canOpen = !!ts && !visited[name] && !(primLike(ts) && !ts.enum);
  const open = canOpen && treeOpenState(key);
  const box = el('div', { title: name, 'data-id': name, cls: 'xbox' + (sel ? ' sel' : ''), onClick: function (e) {
    e.stopPropagation();
    treeSelectClass(name, true, !!(ts && primLike(ts)), key);
  } });
  box.appendChild(el('div', { cls: 'xn', text: name }));
  if (canOpen) box.appendChild(treeExpander(open, key));
  let kids = null;
  if (open) {
    const v2 = Object.assign({}, visited); v2[name] = true;
    kids = treeChildren(name, ts, key, depth + 1, v2);
  }
  return treeRow(box, kids);
}

function treeChildren(ownerId, schema, path, depth, visited) {
  const out = [];
  if (!schema || typeof schema !== 'object' || depth > 10) return out;
  const ph = propsHost(schema);

  (schema.allOf || []).forEach(function (part) {
    const parent = refName(part.$ref);
    if (parent) {
      const ps = host()[parent];
      const key = path + '/^' + parent;
      const canOpen = !!ps && !visited[parent];
      const open = canOpen && treeOpenState(key);
      const box = el('div', { title: M('tree.baseType', { name: parent }), 'data-id': parent, cls: 'xbox xinh' + (S.selClass === parent && S.selAttr == null ? ' sel' : ''), onClick: function (e) {
        e.stopPropagation();
        treeSelectClass(parent, true, !!(ps && (ps.enum || primLike(ps))), key);
      } });
      box.appendChild(el('div', { cls: 'xn', text: '△ ' + parent }));
      if (canOpen) box.appendChild(treeExpander(open, key));
      let kids = null;
      if (open) {
        const v2 = Object.assign({}, visited); v2[parent] = true;
        kids = treeChildren(parent, ps, key, depth + 1, v2);
      }
      out.push(treeRow(box, kids));
    } else if (part !== ph) {
      Array.prototype.push.apply(out, treeChildren(ownerId, part, path, depth + 1, visited));
    }
  });

  const req = ph.required || [];
  const names = Object.keys(ph.properties || {});
  const choiceGroups = (ph['x-xsd-choice'] || []).map(function (g) {
    return g.filter(function (n) { return names.indexOf(n) >= 0; });
  }).filter(function (g) { return g.length; });
  const groupOf = {};
  choiceGroups.forEach(function (g, gi) { g.forEach(function (n) { groupOf[n] = gi; }); });
  const builtRows = {};
  names.forEach(function (fname, idx) {
    const prop = ph.properties[fname];
    if (!prop || typeof prop !== 'object') return;
    const isReq = req.indexOf(fname) >= 0 || groupOf[fname] != null;
    const isArr = prop.type === 'array';
    const core = isArr ? (prop.items || {}) : prop;
    const target = refName(core.$ref);
    const tSchema = target ? host()[target] : null;
    const key = path + '/' + fname;
    const sel = S.selClass === ownerId && S.selAttr === idx;
    const mult = treeMultText(attrMult(prop, isReq));
    let typeText = typeLabelOf(prop) + (isArr ? '[]' : '');
    let canOpen = false, cyc = false, kidsFn = null;
    const selectThisAttr = function () {
      S.selClass = ownerId; S.selAttr = idx;
      S.treePath = key;
      selectProps({ kind: 'attr' });
      render();
    };
    if (tSchema && tSchema.enum) {
      typeText += ' «enum»';
      canOpen = true;
      kidsFn = function () { return treeEnumValues(tSchema, function () { treeSelectClass(target, true, true, key); }); };
    } else if (tSchema && !primLike(tSchema)) {
      if (visited[target]) cyc = true;
      else {
        canOpen = true;
        kidsFn = function () {
          const v2 = Object.assign({}, visited); v2[target] = true;
          return treeChildren(target, tSchema, key, depth + 1, v2);
        };
      }
    } else if (!target && core && core.properties) {
      canOpen = true;
      kidsFn = function () { return treeChildren(ownerId + '.' + fname, core, key, depth + 1, visited); };
    } else if (!target && core && Array.isArray(core.enum) && core.enum.length) {
      typeText += ' «enum»';
      canOpen = true;
      kidsFn = function () { return treeEnumValues(core, selectThisAttr); };
    } else if (!target && core && (Array.isArray(core.oneOf) || Array.isArray(core.anyOf))) {
      const vk = Array.isArray(core.oneOf) ? 'oneOf' : 'anyOf';
      const variants = (core[vk] || []).filter(function (v) { return v && typeof v === 'object'; });
      if (variants.length) {
        typeText = variants.map(function (v, vi) {
          return refName(v.$ref) || v.title || (vk + ' ' + (vi + 1));
        }).join(' | ');
        canOpen = true;
        kidsFn = function () { return treeChildren(ownerId + '.' + fname, core, key, depth + 1, visited); };
      }
    }
    const open = canOpen && treeOpenState(key);
    const box = el('div', { title: fname + ' : ' + typeText + ' ' + (attrMult(prop, isReq) || ''), 'data-attr': fname, cls: 'xbox' + (isReq ? '' : ' opt') + (isArr ? ' many' : '') + (sel ? ' sel' : ''), onClick: function (e) {
      e.stopPropagation();
      selectThisAttr();
    } });
    box.appendChild(el('div', { cls: 'xn', text: (prop['x-xsd-attribute'] ? '@' : '') + (fname === '' ? '(name?)' : fname) }));
    box.appendChild(el('div', { cls: 'xt', text: typeText + (cyc ? ' ' + '(cycle)' : '') }));
    if (mult) box.appendChild(el('div', { cls: 'xm', text: mult }));
    if (canOpen) box.appendChild(treeExpander(open, key));
    builtRows[fname] = treeRow(box, open ? kidsFn() : null);
  });
  const groupDone = {};
  names.forEach(function (fname) {
    if (!builtRows[fname]) return;
    const gi = groupOf[fname];
    if (gi == null) { out.push(builtRows[fname]); return; }
    if (groupDone[gi]) return;
    groupDone[gi] = true;
    const members = choiceGroups[gi].map(function (m) { return builtRows[m]; }).filter(Boolean);
    out.push(treeChoiceRow(members, M('choice.exactlyOne', { count: members.length })));
  });

  ['oneOf', 'anyOf'].forEach(function (vk) {
    const list = schema[vk];
    if (!Array.isArray(list) || !list.length) return;
    const rows = [];
    list.forEach(function (v, i) {
      if (!v || typeof v !== 'object') return;
      const t = refName(v.$ref);
      const vkey = path + '/' + vk + (i + 1);
      if (t) {
        const ts = host()[t];
        if (ts && ts.enum) rows.push(treeEnumRow(t, ts, true, vkey));
        else rows.push(treeVariantRow(t, ts || null, vkey, depth, visited));
      } else if (v.properties) {
        const vid = ownerId + '.' + vk + (i + 1);
        const open = treeOpenState(vkey);
        const box = el('div', { title: v.title || vk + ' ' + (i + 1), cls: 'xbox opt', onClick: function (e) {
          e.stopPropagation();
          treeSelectClass(ownerId, false, false, vkey);
        } });
        box.appendChild(el('div', { cls: 'xn', text: v.title || vk + ' ' + (i + 1) }));
        box.appendChild(treeExpander(open, vkey));
        rows.push(treeRow(box, open ? treeChildren(vid, v, vkey, depth + 1, visited) : null));
      }
    });
    if (rows.length) {
      out.push(treeChoiceRow(rows, vk === 'oneOf' ? M('choice.exactlyOne', { count: rows.length }) : M('choice.atLeastOne', { count: rows.length })));
    }
  });

  if (!RO && schema && !schema.enum && !primLike(schema)) {
    out.push(el('div', { cls: 'xadd', title: 'Add an attribute', text: '＋', onClick: function (e) {
      e.stopPropagation();
      const target = propsHost(schema);
      target.properties = target.properties || {};
      pushHistory();
      const fresh = uniquePropName(target);
      target.properties[fresh] = { type: 'string' };
      S.selClass = ownerId; S.selAttr = Object.keys(target.properties).indexOf(fresh);
      selectProps({ kind: 'attr' });
      S.focusNewParam = true;
      markDirty();
    } }));
  }
  return out;
}

function treeRootRow(r) {
  const schema = r.schema;
  if (schema && schema.enum && !schema.properties) return treeEnumRow(r.id, schema, r.named, r.id);
  const isPrim = !!(schema && primLike(schema));
  const sel = S.selClass === r.id && S.selAttr == null;
  const open = treeOpenState(r.id);
  const box = el('div', { title: r.name, 'data-id': r.id, cls: 'xbox xroot' + (sel ? ' sel' : ''), onClick: function (e) {
    e.stopPropagation();
    treeSelectClass(r.id, r.named, isPrim, r.id);
  } });
  box.appendChild(el('div', { cls: 'xn', text: r.name }));
  box.appendChild(el('div', { cls: 'xt', text: isPrim ? '«type»' : '«schema»' }));
  const canOpen = schema && !isPrim && ((schema.properties && Object.keys(schema.properties).length) || (schema.allOf || []).length || !RO);
  if (canOpen) box.appendChild(treeExpander(open, r.id));
  const visited = {}; visited[r.id] = true;
  const kids = canOpen && open ? treeChildren(r.id, schema, r.id, 0, visited) : null;
  return treeRow(box, kids);
}

function expandAllSwitch() {
  const sw = el('div', { cls: 'tswitch' + (S.treeAll ? ' on' : ''), onClick: function () {
    S.treeAll = !S.treeAll;
    S.treeOpen = {};
    render();
  } });
  sw.appendChild(el('div', { cls: 'track' }, el('i')));
  sw.appendChild(el('span', { text: 'Expand all' }));
  return sw;
}

function structureView() {
  const wrap = el('div', { style: 'height:100%;display:flex;flex-direction:column;overflow:hidden' });

  const tb = el('div', { id: 'dtoolbar' });
  const tool = function (icon, label, opts) {
    return el('div', { cls: 'tool' + (opts.on ? ' on' : '') + (opts.disabled ? ' off' : ''), title: label, onClick: opts.onClick, style: opts.style || '' },
      el('span', { style: 'font-size:14px', text: icon }), el('span', { text: label }));
  };

  if (docKind !== 'xsd') {
    tb.appendChild(tool('←', 'Back', { onClick: function () { S.view = S.scopeFrom === 'structure' ? 'contract' : (S.scopeFrom || 'contract'); render(); } }));
    tb.appendChild(el('div', { cls: 'toolsep' }));
  }
  tb.appendChild(expandAllSwitch());
  tb.appendChild(el('div', { style: 'flex:1' }));
  tb.appendChild(tool('↺', 'Undo', { disabled: !S.past.length, onClick: undo }));
  tb.appendChild(tool('↻', 'Redo', { disabled: !S.future.length, onClick: redo }));
  wrap.appendChild(tb);

  const crumb = el('div', { id: 'dcrumb' });
  const parts = crumbFor(S.scope);
  parts.forEach(function (c, i) {
    crumb.appendChild(el('span', { style: 'color:' + (i === parts.length - 1 ? 'var(--green)' : 'var(--fg-dim)'), text: c }));
    if (i < parts.length - 1) crumb.appendChild(el('span', { style: 'opacity:.5', text: '›' }));
  });
  wrap.appendChild(crumb);

  const canvas = el('div', { id: 'dcanvas' });
  canvas.addEventListener('scroll', function () { S.canvasScroll = { x: canvas.scrollLeft, y: canvas.scrollTop }; });
  requestAnimationFrame(function () {
    if (S.canvasScroll) { canvas.scrollLeft = S.canvasScroll.x; canvas.scrollTop = S.canvasScroll.y; }
  });
  canvas.addEventListener('mousedown', function (e) {
    if (e.target === canvas || e.target.id === 'dtree') {
      S.selClass = null; S.selAttr = null;
      S.treePath = null;
      S.propTarget = { kind: 'none' };
      render();
    }
  });
  canvas.addEventListener('dragover', function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  canvas.addEventListener('drop', function (e) {
    e.preventDefault();
    let name = window.__dragModel;
    window.__dragModel = null;
    if (!name || !host()[name]) return;
    if (S.scope.kind !== 'models') {
      const k = scopeKey(S.scope);
      S.extra[k] = S.extra[k] || [];
      if (S.extra[k].indexOf(name) < 0) S.extra[k].push(name);
    }
    pushHistory();
    S.selClass = name; S.selAttr = null;
    selectProps({ kind: 'class' });
    markDirty();
  });

  const roots = treeRoots();
  const treeWrap = el('div', { id: 'dtree' });
  roots.forEach(function (r) { treeWrap.appendChild(treeRootRow(r)); });
  canvas.appendChild(treeWrap);
  if (!roots.length) {
    canvas.appendChild(el('div', { style: 'padding:26px;color:var(--fg-dim)', text: 'Empty — drag a schema from the explorer or add a new one' }));
  }
  wrap.appendChild(canvas);
  return wrap;
}

function customTypes() {
  return Object.keys(host()).filter(function (n) { return primLike(host()[n]); });
}
function collectRefNames(schema, into) {
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    const rn = typeof o.$ref === 'string' ? refName(o.$ref) : null;
    if (rn) into[rn] = true;
    Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') walk(o[k]); });
  })(schema);
}

function inferSchemaFromExample(v) {
  if (v === null) return { type: 'string', nullable: true };
  if (Array.isArray(v)) return { type: 'array', items: v.length ? inferSchemaFromExample(v[0]) : { type: 'string' } };
  const t = typeof v;
  if (t === 'number') return Number.isInteger(v) ? { type: 'integer' } : { type: 'number' };
  if (t === 'boolean') return { type: 'boolean' };
  if (t === 'object') {
    const out = { type: 'object', properties: {} };
    Object.keys(v).forEach(function (k) { out.properties[k] = inferSchemaFromExample(v[k]); });
    return out;
  }
  return { type: 'string' };
}
function looksLikeSchema(o) {
  return !!(o && typeof o === 'object' && !Array.isArray(o) && (o.type || o.properties || o.enum || o.$ref || o.allOf));
}
function inferFromXmlSample(elGet) {
  const groups = {};
  Array.prototype.forEach.call(elGet.children, function (c) {
    (groups[c.localName] = groups[c.localName] || []).push(c);
  });
  const out = { type: 'object', properties: {} };
  Object.keys(groups).forEach(function (name) {
    const nodes = groups[name];
    const inner = nodes[0].children.length ? inferFromXmlSample(nodes[0]) : { type: 'string' };
    out.properties[name] = nodes.length > 1 ? { type: 'array', items: inner } : inner;
  });
  return out;
}
function parsePasted(text, nameHint) {
  text = (text || '').trim();
  if (!text) throw new Error(M('error.required'));
  const out = {};
  const needName = function () {
    const n = (nameHint || '').trim().replace(/[^A-Za-z0-9_.-]/g, '');
    if (!n) throw new Error(M('error.required'));
    return n;
  };
  if (text[0] === '<') {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(M('error.writeBack'));
    const root = doc.documentElement;
    if (root.localName === 'schema') {
      Object.assign(out, xsdToSchemas([root]).schemas);
    } else if (root.localName === 'complexType' || root.localName === 'simpleType') {
      const wrap = doc.createElementNS(root.namespaceURI || 'http:' + '//www.w3.org/2001/XMLSchema', 'schema');
      wrap.appendChild(root.cloneNode(true));
      const conv = xsdToSchemas([wrap]).schemas;
      const key = root.getAttribute('name') || needName();
      out[key] = conv[root.getAttribute('name')] || conv[Object.keys(conv)[0]] || { type: 'object', properties: {} };
    } else {
      out[needName()] = inferFromXmlSample(root);
    }
  } else {
    const data = JSON.parse(text);
    if (looksLikeSchema(data)) {
      out[needName()] = data;
    } else if (data && typeof data === 'object' && !Array.isArray(data) &&
               Object.keys(data).length && Object.keys(data).every(function (k) { return looksLikeSchema(data[k]); })) {
      Object.assign(out, data);
    } else {
      out[needName()] = inferSchemaFromExample(data);
    }
  }
  return out;
}

function typePickerField(def) {
  const box = el('div', { cls: 'fcol' });
  box.appendChild(el('label', { cls: 'lblx', text: def.label }));
  const btn = el('div', { cls: 'sel', style: 'cursor:pointer;display:flex;justify-content:space-between;align-items:center' },
    el('span', { cls: 'mono', text: def.value || '—' }),
    el('span', { style: 'color:var(--fg);font-size:12px;margin-left:8px;flex:none', text: '▾' }));
  if (!RO) btn.addEventListener('click', function (e) {
    e.stopPropagation();
    S.pickerFor = S.pickerFor === def.id ? null : def.id;
    render();
  });
  box.appendChild(btn);
  if (S.pickerFor !== def.id) return box;
  const panel = el('div', { id: 'typepicker', cls: 'pickerpanel' });
  const search = el('input', { cls: 'inp', placeholder: 'Search types', style: 'margin:6px;flex:none' });
  const list = el('div', { style: 'max-height:240px;overflow-y:auto;padding-bottom:4px' });
  const pick = function (value, source) {
    S.pickerFor = null;
    def.onPick(value, source);
  };
  const renderList = function () {
    const f = search.value.trim().toLowerCase();
    list.innerHTML = '';
    (def.sections || []).forEach(function (sec) {
      const items = (sec.items || []).filter(function (v) { return !f || v.toLowerCase().indexOf(f) >= 0; });
      if (!items.length) return;
      list.appendChild(el('div', { cls: 'lblx', style: 'padding:6px 8px 2px', text: sec.title }));
      items.forEach(function (v) {
        list.appendChild(el('div', { cls: 'trow', style: 'padding-left:14px', onClick: function () { pick(v, sec.source || 'std'); } },
          el('span', { cls: 'lab mono', text: v })));
      });
    });
    if (!list.children.length) list.appendChild(el('div', { style: 'padding:8px;font-size:11px;color:var(--fg-dim)', text: M('types.noneMatch') }));
  };
  search.addEventListener('input', renderList);
  renderList();
  panel.appendChild(search);
  panel.appendChild(list);
  requestAnimationFrame(function () { search.focus(); });
  box.appendChild(panel);
  return box;
}

function typesView() {
  const v = el('div', { id: 'typesview' });
  v.appendChild(el('div', { cls: 'sechead', style: 'margin-bottom:8px', text: 'Standard types' }));
  const std = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:22px' });
  stdTypesForDoc().forEach(function (t) { std.appendChild(el('div', { cls: 'stdtype', text: t })); });
  v.appendChild(std);
  v.appendChild(el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px' },
    el('div', { cls: 'sechead', text: 'Custom types' }),
    RO ? el('span') : el('button', { cls: 'btn', title: 'Add a custom type', text: '＋', onClick: function () {
      const name = uniqueName('NewType');
      host()[name] = { type: 'string' };
      selectProps({ kind: 'customtype', name: name });
      markDirty();
    } })));
  const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px' });
  const cts = customTypes();
  cts.forEach(function (name) {
    const s = host()[name];
    const isSel = S.propTarget.kind === 'customtype' && S.propTarget.name === name;
    const card = el('div', { cls: 'ctcard' + (isSel ? ' on' : ''), onClick: function () { selectProps({ kind: 'customtype', name: name }); render(); } });
    card.appendChild(el('div', { cls: 'head' },
      el('span', { style: 'width:10px;height:10px;border-radius:2px;background:var(--purple)' }),
      el('span', { style: 'font:600 13px/1 ui-monospace,monospace;color:var(--green)', text: name }),
      el('span', { style: 'font-size:11px;color:var(--fg-dim)', text: 'extends ' + (s.type || '?') })));
    const props = el('div', { cls: 'props' });
    ['format', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum'].forEach(function (k) {
      if (s[k] == null) return;
      props.appendChild(el('div', { cls: 'fcol' },
        el('span', { style: 'font:10px/1 ui-monospace,monospace;color:var(--fg-dim)', text: k }),
        el('span', { style: 'font:12px/1 ui-monospace,monospace;color:var(--orange)', text: String(s[k]) })));
    });
    if (s.enum) props.appendChild(el('div', { cls: 'fcol' },
      el('span', { style: 'font:10px/1 ui-monospace,monospace;color:var(--fg-dim)', text: 'enum' }),
      el('span', { style: 'font:12px/1 ui-monospace,monospace;color:var(--orange)', text: s.enum.join(', ') })));
    card.appendChild(props);
    grid.appendChild(card);
  });
  v.appendChild(grid);

  return v;
}

function createView() {
  const v = el('div', { id: 'createview' });
  const box = el('div', { style: 'width:560px;max-width:100%' });
  const kinds = el('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:26px' });
  [['openapi', 'Swagger/OpenAPI', '{}', 'var(--mpost)'], ['wsdl', 'WSDL', '⧉', 'var(--purple)'], ['xsd', 'XSD', '◈', 'var(--blue)'], ['avro', 'Avro', '◉', 'var(--mput)']].forEach(function (k) {
    const on = S.createKind === k[0];
    kinds.appendChild(el('div', { cls: 'kindcard' + (on ? ' on' : ''), onClick: function () { S.createKind = k[0]; render(); } },
      el('div', { style: 'font-size:22px;margin-bottom:6px;color:' + k[3], text: k[2] }),
      el('div', { style: 'font-size:12px;font-weight:600', text: k[1] })));
  });
  box.appendChild(kinds);
  const nc = S.createVals;
  const fields = el('div', { style: 'display:flex;flex-direction:column;gap:14px' });
  const setC = function (k) { return function (v2) { nc[k] = v2; }; };
  if (S.createKind === 'openapi') {
    fields.appendChild(fld({ label: 'title', kind: 'text', mono: true, value: nc.title || '', placeholder: 'Order API', onChange: setC('title') }));
    fields.appendChild(fld({ label: 'interface version', kind: 'text', mono: true, value: nc.version || '', placeholder: '1.0.0', onChange: setC('version') }));
    fields.appendChild(fld({ label: M('create.stdVersion'), kind: 'select', value: nc.std || '3.0.3', options: ['2.0', '3.0.0', '3.0.3', '3.1.0'], onChange: setC('std') }));
    fields.appendChild(fld({ label: 'file extension', kind: 'select', value: nc.ext || '.yaml', options: ['.json', '.yaml'], onChange: setC('ext') }));
  } else {
    fields.appendChild(fld({ label: S.createKind === 'avro' ? 'event name' : 'name', kind: 'text', mono: true, value: nc.name || '', onChange: setC('name') }));
    fields.appendChild(fld({ label: 'version', kind: 'text', mono: true, value: nc.version || '', placeholder: '1.0.0', onChange: setC('version') }));
    fields.appendChild(fld({ label: 'namespace', kind: 'text', mono: true, value: nc.ns || '', placeholder: S.createKind === 'avro' ? 'org.example.events' : 'http:' + '//example.org/api', onChange: setC('ns') }));
  }
  fields.appendChild(fld({ label: 'file name', kind: 'text', mono: true, value: nc.file || '', placeholder: 'contract', onChange: setC('file') }));
  fields.appendChild(fld({ label: 'location', kind: 'text', mono: true, value: nc.loc == null ? '/src/main/contracts' : nc.loc, onChange: setC('loc') }));
  box.appendChild(fields);
  const btns = el('div', { style: 'display:flex;gap:10px;margin-top:24px' });
  btns.appendChild(el('div', { cls: 'btn', style: 'padding:9px 20px;font-size:13px', text: 'Create contract', onClick: function () {
    const vals = Object.assign({}, nc);
    if (vals.loc == null) vals.loc = '/src/main/contracts';
    vscodeApi.postMessage({ type: 'create', kind: S.createKind, vals: vals });
  } }));
  if (spec) btns.appendChild(el('div', { cls: 'btn2', text: 'cancel', onClick: function () { S.view = 'contract'; render(); } }));
  box.appendChild(btns);
  v.appendChild(box);
  return v;
}
