function copyText(t) {
  const done = function () { toast('Copied: ' + t); };
  const fallback = function () {
    const ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast(M('error.copyFailed')); }
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback);
  else fallback();
}

function treePathLabel() {
  if (!S.treePath) return '';
  let p = String(S.treePath).replace(/\/\^/g, '/');
  if (p.indexOf('@root') === 0) {
    const rootName = S.scope.kind === 'req' ? 'Request' : S.scope.kind === 'resp' ? 'Response ' + S.scope.code : 'Schema';
    p = rootName + p.slice(5);
  }
  return p;
}

function renderStatus() {
  const s = document.getElementById('statusbar');
  s.innerHTML = '';
  const tp = S.view === 'structure' ? treePathLabel() : '';
  if (tp) {
    s.appendChild(el('span', { style: 'min-width:0;cursor:pointer', title: M('status.clickToCopy', { path: tp }), text: tp, onClick: function () { copyText(tp); } }));
  }
  s.appendChild(el('span', { style: 'margin-left:auto' }, el('span', { cls: 'g' }), fileName || '(new contract)'));

  if (hasDoc) {
    s.appendChild(el('span', { style: 'cursor:pointer', title: 'Read the file again', text: '⟳',
      onClick: function () { vscodeApi.postMessage({ type: 'reload' }); } }));
  }
  s.appendChild(el('span', { style: 'opacity:.9', text: saveStatus }));
}

function renderView() {
  const v = document.getElementById('viewbody');
  v.innerHTML = '';
  if (S.view === 'create' || !spec) { v.appendChild(createView()); return; }
  if (S.view === 'types') { v.appendChild(typesView()); return; }
  if (S.view === 'structure') { v.appendChild(structureView()); return; }
  if (avroMeta) { v.appendChild(avroView()); return; }
  if (wsdlMeta) { v.appendChild(wsdlView()); return; }
  v.appendChild(contractView());
}

function requestInfo(op) {
  if (isV2()) {
    const bp = (op.parameters || []).find(function (p) { return p && p.in === 'body'; });
    return bp ? { schema: bp.schema, model: bp.schema && schemaRefName(bp.schema) || '(inline)' } : null;
  }
  const rb = op.requestBody;
  if (!rb || !rb.content) return null;
  const mt = Object.keys(rb.content)[0];
  const sch = mt && rb.content[mt].schema;
  return { schema: sch, model: sch && (schemaRefName(sch) || '(inline)') || '(no schema)' };
}

function responseSchema(r) {
  if (!r) return null;
  if (r.schema) return r.schema;
  const c = r.content || {};
  const mt = Object.keys(c)[0];
  return mt ? c[mt].schema : null;
}
function responseKind(r) {
  const s = responseSchema(r);
  if (!s) return 'empty';
  if (s.type === 'array') return 'array';
  if (!s.$ref && (s.type === 'string' || s.type === 'integer' || s.type === 'number' || s.type === 'boolean')) return 'text';
  return 'object';
}
function schemaHasStructure(sch) {
  if (!sch) return false;
  const core = sch.type === 'array' ? (sch.items || {}) : sch;
  return !!(schemaRefName(core) || core.$ref || core.properties || core.allOf || core.type === 'object');
}
function responseModel(r) {
  const s = responseSchema(r);
  if (!s) return null;
  const core = s.type === 'array' ? s.items || {} : s;
  return schemaRefName(core) || '(inline)';
}
function responseMedia(op, r) {
  if (r.content) return Object.keys(r.content)[0] || '';
  if (r.schema) return (op.produces && op.produces[0]) || (spec.produces && spec.produces[0]) || 'application/json';
  return '';
}

function contractView() {
  const wrap = el('div', { style: 'height:100%;display:flex;flex-direction:column;overflow:hidden' });
  wrap.appendChild(headerArea());
  const cols = el('div', { cls: 'col3' });
  cols.appendChild(opPropsColumn());
  cols.appendChild(reqRespColumn());
  wrap.appendChild(cols);
  return wrap;
}

function headerArea() {
  const info = spec.info = spec.info || {};
  const head = el('div', { id: 'ophead' });
  const titleInput = el('input', { cls: 'title', value: info.title || '', onChange: function (e) { info.title = e.target.value; markDirty(); } });
  head.appendChild(el('div', { cls: 'titlerow' }, titleInput));
  if (info.description) {
    head.appendChild(el('div', { cls: 'headdesc', text: info.description }));
  }
  return head;
}

