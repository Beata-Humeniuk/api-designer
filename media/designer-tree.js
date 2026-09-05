function renderSidebar() {
  const sb = document.getElementById('sidebar');
  sb.className = '';
  const sinput = document.getElementById('searchinput');
  sinput.oninput = function () { S.search = sinput.value.toLowerCase(); renderTree(); };
  renderTree();
}

function trow(opts) {
  if (S.search && opts.label.toLowerCase().indexOf(S.search) < 0) return null;
  const r = el('div', { cls: 'trow' + (opts.active ? ' on' : ''), role: 'treeitem',
    'aria-level': String((opts.depth || 0) + 1),
    'aria-selected': opts.active ? 'true' : 'false',
    'aria-label': (opts.method ? opts.method + ' ' : '') + opts.label,
    style: 'padding-left:' + (8 + opts.depth * 14) + 'px', onClick: opts.onClick });
  if (opts.onDblClick) r.addEventListener('dblclick', opts.onDblClick);
  r.appendChild(el('span', { cls: 'twist', text: opts.twist || '' }));
  if (opts.method) r.appendChild(el('span', { cls: 'meth', style: 'color:' + (METHOD_COLOR[opts.method] || 'var(--fg-dim)'), text: opts.method }));
  if (opts.dot) r.appendChild(el('span', { cls: 'dot', style: 'background:' + (opts.dotColor || 'var(--green)') }));
  r.appendChild(el('span', { cls: 'lab', text: opts.label }));
  if (opts.dataOp) r.setAttribute('data-op', opts.dataOp);
  if (opts.model) {
    r.setAttribute('data-model', opts.model);
    r.draggable = true;
    r.addEventListener('dragstart', function (e) {
      window.__dragModel = opts.model;
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', opts.model); }
    });
  }
  return r;
}

function renderTree() {
  const tree = document.getElementById('tree');
  tree.setAttribute('role', 'tree');
  tree.innerHTML = '';
  if (!spec) {
    tree.appendChild(el('div', { style: 'padding:12px 16px;color:var(--fg-dim);font-size:12px', text: M('tree.empty') }));
    return;
  }
  const add = function (n) { if (n) tree.appendChild(n); };
  const exp = S.expanded;
  const tw = function (k) { return exp[k] ? '▾' : '▸'; };
  const info = spec.info || {};
  add(trow({ label: info.title || 'Contract', depth: 0, dot: true, dotColor: 'var(--mpost)',
    active: S.propTarget.kind === 'interface',
    onClick: function () { selectProps({ kind: 'interface' }); render(); } }));
  const modelsMode = S.view === 'structure' || S.view === 'types' || docKind === 'avro';
  if (wsdlMeta) {
    wsdlMeta.operations.forEach(function (o) {
      add(trow({ label: o.name, depth: 1, dot: true, dotColor: 'var(--purple)', active: S.view === 'contract' && S.wsdlSelOp === o.name, onClick: function () {
        S.wsdlSelOp = o.name;
        S.view = 'contract';
        selectProps({ kind: 'wsdlop' });
        render();
      } }));
    });
  }
  if (!modelsMode && !wsdlMeta) {
    const opRow = function (o, depth) {
      const active = S.view === 'contract' && S.selOp && S.selOp.path === o.path && S.selOp.method === o.method;
      add(trow({ label: o.path, depth: depth, method: o.method, active: active, dataOp: o.method + ' ' + o.path, onClick: function () {
        selectOp(o.path, o.method);
      } }));
    };
    const ops = listOps();
    const tagged = {};
    const untagged = [];
    ops.forEach(function (o) {
      const ts = (o.op.tags || []).filter(Boolean);
      if (!ts.length) { untagged.push(o); return; }
      ts.forEach(function (t) { (tagged[t] = tagged[t] || []).push(o); });
    });
    Object.keys(tagged).sort(function (a, b) { return a.localeCompare(b); }).forEach(function (t) {
      const tk = 'tag:' + t;
      const open = S.search ? true : exp[tk] !== false;
      add(trow({ label: t, depth: 1, twist: open ? '▾' : '▸', onClick: function () { exp[tk] = !open; render(); } }));
      if (open) tagged[t].forEach(function (o) { opRow(o, 2); });
    });
    untagged.forEach(function (o) { opRow(o, 1); });
    const addRow = RO ? null : trow({ label: '＋ Add operation', depth: 1, onClick: addOperation });
    if (addRow) {
      addRow.style.color = 'var(--fg-dim)';
      add(addRow);
    }
  }
  if (modelsMode || wsdlMeta) renderModelsTree(add, exp, tw);
  add(trow({ label: 'Type definitions', depth: 1, dot: true, dotColor: 'var(--blue)',
    active: S.view === 'types',
    onClick: function () { S.view = 'types'; render(); } }));
  if (S.search && !tree.childNodes.length) {
    tree.appendChild(el('div', { style: 'padding:12px 16px;color:var(--fg-dim);font-size:12px', text: M('tree.noMatch') }));
  }
}

