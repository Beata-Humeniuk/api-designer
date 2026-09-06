const vscodeApi = acquireVsCodeApi();

function M(key, params) {
  const text = NLS[key] || key;
  return text.replace(/\{(\w+)\}/g, function (whole, name) {
    return params && name in params ? String(params[name]) : whole;
  });
}

let spec = null;
let RO = false;
let roFormat = null;
let wsdlMeta = null;
let docKind = 'openapi';
let xmlMeta = null;
let avroMeta = null;
let avroOrig = null;
let avroOrigText = null;
let lastWrittenText = null;
let wsdlOrigText = null;
let xsdOrigText = null;
let xmlIncludeTexts = [];
let xmlRenames = [];
let fileName = '';
let hasDoc = false;

let saveStatus = 'All changes saved';
let applyTimer = null;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE'];
function methodsFor() { return isV2() ? METHODS.filter(function (m) { return m !== 'TRACE'; }) : METHODS; }
function nullableKey() { return isV2() ? 'x-nullable' : 'nullable'; }
function readNullable(core) { return core.nullable === true || core['x-nullable'] === true; }
function writeNullable(core, on) {
  delete core.nullable;
  delete core['x-nullable'];
  if (on) core[nullableKey()] = true;
}
const METHOD_COLOR = { GET: 'var(--mget)', POST: 'var(--mpost)', PUT: 'var(--mput)', DELETE: 'var(--mdel)',
  PATCH: 'var(--mpatch)', HEAD: 'var(--fg-dim)', OPTIONS: 'var(--fg-dim)', TRACE: 'var(--fg-dim)', EVENT: 'var(--mput)' };
const MEDIA_TYPES = ['application/json', 'application/xml', 'multipart/form-data', 'application/x-www-form-urlencoded', 'text/plain'];
const RESP_MEDIA = ['application/json', 'application/xml', 'text/plain', 'text/html', 'application/octet-stream'];
const STD_TYPES = ['string', 'integer', 'number', 'boolean', 'array', 'object', 'date', 'date-time', 'uuid'];

const XSD_TYPE_LIST = ['string', 'token', 'normalizedString', 'anyURI', 'boolean', 'decimal', 'integer', 'int', 'long', 'short', 'byte',
  'nonNegativeInteger', 'positiveInteger', 'unsignedInt', 'unsignedLong', 'double', 'float',
  'date', 'dateTime', 'time', 'duration', 'base64Binary', 'hexBinary', 'QName', 'object'];
const AVRO_TYPE_LIST = ['string', 'int', 'long', 'float', 'double', 'boolean', 'bytes',
  'date', 'time-millis', 'timestamp-millis', 'uuid', 'decimal', 'object'];
const AVRO_PRIM_MAP = { int: 'integer', long: 'integer', float: 'number', double: 'number', bytes: 'string', string: 'string', boolean: 'boolean' };
const AVRO_LOGICAL_DEFAULTS = {
  date: { type: 'int', logicalType: 'date' },
  'time-millis': { type: 'int', logicalType: 'time-millis' },
  'timestamp-millis': { type: 'long', logicalType: 'timestamp-millis' },
  uuid: { type: 'string', logicalType: 'uuid' },
  decimal: { type: 'bytes', logicalType: 'decimal', precision: 18, scale: 2 }
};
function stdTypesForDoc() {
  if (docKind === 'xsd' || docKind === 'wsdl') return XSD_TYPE_LIST;
  if (docKind === 'avro') return AVRO_TYPE_LIST;
  return STD_TYPES;
}

function avroAnnotatedProp(raw) {
  const p = { type: AVRO_PRIM_MAP[raw.type] || 'string' };
  const lt = raw.logicalType;
  if (lt === 'decimal') p.type = 'number';
  else if (lt === 'uuid') { p.type = 'string'; p.format = 'uuid'; }
  else if (lt === 'date') { p.type = 'string'; p.format = 'date'; }
  else if (typeof lt === 'string' && lt.indexOf('timestamp') >= 0) { p.type = 'string'; p.format = 'date-time'; }
  p['x-avro-raw'] = JSON.parse(JSON.stringify(raw));
  return p;
}

