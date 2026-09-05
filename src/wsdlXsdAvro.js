const { parseXml, localName, findAll } = require('./miniXml');

const REF_PREFIX = '#/components/schemas/';

function stripPrefix(v) { return v ? String(v).split(':').pop() : v; }

const XSD_PRIMS = {
  string: 'string', normalizedString: 'string', token: 'string', anyURI: 'string',
  QName: 'string', NOTATION: 'string', anySimpleType: 'string', anyType: 'string',
  language: 'string', Name: 'string', NCName: 'string', ID: 'string', IDREF: 'string',
  IDREFS: 'string', ENTITY: 'string', ENTITIES: 'string',
  NMTOKEN: 'string', NMTOKENS: 'string',
  int: 'integer', integer: 'integer', long: 'integer', short: 'integer', byte: 'integer',
  nonNegativeInteger: 'integer', nonPositiveInteger: 'integer',
  positiveInteger: 'integer', negativeInteger: 'integer',
  unsignedInt: 'integer', unsignedLong: 'integer', unsignedShort: 'integer', unsignedByte: 'integer',
  decimal: 'number', double: 'number', float: 'number',
  boolean: 'boolean',
  date: 'date', dateTime: 'date-time', time: 'string', duration: 'string',
  gYear: 'string', gYearMonth: 'string', gMonth: 'string', gMonthDay: 'string', gDay: 'string',
  base64Binary: 'string', hexBinary: 'string'
};

function xsdProp(typeAttr) {
  const t = stripPrefix(typeAttr);
  if (!t) return { type: 'object', properties: {} };
  if (XSD_PRIMS[t]) {
    const mapped = XSD_PRIMS[t];
    if (mapped === 'date') return { type: 'string', format: 'date' };
    if (mapped === 'date-time') return { type: 'string', format: 'date-time' };
    return { type: mapped };
  }
  return { $ref: REF_PREFIX + t };
}

function simpleSchemaOf(node) {
  const restr = findAll(node, 'restriction')[0];
  const schema = xsdProp(restr ? restr.attrs.base : 'string');
  if (schema.$ref) { delete schema.$ref; schema.type = 'string'; }
  const enums = restr ? findAll(restr, 'enumeration') : [];
  if (enums.length) {
    schema.enum = enums.map(function (e) { return e.attrs.value; });
    const ds = enums.map(function (e) {
      const docEl = findAll(e, 'documentation')[0];
      return docEl ? docEl.text.trim() : '';
    });
    if (ds.some(function (x) { return x; })) schema['x-enum-descriptions'] = ds;
  }
  const facet = function (name) { return restr && findAll(restr, name)[0]; };
  const pat = facet('pattern');
  if (pat) schema.pattern = pat.attrs.value;
  const minLen = facet('minLength');
  if (minLen) schema.minLength = Number(minLen.attrs.value);
  const maxLen = facet('maxLength');
  if (maxLen) schema.maxLength = Number(maxLen.attrs.value);
  const minInc = facet('minInclusive');
  if (minInc) schema.minimum = Number(minInc.attrs.value);
  const maxInc = facet('maxInclusive');
  if (maxInc) schema.maximum = Number(maxInc.attrs.value);
  const docEl = findAll(node, 'documentation')[0];
  if (docEl && docEl.text.trim()) schema.description = docEl.text.trim();
  return schema;
}

const GROUP_HOLDERS = ['sequence', 'all', 'complexContent', 'extension', 'restriction'];

function ownElements(ct) {
  const out = [];
  const walk = function (node) {
    (node.children || []).forEach(function (c) {
      const kind = localName(c.tag);
      if (kind === 'element') { out.push(c); return; }
      if (kind === 'choice' || GROUP_HOLDERS.indexOf(kind) >= 0) walk(c);
    });
  };
  walk(ct);
  return out;
}

function choiceGroupsOf(ct) {
  const groups = [];
  const walk = function (node, group) {
    (node.children || []).forEach(function (c) {
      const kind = localName(c.tag);
      if (kind === 'element') {
        const name = c.attrs.name || stripPrefix(c.attrs.ref);
        if (group && name) group.push(name);
        return;
      }
      if (kind === 'choice') {
        const g = [];
        groups.push(g);
        walk(c, g);
        return;
      }
      if (GROUP_HOLDERS.indexOf(kind) >= 0) walk(c, group);
    });
  };
  walk(ct, null);
  return groups.filter(function (g) { return g.length > 1; });
}

