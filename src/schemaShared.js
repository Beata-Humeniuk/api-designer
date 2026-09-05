function schemaHost(spec) {
  return (spec && (spec.definitions || (spec.components && spec.components.schemas))) || {};
}

function refName(ref) {
  const m = typeof ref === 'string' && ref.match(/#\/(?:definitions|components\/schemas)\/([^/]+)$/);
  return m ? m[1] : null;
}

function plainType(s) {
  if (!s || typeof s !== 'object') return '?';
  if (s.$ref) return refName(s.$ref) || s.$ref;
  if (s.type === 'array') return plainType(s.items) + '[]';
  const t = Array.isArray(s.type) ? s.type.filter((x) => x !== 'null').join('|') || 'any' : (s.type || 'object');
  return s.format ? t + ' (' + s.format + ')' : t;
}

function isNullable(s) {
  if (!s || typeof s !== 'object') return false;
  if (s.nullable === true || s['x-nullable'] === true) return true;
  return Array.isArray(s.type) && s.type.includes('null');
}

function constraintText(p, opts) {
  const o = opts || {};
  const out = [];
  if (!p || typeof p !== 'object') return '';
  if (p.title !== undefined && p.title !== '') out.push('title: ' + JSON.stringify(p.title));
  if (p.enum) out.push('enum: ' + p.enum.join(', '));
  if (p.pattern) out.push('pattern: ' + (o.md ? '`' + p.pattern + '`' : p.pattern));
  if (typeof p.exclusiveMinimum === 'number') out.push('min (excl): ' + p.exclusiveMinimum);
  else if (p.minimum !== undefined) {
    out.push('min' + (p.exclusiveMinimum === true ? ' (excl)' : '') + ': ' + p.minimum);
  }
  if (typeof p.exclusiveMaximum === 'number') out.push('max (excl): ' + p.exclusiveMaximum);
  else if (p.maximum !== undefined) {
    out.push('max' + (p.exclusiveMaximum === true ? ' (excl)' : '') + ': ' + p.maximum);
  }
  if (p.minLength !== undefined) out.push('minLength: ' + p.minLength);
  if (p.maxLength !== undefined) out.push('maxLength: ' + p.maxLength);
  if (o.items !== false) {
    if (p.minItems !== undefined) out.push('minItems: ' + p.minItems);
    if (p.maxItems !== undefined) out.push('maxItems: ' + p.maxItems);
  }
  if (p.multipleOf !== undefined) out.push('multipleOf: ' + p.multipleOf);
  if (p.minProperties !== undefined) out.push('minProperties: ' + p.minProperties);
  if (p.maxProperties !== undefined) out.push('maxProperties: ' + p.maxProperties);
  if (p.uniqueItems === true) out.push('uniqueItems');
  if (p.default !== undefined) out.push('default: ' + JSON.stringify(p.default));
  if (p.readOnly === true) out.push('readOnly');
  if (p.writeOnly === true) out.push('writeOnly');
  if (p.deprecated === true || p['x-deprecated'] === true) out.push('deprecated');
  if (isNullable(p)) out.push('nullable');
  if (o.example) {
    const example = p.example !== undefined ? p.example : p['x-example'];
    if (example !== undefined) out.push('example: ' + JSON.stringify(example));
  }
  return out.join('; ');
}

function firstResponseSchema(op) {
  const responses = op.responses || {};
  const code = ['200', '201', '202', 'default'].find((c) => responses[c]) || Object.keys(responses)[0];
  const r = code && responses[code];
  if (!r) return null;
  if (r.schema) return r.schema;
  const content = r.content || {};
  const media = Object.keys(content)[0];
  return media ? content[media].schema : null;
}

module.exports = { schemaHost, refName, plainType, firstResponseSchema, isNullable, constraintText };