function serversText() {
  return (spec.servers || []).map(function (s) { return s.url; }).join(', ');
}
function setServersFromText(v) {
  const urls = v.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  if (urls.length) spec.servers = urls.map(function (u) { return { url: u }; }); else delete spec.servers;
  markDirty();
}

function toggleArr(obj, key, val) {
  const a = obj[key] = obj[key] || [];
  const i = a.indexOf(val);
  if (i >= 0) a.splice(i, 1); else a.push(val);
  if (!a.length) delete obj[key];
  markDirty();
}

function addOperation() {
  if (!spec.paths) spec.paths = {};
  let n = 1, p;
  do { p = '/new' + (n > 1 ? n : ''); n++; } while (spec.paths[p] && spec.paths[p].get);
  spec.paths[p] = spec.paths[p] || {};
  spec.paths[p].get = { summary: '', responses: { '200': { description: 'OK' } } };
  S.selOp = { path: p, method: 'GET' };
  selectProps({ kind: 'operation' });
  markDirty();
}

function moveOp(oldPath, oldMethod, newPath, newMethod) {
  const paths = spec.paths;
  const op = paths[oldPath][oldMethod.toLowerCase()];
  if (newPath !== oldPath || newMethod !== oldMethod) {
    if (paths[newPath] && paths[newPath][newMethod.toLowerCase()]) {
      toast(M('error.exists', { name: newMethod + ' ' + newPath }));
      render();
      return false;
    }
    delete paths[oldPath][oldMethod.toLowerCase()];
    if (!Object.keys(paths[oldPath]).length) delete paths[oldPath];
    paths[newPath] = paths[newPath] || {};
    paths[newPath][newMethod.toLowerCase()] = op;
    S.selOp = { path: newPath, method: newMethod };
  }
  markDirty();
  return true;
}

function paramList(op) {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  (op.parameters || []).forEach(function (p, i) {
    if (!p || p.$ref || p.in === 'body') return;
    const target = p.schema && !isV2() ? p.schema : p;
    wrap.appendChild(el('div', { cls: 'respitem', onClick: function () { selectProps({ kind: 'param', idx: i }); render(); } },
      el('span', { cls: 'mono', cls: 'paramname', text: p.name || '(unnamed)' }),
      el('span', { cls: 'mono', style: 'color:var(--blue);font-size:11px', text: p.in }),
      el('span', { cls: 'mono', style: 'color:var(--green);font-size:11px', text: target.type || 'string' }),
      el('span', { style: 'font-size:13px;color:var(--fg-dim)', text: '→' })));
  });
  wrap.appendChild(el('div', { cls: 'dashadd', title: 'Add a parameter', text: '＋', onClick: function () {
    op.parameters = op.parameters || [];
    const p = { name: '', in: 'query', description: '' };
    if (isV2()) p.type = 'string'; else p.schema = { type: 'string' };
    op.parameters.push(p);
    selectProps({ kind: 'param', idx: op.parameters.length - 1 });
    S.focusNewParam = true;
    markDirty();
  } }));
  return wrap;
}

function opPropsColumn() {
  const col = el('div', { id: 'opprops' });
  const op = curOp();
  if (!op) {
    col.appendChild(el('div', { cls: 'sechead', text: 'Operation' }));
    col.appendChild(el('div', { style: 'color:var(--fg-dim);font-size:12px', text: M('empty.noOps') }));
    return col;
  }
  col.appendChild(el('div', { cls: 'secheadrow' },
    el('div', { cls: 'sechead', text: 'Parameters' })));
  col.appendChild(paramList(op));
  return col;
}

function deleteOpAction() {
  return dangerDelete('Delete operation', function () {
    const p2 = S.selOp.path, m = S.selOp.method.toLowerCase();
    delete spec.paths[p2][m];
    if (!Object.keys(spec.paths[p2]).length) delete spec.paths[p2];
    const rest = listOps();
    S.selOp = rest.length ? { path: rest[0].path, method: rest[0].method } : null;
    S.propTarget = { kind: 'none' };
    markDirty();
  });
}