function prim2avro(p) {
  if (p['x-avro']) return p['x-avro'];
  if (p.type === 'integer') return 'long';
  if (p.type === 'number') return 'double';
  if (p.type === 'boolean') return 'boolean';
  return 'string';
}
const STATUS_NAMES = {
  '100': 'Continue', '101': 'Switching Protocols',
  '200': 'OK', '201': 'Created', '202': 'Accepted', '204': 'No Content', '206': 'Partial Content',
  '301': 'Moved Permanently', '302': 'Found', '304': 'Not Modified', '307': 'Temporary Redirect', '308': 'Permanent Redirect',
  '400': 'Bad Request', '401': 'Unauthorized', '403': 'Forbidden', '404': 'Not Found', '405': 'Method Not Allowed',
  '406': 'Not Acceptable', '408': 'Request Timeout', '409': 'Conflict', '410': 'Gone', '412': 'Precondition Failed',
  '415': 'Unsupported Media Type', '422': 'Unprocessable Entity', '429': 'Too Many Requests',
  '500': 'Internal Server Error', '501': 'Not Implemented', '502': 'Bad Gateway', '503': 'Service Unavailable', '504': 'Gateway Timeout'
};
function codeLabel(code) { return STATUS_NAMES[code] ? code + ' ' + STATUS_NAMES[code] : code; }
const PRIMS = ['string', 'integer', 'number', 'boolean'];

const S = {
  view: 'create',
  selOp: null,
  scope: { kind: 'models' },
  scopeFrom: 'contract',
  selClass: null, selAttr: null,
  propTarget: { kind: 'none' }, propsOpen: false,
  expanded: { root: true, iface: true, models: true },
  multiOpen: {},
  past: [], future: [],
  openStructures: [],
  treeOpen: {}, treeAll: false,
  treePath: null,
  createKind: 'openapi', createVals: {},
  search: '',
  extra: {}
};

function selectProps(target) {
  S.propTarget = target;
  S.propsOpen = true;
}

function isV2() { return spec && spec.swagger === '2.0'; }
function stdLabel() { if (roFormat) return roFormat; return isV2() ? 'Swagger 2.0' : 'OpenAPI ' + spec.openapi; }
function refPrefix() { return isV2() ? '#/definitions/' : '#/components/schemas/'; }
function host() {
  if (!spec) return {};
  if (isV2()) { if (!spec.definitions) spec.definitions = {}; return spec.definitions; }
  if (spec.definitions) return spec.definitions;
  if (!spec.components) spec.components = {};
  if (!spec.components.schemas) spec.components.schemas = {};
  return spec.components.schemas;
}
function refName(ref) {
  const m = typeof ref === 'string' && ref.match(/#\/(?:definitions|components\/schemas)\/([^/]+)$/);
  return m ? m[1] : null;
}
function schemaRefName(sch) {
  if (!sch || typeof sch !== 'object') return null;
  if (sch.$ref) return refName(sch.$ref);
  if (Array.isArray(sch.allOf)) {
    const refs = sch.allOf.filter(function (x) { return x && x.$ref; });
    if (refs.length === 1) return refName(refs[0].$ref);
  }
  return null;
}
function objLike(s) { return !!(s && typeof s === 'object' && (s.properties || s.allOf || s.type === 'object')); }
function propsHost(schema) {
  const parts = (schema && Array.isArray(schema.allOf)) ? schema.allOf : [];
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (part && typeof part === 'object' && !part.$ref &&
      (part.properties || part.type === 'object')) return part;
  }
  return schema;
}
function uniquePropName(hostObj) {
  const taken = hostObj.properties || {};
  let n = 'newField';
  let i = 2;
  while (Object.prototype.hasOwnProperty.call(taken, n)) { n = 'newField' + i; i += 1; }
  return n;
}
function primLike(s) { return !!(s && typeof s === 'object' && !s.properties && !s.allOf && PRIMS.indexOf(s.type) >= 0); }
function listOps() {
  const out = [];
  const paths = (spec && spec.paths) || {};
  Object.keys(paths).forEach(function (p) {
    METHODS.forEach(function (m) {
      const op = paths[p] && paths[p][m.toLowerCase()];
      if (op) out.push({ path: p, method: m, op: op });
    });
  });
  return out;
}
function curOp() {
  if (!S.selOp || !spec || !spec.paths) return null;
  const pi = spec.paths[S.selOp.path];
  return pi ? pi[S.selOp.method.toLowerCase()] || null : null;
}

