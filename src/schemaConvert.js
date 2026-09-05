'use strict';

const { refName, isNullable } = require('./schemaShared');
const { parseXmlContract, isAvroSpec, avroToModel } = require('./wsdlXsdAvro');

const REF_PREFIX = '#/components/schemas/';

function firstLine(s) { return String(s || '').split('\n')[0].trim(); }

function normalizeRefs(node) {
  if (Array.isArray(node)) return node.map(normalizeRefs);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  Object.keys(node).forEach(function (k) {
    if (k === '$ref') {
      const n = refName(node[k]);
      out[k] = n ? REF_PREFIX + n : node[k];
    } else out[k] = normalizeRefs(node[k]);
  });
  return out;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function bodySchemaName(media) {
  const schema = media && media.schema;
  if (!schema) return null;
  if (schema.$ref) return refName(schema.$ref);
  if (schema.type === 'array' && schema.items && schema.items.$ref) return refName(schema.items.$ref);
  return null;
}

function requestName(op) {
  if (op.requestBody && op.requestBody.content) {
    for (const media of Object.values(op.requestBody.content)) {
      const n = bodySchemaName(media);
      if (n) return n;
    }
  }
  for (const p of op.parameters || []) {
    if (p && p.in === 'body') return bodySchemaName(p);
  }
  return null;
}

function responseNames(op) {
  const out = { output: null, faults: [] };
  for (const [code, response] of Object.entries(op.responses || {})) {
    if (!response) continue;
    let name = null;
    if (response.content) {
      for (const media of Object.values(response.content)) {
        name = bodySchemaName(media);
        if (name) break;
      }
    } else name = bodySchemaName(response);
    if (!name) continue;
    if (code[0] === '2' && !out.output) out.output = name;
    else if (code[0] === '4' || code[0] === '5') out.faults.push({ name: code, className: name });
  }
  return out;
}

function specOperations(spec) {
  const list = [];
  for (const [route, item] of Object.entries((spec && spec.paths) || {})) {
    if (!item || typeof item !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      const responses = responseNames(op);
      list.push({
        name: avroName(op.operationId || (method + ' ' + route)),
        documentation: op.summary || op.description || '',
        input: requestName(op),
        output: responses.output,
        faults: responses.faults
      });
    }
  }
  return list;
}

function specModel(spec, fileName) {
  const host = spec.definitions || (spec.components && spec.components.schemas) || {};
  return {
    kind: spec.swagger === '2.0' ? 'swagger' : 'openapi',
    name: (spec.info && spec.info.title) ||
      (fileName ? fileName.replace(/\.(json|yaml|yml)$/i, '') : '') || 'API',
    namespace: '',
    documentation: (spec.info && spec.info.description) || '',
    operations: specOperations(spec),
    schemas: normalizeRefs(host)
  };
}

function readContract(text, fileName) {
  const xml = parseXmlContract(text, fileName || '');
  if (xml) return xml;
  let spec = null;
  try {
    spec = JSON.parse(text);
  } catch (e) {
    try { spec = require('js-yaml').load(text); } catch (e2) { spec = null; }
  }
  if (isAvroSpec(spec)) return avroToModel(spec);
  if (spec && typeof spec === 'object' && (spec.swagger === '2.0' || typeof spec.openapi === 'string')) {
    return specModel(spec, fileName);
  }
  return null;
}

function targetsFor(kind) {
  if (kind === 'wsdl') return ['openapi', 'xsd', 'avro'];
  if (kind === 'xsd') return ['openapi', 'wsdl', 'avro'];
  if (kind === 'avro') return ['openapi', 'wsdl', 'xsd'];
  return ['wsdl', 'xsd', 'avro'];
}

function isObjectSchema(s) {
  return !!(s && typeof s === 'object' && !s.enum &&
    (s.properties || s.type === 'object' || Array.isArray(s.allOf)));
}

function eachRef(node, fn) {
  if (Array.isArray(node)) { node.forEach(function (x) { eachRef(x, fn); }); return; }
  if (!node || typeof node !== 'object') return;
  Object.keys(node).forEach(function (k) {
    if (k === '$ref') {
      const n = refName(node[k]);
      if (n) fn(n);
    } else eachRef(node[k], fn);
  });
}

function rootCandidates(model) {
  const host = model.schemas || {};
  if (model.rootName && host[model.rootName]) return [model.rootName];
  const referenced = {};
  Object.keys(host).forEach(function (n) {
    eachRef(host[n], function (r) { if (r !== n) referenced[r] = true; });
  });
  const objects = Object.keys(host).filter(function (n) { return isObjectSchema(host[n]); });
  const top = objects.filter(function (n) { return !referenced[n]; });
  return top.length ? top : objects;
}

function flattenAllOf(host, s, seen) {
  const props = {};
  const required = [];
  const mark = seen || {};
  (Array.isArray(s.allOf) ? s.allOf : []).forEach(function (part) {
    let target = part;
    const n = part && part.$ref ? refName(part.$ref) : null;
    if (n) {
      if (mark[n]) return;
      mark[n] = true;
      target = host[n];
    }
    if (!target || typeof target !== 'object') return;
    const m = flattenAllOf(host, target, mark);
    Object.keys(m.props).forEach(function (k) { props[k] = m.props[k]; });
    m.required.forEach(function (r) { if (required.indexOf(r) < 0) required.push(r); });
  });
  Object.keys(s.properties || {}).forEach(function (k) { props[k] = s.properties[k]; });
  (s.required || []).forEach(function (r) { if (required.indexOf(r) < 0) required.push(r); });
  return { props: props, required: required };
}

function pathSegment(name) {
  return String(name || 'resource')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'resource';
}

function choiceToOneOf(schemas) {
  const out = {};
  Object.keys(schemas || {}).forEach(function (name) {
    const s = schemas[name];
    const groups = s && Array.isArray(s['x-xsd-choice']) ? s['x-xsd-choice'] : null;
    if (!groups || !groups.length) { out[name] = s; return; }
    const copy = Object.assign({}, s);
    const members = [];
    groups.forEach(function (g) { (g || []).forEach(function (n) { members.push(n); }); });
    if (Array.isArray(copy.required)) {
      copy.required = copy.required.filter(function (r) { return members.indexOf(r) < 0; });
      if (!copy.required.length) delete copy.required;
    }
    const variants = [];
    groups.forEach(function (g) {
      (g || []).forEach(function (n) { variants.push({ required: [n] }); });
    });
    if (variants.length > 1) copy.oneOf = (copy.oneOf || []).concat(variants);
    out[name] = copy;
  });
  return out;
}

function toOpenApi(model, rootName) {
  const doc = {
    openapi: '3.0.3',
    info: { title: model.name || 'API', version: '1.0.0' }
  };
  if (model.documentation) doc.info.description = model.documentation;
  doc.paths = {};

  if (model.kind !== 'wsdl' && rootName && (model.schemas || {})[rootName]) {
    doc.paths['/' + pathSegment(rootName)] = {
      get: {
        operationId: 'get' + capitalize(avroName(rootName)),
        summary: 'Read ' + rootName,
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: REF_PREFIX + rootName } } }
          }
        }
      }
    };
  }

  (model.kind === 'wsdl' ? model.operations || [] : []).forEach(function (op) {
    const post = { operationId: op.name };
    if (op.documentation) post.summary = firstLine(op.documentation);
    if (op.input) {
      post.requestBody = {
        required: true,
        content: { 'application/json': { schema: { $ref: REF_PREFIX + op.input } } }
      };
    }
    post.responses = {
      '200': op.output
        ? { description: 'OK', content: { 'application/json': { schema: { $ref: REF_PREFIX + op.output } } } }
        : { description: 'OK' }
    };
    const faults = (op.faults || []).filter(function (f) { return f.className; });
    if (faults.length) {
      post.responses['500'] = {
        description: faults.map(function (f) { return f.name || f.className; }).join(', '),
        content: {
          'application/json': {
            schema: faults.length === 1
              ? { $ref: REF_PREFIX + faults[0].className }
              : { oneOf: faults.map(function (f) { return { $ref: REF_PREFIX + f.className }; }) }
          }
        }
      };
    }
    doc.paths['/' + op.name] = { post: post };
  });
  doc.components = { schemas: choiceToOneOf(model.schemas || {}) };
  return doc;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scalarXsd(p) {
  if (p.format === 'date') return 'xs:date';
  if (p.format === 'date-time') return 'xs:dateTime';
  if (p.format === 'byte' || p.format === 'binary') return 'xs:base64Binary';
  if (p.type === 'integer') return p.format === 'int32' ? 'xs:int' : 'xs:long';
  if (p.type === 'number') {
    return p.format === 'float' ? 'xs:float' : p.format === 'double' ? 'xs:double' : 'xs:decimal';
  }
  if (p.type === 'boolean') return 'xs:boolean';
  return 'xs:string';
}