function xsdToSchemas(roots) {
  const out = {};
  const elementType = {};
  const complex = function (ct) {
    const schema = { type: 'object', properties: {} };
    const req = [];
    const ext = findAll(ct, 'extension')[0];
    if (ext && ext.attrs.base) {
      const base = stripPrefix(ext.attrs.base);
      if (!XSD_PRIMS[base]) schema.allOf = [{ $ref: REF_PREFIX + base }];
    }
    ownElements(ct).forEach(function (e) {
      const name = e.attrs.name || stripPrefix(e.attrs.ref);
      if (!name) return;
      let p = xsdProp(e.attrs.type || e.attrs.ref);
      const inline = findAll(e, 'complexType')[0];
      const inlineSimple = findAll(e, 'simpleType')[0];
      if (!e.attrs.type && inline) {
        const nested = name.charAt(0).toUpperCase() + name.slice(1);
        if (!out[nested]) out[nested] = complex(inline);
        p = { $ref: REF_PREFIX + nested };
      } else if (!e.attrs.type && inlineSimple) {
        p = simpleSchemaOf(inlineSimple);
      }
      const docEl = findAll(e, 'documentation')[0];
      if (docEl && docEl.text.trim()) p.description = docEl.text.trim();

      if (e.attrs.nillable === 'true') p.nullable = true;
      const max = e.attrs.maxOccurs;
      const min = e.attrs.minOccurs;
      if (max === 'unbounded' || (max && parseInt(max, 10) > 1)) {
        p = { type: 'array', items: p };
        if (min !== '0') p.minItems = 1;
      } else if (min !== '0') req.push(name);
      schema.properties[name] = p;
    });
    (ct.children || []).forEach(function (c) {
      if (localName(c.tag) !== 'attribute') return;
      const name = c.attrs.name;
      if (!name) return;
      const ap = xsdProp(c.attrs.type);
      ap['x-xsd-attribute'] = true;
      schema.properties[name] = ap;
      if (c.attrs.use === 'required') req.push(name);
    });
    const choiceGroups = choiceGroupsOf(ct);
    if (choiceGroups.length) schema['x-xsd-choice'] = choiceGroups;
    if (req.length) schema.required = req;
    return schema;
  };
  roots.forEach(function (root) {
    (root.children || []).forEach(function (node) {
      const name = node.attrs && node.attrs.name;
      if (!name) return;
      const kind = localName(node.tag);
      if (kind === 'complexType') out[name] = complex(node);
      else if (kind === 'simpleType') out[name] = simpleSchemaOf(node);
      else if (kind === 'element') {
        const inline = findAll(node, 'complexType')[0];
        if (inline) { out[name] = complex(inline); elementType[name] = name; }
        else if (node.attrs.type) elementType[name] = stripPrefix(node.attrs.type);
      }
    });
  });
  return { schemas: out, elementType: elementType };
}

function collectNamespaces(node, map) {
  Object.keys(node.attrs || {}).forEach(function (k) {
    if (k === 'xmlns') map[''] = node.attrs[k];
    else if (k.indexOf('xmlns:') === 0) map[k.slice(6)] = node.attrs[k];
  });
  (node.children || []).forEach(function (c) { collectNamespaces(c, map); });
  return map;
}

function tagPrefix(tag) {
  const i = tag.indexOf(':');
  return i < 0 ? '' : tag.slice(0, i);
}

function parseWsdlText(text) {
  const root = parseXml(text);
  const defs = (root.children || []).find(function (c) { return localName(c.tag) === 'definitions'; });

  if (!defs) throw new Error('wsdl-no-definitions');
  const ns = collectNamespaces(defs, {});
  const model = {
    kind: 'wsdl',
    name: defs.attrs.name || 'Service',
    namespace: defs.attrs.targetNamespace || '',
    documentation: '',
    protocol: '—',
    operations: [],
    schemas: {},
    elementType: {}
  };
  (defs.children || []).forEach(function (c) {
    if (localName(c.tag) === 'documentation') model.documentation = c.text.trim();
  });
  const messages = {};
  findAll(defs, 'message').forEach(function (msg) {
    const part = findAll(msg, 'part')[0];
    if (part) messages[msg.attrs.name] = stripPrefix(part.attrs.element || part.attrs.type);
  });
  findAll(defs, 'binding').forEach(function (b) {
    (b.children || []).forEach(function (c) {
      if (localName(c.tag) !== 'binding') return;
      const uri = ns[tagPrefix(c.tag)] || '';
      if (uri.indexOf('wsdl/soap12') >= 0) model.protocol = 'SOAP 1.2';
      else if (uri.indexOf('wsdl/soap') >= 0 && model.protocol === '—') model.protocol = 'SOAP 1.1';
    });
  });
  const schemaEls = findAll(defs, 'schema');
  const conv = xsdToSchemas(schemaEls);
  model.schemas = conv.schemas;
  model.elementType = conv.elementType;
  const resolveCls = function (n) { return n ? (conv.elementType[n] || n) : n; };
  findAll(defs, 'portType').forEach(function (pt) {
    findAll(pt, 'operation').forEach(function (op) {
      const entry = { name: op.attrs.name, documentation: '', portType: pt.attrs.name || '', input: null, output: null, faults: [] };
      (op.children || []).forEach(function (c) {
        const kind = localName(c.tag);
        if (kind === 'documentation') entry.documentation = c.text.trim();
        if (kind === 'input') entry.input = resolveCls(messages[stripPrefix(c.attrs.message)] || null);
        if (kind === 'output') entry.output = resolveCls(messages[stripPrefix(c.attrs.message)] || null);
        if (kind === 'fault') entry.faults.push({ name: c.attrs.name || '', className: resolveCls(messages[stripPrefix(c.attrs.message)] || null) });
      });
      model.operations.push(entry);
    });
  });
  return model;
}