// Diagram layout lives inside the contract itself, under a vendor extension
// named after this extension. Earlier names are NOT read: an abandoned name
// does not come back into the sources, not even to migrate off itself. A
// contract that carries an older key opens with default positions and takes
// the current key on the next save.
const LAYOUT_KEY = 'x-api-editor';

function ext() {
  spec[LAYOUT_KEY] = spec[LAYOUT_KEY] || {};
  return spec[LAYOUT_KEY];
}
function positions() { const e = ext(); e.diagram = e.diagram || {}; e.diagram.positions = e.diagram.positions || {}; return e.diagram.positions; }
function linkTypes() { const e = ext(); e.diagram = e.diagram || {}; e.diagram.linkTypes = e.diagram.linkTypes || {}; return e.diagram.linkTypes; }
function uniqueName(base) {
  base = (base || 'Klasa').replace(/[^A-Za-z0-9_.-]/g, '') || 'Klasa';
  if (!host()[base]) return base;
  let n = 2;
  while (host()[base + n]) n++;
  return base + n;
}
function securitySchemes() {
  return (isV2() ? spec.securityDefinitions : (spec.components && spec.components.securitySchemes)) || {};
}
function securityTemplates() {
  const exUrl = 'https:' + '//example.com';
  if (isV2()) {
    return [
      { id: 'basicAuth', label: 'basicAuth (HTTP basic)', def: { type: 'basic' } },
      { id: 'apiKeyAuth', label: M('security.apiKeyHeader'), def: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
      { id: 'oauth2', label: 'oauth2 (application flow)', def: { type: 'oauth2', flow: 'application', tokenUrl: exUrl + '/oauth/token', scopes: {} } }
    ];
  }
  return [
    { id: 'bearerAuth', label: 'bearerAuth (HTTP bearer / JWT)', def: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    { id: 'basicAuth', label: 'basicAuth (HTTP basic)', def: { type: 'http', scheme: 'basic' } },
    { id: 'apiKeyAuth', label: M('security.apiKeyHeader'), def: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
    { id: 'oauth2', label: 'oauth2 (client credentials)', def: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: exUrl + '/oauth/token', scopes: {} } } } },
    { id: 'openIdConnect', label: 'openIdConnect', def: { type: 'openIdConnect', openIdConnectUrl: exUrl + '/.well-known/openid-configuration' } }
  ];
}
function securityOptions() {
  const defs = securitySchemes();
  const opts = [['', '—']];
  Object.keys(defs).forEach(function (n) { opts.push([n, n]); });
  securityTemplates().forEach(function (t) { if (!defs[t.id]) opts.push(['new:' + t.id, '＋ ' + t.label]); });
  return opts;
}
function opSecurity(op) {
  const s = op.security && op.security[0];
  return s ? Object.keys(s)[0] || '' : '';
}
function setOpSecurity(op, name) {
  if (!name) { delete op.security; return; }
  if (name.indexOf('new:') === 0) {
    const t = securityTemplates().find(function (x) { return 'new:' + x.id === name; });
    if (!t) return;
    if (isV2()) {
      spec.securityDefinitions = spec.securityDefinitions || {};
      spec.securityDefinitions[t.id] = JSON.parse(JSON.stringify(t.def));
    } else {
      spec.components = spec.components || {};
      spec.components.securitySchemes = spec.components.securitySchemes || {};
      spec.components.securitySchemes[t.id] = JSON.parse(JSON.stringify(t.def));
    }
    name = t.id;
  }
  const o = {};
  o[name] = [];
  op.security = [o];
}
function dropRequired(schema, name) {
  if (!schema || !schema.required) return;
  schema.required = schema.required.filter(function (r) { return r !== name; });
  if (!schema.required.length) delete schema.required;
}
function refUsed(name) {
  const ref = refPrefix() + name;
  let used = false;
  (function walk(o) {
    if (used || !o || typeof o !== 'object') return;
    if (typeof o.$ref === 'string' && o.$ref === ref) { used = true; return; }
    Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') walk(o[k]); });
  })(spec);
  return used;
}
function renameClassRefs(oldName, newName) {
  const oldRef = refPrefix() + oldName, newRef = refPrefix() + newName;
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (typeof o.$ref === 'string' && o.$ref === oldRef) o.$ref = newRef;
    Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') walk(o[k]); });
  })(spec);
  const pos = positions();
  if (pos[oldName]) { pos[newName] = pos[oldName]; delete pos[oldName]; }
  const lt = linkTypes();
  Object.keys(lt).forEach(function (k) {
    if (k.indexOf(oldName + '|') === 0) { lt[newName + k.slice(oldName.length)] = lt[k]; delete lt[k]; }
  });
  if (xmlMeta && xmlMeta.elements) {
    Object.keys(xmlMeta.elements).forEach(function (k) { if (xmlMeta.elements[k] === oldName) xmlMeta.elements[k] = newName; });
  }
  if (wsdlMeta) {
    wsdlMeta.operations.forEach(function (o) {
      if (o.input === oldName) o.input = newName;
      if (o.output === oldName) o.output = newName;
      o.faults.forEach(function (f) { if (f.className === oldName) f.className = newName; });
    });
  }
  if (avroMeta && avroMeta.rootName === oldName) avroMeta.rootName = newName;

  if ((docKind === 'xsd' || docKind === 'wsdl') && !(xmlMeta && xmlMeta.imported && xmlMeta.imported[oldName])) {
    xmlRenames.push({ from: oldName, to: newName });
  }
}

