const { schemaHost, refName, firstResponseSchema, constraintText } = require('./schemaShared');

const FRONTMATTER_KEYS = ['type', 'generator', 'generated', 'source', 'sourceId', 'operation',
  'name', 'entries', 'status', 'managed'];

function frontmatterValue(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  return /^[A-Za-z0-9._\/@-]+$/.test(s) ? s : JSON.stringify(s);
}

function frontmatter(meta) {
  if (!meta || typeof meta !== 'object') return [];
  const lines = ['---'];
  for (const key of FRONTMATTER_KEYS) {
    if (meta[key] === undefined || meta[key] === null || meta[key] === '') continue;
    lines.push(key + ': ' + frontmatterValue(meta[key]));
  }
  lines.push('---');
  lines.push('');
  return lines.length > 3 ? lines : [];
}

function typeLabel(s) {
  if (!s || typeof s !== 'object') return '?';
  if (s.$ref) {
    const n = refName(s.$ref) || s.$ref;
    return '[' + n + '](#' + String(n).toLowerCase() + ')';
  }
  if (s.type === 'array') return typeLabel(s.items) + '[]';
  const raw = s['x-avro-raw'];
  if (raw) {
    const logical = raw.logicalType;
    if (logical === 'decimal' && raw.precision !== undefined) {
      return 'decimal(' + raw.precision + ',' + (raw.scale || 0) + ')';
    }
    if (logical) return logical;
    if (raw.type) return raw.type;
  }
  if (s['x-xsd']) return s['x-xsd'];
  if (s['x-avro']) return s['x-avro'];
  const t = Array.isArray(s.type) ? s.type.filter((x) => x !== 'null').join('|') || 'any' : (s.type || 'object');
  return s.format ? t + ' (' + s.format + ')' : t;
}