function hasFacets(p) {
  return !!(p.enum || p.pattern || p.minLength !== undefined || p.maxLength !== undefined ||
    p.minimum !== undefined || p.maximum !== undefined);
}

function xsdPattern(p) {
  let v = String(p);
  if (v.charAt(0) === '^') v = v.slice(1);
  if (v.charAt(v.length - 1) === '$' && v.charAt(v.length - 2) !== '\\') v = v.slice(0, -1);
  return v;
}

function annotation(text, pad) {
  return pad + '<xs:annotation><xs:documentation>' + escapeXml(text) + '</xs:documentation></xs:annotation>';
}

function restrictionLines(p, pad) {
  const out = [pad + '<xs:restriction base="' + scalarXsd(p) + '">'];
  const descs = p['x-enum-descriptions'] || [];
  (p.enum || []).forEach(function (v, i) {
    if (descs[i]) {
      out.push(pad + '  <xs:enumeration value="' + escapeXml(v) + '">');
      out.push(annotation(descs[i], pad + '    '));
      out.push(pad + '  </xs:enumeration>');
    } else out.push(pad + '  <xs:enumeration value="' + escapeXml(v) + '"/>');
  });
  if (p.pattern) out.push(pad + '  <xs:pattern value="' + escapeXml(xsdPattern(p.pattern)) + '"/>');
  if (p.minLength !== undefined) out.push(pad + '  <xs:minLength value="' + p.minLength + '"/>');
  if (p.maxLength !== undefined) out.push(pad + '  <xs:maxLength value="' + p.maxLength + '"/>');
  if (p.minimum !== undefined) out.push(pad + '  <xs:minInclusive value="' + p.minimum + '"/>');
  if (p.maximum !== undefined) out.push(pad + '  <xs:maxInclusive value="' + p.maximum + '"/>');
  out.push(pad + '</xs:restriction>');
  return out;
}