function markDirty() {
  if (RO) { saveStatus = M('status.preview'); render(); return; }
  if (!hasDoc) { render(); return; }
  saveStatus = '● Applying changes';
  clearTimeout(applyTimer);
  applyTimer = setTimeout(function () {
    if (docKind === 'openapi') { vscodeApi.postMessage({ type: 'apply', spec: spec }); return; }
    try {
      const out = serializeDoc();
      if (out.warn) toast(out.warn);
      if (lastWrittenText !== null && out.text === lastWrittenText) {
        saveStatus = 'All changes saved';
        renderStatus();
        return;
      }
      lastWrittenText = out.text;
      vscodeApi.postMessage({ type: 'applyRaw', text: out.text });
    } catch (e) {
      saveStatus = M('status.writeFailed', { format: docKind, error: e.message || String(e) });
      renderStatus();
    }
  }, 500);
  render();
}

const KEPT_STATE = ['view', 'selOp', 'wsdlSelOp', 'scope', 'scopeFrom', 'selClass', 'selAttr',
  'propTarget', 'propsOpen', 'expanded', 'multiOpen', 'openStructures',
  'treeOpen', 'treeAll', 'treePath', 'search', 'canvasScroll',
  'extra'];

function snapshotState() {
  const keep = {};
  KEPT_STATE.forEach(function (k) { keep[k] = S[k]; });
  return keep;
}