function reqRespColumn() {
  const outer = el('div', { id: 'reqresp' });
  const col = el('div', { cls: 'inner' });
  outer.appendChild(col);
  const op = curOp();
  if (!op) {
    col.appendChild(el('div', { style: 'color:var(--fg-dim);font-size:12px', text: M('empty.noOps') }));
    return outer;
  }
  const o = S.selOp;
  col.appendChild(el('div', { cls: 'sechead', style: 'margin-bottom:8px', text: 'Request' }));
  const req = requestInfo(op);
  if (req) {
    const reqSel = S.propTarget.kind === 'request';
    const reqCard = el('div', { cls: 'respitem' + (reqSel ? ' on' : ''), style: 'margin-bottom:16px', onClick: function () { selectProps({ kind: 'request' }); render(); } },
      el('span', { style: 'width:11px;height:11px;border-radius:2px;background:var(--green);flex:none' }),
      el('span', { cls: 'model', style: 'flex:1;font-size:13px', text: req.model }));
    if (schemaHasStructure(req.schema)) {
      reqCard.appendChild(el('span', { cls: 'openbtn', title: 'Open', text: '→', onClick: function (e) { e.stopPropagation(); openStructure({ kind: 'req', path: o.path, method: o.method }); } }));
    }
    col.appendChild(reqCard);
  } else {
    col.appendChild(el('div', { cls: 'dashadd', style: 'margin-bottom:16px', title: isV2() ? 'Add a body parameter' : 'Add a request body', text: '＋', onClick: function () {
      if (isV2()) {
        op.parameters = op.parameters || [];
        op.parameters.push({ name: 'body', in: 'body', required: true, schema: { type: 'object', properties: {} } });
      } else {
        op.requestBody = { required: true, content: { 'application/json': { schema: { type: 'object', properties: {} } } } };
      }
      selectProps({ kind: 'request' });
      markDirty();
    } }));
  }
  col.appendChild(el('div', { cls: 'sechead', style: 'margin-bottom:8px', text: 'Responses' }));
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  const kindLabel = { object: 'object', array: 'array', text: 'text', empty: 'no content' };
  Object.keys(op.responses || {}).forEach(function (code) {
    const r = op.responses[code];
    const kind = responseKind(r);
    const hasDiag = (kind === 'object' || kind === 'array') && schemaHasStructure(responseSchema(r));
    const isSel = S.propTarget.kind === 'response' && S.propTarget.code === code;
    const item = el('div', { cls: 'respitem' + (isSel ? ' on' : ''), onClick: function () { selectProps({ kind: 'response', code: code }); render(); } },
      el('span', { cls: 'code', style: 'color:' + (code[0] === '2' ? 'var(--mpost)' : (code[0] === '4' || code[0] === '5') ? 'var(--mdel)' : 'var(--mput)'), text: code }),
      el('div', { style: 'flex:1;min-width:0' },
        el('div', { cls: 'model', text: hasDiag ? (responseModel(r) || '—') : (kind === 'text' ? '(text)' : '(' + 'no content' + ')') }),
        el('div', { cls: 'meta', text: ((r && r.description) || STATUS_NAMES[code] || '') + ((r && r.description) || STATUS_NAMES[code] ? ' · ' : '') + (responseMedia(op, r) || '—') + (hasDiag ? '' : ' · ' + kindLabel[kind]) })));
    if (hasDiag) item.appendChild(el('span', { cls: 'openbtn', title: 'Open', text: '→', onClick: function (e) { e.stopPropagation(); openStructure({ kind: 'resp', path: o.path, method: o.method, code: code }); } }));
    list.appendChild(item);
  });
  if (S.respAdd) {
    const form = el('div', { cls: 'paramcard' });
    const codeInput = el('input', { id: 'respadd-code', cls: 'inp mono', style: 'flex:1;min-width:0', value: S.respAdd.code, placeholder: 'e.g. 404 or default', list: 'httpcodes' });
    const dl = el('datalist', { id: 'httpcodes' });
    Object.keys(STATUS_NAMES).forEach(function (c) { dl.appendChild(el('option', { value: c, label: STATUS_NAMES[c], text: c + ' ' + STATUS_NAMES[c] })); });
    form.appendChild(dl);
    form.appendChild(el('div', { cls: 'prow' }, el('span', { cls: 'lblx', style: 'min-width:72px', text: 'HTTP code' }), codeInput));
    const kindSel = el('select', { id: 'respadd-kind', cls: 'sel', style: 'flex:1;min-width:0', onChange: function (e) { S.respAdd.code = codeInput.value; S.respAdd.kind = e.target.value; render(); } });
    [['object', 'object'], ['array', 'array'], ['text', 'text'], ['empty', 'no content']].forEach(function (k) {
      const opt = el('option', { value: k[0], text: k[1] });
      if (k[0] === S.respAdd.kind) opt.selected = true;
      kindSel.appendChild(opt);
    });
    form.appendChild(el('div', { cls: 'prow' }, el('span', { cls: 'lblx', style: 'min-width:72px', text: 'type' }), kindSel));
    if (S.respAdd.kind === 'object' || S.respAdd.kind === 'array') {
      const modelSel = el('select', { id: 'respadd-model', cls: 'sel mono', style: 'flex:1;min-width:0', onChange: function (e) { S.respAdd.code = codeInput.value; S.respAdd.model = e.target.value; } });
      [''].concat(Object.keys(host()).filter(function (n) { return objLike(host()[n]); })).forEach(function (n) {
        const opt = el('option', { value: n, text: n === '' ? '(inline)' : n });
        if (n === (S.respAdd.model || '')) opt.selected = true;
        modelSel.appendChild(opt);
      });
      form.appendChild(el('div', { cls: 'prow' }, el('span', { cls: 'lblx', style: 'min-width:72px', text: 'schema' }), modelSel));
    }
    form.appendChild(el('div', { cls: 'prow' },
      el('button', { cls: 'btn', text: 'Add', onClick: function () {
        const code = codeInput.value.trim();
        if (!/^([1-5][0-9][0-9]|default)$/.test(code)) { toast(M('error.badHttpCode')); return; }
        op.responses = op.responses || {};
        if (op.responses[code]) { toast(M('error.exists', { name: code })); return; }
        const r = { description: '' };
        setResponseKind(op, r, S.respAdd.kind);
        if ((S.respAdd.kind === 'object' || S.respAdd.kind === 'array') && S.respAdd.model) {
          setResponseModel(r, S.respAdd.kind, S.respAdd.model);
        }
        op.responses[code] = r;
        S.respAdd = null;
        selectProps({ kind: 'response', code: code });
        markDirty();
      } }),
      el('button', { cls: 'btn2', style: 'padding:5px 12px;font-size:12px', text: 'cancel', onClick: function () { S.respAdd = null; render(); } })));
    list.appendChild(form);
  } else {
    list.appendChild(el('div', { cls: 'dashadd', title: 'Add a response', text: '＋', onClick: function () {
      const codes = ['200', '201', '204', '400', '404', '500'];
      const responses = op.responses || {};
      let code = codes.find(function (c) { return !responses[c]; });
      if (!code) { let n = 200; while (responses[String(n)]) n++; code = String(n); }
      S.respAdd = { code: code, kind: 'object', model: '' };
      render();
    } }));
  }
  col.appendChild(list);
  return outer;
}