function cell(v) {
  if (v === undefined || v === null || v === '') return '';
  return String(v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
}

function mdConstraints(p) {
  return constraintText(p, { md: true });
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function requestSchema(op) {
  const bodyParam = (op.parameters || []).find((p) => p && p.in === 'body');
  if (bodyParam) return bodyParam.schema;
  if (op.requestBody && op.requestBody.content) {
    const media = Object.keys(op.requestBody.content)[0];
    return media ? op.requestBody.content[media].schema : null;
  }
  return null;
}

function collectEndpoints(spec) {
  const endpoints = [];
  for (const [route, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of HTTP_METHODS) {
      const op = pathItem && pathItem[method];
      if (!op) continue;
      const params = (op.parameters || []).concat(pathItem.parameters || [])
        .filter((p) => p && p.in !== 'body')
        .map((p) => {

          const src = p.schema || p;
          const example = p.example !== undefined ? p.example
            : p['x-example'] !== undefined ? p['x-example']
            : src.example !== undefined ? src.example : src['x-example'];
          const parts = [];
          if (p.schema && p.deprecated === true) parts.push('deprecated');
          const base = constraintText(src);
          if (base) parts.push(base);
          if (example !== undefined) parts.push('example: ' + JSON.stringify(example));
          return {
            name: p.name,
            in: p.in,
            required: !!p.required,
            type: typeLabel(p.schema || p),
            constraints: parts.join('; '),
            description: p.description || ''
          };
        });
      const req = requestSchema(op);
      const res = firstResponseSchema(op);
      endpoints.push({
        tag: (op.tags && op.tags[0]) || 'API',
        method: method.toUpperCase(),
        path: route,
        operationId: op.operationId || '',
        summary: op.summary || op.description || '',
        deprecated: !!op.deprecated,
        params,
        request: req ? typeLabel(req) : '',
        response: res ? typeLabel(res) : '',
        responses: Object.entries(op.responses || {}).map(([code, r]) => ({
          code, description: (r && r.description) || ''
        }))
      });
    }
  }
  return endpoints;
}

function specToMarkdown(spec, meta) {
  if (!spec || typeof spec !== 'object') throw new Error('unsupported-input');
  const info = spec.info || {};
  const lines = [];
  const version = spec.swagger === '2.0' ? 'Swagger 2.0' : 'OpenAPI ' + spec.openapi;

  lines.push(...frontmatter(meta));
  lines.push('# ' + (info.title || 'API contract'));
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push('| Contract version | ' + cell(info.version || '-') + ' |');
  lines.push('| Format | ' + version + ' |');
  if (spec.host) lines.push('| Host | ' + cell(spec.host + (spec.basePath || '')) + ' |');
  (spec.servers || []).forEach((s, i) => {
    lines.push('| Server ' + (i + 1) + ' | ' + cell(s.url + (s.description ? ' — ' + s.description : '')) + ' |');
  });
  lines.push('');
  if (info.description) {
    lines.push(info.description.trim());
    lines.push('');
  }

  const endpoints = collectEndpoints(spec);
  if (endpoints.length) {
    lines.push('## Endpoints');
    lines.push('');
    const byTag = {};
    endpoints.forEach((e) => { (byTag[e.tag] = byTag[e.tag] || []).push(e); });
    for (const tag of Object.keys(byTag)) {
      lines.push('### ' + tag);
      lines.push('');
      for (const e of byTag[tag]) {
        lines.push('#### `' + e.method + ' ' + e.path + '`' + (e.deprecated ? ' _(deprecated)_' : ''));
        lines.push('');
        if (e.summary) { lines.push(e.summary.trim()); lines.push(''); }
        if (e.operationId) { lines.push('- operationId: `' + e.operationId + '`'); }
        if (e.request) lines.push('- request: ' + e.request);
        if (e.response) lines.push('- response: ' + e.response);
        lines.push('');
        if (e.params.length) {
          lines.push('| Parameter | In | Type | Required | Constraints | Description |');
          lines.push('|---|---|---|---|---|---|');
          e.params.forEach((p) => {
            lines.push('| ' + cell(p.name) + ' | ' + cell(p.in) + ' | ' + p.type + ' | ' +
              (p.required ? 'yes' : 'no') + ' | ' + cell(p.constraints) + ' | ' + cell(p.description) + ' |');
          });
          lines.push('');
        }
        if (e.responses.length) {
          lines.push('| Code | Description |');
          lines.push('|---|---|');
          e.responses.forEach((r) => lines.push('| ' + cell(r.code) + ' | ' + cell(r.description) + ' |'));
          lines.push('');
        }
      }
    }
  }

  lines.push(...schemasMarkdown(schemaHost(spec)));

  return finish(lines);
}

function finish(lines) {
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

function classLink(name) {
  return '[' + name + '](#' + String(name).toLowerCase() + ')';
}

function schemasMarkdown(host, order) {
  const lines = [];
  let names = Object.keys(host || {});
  if (!names.length) return lines;
  if (order && order.length) {
    names = order.filter((n) => names.includes(n)).concat(names.filter((n) => !order.includes(n)));
  }
  lines.push('## Data model');
  lines.push('');
  for (const name of names) {
    const schema = host[name] || {};
    lines.push('### ' + name);
    lines.push('');
    if (schema.description) { lines.push(schema.description.trim()); lines.push(''); }
    let inherited = 0;
    (schema.allOf || []).forEach((part) => {
      const parent = refName(part.$ref);
      if (parent) { lines.push('- inherits from: ' + classLink(parent)); inherited += 1; }
    });
    if (inherited) lines.push('');
    if (schema.enum && !schema.properties) {
      const ds = schema['x-enum-descriptions'] || [];
      lines.push('Simple type: `' + (schema.type || 'string') + '`' +
        (schema.pattern ? ', pattern: `' + schema.pattern + '`' : '') +
        (schema.maxLength !== undefined ? ', maxLength: ' + schema.maxLength : ''));
      lines.push('');
      lines.push('| Value | Description |');
      lines.push('|---|---|');
      schema.enum.forEach((v, i) => lines.push('| ' + cell(v) + ' | ' + cell(ds[i]) + ' |'));
      lines.push('');
      continue;
    }
    if (schema.type && schema.type !== 'object' && !schema.properties) {
      lines.push('Simple type: `' + typeLabel(schema) + '`' + (mdConstraints(schema) ? ' — ' + mdConstraints(schema) : ''));
      lines.push('');
      continue;
    }
    const merged = Object.assign({}, schema);
    (schema.allOf || []).forEach((part) => {
      if (part && part.properties) {
        merged.properties = Object.assign({}, merged.properties, part.properties);
        if (part.required) merged.required = (merged.required || []).concat(part.required);
      }
    });
    const required = merged.required || [];
    const props = Object.entries(merged.properties || {});

    const groups = (schema['x-xsd-choice'] || [])
      .filter(Array.isArray)
      .map((g) => g.filter((n) => merged.properties && merged.properties[n]))
      .filter((g) => g.length > 1);
    const groupOf = new Map();
    groups.forEach((g) => g.forEach((n) => groupOf.set(n, g)));
    groups.forEach((g) => {
      lines.push('- choice — exactly one of: ' + g.map((n) => '`' + n + '`').join(', '));
    });
    [['oneOf', 'exactly one of the variants'], ['anyOf', 'at least one of the variants']].forEach(([key, lead]) => {
      const list = Array.isArray(schema[key]) ? schema[key] : [];
      if (!list.length) return;
      lines.push('- choice — ' + lead + ': ' + list.map((v, i) => {
        const target = refName(v && v.$ref);
        return target ? classLink(target) : '`' + ((v && v.title) || ('variant ' + (i + 1))) + '`';
      }).join(', '));
    });
    if (groups.length || schema.oneOf || schema.anyOf) lines.push('');
    if (props.length) {
      lines.push('| Field | Type | Required | Constraints | Description |');
      lines.push('|---|---|---|---|---|');
      props.forEach(([fname, p]) => {
        if (!p || typeof p !== 'object') return;
        const group = groupOf.get(fname);
        const constraints = group
          ? ['choice: 1 of ' + group.length].concat(mdConstraints(p) ? [mdConstraints(p)] : []).join('; ')
          : mdConstraints(p);
        const isReq = required.includes(fname) || (p.type === 'array' && p.minItems >= 1);
        lines.push('| ' + cell(fname) + ' | ' + typeLabel(p) + ' | ' +
          (isReq ? 'yes' : 'no') + ' | ' + cell(constraints) + ' | ' + cell(p.description) + ' |');
      });
    } else if (!(schema.allOf || []).length) {
      lines.push('_(no fields)_');
    }
    lines.push('');
  }
  return lines;
}

function wsdlToMarkdown(model, meta) {
  const lines = [];
  lines.push(...frontmatter(meta));
  lines.push('# ' + (model.name || 'WSDL contract'));
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push('| Format | WSDL 1.1 |');
  if (model.namespace) lines.push('| Namespace | ' + cell(model.namespace) + ' |');
  if (model.protocol && model.protocol !== '—') lines.push('| Protocol | ' + cell(model.protocol) + ' |');
  lines.push('');
  if (model.documentation) { lines.push(model.documentation.trim()); lines.push(''); }
  if (model.operations.length) {
    lines.push('## Operations');
    lines.push('');
    for (const op of model.operations) {
      lines.push('### `' + op.name + '`');
      lines.push('');
      if (op.documentation) { lines.push(op.documentation.trim()); lines.push(''); }
      if (op.portType) lines.push('- portType: `' + op.portType + '`');
      if (op.input) lines.push('- input: ' + classLink(op.input));
      if (op.output) lines.push('- output: ' + classLink(op.output));
      op.faults.forEach((f) => {
        lines.push('- fault (' + (f.name ? '`' + f.name + '`' : '') + '): ' + (f.className ? classLink(f.className) : '—'));
      });
      lines.push('');
    }
  }
  lines.push(...schemasMarkdown(model.schemas));
  return finish(lines);
}

function xsdToMarkdown(model, meta) {
  const lines = [];
  lines.push(...frontmatter(meta));
  lines.push('# ' + (model.name || 'XSD schema'));
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push('| Format | XSD |');
  if (model.namespace) lines.push('| Namespace | ' + cell(model.namespace) + ' |');
  lines.push('');
  const elements = Object.entries(model.elementType || {});
  if (elements.length) {
    lines.push('## Root elements');
    lines.push('');
    lines.push('| Element | Typ |');
    lines.push('|---|---|');
    elements.forEach(([el, type]) => {
      const label = model.schemas && model.schemas[type] ? classLink(type) : cell(type);
      lines.push('| ' + cell(el) + ' | ' + label + ' |');
    });
    lines.push('');
  }
  lines.push(...schemasMarkdown(model.schemas));
  return finish(lines);
}

function avroToMarkdown(model, meta) {
  const lines = [];
  lines.push(...frontmatter(meta));
  lines.push('# ' + (model.name || 'Avro schema'));
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push('| Format | Avro |');
  if (model.namespace) lines.push('| Namespace | ' + cell(model.namespace) + ' |');
  lines.push('| Root record | ' + cell(model.rootName) + ' |');
  lines.push('');
  if (model.documentation) { lines.push(model.documentation.trim()); lines.push(''); }
  lines.push(...schemasMarkdown(model.schemas, [model.rootName]));
  return finish(lines);
}

function modelToMarkdown(model, meta) {
  if (!model || typeof model !== 'object') throw new Error('unsupported-input');
  if (model.kind === 'wsdl') return wsdlToMarkdown(model, meta);
  if (model.kind === 'xsd') return xsdToMarkdown(model, meta);
  if (model.kind === 'avro') return avroToMarkdown(model, meta);
  throw new Error('unsupported-input');
}

module.exports = { specToMarkdown, modelToMarkdown, collectEndpoints, frontmatter, cell };