function opAlive(sel) {
  if (!sel || !spec || !spec.paths) return false;
  const pi = spec.paths[sel.path];
  return !!(pi && pi[String(sel.method).toLowerCase()]);
}

function scopeAlive(sc) {
  if (!sc) return false;
  if (sc.kind === 'models') return true;
  if (sc.kind === 'model') return !!host()[sc.name];
  return opAlive(sc);
}

function restoreKept(keep, fallback) {
  KEPT_STATE.forEach(function (k) { if (keep[k] !== undefined) S[k] = keep[k]; });

  S.past = []; S.future = [];
  if (S.selOp && !opAlive(S.selOp)) S.selOp = fallback.selOp;
  if (S.wsdlSelOp && wsdlMeta && !wsdlMeta.operations.some(function (o) { return o.name === S.wsdlSelOp; })) {
    S.wsdlSelOp = fallback.wsdlSelOp;
  }
  S.openStructures = (S.openStructures || []).filter(scopeAlive);
  if (S.view === 'structure' && !scopeAlive(S.scope)) { S.view = fallback.view; S.scope = fallback.scope; }
  if (S.view === 'structure' && S.openStructures.indexOf(S.scope) < 0) S.openStructures.push(S.scope);
}

function reapplyState(keep, time) {
  if (!keep || !spec) return;
  const fallback = snapshotState();
  try {
    restoreKept(keep, fallback);
    render();
  } catch (err) {

    KEPT_STATE.forEach(function (k) { S[k] = fallback[k]; });
    S.past = []; S.future = [];
    render();
  }
  if (time) { saveStatus = M('status.reloaded', { time: time }); renderStatus(); }
}

window.addEventListener('message', function (e) {
  const m = e.data || {};
  if (m.type === 'load') {
    const keep = m.keepState ? snapshotState() : null;
    RO = false; roFormat = null; wsdlMeta = null;
    docKind = 'openapi'; xmlMeta = null; avroMeta = null; wsdlOrigText = null;
    xsdOrigText = null; xmlIncludeTexts = []; xmlRenames = [];
    avroOrig = null; avroOrigText = null; lastWrittenText = null;
    S.openStructures = [];
    if (m.xmlFormat || m.avro) { loadPreview(m); reapplyState(keep, m.time); return; }
    spec = m.spec; fileName = m.fileName || ''; hasDoc = !!m.hasDoc;
    saveStatus = 'All changes saved';
    S.propsOpen = true;
    if (spec) {
      S.view = 'contract';
      const ops = listOps();
      S.selOp = ops.length ? { path: ops[0].path, method: ops[0].method } : null;
      S.propTarget = { kind: 'interface' };
    } else {
      S.view = 'create';
    }
    render();
    reapplyState(keep, m.time);
  } else if (m.type === 'reloadFailed') {
    saveStatus = M('status.reloadFailed');
    renderStatus();
  } else if (m.type === 'applied') {
    if (m.ok) {
      saveStatus = M('status.applied', { time: m.time });
    } else {

      lastWrittenText = null;
      saveStatus = M('status.writeFailed', { error: '' });
    }
    renderStatus();
  } else if (m.type === 'createError') {
    toast(m.message);
  }
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && S.pickerFor) { S.pickerFor = null; render(); }
});
document.addEventListener('mousedown', function (e) {
  if (!S.pickerFor) return;
  let n = e.target;
  while (n) {
    if (n.id === 'typepicker') return;
    n = n.parentNode;
  }
  S.pickerFor = null;
  render();
});

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toast._h);
  toast._h = setTimeout(function () { t.style.display = 'none'; }, 4500);
}

const NATIVE_CONTROLS = ['input', 'select', 'textarea', 'button', 'option', 'a', 'label'];

