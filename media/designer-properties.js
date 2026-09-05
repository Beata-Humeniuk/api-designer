function renderProps() {
  const panel = document.getElementById('props');
  const reopen = document.getElementById('propsreopen');
  panel.className = S.propsOpen ? '' : 'hidden';
  reopen.style.display = S.propsOpen ? 'none' : 'flex';
  reopen.onclick = function () { S.propsOpen = true; render(); };
  document.getElementById('propsclose').onclick = function () { S.propsOpen = false; render(); };
  const gear = document.getElementById('propssettings');
  gear.className = S.propTarget.kind === 'interface' ? 'on' : '';
  gear.style.display = spec ? '' : 'none';
  gear.onclick = function () { selectProps({ kind: 'interface' }); render(); };
  const idBox = document.getElementById('propsid');
  const body = document.getElementById('propsbody');
  idBox.innerHTML = '';
  body.innerHTML = '';

  const build = function () {
    try {
      return buildProps();
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  };
  let P = build();
  if (P.empty && spec && S.propTarget.kind !== 'interface') {
    S.propTarget = { kind: 'interface' };
    P = build();
  }
  if (P.error) {
    body.appendChild(el('div', { style: 'color:var(--mdel);font-size:12px',
      text: M('error.readFailed', { error: P.error }) }));
    return;
  }
  if (P.empty) {
    panel.className = 'hidden';
    reopen.style.display = 'flex';
    return;
  }
  idBox.appendChild(el('span', { style: 'width:11px;height:11px;border-radius:2px;flex:none;background:' + P.iconColor }));
  idBox.appendChild(el('div', {},
    el('div', { style: 'font-size:13px;color:var(--fg-bright);font-weight:600', text: P.title }),
    el('div', { style: 'font-size:11px;color:var(--fg-dim)', text: P.kind })));
  P.fields.forEach(function (f) { body.appendChild(fld(f)); });
}

function numOrDel(obj, key) {
  return function (v) {
    if (v === '') delete obj[key];
    else obj[key] = isNaN(Number(v)) ? v : Number(v);
    markDirty();
  };
}
function strOrDel(obj, key) {
  return function (v) { if (v === '') delete obj[key]; else obj[key] = v; markDirty(); };
}
function isOas31() { return !!spec && !isV2() && /^3\.[12]/.test(String(spec.openapi || '')); }

function readExample(t) {
  if (t.example !== undefined) return t.example;
  return Array.isArray(t.examples) ? t.examples[0] : undefined;
}
function clearExample(t) { delete t.example; delete t.examples; }
function writeExample(t, val) {
  clearExample(t);
  if (isOas31()) t.examples = [val]; else t.example = val;
}
function exampleOrDel(core) {
  return function (v) {
    if (v === '') clearExample(core);
    else writeExample(core, isNaN(Number(v)) ? v : Number(v));
    markDirty();
  };
}

function listExampleOrDel(wrapper) {
  return function (v) {
    v = String(v).trim();
    if (v === '') { clearExample(wrapper); markDirty(); return; }
    if (v === 'null') { writeExample(wrapper, null); markDirty(); return; }
    try {
      const parsed = JSON.parse(v);
      writeExample(wrapper, Array.isArray(parsed) ? parsed : [parsed]);
    } catch (e) {
      writeExample(wrapper, [isNaN(Number(v)) ? v : Number(v)]);
    }
    markDirty();
  };
}

function buildProps() {
  const t = S.propTarget;
  const F = [];
  const out = { fields: F, empty: false, title: '', kind: '', iconColor: 'var(--green)' };
  const d = S.view === 'structure' ? deriveClassModel() : null;

  if (t.kind === 'event') {
    out.title = avroMeta ? avroMeta.rootName : 'Event';
    out.kind = 'event';
    out.iconColor = 'var(--mput)';
    if (avroMeta) {
      F.push({ label: 'record', kind: 'text', mono: true, disabled: true, value: avroMeta.rootName, onChange: function () {} });
      if (avroMeta.namespace) F.push({ label: 'namespace', kind: 'text', mono: true, disabled: true, value: avroMeta.namespace, onChange: function () {} });
    }
    F.push({ kind: 'custom', build: function () { return operationActions({}); } });
    return out;
  }

  if (t.kind === 'interface') {
    const info = spec.info = spec.info || {};
    out.title = info.title || 'Contract';
    out.kind = 'interface';
    if (docKind !== 'openapi') {
      F.push({ label: 'standard', kind: 'text', disabled: true, value: stdLabel(), onChange: function () {} });
      if (docKind === 'avro' && avroMeta) {
        F.push({ label: 'record', kind: 'text', mono: true, disabled: true, value: avroMeta.rootName, onChange: function () {} });
        if (avroMeta.namespace) F.push({ label: 'namespace', kind: 'text', mono: true, disabled: true, value: avroMeta.namespace, onChange: function () {} });
      }
      F.push({ kind: 'custom', build: contractActions });
      return out;
    }
    F.push({ label: 'title', kind: 'text', value: info.title, onChange: strOrDel(info, 'title') });
    F.push({ label: 'version', kind: 'text', value: info.version, onChange: strOrDel(info, 'version') });
    F.push({ label: 'application', kind: 'text', value: info['x-application'],
      onChange: strOrDel(info, 'x-application') });
    F.push({ label: 'standard', kind: 'text', disabled: true, value: stdLabel(), onChange: function () {} });
    F.push({ label: 'description', kind: 'textarea', value: info.description, onChange: strOrDel(info, 'description') });
    if (isV2()) {
      F.push({ label: 'host', kind: 'text', mono: true, value: spec.host, onChange: strOrDel(spec, 'host') });
      F.push({ label: 'basePath', kind: 'text', mono: true, value: spec.basePath, onChange: strOrDel(spec, 'basePath') });
      F.push({ label: 'schemes', kind: 'multi', key: 'i-schemes', options: ['https', 'http', 'ws', 'wss'], selected: spec.schemes || [], onToggle: function (v) { toggleArr(spec, 'schemes', v); } });
    } else {
      F.push({ label: 'servers', kind: 'text', mono: true, value: serversText(), onChange: setServersFromText });
    }
    F.push({ label: 'availability', kind: 'text', value: info['x-availability'], placeholder: '24/7',
      onChange: strOrDel(info, 'x-availability') });
    F.push({ label: 'responseTime', kind: 'text', value: info['x-response-time'],
      onChange: strOrDel(info, 'x-response-time') });
    F.push({ kind: 'custom', build: contractActions });
    return out;
  }

  if (t.kind === 'operation') {
    const op = curOp();
    if (!op || !S.selOp) { out.empty = true; return out; }
    out.title = op.operationId || (S.selOp.method + ' ' + S.selOp.path);
    out.kind = 'operation';
    out.iconColor = METHOD_COLOR[S.selOp.method] || 'var(--mpost)';
    F.push({ label: 'operationId', kind: 'text', mono: true, value: op.operationId, onChange: strOrDel(op, 'operationId') });
    F.push({ label: 'method', kind: 'select', value: S.selOp.method, options: methodsFor(), onChange: function (v) { moveOp(S.selOp.path, S.selOp.method, S.selOp.path, v); } });
    F.push({ label: 'path', kind: 'text', mono: true, value: S.selOp.path, onChange: function (v) { if (v[0] !== '/') v = '/' + v; moveOp(S.selOp.path, S.selOp.method, v, S.selOp.method); } });
    F.push({ label: 'summary', kind: 'text', value: op.summary, onChange: strOrDel(op, 'summary') });
    F.push({ label: 'tags', kind: 'tags', tags: op.tags || [],
      onAdd: function (v) { op.tags = op.tags || []; if (op.tags.indexOf(v) < 0) op.tags.push(v); markDirty(); },
      onRemove: function (i) { op.tags.splice(i, 1); if (!op.tags.length) delete op.tags; markDirty(); } });
    F.push({ label: 'description', kind: 'textarea', value: op.description, onChange: strOrDel(op, 'description') });
    if (isV2()) {
      F.push({ label: 'produces', kind: 'multi', key: 'op-produces', options: MEDIA_TYPES, selected: op.produces || [], onToggle: function (v) { toggleArr(op, 'produces', v); } });
    }
    F.push({ label: 'security', kind: 'select', value: opSecurity(op), options: securityOptions(), onChange: function (v) { setOpSecurity(op, v); markDirty(); } });
    F.push({ label: 'deprecated', kind: 'toggle', value: !!op.deprecated, onChange: function () { if (op.deprecated) delete op.deprecated; else op.deprecated = true; markDirty(); } });
    F.push({ kind: 'custom', build: function () { return operationActions({ path: S.selOp.path, method: S.selOp.method }); } });
    if (!RO) F.push({ kind: 'custom', build: deleteOpAction });
    return out;
  }

  if (t.kind === 'wsdlop') {
    const op = wsdlMeta && (wsdlMeta.operations.find(function (o) { return o.name === S.wsdlSelOp; }) || wsdlMeta.operations[0]);
    if (!op) { out.empty = true; return out; }
    out.title = op.name;
    out.kind = 'operation';
    out.iconColor = 'var(--purple)';
    F.push({ label: 'name', kind: 'text', mono: true, value: op.name, onChange: function (v) {
      v = v.trim();
      if (!v || v === op.name) { render(); return; }
      if (wsdlMeta.operations.some(function (x) { return x !== op && x.name === v; })) { toast(M('error.exists', { name: v })); render(); return; }
      op.name = v;
      S.wsdlSelOp = v;
      markDirty();
    } });
    F.push({ label: 'protocol', kind: 'text', disabled: true, value: op.protocol, onChange: function () {} });
    F.push({ label: 'portType', kind: 'text', mono: true, disabled: true, value: op.portType, onChange: function () {} });
    F.push({ label: 'documentation', kind: 'textarea', value: op.documentation, onChange: function (v) { op.documentation = v.trim(); markDirty(); } });
    F.push({ kind: 'custom', build: function () { return operationActions({ name: op.name }); } });
    return out;
  }

  if (t.kind === 'param') {
    const op = curOp();
    const p = op && op.parameters && op.parameters[t.idx];
    if (!p || p.in === 'body') { out.empty = true; return out; }
    const core = p.schema && !isV2() ? p.schema : p;
    out.title = p.name || '(unnamed)';
    out.kind = 'parameter · ' + p.in;
    out.iconColor = 'var(--orange)';
    F.push({ label: 'name', kind: 'text', mono: true, value: p.name, focus: !p.name && S.focusNewParam, onChange: function (v) { p.name = v.trim(); markDirty(); } });
    F.push({ label: 'in', kind: 'select', value: p.in, options: isV2() ? ['query', 'path', 'header', 'formData'] : ['query', 'path', 'header', 'cookie'], onChange: function (v) { p.in = v; if (v === 'path') p.required = true; markDirty(); } });
    F.push({ label: 'type', kind: 'select', value: core.type || 'string', options: ['string', 'integer', 'number', 'boolean', 'array'], onChange: function (v) {
      core.type = v;
      if (v === 'array' && !core.items) core.items = { type: 'string' };
      if (v !== 'array') delete core.items;
      markDirty();
    } });
    if (core.type === 'array') {
      F.push({ label: 'items', kind: 'select', value: (core.items && core.items.type) || 'string', options: ['string', 'integer', 'number', 'boolean'], onChange: function (v) {
        core.items = { type: v };
        markDirty();
      } });
    }
    F.push({ label: 'required', kind: 'toggle', value: !!p.required, onChange: function () { if (p.required) delete p.required; else p.required = true; markDirty(); } });
    F.push({ label: 'description', kind: 'textarea', value: p.description, onChange: strOrDel(p, 'description') });
    F.push({ label: 'format', kind: 'select', value: core.format || '', options: ['', 'int32', 'int64', 'float', 'double', 'date', 'date-time', 'email', 'uuid', 'byte'], onChange: strOrDel(core, 'format') });
    F.push({ label: 'default', kind: 'text', mono: true, value: core.default, onChange: numOrDel(core, 'default') });
    const coreEx = readExample(core);
    F.push({ label: 'example', kind: 'text', mono: true,
      value: core.type === 'array' && coreEx !== undefined ? (coreEx === null ? 'null' : JSON.stringify(coreEx)) : coreEx,
      onChange: core.type === 'array' ? listExampleOrDel(core) : exampleOrDel(core) });
    F.push({ label: 'enum', kind: 'tags', placeholder: '+ value, Enter', tags: (core.enum || []).map(String),
      onAdd: function (v) {
        const val = (core.type === 'integer' || core.type === 'number') && !isNaN(Number(v)) ? Number(v) : v;
        core.enum = core.enum || [];
        if (core.enum.indexOf(val) < 0) core.enum.push(val);
        markDirty();
      },
      onRemove: function (i) { core.enum.splice(i, 1); if (!core.enum.length) delete core.enum; markDirty(); } });
    F.push({ label: 'pattern', kind: 'text', mono: true, value: core.pattern, onChange: strOrDel(core, 'pattern') });
    F.push({ label: 'minimum', kind: 'text', mono: true, value: core.minimum, onChange: numOrDel(core, 'minimum') });
    F.push({ label: 'maximum', kind: 'text', mono: true, value: core.maximum, onChange: numOrDel(core, 'maximum') });
    F.push({ kind: 'custom', build: function () {
      return dangerDelete('Delete parameter', function () {
        op.parameters.splice(t.idx, 1);
        if (!op.parameters.length) delete op.parameters;
        S.propTarget = { kind: 'none' };
        markDirty();
      });
    } });
    return out;
  }

  if (t.kind === 'request') {
    const op = curOp();
    const req = op && requestInfo(op);
    if (!req) { out.empty = true; return out; }
    out.title = 'Request';
    out.kind = isV2() ? 'body param' : 'requestBody';
    const modelOptions = ['', '(inline)'].concat(Object.keys(host()).filter(function (n) { return objLike(host()[n]); }));
    const curModel = req.model === '(inline)' || req.model === '(no schema)' ? '' : req.model;
    if (isV2()) {
      const bp = (op.parameters || []).find(function (p) { return p && p.in === 'body'; });
      F.push({ label: 'name', kind: 'text', mono: true, value: bp.name, onChange: function (v) { bp.name = v; markDirty(); } });
      F.push({ label: 'required', kind: 'toggle', value: !!bp.required, onChange: function () { if (bp.required) delete bp.required; else bp.required = true; markDirty(); } });
      F.push({ label: 'description', kind: 'textarea', value: bp.description, onChange: strOrDel(bp, 'description') });
      F.push({ label: 'consumes', kind: 'multi', key: 'req-consumes', options: MEDIA_TYPES, selected: op.consumes || [], onToggle: function (v) { toggleArr(op, 'consumes', v); } });
      F.push({ label: 'schema', kind: 'select', value: curModel, options: modelOptions, onChange: function (v) {
        bp.schema = v && v !== '(inline)' ? { $ref: refPrefix() + v } : { type: 'object', properties: {} };
        markDirty();
      } });
      F.push({ kind: 'custom', build: function () {
        return dangerDelete('Delete request', function () {
          op.parameters = op.parameters.filter(function (p) { return p !== bp; });
          if (!op.parameters.length) delete op.parameters;
          S.propTarget = { kind: 'none' };
          markDirty();
        });
      } });
    } else {
      const rb = op.requestBody;
      F.push({ label: 'required', kind: 'toggle', value: !!rb.required, onChange: function () { if (rb.required) delete rb.required; else rb.required = true; markDirty(); } });
      F.push({ label: 'description', kind: 'textarea', value: rb.description, onChange: strOrDel(rb, 'description') });
      F.push({ label: 'consumes', kind: 'multi', key: 'req-consumes', options: MEDIA_TYPES, selected: Object.keys(rb.content || {}), onToggle: function (mt) {
        const c = rb.content = rb.content || {};
        if (c[mt]) {
          if (Object.keys(c).length <= 1) { toast(M('error.needContentType')); render(); return; }
          delete c[mt];
        } else {
          const first = Object.keys(c)[0];
          c[mt] = first ? JSON.parse(JSON.stringify(c[first])) : { schema: { type: 'object', properties: {} } };
        }
        markDirty();
      } });
      F.push({ label: 'schema', kind: 'select', value: curModel, options: modelOptions, onChange: function (v) {
        const schema = v && v !== '(inline)' ? { $ref: refPrefix() + v } : { type: 'object', properties: {} };
        const c = rb.content = rb.content || { 'application/json': {} };
        Object.keys(c).forEach(function (mt) { c[mt] = { schema: JSON.parse(JSON.stringify(schema)) }; });
        markDirty();
      } });
      F.push({ kind: 'custom', build: function () {
        return dangerDelete('Delete request', function () {
          delete op.requestBody;
          S.propTarget = { kind: 'none' };
          markDirty();
        });
      } });
    }
    return out;
  }

  if (t.kind === 'response') {
    const op = curOp();
    const r = op && op.responses && op.responses[t.code];
    if (!r) { out.empty = true; return out; }
    out.title = 'Response ' + codeLabel(t.code);
    out.kind = 'response';
    out.iconColor = t.code[0] === '2' ? 'var(--mpost)' : (t.code[0] === '4' || t.code[0] === '5') ? 'var(--mdel)' : 'var(--mput)';
    const kind = responseKind(r);
    F.push({ label: 'HTTP code', kind: 'text', mono: true, value: t.code, onChange: function (v) {
      if (!/^([1-5][0-9][0-9]|default)$/.test(v)) { toast(M('error.badHttpCode')); render(); return; }
      if (op.responses[v]) { toast(M('error.exists', { name: v })); render(); return; }
      op.responses[v] = r;
      delete op.responses[t.code];
      S.propTarget = { kind: 'response', code: v };
      markDirty();
    } });
    F.push({ label: 'description', kind: 'text', value: r.description, onChange: strOrDel(r, 'description') });
    F.push({ label: 'response type', kind: 'select', value: kind, options: [['object', 'object'], ['array', 'array'], ['text', 'text'], ['empty', 'no content']], onChange: function (v) {
      setResponseKind(op, r, v);
      markDirty();
    } });
    if (kind !== 'empty' && !isV2()) {
      F.push({ label: 'content-type', kind: 'select', value: responseMedia(op, r), options: RESP_MEDIA, onChange: function (v) {
        const c = r.content || {};
        const old = Object.keys(c)[0];
        const payload = old ? c[old] : { schema: { type: 'object', properties: {} } };
        r.content = {};
        r.content[v] = payload;
        markDirty();
      } });
    }
    if (kind === 'object' || kind === 'array') {
      F.push({ label: 'schema', kind: 'select', value: responseModel(r) === '(inline)' ? '' : responseModel(r), options: ['', '(inline)'].concat(Object.keys(host()).filter(function (n) { return objLike(host()[n]); })), onChange: function (v) {
        setResponseModel(r, kind, v);
        markDirty();
      } });
    }
    F.push({ kind: 'custom', build: function () {
      return dangerDelete(M('action.delete', { name: t.code }), function () {
        delete op.responses[t.code];
        if (!Object.keys(op.responses).length) op.responses['200'] = { description: 'OK' };
        S.propTarget = { kind: 'none' };
        markDirty();
      });
    } });
    return out;
  }

  if (t.kind === 'class' && d && S.selClass) {
    const node = d.nodes.find(function (n) { return n.id === S.selClass; });
    if (!node || !node.schema) { out.empty = true; return out; }
    out.title = node.named ? schemaSourceName(node.id) : node.name;
    out.kind = 'class';
    const srcNs = node.named ? schemaSourceNs(node.id) : '';
    F.push({ label: 'name', kind: 'text', mono: true, focus: S.focusNewParam, disabled: !!srcNs, value: node.named ? schemaSourceName(node.id) : node.name, onChange: function (v) {
      if (!node.named) { toast(M('error.renameWhereDefined')); render(); return; }
      if (srcNs) { toast(M('error.renameWhereDefined')); render(); return; }
      v = v.replace(/[^A-Za-z0-9_.-]/g, '');
      if (!v || v === node.id) { render(); return; }
      if (host()[v]) { toast(M('error.exists', { name: v })); render(); return; }
      pushHistory();
      host()[v] = host()[node.id];
      delete host()[node.id];
      renameClassRefs(node.id, v);
      const k = scopeKey(S.scope);
      if (S.extra[k]) S.extra[k] = S.extra[k].map(function (x) { return x === node.id ? v : x; });
      S.selClass = v;
      markDirty();
    } });
    if (srcNs) F.push({ label: 'namespace', kind: 'text', mono: true, disabled: true, value: srcNs, onChange: function () {} });
    F.push({ label: 'documentation', kind: 'textarea', value: node.schema.description, onChange: strOrDel(node.schema, 'description') });
    F.push({ label: 'attributes', kind: 'custom', build: function () {
      const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
      attrRows(node).forEach(function (a, ai) {
        wrap.appendChild(el('div', { cls: 'respitem', onClick: function () {
          S.selAttr = ai;
          S.propTarget = { kind: 'attr' };
          render();
        } },
          el('span', { cls: 'mono', style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:' + (a.name === '' ? 'var(--fg-dim)' : 'var(--blue)'), text: a.name === '' ? '(name?)' : a.name }),
          el('span', { cls: 'mono', style: 'color:var(--green);font-size:11px', text: a.type }),
          el('span', { cls: 'mono', style: 'color:var(--fg-dim);font-size:11px', text: a.mult }),
          el('span', { style: 'font-size:13px;color:var(--fg-dim)', text: '→' })));
      });
      if (!RO && !node.schema.enum && !primLike(node.schema)) {
        wrap.appendChild(el('div', { cls: 'dashadd', title: 'Add an attribute', text: '＋', onClick: function () {
          const target = propsHost(node.schema);
          target.properties = target.properties || {};
          pushHistory();
          const fresh = uniquePropName(target);
          target.properties[fresh] = { type: 'string' };
          S.selAttr = Object.keys(target.properties).indexOf(fresh);
          S.propTarget = { kind: 'attr' };
          S.focusNewParam = true;
          markDirty();
        } }));
      }
      return wrap;
    } });
    if (node.named && !RO) {
      F.push({ kind: 'custom', build: function () {
        return dangerDelete(M('action.delete', { name: node.id }), function () { deleteSelected(d); });
      } });
    }
    return out;
  }

  if (t.kind === 'attr' && d && S.selClass && S.selAttr != null) {
    const node = d.nodes.find(function (n) { return n.id === S.selClass; });
    const schema = propsHost(node && node.schema);
    if (!schema || !schema.properties) { out.empty = true; return out; }
    const names = Object.keys(schema.properties);
    const aname = names[S.selAttr];
    if (aname == null) { out.empty = true; return out; }
    const wrapper = schema.properties[aname];
    const core = wrapper.type === 'array' ? (wrapper.items = wrapper.items || {}) : wrapper;
    out.title = aname === '' ? '(unnamed)' : aname;
    out.kind = wrapper['x-xsd-attribute'] ? 'XML attribute' : 'attribute';
    out.iconColor = 'var(--mget)';
    F.push({ label: 'name', kind: 'text', mono: true, value: aname, focus: aname === '' && S.focusNewParam, onChange: function (v) {
      v = v.trim();
      if (!v || v === aname) { render(); return; }
      if (schema.properties[v]) { toast(M('error.exists', { name: v })); render(); return; }
      pushHistory();
      const rebuilt = {};
      names.forEach(function (k) { rebuilt[k === aname ? v : k] = schema.properties[k]; });
      schema.properties = rebuilt;
      if (schema.required) schema.required = schema.required.map(function (r) { return r === aname ? v : r; });
      const lt = linkTypes();
      if (lt[S.selClass + '|' + aname]) { lt[S.selClass + '|' + v] = lt[S.selClass + '|' + aname]; delete lt[S.selClass + '|' + aname]; }
      markDirty();
    } });
    const withLists = function (items) {
      return items.concat(items.filter(function (x) { return x !== 'object' && x !== 'array'; }).map(function (x) { return x + '[]'; }));
    };
    const schemaNames = Object.keys(host()).filter(function (n2) { return objLike(host()[n2]); });
    F.push({ label: 'type', kind: 'typepick', id: 'attr-type', value: typeLabelOf(wrapper) + (wrapper.type === 'array' ? '[]' : ''), sections: [
      { title: 'Standard types', items: withLists(stdTypesForDoc()) },
      { title: 'Contract schemas', source: 'schema', items: withLists(schemaNames) },
      { title: 'Custom types (contract)', source: 'custom', items: withLists(customTypes()) }
    ], onPick: function (v, src) {
      pushHistory();
      if (v.slice(-2) === '[]') {
        const base = v.slice(0, -2);
        if (wrapper.type === 'array') {
          setAttrTypeAndPrune(wrapper.items = wrapper.items || {}, base);
        } else {
          const w = { type: 'array', items: {} };
          schema.properties[aname] = w;
          setAttrTypeAndPrune(w.items, base);
        }
      } else if (wrapper.type === 'array') {
        const plain = {};
        schema.properties[aname] = plain;
        setAttrTypeAndPrune(plain, v);
      } else {
        setAttrTypeAndPrune(core, v);
      }
      markDirty();
    } });
    F.push({ label: 'multiplicity', kind: 'select', value: attrMult(wrapper, (schema.required || []).indexOf(aname) >= 0), options: ['[1]', '[0..1]', '[0..*]', '[1..*]'], onChange: function (v) {
      pushHistory();
      setAttrMult(schema, aname, v);
      markDirty();
    } });

    if (docKind === 'avro' && !core.$ref && core.type !== 'object' && core.type !== 'array') {
      F.push({ label: 'Avro type (JSON)', kind: 'text', mono: true,
        value: core['x-avro-raw'] ? JSON.stringify(core['x-avro-raw']) : JSON.stringify(prim2avro(core)),
        onChange: function (v) {
          v = v.trim();
          let parsed;
          try { parsed = JSON.parse(v); } catch (e) { parsed = /^[\w.-]+$/.test(v) ? v : undefined; }
          if (typeof parsed === 'string' && AVRO_PRIM_MAP[parsed]) {
            pushHistory();
            delete core['x-avro-raw']; delete core.format;
            core['x-avro'] = parsed;
            core.type = AVRO_PRIM_MAP[parsed];
            pruneConstraints(core);
            markDirty();
            return;
          }
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.type === 'string' && AVRO_PRIM_MAP[parsed.type]) {
            pushHistory();
            delete core['x-avro']; delete core['x-avro-raw']; delete core.format;
            const p = avroAnnotatedProp(parsed);
            Object.keys(p).forEach(function (k) { core[k] = p[k]; });
            pruneConstraints(core);
            markDirty();
            return;
          }
          toast(M('error.badAvroType'));
          render();
        } });
    }
    const xmlDoc = docKind === 'xsd' || docKind === 'wsdl';
    const facets = !xmlDoc;
    if (wrapper.type === 'array' && facets) {

      const listEx = readExample(wrapper);
      F.push({ label: 'example (list)', kind: 'text', mono: true,
        value: listEx === null ? 'null' : (listEx === undefined ? undefined : JSON.stringify(listEx)),
        onChange: listExampleOrDel(wrapper) });
    }
    const tv = core.$ref ? 'ref' : (core.type || 'string');
    const numeric = tv === 'integer' || tv === 'number';
    if (FORMATS_BY_TYPE[tv] && facets) F.push({ label: 'format', kind: 'select', value: core.format || '', options: FORMATS_BY_TYPE[tv], onChange: strOrDel(core, 'format') });
    const nullableFld = { label: xmlDoc ? 'nillable' : nullableKey(), kind: 'toggle', value: readNullable(core), onChange: function () { writeNullable(core, !readNullable(core)); markDirty(); } };

    if (xmlDoc && (tv === 'ref' || tv === 'object')) F.push(nullableFld);
    if (tv !== 'ref' && tv !== 'object' && tv !== 'array') {
      F.push(nullableFld);
      if (facets) {
        F.push({ label: 'default', kind: 'text', mono: true, value: core.default, onChange: numOrDel(core, 'default') });
        F.push({ label: wrapper.type === 'array' ? 'example (item)' : 'example', kind: 'text', mono: true, value: readExample(core), onChange: exampleOrDel(core) });
      }
    }
    if ((tv === 'string' || numeric) && facets) F.push(enumEditorFld(core, numeric));
    if (tv === 'string' && facets) {
      F.push({ label: 'pattern', kind: 'text', mono: true, value: core.pattern, onChange: strOrDel(core, 'pattern') });
      F.push({ label: 'minLength', kind: 'text', mono: true, value: core.minLength, onChange: numOrDel(core, 'minLength') });
      F.push({ label: 'maxLength', kind: 'text', mono: true, value: core.maxLength, onChange: numOrDel(core, 'maxLength') });
    }
    if (numeric && facets) {
      F.push({ label: 'minimum', kind: 'text', mono: true, value: core.minimum, onChange: numOrDel(core, 'minimum') });
      F.push({ label: 'maximum', kind: 'text', mono: true, value: core.maximum, onChange: numOrDel(core, 'maximum') });
    }
    F.push({ label: 'deprecated', kind: 'toggle', value: !!core.deprecated, onChange: function () { if (core.deprecated) delete core.deprecated; else core.deprecated = true; markDirty(); } });
    if (!RO) F.push({ kind: 'custom', build: function () {
      return dangerDelete(M('action.delete', { name: aname }), function () {
        pushHistory();
        delete schema.properties[aname];
        dropRequired(schema, aname);
        S.selAttr = null;
        S.propTarget = { kind: 'none' };
        markDirty();
      });
    } });
    return out;
  }

  if (t.kind === 'paste') {
    out.title = 'Paste a schema';
    out.kind = 'JSON / XML';
    out.iconColor = 'var(--mput)';
    F.push({ label: M('paste.nameLabel'), kind: 'text', mono: true, value: S.pasteName || '', onChange: function (v) { S.pasteName = v; } });
    F.push({ label: M('paste.body'), kind: 'custom', build: function () {
      const ta = el('textarea', { id: 'pastearea', cls: 'txa mono', rows: 10, placeholder: '{ "Pet": { "type": "object", "properties": { "name": { "type": "string" } } } }', onChange: function (e) { S.pasteText = e.target.value; } });
      ta.value = S.pasteText || '';
      return ta;
    } });
    F.push({ kind: 'custom', build: function () {
      return el('button', { cls: 'btn', style: 'width:100%', text: 'Add to the contract', onClick: function () {
        let parsed;
        try {
          parsed = parsePasted(S.pasteText, S.pasteName);
        } catch (e) {
          toast(M('error.readFailed', { error: e.message || String(e) }));
          return;
        }
        pushHistory();
        const added = [];
        Object.keys(parsed).forEach(function (n) {
          const final = uniqueName(n);
          host()[final] = parsed[n];
          added.push(final);
        });
        S.pasteText = '';
        S.pasteName = '';
        toast('Added: ' + added.join(', '));
        openStructure({ kind: 'model', name: added[0] });
        S.selClass = added[0];
        S.propTarget = { kind: 'class' };
        markDirty();
      } });
    } });
    return out;
  }

  if (t.kind === 'customtype') {
    const s = host()[t.name];
    if (!s) { out.empty = true; return out; }
    out.title = t.name;
    out.kind = 'custom type';
    out.iconColor = 'var(--purple)';
    F.push({ label: 'name', kind: 'text', mono: true, value: t.name, onChange: function (v) {
      v = v.replace(/[^A-Za-z0-9_.-]/g, '');
      if (!v || v === t.name) { render(); return; }
      if (host()[v]) { toast(M('error.exists', { name: v })); render(); return; }
      host()[v] = s;
      delete host()[t.name];
      renameClassRefs(t.name, v);
      S.propTarget = { kind: 'customtype', name: v };
      markDirty();
    } });
    F.push({ label: 'extends (base type)', kind: 'typepick', id: 'ct-extends', value: s.type || 'string', sections: [
      { title: 'Primitive types', items: PRIMS }
    ], onPick: function (v) {
      s.type = v;
      pruneConstraints(s);
      markDirty();
    } });
    const bt = s.type || 'string';
    const btNum = bt === 'integer' || bt === 'number';
    if (FORMATS_BY_TYPE[bt]) F.push({ label: 'format', kind: 'select', value: s.format || '', options: FORMATS_BY_TYPE[bt], onChange: strOrDel(s, 'format') });
    if (bt === 'string') {
      F.push({ label: 'pattern', kind: 'text', mono: true, value: s.pattern, onChange: strOrDel(s, 'pattern') });
      F.push({ label: 'minLength', kind: 'text', mono: true, value: s.minLength, onChange: numOrDel(s, 'minLength') });
      F.push({ label: 'maxLength', kind: 'text', mono: true, value: s.maxLength, onChange: numOrDel(s, 'maxLength') });
    }
    if (btNum) {
      F.push({ label: 'minimum', kind: 'text', mono: true, value: s.minimum, onChange: numOrDel(s, 'minimum') });
      F.push({ label: 'maximum', kind: 'text', mono: true, value: s.maximum, onChange: numOrDel(s, 'maximum') });
    }
    if (bt === 'string' || btNum) F.push(enumEditorFld(s, btNum));
    F.push({ label: 'description', kind: 'textarea', value: s.description, onChange: strOrDel(s, 'description') });
    if (!RO) F.push({ kind: 'custom', build: function () {
      return dangerDelete(M('action.delete', { name: t.name }), function () {
        if (refUsed(t.name)) { toast(M('error.inUse', { name: t.name, by: '' })); return; }
        delete host()[t.name];
        delete positions()[t.name];
        S.propTarget = { kind: 'none' };
        markDirty();
      });
    } });
    return out;
  }

  out.empty = true;
  return out;
}

const FORMATS_BY_TYPE = { string: ['', 'date', 'date-time', 'email', 'uuid', 'byte', 'password', 'uri'], integer: ['', 'int32', 'int64'], number: ['', 'float', 'double'] };
function pruneConstraints(core) {
  const t = core.$ref ? 'ref' : (core.type || core.base);
  if (t !== 'string') { delete core.pattern; delete core.minLength; delete core.maxLength; }
  if (t !== 'integer' && t !== 'number') { delete core.minimum; delete core.maximum; }
  if (t !== 'string' && t !== 'integer' && t !== 'number') { delete core.enum; delete core.format; }
  if ((FORMATS_BY_TYPE[t] || []).indexOf(core.format || '') < 0) delete core.format;
  if (t === 'ref' || t === 'object' || t === 'array') {

    if (docKind !== 'xsd' && docKind !== 'wsdl') { delete core.nullable; delete core['x-nullable']; }
    delete core.default; clearExample(core);
  }
}
function setAttrType(core, v) {
  delete core.$ref; delete core.properties; delete core.items;

  delete core['x-xsd']; delete core['x-avro']; delete core['x-avro-raw'];
  if ((docKind === 'xsd' || docKind === 'wsdl') && v !== 'object' && XSD_PRIMS[v]) {
    delete core.format;
    const mapped = XSD_PRIMS[v];
    if (mapped === 'date') { core.type = 'string'; core.format = 'date'; }
    else if (mapped === 'date-time') { core.type = 'string'; core.format = 'date-time'; }
    else core.type = mapped;
    core['x-xsd'] = v;
    return;
  }
  if (docKind === 'avro') {
    if (AVRO_PRIM_MAP[v]) { delete core.format; core.type = AVRO_PRIM_MAP[v]; core['x-avro'] = v; return; }
    if (AVRO_LOGICAL_DEFAULTS[v]) {
      delete core.format; delete core.type;
      const p = avroAnnotatedProp(AVRO_LOGICAL_DEFAULTS[v]);
      Object.keys(p).forEach(function (k) { core[k] = p[k]; });
      return;
    }
  }
  if (v === 'date' || v === 'date-time' || v === 'uuid') { core.type = 'string'; core.format = v; return; }
  if (STD_TYPES.indexOf(v) >= 0) {
    core.type = v;
    delete core.format;
    if (v === 'object') core.properties = {};
    if (v === 'array') core.items = { type: 'string' };
    return;
  }
  delete core.type; delete core.format;
  core.$ref = refPrefix() + v;
}
function setAttrTypeAndPrune(core, v) {
  setAttrType(core, v);
  pruneConstraints(core);
}

function setAttrMult(schema, name, mult) {
  let p = schema.properties[name];
  const isArr = p.type === 'array';
  const core = isArr ? (p.items || {}) : (function () { const c = {}; Object.keys(p).forEach(function (k) { c[k] = p[k]; }); return c; })();
  if (mult === '[0..*]' || mult === '[1..*]') {
    if (!isArr) schema.properties[name] = p = { type: 'array', items: core };
    if (mult === '[1..*]') p.minItems = 1; else delete p.minItems;
    setRequired(schema, name, mult === '[1..*]');
  } else {
    if (isArr) schema.properties[name] = core;
    setRequired(schema, name, mult === '[1]');
  }
}
function setRequired(schema, name, on) {
  let req = schema.required || [];
  if (on) { if (req.indexOf(name) < 0) req.push(name); }
  else req = req.filter(function (r) { return r !== name; });
  if (req.length) schema.required = req; else delete schema.required;
}

function setResponseKind(op, r, v) {
  const mkSchema = function () {
    if (v === 'text') return { type: 'string' };
    if (v === 'array') return { type: 'array', items: { type: 'object', properties: {} } };
    return { type: 'object', properties: {} };
  };
  if (isV2()) {
    if (v === 'empty') delete r.schema;
    else r.schema = mkSchema();
  } else {
    if (v === 'empty') { delete r.content; return; }
    const c = r.content = r.content || {};
    const mt = Object.keys(c)[0] || 'application/json';
    c[mt] = { schema: mkSchema() };
  }
}
function setResponseModel(r, kind, name) {
  const target = name && name !== '(inline)' ? { $ref: refPrefix() + name } : { type: 'object', properties: {} };
  const wrap = kind === 'array' ? { type: 'array', items: target } : target;
  if (isV2() || r.schema) r.schema = wrap;
  else {
    const c = r.content = r.content || {};
    const mt = Object.keys(c)[0] || 'application/json';
    c[mt] = { schema: wrap };
  }
}