function parseXsdText(text, fileName) {
  const root = parseXml(text);
  const schemaEl = (root.children || []).find(function (c) { return localName(c.tag) === 'schema'; });

  if (!schemaEl) throw new Error('xsd-no-schema');
  const conv = xsdToSchemas([schemaEl]);
  return {
    kind: 'xsd',
    name: fileName ? fileName.replace(/\.(xsd|xml)$/i, '') : 'XSD schema',
    namespace: schemaEl.attrs.targetNamespace || '',
    schemas: conv.schemas,
    elementType: conv.elementType
  };
}

function isAvroSpec(spec) {
  return !!(spec && typeof spec === 'object' && spec.type === 'record' && Array.isArray(spec.fields));
}

function avroToSchemas(root) {
  const out = {};
  function typeOf(t) {
    if (Array.isArray(t)) {
      const nn = t.filter(function (x) { return x !== 'null'; });
      return { prop: typeOf(nn[0] || 'string').prop, optional: t.indexOf('null') >= 0 };
    }
    if (typeof t === 'object' && t) {
      if (t.type === 'record') { walk(t); return { prop: { $ref: REF_PREFIX + t.name } }; }
      if (t.type === 'enum') { out[t.name] = { type: 'string', enum: t.symbols || [] }; return { prop: { $ref: REF_PREFIX + t.name } }; }
      if (t.type === 'array') { const inner = typeOf(t.items); return { prop: { type: 'array', items: inner.prop } }; }
      if (t.type === 'map') return { prop: { type: 'object', properties: {} } };
      if (t.type === 'fixed') { out[t.name] = { type: 'string' }; return { prop: { $ref: REF_PREFIX + t.name } }; }
      return typeOf(t.type);
    }
    const map = { int: 'integer', long: 'integer', float: 'number', double: 'number', bytes: 'string', string: 'string', boolean: 'boolean' };
    return { prop: map[t] ? { type: map[t] } : { type: 'string' } };
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

function avroToModel(spec) {
  return {
    kind: 'avro',
    name: spec.name || 'Record',
    namespace: spec.namespace || '',
    documentation: spec.doc || '',
    rootName: spec.name || 'Record',
    schemas: avroToSchemas(spec)
  };
}

function parseXmlContract(text, fileName) {
  const base = fileName || '';
  if (/\.wsdl$/i.test(base) || (/<\s*[\w:]*definitions[\s>]/.test(text) && text.indexOf('schemas.xmlsoap.org/wsdl') >= 0)) {
    return parseWsdlText(text);
  }
  if (/\.xsd$/i.test(base) || (/<\s*[\w:]*schema[\s>]/.test(text) && text.indexOf('XMLSchema') >= 0)) {
    return parseXsdText(text, base);
  }
  return null;
}

function wsdlOperationModel(model, operationName) {
  if (!model || model.kind !== 'wsdl' || !operationName) return null;
  const op = (model.operations || []).find(function (o) { return o.name === operationName; });
  if (!op) return null;
  const { reachableSchemas } = require('./operationSlice');
  const roots = [op.input, op.output]
    .concat(op.faults.map(function (f) { return f.className; }))
    .filter(Boolean)
    .map(function (n) { return { $ref: REF_PREFIX + n }; });
  const keep = reachableSchemas(model.schemas, roots);
  const schemas = {};
  Object.keys(model.schemas).forEach(function (name) {
    if (keep.has(name)) schemas[name] = model.schemas[name];
  });
  return Object.assign({}, model, { operations: [op], schemas: schemas });
}

module.exports = { parseXmlContract, isAvroSpec, avroToModel, wsdlOperationModel };