function toXsd(model, rootName) {
  const host = model.schemas || {};
  const prefix = model.namespace ? 'tns:' : '';
  const q = function (n) { return prefix + n; };

  function typeAttrOf(p) {
    if (p.$ref) {
      const n = refName(p.$ref);
      return n ? q(n) : 'xs:string';
    }
    if (p.properties || p.type === 'object' || p.type === 'array' || hasFacets(p)) return null;
    return scalarXsd(p);
  }

  function elementLines(name, p, required, pad) {
    const out = [];
    let occurs = '';
    let inner = p || {};
    if (inner.type === 'array') {
      const min = inner.minItems !== undefined ? inner.minItems : (required ? 1 : 0);
      occurs = (min < 1 ? ' minOccurs="0"' : '') + ' maxOccurs="unbounded"';
      inner = inner.items || {};
    } else if (!required) occurs = ' minOccurs="0"';
    const nillable = isNullable(p) || isNullable(inner) ? ' nillable="true"' : '';
    const doc = p.description || inner.description;
    const attr = typeAttrOf(inner);
    const head = pad + '<xs:element name="' + escapeXml(name) + '"';
    if (attr && !doc) {
      out.push(head + ' type="' + attr + '"' + occurs + nillable + '/>');
      return out;
    }
    out.push(head + (attr ? ' type="' + attr + '"' : '') + occurs + nillable + '>');
    if (doc) out.push(annotation(doc, pad + '  '));
    if (!attr) {
      if (hasFacets(inner)) {
        out.push(pad + '  <xs:simpleType>');
        restrictionLines(inner, pad + '    ').forEach(function (l) { out.push(l); });
        out.push(pad + '  </xs:simpleType>');
      } else if (inner.type === 'array') {

        out.push(pad + '  <xs:complexType>');
        out.push(pad + '    <xs:sequence>');
        elementLines('item', inner, true, pad + '      ').forEach(function (l) { out.push(l); });
        out.push(pad + '    </xs:sequence>');
        out.push(pad + '  </xs:complexType>');
      } else {
        out.push(pad + '  <xs:complexType>');
        contentLines(inner, pad + '    ').forEach(function (l) { out.push(l); });
        out.push(pad + '  </xs:complexType>');
      }
    }
    out.push(pad + '</xs:element>');
    return out;
  }

  function sequenceLines(own, req, groups, pad) {
    const inChoice = {};
    groups.forEach(function (g) { (g || []).forEach(function (n) { inChoice[n] = true; }); });
    const out = [pad + '<xs:sequence>'];
    Object.keys(own).forEach(function (n) {
      if (inChoice[n]) return;
      elementLines(n, own[n] || {}, req.indexOf(n) >= 0, pad + '  ').forEach(function (l) { out.push(l); });
    });
    groups.forEach(function (g) {
      const members = (g || []).filter(function (n) { return own[n]; });
      if (!members.length) return;
      out.push(pad + '  <xs:choice>');
      members.forEach(function (n) {
        elementLines(n, own[n] || {}, req.indexOf(n) >= 0, pad + '    ').forEach(function (l) { out.push(l); });
      });
      out.push(pad + '  </xs:choice>');
    });
    out.push(pad + '</xs:sequence>');
    return out;
  }

  function contentLines(s, pad) {

    const own = {};
    const req = [];
    let base = null;
    (Array.isArray(s.allOf) ? s.allOf : []).forEach(function (part) {
      if (part && part.$ref) {
        if (!base) base = refName(part.$ref);
        return;
      }
      if (!part || typeof part !== 'object') return;
      Object.keys(part.properties || {}).forEach(function (k) { own[k] = part.properties[k]; });
      (part.required || []).forEach(function (r) { if (req.indexOf(r) < 0) req.push(r); });
    });
    Object.keys(s.properties || {}).forEach(function (k) { own[k] = s.properties[k]; });
    (s.required || []).forEach(function (r) { if (req.indexOf(r) < 0) req.push(r); });
    const groups = Array.isArray(s['x-xsd-choice']) ? s['x-xsd-choice'] : [];
    if (!base) return sequenceLines(own, req, groups, pad);
    return [pad + '<xs:complexContent>', pad + '  <xs:extension base="' + q(base) + '">']
      .concat(sequenceLines(own, req, groups, pad + '    '))
      .concat([pad + '  </xs:extension>', pad + '</xs:complexContent>']);
  }

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const attrs = ['xmlns:xs="http://www.w3.org/2001/XMLSchema"'];
  if (model.namespace) {
    attrs.push('targetNamespace="' + escapeXml(model.namespace) + '"');
    attrs.push('xmlns:tns="' + escapeXml(model.namespace) + '"');
  }
  if (model.namespace) attrs.push('elementFormDefault="qualified"');
  lines.push('<xs:schema ' + attrs.join(' ') + '>');

  const wanted = Array.isArray(rootName) ? rootName.filter(function (n) { return host[n]; }) : null;
  const declared = wanted && wanted.length
    ? wanted.reduce(function (m, n) { m[n] = n; return m; }, {})
    : (rootName && !Array.isArray(rootName) && host[rootName] ? { [rootName]: rootName }
      : (model.elementType && Object.keys(model.elementType).length ? model.elementType : null));
  const elements = declared || rootCandidates(model).reduce(function (m, n) {
    m[n] = n;
    return m;
  }, {});
  Object.keys(elements).forEach(function (el) {
    lines.push('  <xs:element name="' + escapeXml(el) + '" type="' + q(elements[el]) + '"/>');
  });
  Object.keys(host).forEach(function (name) {
    const s = host[name] || {};
    if (isObjectSchema(s)) {
      lines.push('  <xs:complexType name="' + escapeXml(name) + '">');
      if (s.description) lines.push(annotation(s.description, '    '));
      contentLines(s, '    ').forEach(function (l) { lines.push(l); });
      lines.push('  </xs:complexType>');
    } else if (s.type === 'array') {

      lines.push('  <xs:complexType name="' + escapeXml(name) + '">');
      lines.push('    <xs:sequence>');
      elementLines('item', s, true, '      ').forEach(function (l) { lines.push(l); });
      lines.push('    </xs:sequence>');
      lines.push('  </xs:complexType>');
    } else {
      lines.push('  <xs:simpleType name="' + escapeXml(name) + '">');
      if (s.description) lines.push(annotation(s.description, '    '));
      restrictionLines(s, '    ').forEach(function (l) { lines.push(l); });
      lines.push('  </xs:simpleType>');
    }
  });
  lines.push('</xs:schema>');
  return lines.join('\n') + '\n';
}