function renderModelsTree(add, exp, tw) {
  if (docKind === 'avro' && avroMeta) {
    add(trow({ label: avroMeta.rootName, depth: 1, method: 'EVENT',
      active: S.propTarget.kind === 'event',
      onClick: function () { selectProps({ kind: 'event' }); render(); } }));
  }
  add(trow({ label: 'Schemas', depth: 1, twist: tw('models'),
    active: S.view === 'structure' && S.scope.kind === 'models',
    onClick: function () { exp.models = !exp.models; render(); },
    onDblClick: function () { openStructure({ kind: 'models' }); } }));
  if (exp.models) {
    Object.keys(host()).forEach(function (name) {
      if (!objLike(host()[name])) return;
      const openThis = function () {
        openStructure({ kind: 'model', name: name });
        S.selClass = name; S.selAttr = null; selectProps({ kind: 'class' });
        render();
      };
      const row = trow({ label: schemaSourceName(name), depth: 2, dot: true, model: name, active: S.view === 'structure' && S.selClass === name, onClick: openThis, onDblClick: openThis });
      const srcNs = schemaSourceNs(name);
      if (row && srcNs) {
        row.title = srcNs;
        row.appendChild(el('span', { style: 'font-size:10px;color:var(--fg-dim);margin-left:6px;flex:none', text: nsHint(srcNs) }));
      }
      add(row);
    });
    if (!RO) {
      const rowP = trow({ label: M('tree.pasteSchema'), depth: 2, onClick: function () {
        selectProps({ kind: 'paste' });
        S.pasteText = '';
        S.pasteName = '';
        render();
      } });
      if (rowP) { rowP.style.color = 'var(--fg-dim)'; add(rowP); }
    }
    const addModel = RO ? null : trow({ label: '＋ Add schema', depth: 2, onClick: function () {
      const name = uniqueName('NewSchema');
      host()[name] = { type: 'object', properties: {} };
      openStructure({ kind: 'model', name: name });
      S.selClass = name;
      selectProps({ kind: 'class' });
      S.focusNewParam = true;
      markDirty();
    } });
    if (addModel) {
      addModel.style.color = 'var(--fg-dim)';
      add(addModel);
    }
  }
}

function genSpecButton(label, message) {
  const b = el('span', { cls: 'genspec', text: label });
  b.addEventListener('click', function () { vscodeApi.postMessage(message); });
  return b;
}

function contractActions() {
  const box = el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:4px' });
  if (!hasDoc) return box;
  const act = function (label, message) {
    const b = genSpecButton(label, message);
    b.style.textAlign = 'center';
    return b;
  };
  box.appendChild(act('Convert schema', { type: 'convertContract' }));
  box.appendChild(act('Export to md', { type: 'exportMd' }));
  return box;
}

function operationActions(operation) {
  const box = el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:4px' });
  if (!fileName) return box;
  const b = genSpecButton('Export to md', { type: 'exportMd', operation: operation });
  b.style.textAlign = 'center';
  box.appendChild(b);
  return box;
}

function selectOp(p, m) {
  S.selOp = { path: p, method: m };
  S.view = 'contract';
  S.propTarget = { kind: 'operation' };
  S.respAdd = null;
  render();
}

function renderTabs() {
  const t = document.getElementById('tabs');
  t.innerHTML = '';
  t.setAttribute('role', 'tablist');
  const mkTab = function (label, dot, on, onClick, onClose) {
    const node = el('div', { cls: 'tab' + (on ? ' on' : ''), role: 'tab',
      'aria-selected': on ? 'true' : 'false', 'aria-label': label, onClick: onClick },
      el('span', { cls: 'tdot', style: 'background:' + dot }),
      el('span', { text: label }));
    if (onClose) node.appendChild(el('span', { cls: 'tx', text: '×', title: 'Close ' + label, onClick: function (e) { e.stopPropagation(); onClose(); } }));
    t.appendChild(node);
  };
  if (spec && docKind !== 'xsd') mkTab((spec.info && spec.info.title) || fileName || 'Contract', 'var(--mpost)', S.view === 'contract', function () { S.view = 'contract'; render(); }, null);
  S.openStructures.forEach(function (sc, i) {
    const key = scopeKey(sc);
    const on = S.view === 'structure' && scopeKey(S.scope) === key;
    mkTab(crumbFor(sc).slice(-2).join(' › '), 'var(--green)', on, function () {
      S.scope = sc;
      S.view = 'structure';
      S.selClass = null; S.selAttr = null;
      S.propTarget = { kind: 'none' };
      render();
    }, docKind === 'xsd' ? null : function () {
      S.openStructures.splice(i, 1);
      if (on) {
        if (S.openStructures.length) {
          S.scope = S.openStructures[Math.min(i, S.openStructures.length - 1)];
        } else S.view = spec ? 'contract' : 'create';
      }
      render();
    });
  });
  if (S.view === 'types') mkTab('Type definitions', 'var(--blue)', true, function () {}, function () { S.view = spec ? 'contract' : 'create'; render(); });
  if (S.view === 'create') mkTab('New contract', 'var(--mput)', true, function () {}, spec ? function () { S.view = 'contract'; render(); } : null);
}