function makeActivatable(n, tag, attrs, onClick) {
  if (NATIVE_CONTROLS.indexOf(tag) >= 0) return;
  if (attrs.tabindex !== undefined || attrs.role === 'presentation') return;
  n.tabIndex = 0;
  if (!n.getAttribute('role')) n.setAttribute('role', 'button');
  if (!n.getAttribute('aria-label')) {
    const label = attrs.title || attrs.text;
    if (label) n.setAttribute('aria-label', String(label));
  }
  n.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();
    e.stopPropagation();
    onClick.call(n, e);
  });
}

function el(tag, attrs) {
  const n = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function (k) {
    const v = attrs[k];
    if (k === 'cls') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = !!v;
    else if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null && v !== false) n.setAttribute(k, v);
  });
  if (attrs && typeof attrs.onClick === 'function') makeActivatable(n, tag, attrs, attrs.onClick);
  for (let i = 2; i < arguments.length; i++) {
    const c = arguments[i];
    if (c == null || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

function fld(def) {
  const box = el('div', { cls: 'fcol', style: def.span ? 'grid-column:' + def.span : '' });
  if (def.label) box.appendChild(el('label', { cls: 'lblx', text: def.label }));
  if (def.kind === 'text') {
    const inp = el('input', { cls: 'inp' + (def.mono ? ' mono' : ''), value: def.value == null ? '' : def.value, placeholder: def.placeholder || '', title: def.title || undefined, onChange: function (e) { def.onChange(e.target.value); } });
    if (RO || def.disabled) inp.disabled = true;
    if (def.focus) {
      S.focusNewParam = false;
      requestAnimationFrame(function () { inp.focus(); inp.select(); });
    }
    box.appendChild(inp);
  } else if (def.kind === 'textarea') {
    const t = el('textarea', { cls: 'txa', rows: def.rows || 5, onChange: function (e) { def.onChange(e.target.value); } });
    if (RO) t.disabled = true;
    t.value = def.value == null ? '' : def.value;
    box.appendChild(t);
  } else if (def.kind === 'select') {
    const s = el('select', { cls: 'sel', onChange: function (e) { def.onChange(e.target.value); } });
    if (RO) s.disabled = true;
    let found = false;
    (def.options || []).forEach(function (o) {
      const val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o;
      const opt = el('option', { value: val, text: lab === '' ? '—' : lab });
      if (val === def.value) { opt.selected = true; found = true; }
      s.appendChild(opt);
    });
    if (!found && def.value != null && def.value !== '') {
      const opt = el('option', { value: def.value, text: String(def.value) });
      opt.selected = true;
      s.appendChild(opt);
    }
    box.appendChild(s);
  } else if (def.kind === 'toggle') {
    const on = !!def.value;
    box.appendChild(el('div', { role: 'switch', 'aria-checked': on ? 'true' : 'false',
      'aria-label': def.label || def.toggleLabel || 'toggle',
      style: 'display:flex;align-items:center;gap:8px;cursor:pointer;padding-top:2px', onClick: function () { def.onChange(!on); } },
      el('div', { cls: 'toggle' + (on ? ' on' : '') }, el('div', { cls: 'knob' })),
      el('span', { style: 'font-size:12px;color:var(--fg-dim)', text: def.toggleLabel || (on ? 'true' : 'false') })));
  } else if (def.kind === 'multi') {
    box.appendChild(multiEditor(def));
  } else if (def.kind === 'tags') {
    box.appendChild(tagsEditor(def));
  } else if (def.kind === 'custom') {
    box.appendChild(def.build());
  } else if (def.kind === 'typepick') {
    return typePickerField(def);
  }
  return box;
}

function multiEditor(def) {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:5px' });
  const rowEl = el('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;align-items:center' });
  (def.selected || []).forEach(function (v) {
    rowEl.appendChild(el('div', { cls: 'mchip' }, v, el('span', { text: '×', onClick: function () { def.onToggle(v); } })));
  });
  const open = !!S.multiOpen[def.key] || (def.selected || []).length === 0;
  if (!open) {
    rowEl.appendChild(el('div', { cls: 'addsq', title: 'Add', text: '＋', onClick: function () { S.multiOpen[def.key] = true; render(); } }));
  }
  wrap.appendChild(rowEl);
  if (open) {
    const s = el('select', { cls: 'sel', style: 'color:var(--fg-dim)', onChange: function (e) {
      const v = e.target.value; e.target.value = '';
      S.multiOpen[def.key] = false;
      if (v) def.onToggle(v); else render();
    } });
    s.appendChild(el('option', { value: '', text: 'Add' }));
    (def.options || []).filter(function (v) { return (def.selected || []).indexOf(v) < 0; })
      .forEach(function (v) { s.appendChild(el('option', { value: v, text: v })); });
    wrap.appendChild(s);
  }
  return wrap;
}

function dangerDelete(label, onConfirm) {
  const b = el('button', { cls: 'btndanger', text: label });
  let armed = false, timer = null;
  b.addEventListener('click', function () {
    if (!armed) {
      armed = true;
      b.textContent = 'confirm delete';
      b.classList.add('armed');
      timer = setTimeout(function () { armed = false; b.textContent = label; b.classList.remove('armed'); }, 3000);
      return;
    }
    clearTimeout(timer);
    onConfirm();
  });
  return b;
}

function enumEditorFld(core, numeric) {
  return { label: 'enum (value + description)', kind: 'custom', build: function () {
    const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    const vals = core.enum || [];
    const descs = core['x-enum-descriptions'] || [];
    const saveDescs = function (arr) {
      while (arr.length > (core.enum || []).length) arr.pop();
      if (arr.some(function (x) { return x; })) core['x-enum-descriptions'] = arr;
      else delete core['x-enum-descriptions'];
    };
    vals.forEach(function (v, i) {
      wrap.appendChild(el('div', { cls: 'prow', style: 'gap:8px' },
        el('span', { cls: 'mono', cls: 'enumkey', text: String(v) }),
        el('input', { cls: 'inp', style: 'flex:1;min-width:0', placeholder: 'description', value: descs[i] || '', onChange: function (e) {
          const arr = (core['x-enum-descriptions'] || []).slice();
          while (arr.length < vals.length) arr.push('');
          arr[i] = e.target.value.trim();
          saveDescs(arr);
          markDirty();
        } }),
        RO ? null : el('span', { cls: 'delx', style: 'padding:5px 6px;flex:none', text: '×', onClick: function () {
          pushHistory();
          core.enum.splice(i, 1);
          const arr = (core['x-enum-descriptions'] || []).slice();
          arr.splice(i, 1);
          if (!core.enum.length) delete core.enum;
          saveDescs(arr);
          markDirty();
        } })));
    });
    if (!RO) wrap.appendChild(el('input', { id: 'enumadd', cls: 'inp mono', placeholder: '+ value, Enter', onKeydown: function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = e.target.value.trim();
      if (!v) return;
      const val = numeric && !isNaN(Number(v)) ? Number(v) : v;
      core.enum = core.enum || [];
      if (core.enum.indexOf(val) < 0) core.enum.push(val);
      markDirty();
    } }));
    return wrap;
  } };
}

function tagsEditor(def) {
  const box = el('div', { cls: 'chipfield' });
  (def.tags || []).forEach(function (t, i) {
    box.appendChild(el('div', { cls: 'tagchip' }, t, RO ? null : el('span', { text: '×', onClick: function () { def.onRemove(i); } })));
  });
  if (RO) return box;
  box.appendChild(el('input', {
    placeholder: def.placeholder || '+ tag, Enter',
    cls: 'chipinput',
    onKeydown: function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = e.target.value.trim();
      if (v) { def.onAdd(v); e.target.value = ''; }
    }
  }));
  return box;
}

function render() {
  renderSidebar();
  renderTabs();
  renderView();
  renderStatus();
  renderProps();
}