function wsdlNamespace(model) {
  if (model.namespace) return model.namespace;
  return 'http://example.org/' + pathSegment(model.name || 'service');
}

function xsdInsideTypes(model, elementNames) {
  const schema = toXsd(Object.assign({}, model, { namespace: wsdlNamespace(model) }), elementNames);
  return schema
    .replace(/^\s*<\?xml[^>]*\?>\s*/, '')
    .replace(/\n$/, '')
    .split('\n')
    .map(function (line) { return line ? '    ' + line : line; })
    .join('\n');
}

function xmlName(text) {
  const cleaned = String(text || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ')
    .map(function (word) { return word ? word.charAt(0).toUpperCase() + word.slice(1) : ''; })
    .join('');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : 'Service';
}

function toWsdl(model, rootName) {
  const host = Object.assign({}, model.schemas || {});
  const ns = wsdlNamespace(model);
  const service = xmlName(model.name || 'Service');

  let operations = (model.operations || []).filter(function (op) {
    return op && (op.input || op.output);
  }).map(function (op) {
    return {
      name: xmlName(op.name),
      documentation: op.documentation || '',
      input: op.input && host[op.input] ? op.input : null,
      output: op.output && host[op.output] ? op.output : null,
      faults: (op.faults || []).filter(function (f) { return f.className && host[f.className]; })
    };
  });

  if (!operations.length) {
    const root = (rootName && host[rootName]) ? rootName : rootCandidates(model)[0];
    if (!root) throw new Error('nothing-to-convert');
    operations = [{
      name: 'Get' + xmlName(root),
      documentation: 'Read ' + root,
      input: null,
      output: root,
      faults: []
    }];
  }

  const wrapper = function (base) {
    let name = base;
    let i = 2;
    while (host[name]) { name = base + i; i += 1; }
    host[name] = { type: 'object', properties: {} };
    return name;
  };
  operations.forEach(function (op) {
    if (!op.input) op.input = wrapper(op.name + 'Request');
    if (!op.output) op.output = wrapper(op.name + 'Response');
  });

  const elements = [];
  const add = function (n) { if (n && elements.indexOf(n) < 0) elements.push(n); };
  operations.forEach(function (op) {
    add(op.input);
    add(op.output);
    op.faults.forEach(function (f) { add(f.className); });
  });

  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>');
  L.push('<wsdl:definitions name="' + escapeXml(service) + '"');
  L.push('    targetNamespace="' + escapeXml(ns) + '"');
  L.push('    xmlns:tns="' + escapeXml(ns) + '"');
  L.push('    xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"');
  L.push('    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"');
  L.push('    xmlns:xs="http://www.w3.org/2001/XMLSchema">');
  if (model.documentation) {
    L.push('  <wsdl:documentation>' + escapeXml(firstLine(model.documentation)) + '</wsdl:documentation>');
  }
  L.push('  <wsdl:types>');
  L.push(xsdInsideTypes(Object.assign({}, model, { schemas: host }), elements));
  L.push('  </wsdl:types>');

  const messages = [];
  operations.forEach(function (op) {
    const part = function (suffix, element) {
      const name = op.name + suffix;
      messages.push({ name: name, element: element });
      return name;
    };
    op.inputMessage = part('Request', op.input);
    op.outputMessage = part('Response', op.output);
    op.faultMessages = op.faults.map(function (f, i) {
      const name = op.name + 'Fault' + (op.faults.length > 1 ? (i + 1) : '');
      messages.push({ name: name, element: f.className });
      return { name: name, fault: 'fault' + (op.faults.length > 1 ? (i + 1) : '') };
    });
  });

  messages.forEach(function (m) {
    L.push('  <wsdl:message name="' + escapeXml(m.name) + '">');
    if (m.element) L.push('    <wsdl:part name="parameters" element="tns:' + escapeXml(m.element) + '"/>');
    L.push('  </wsdl:message>');
  });

  L.push('  <wsdl:portType name="' + escapeXml(service) + 'PortType">');
  operations.forEach(function (op) {
    L.push('    <wsdl:operation name="' + escapeXml(op.name) + '">');
    if (op.documentation) {
      L.push('      <wsdl:documentation>' + escapeXml(firstLine(op.documentation)) + '</wsdl:documentation>');
    }
    L.push('      <wsdl:input message="tns:' + escapeXml(op.inputMessage) + '"/>');
    L.push('      <wsdl:output message="tns:' + escapeXml(op.outputMessage) + '"/>');
    op.faultMessages.forEach(function (f) {
      L.push('      <wsdl:fault name="' + escapeXml(f.fault) + '" message="tns:' + escapeXml(f.name) + '"/>');
    });
    L.push('    </wsdl:operation>');
  });
  L.push('  </wsdl:portType>');

  L.push('  <wsdl:binding name="' + escapeXml(service) + 'Binding" type="tns:' + escapeXml(service) + 'PortType">');
  L.push('    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>');
  operations.forEach(function (op) {
    L.push('    <wsdl:operation name="' + escapeXml(op.name) + '">');
    L.push('      <soap:operation soapAction="' + escapeXml(ns.replace(/\/$/, '') + '/' + op.name) + '"/>');
    L.push('      <wsdl:input><soap:body use="literal"/></wsdl:input>');
    L.push('      <wsdl:output><soap:body use="literal"/></wsdl:output>');
    op.faultMessages.forEach(function (f) {
      L.push('      <wsdl:fault name="' + escapeXml(f.fault) + '"><soap:fault name="' +
        escapeXml(f.fault) + '" use="literal"/></wsdl:fault>');
    });
    L.push('    </wsdl:operation>');
  });
  L.push('  </wsdl:binding>');

  L.push('  <wsdl:service name="' + escapeXml(service) + '">');
  L.push('    <wsdl:port name="' + escapeXml(service) + 'Port" binding="tns:' + escapeXml(service) + 'Binding">');
  L.push('      <soap:address location="' + escapeXml(ns.replace(/\/$/, '') + '/' + service) + '"/>');
  L.push('    </wsdl:port>');
  L.push('  </wsdl:service>');
  L.push('</wsdl:definitions>');
  return L.join('\n') + '\n';
}

const AVRO_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function avroName(n) {
  const s = String(n || '').replace(/[^A-Za-z0-9_]/g, '_');
  return (/^[0-9]/.test(s) ? '_' + s : s) || '_';
}

function capitalize(n) { return n.charAt(0).toUpperCase() + n.slice(1); }

function avroNamespace(ns) {
  if (!ns) return '';
  if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(ns)) return ns;
  const m = String(ns).match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^?#]*)/i);
  if (!m) return '';
  const host = m[1].split(':')[0].split('.').filter(Boolean).reverse();
  const path = m[2].split('/').filter(Boolean);
  return host.concat(path).map(avroName).join('.');
}