function scopeKey(scope) {
  if (scope.kind === 'models') return 'models';
  if (scope.kind === 'model') return 'model:' + scope.name;
  return scope.kind + ':' + scope.method + ' ' + scope.path + (scope.code ? ':' + scope.code : '');
}
function crumbFor(scope) {
  const title = (spec && spec.info && spec.info.title) || 'Contract';
  if (scope.kind === 'models') return [title, 'Schemas'];
  if (scope.kind === 'model') return [title, 'Schemas', scope.name];
  const opPart = scope.method + ' ' + scope.path;
  return [title, opPart, scope.kind === 'req' ? 'Request' : 'Response ' + scope.code];
}
function scopeRootSchema(scope) {
  const op = spec.paths && spec.paths[scope.path] && spec.paths[scope.path][scope.method.toLowerCase()];
  if (!op) return null;
  if (scope.kind === 'req') { const r = requestInfo(op); return r && r.schema; }
  return responseSchema((op.responses || {})[scope.code]);
}
function openStructure(scope) {
  S.scopeFrom = S.view === 'structure' ? S.scopeFrom : S.view;
  const key = scopeKey(scope);
  let existing = S.openStructures.find(function (sc) { return scopeKey(sc) === key; });
  if (!existing) { S.openStructures.push(scope); existing = scope; }
  S.scope = existing;
  S.view = 'structure';
  S.selClass = null; S.selAttr = null;
  S.treePath = null;
  S.propTarget = { kind: 'none' };
  S.past = []; S.future = [];
  render();
}

function typeLabelOf(s) {
  if (!s || typeof s !== 'object') return '?';
  if (s.$ref) {
    const n = refName(s.$ref);
    return n ? schemaSourceName(n) : '?';
  }
  if (s.type === 'array') return typeLabelOf(s.items || {});

  if (s['x-avro-raw']) return s['x-avro-raw'].logicalType || s['x-avro-raw'].type || 'string';
  if (s['x-xsd']) return s['x-xsd'];
  if (s['x-avro']) return s['x-avro'];
  return s.type || 'object';
}
function attrMult(prop, req) {
  if (prop && prop.type === 'array') return (prop.minItems >= 1 || req) ? '[1..*]' : '[0..*]';
  return req ? '[1]' : '[0..1]';
}