function toAvro(model, rootName) {
  const host = model.schemas || {};
  const used = {};
  const bySchema = {};

  function uniqueName(base) {
    let n = avroName(base);
    let i = 2;
    while (used[n]) n = avroName(base) + i++;
    used[n] = true;
    return n;
  }

  function scalar(p) {
    if (p.format === 'date') return { type: 'int', logicalType: 'date' };
    if (p.format === 'date-time') return { type: 'long', logicalType: 'timestamp-millis' };
    if (p.format === 'uuid') return { type: 'string', logicalType: 'uuid' };
    if (p.format === 'byte' || p.format === 'binary') return 'bytes';

    if (p.type === 'integer') return p.format === 'int32' ? 'int' : 'long';
    if (p.type === 'number') return p.format === 'float' ? 'float' : 'double';
    if (p.type === 'boolean') return 'boolean';
    return 'string';
  }

  function enumType(p, base) {
    const symbols = (p.enum || []).map(String);
    if (!symbols.length || !symbols.every(function (s) { return AVRO_NAME.test(s); })) {
      return scalar(p);
    }
    const e = { type: 'enum', name: uniqueName(base), symbols: symbols };
    if (p.description) e.doc = p.description;
    return e;
  }

  function withNull(t) {
    if (Array.isArray(t)) return t.indexOf('null') >= 0 ? t : ['null'].concat(t);
    return ['null', t];
  }

  function recordFields(s) {
    const m = flattenAllOf(host, s);
    return Object.keys(m.props).map(function (fn) {
      const p = m.props[fn] || {};
      const t = typeOf(p, fn);

      const listed = m.required.indexOf(fn) >= 0 || (p.type === 'array' && p.minItems >= 1);
      const optional = !listed || isNullable(p);
      const f = { name: avroName(fn), type: optional ? withNull(t) : t };
      if (optional) f.default = null;
      if (p.description) f.doc = p.description;
      return f;
    });
  }

  function typeOf(p, fieldName) {
    if (!p || typeof p !== 'object') return 'string';
    if (p.$ref) {
      const n = refName(p.$ref);
      return n ? namedType(n) : 'string';
    }
    if (p.type === 'array') return { type: 'array', items: typeOf(p.items || {}, fieldName) };
    const variants = Array.isArray(p.oneOf) ? p.oneOf : (Array.isArray(p.anyOf) ? p.anyOf : null);
    if (variants && variants.length) {
      const branches = [];
      variants.forEach(function (v, i) {
        if (!v || typeof v !== 'object') return;
        const t = typeOf(v, capitalize(avroName(fieldName)) + (i + 1));
        if (t !== undefined && branches.indexOf(t) < 0) branches.push(t);
      });
      if (branches.length > 1) return branches;
      if (branches.length === 1) return branches[0];
    }
    if (p.enum) return enumType(p, capitalize(avroName(fieldName)));
    if (p.properties && Object.keys(p.properties).length) {

      const rec = { type: 'record', name: uniqueName(capitalize(avroName(fieldName))), fields: [] };
      if (p.description) rec.doc = p.description;
      rec.fields = recordFields(p);
      return rec;
    }
    if (p.type === 'object' || p.additionalProperties) {
      const v = p.additionalProperties;
      return { type: 'map', values: v && typeof v === 'object' ? typeOf(v, fieldName) : 'string' };
    }
    return scalar(p);
  }

  function namedType(name) {
    if (bySchema[name] !== undefined) return bySchema[name];
    const s = host[name];
    if (!s || typeof s !== 'object') return 'string';
    if (s.enum) {
      const e = enumType(s, name);
      if (typeof e === 'object' && e.type === 'enum') bySchema[name] = e.name;
      return e;
    }
    if (!isObjectSchema(s)) {
      if (s.type === 'array') return { type: 'array', items: typeOf(s.items || {}, name) };
      return scalar(s);
    }
    const rec = { type: 'record', name: uniqueName(name), fields: [] };

    bySchema[name] = rec.name;
    if (s.description) rec.doc = s.description;
    rec.fields = recordFields(s);
    return rec;
  }

  const s = host[rootName];
  if (!s || !isObjectSchema(s)) throw new Error('avro-root-not-object');
  const root = namedType(rootName);
  const ns = avroNamespace(model.namespace);
  if (ns) root.namespace = ns;
  if (!root.doc && model.documentation) root.doc = model.documentation;
  return root;
}

module.exports = { readContract, targetsFor, rootCandidates, toOpenApi, toXsd, toWsdl, toAvro, choiceToOneOf, avroNamespace };
