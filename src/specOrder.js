const CANONICAL_ORDER = [
  'swagger', 'openapi', '$self', 'info', 'externalDocs',
  'host', 'basePath', 'schemes', 'consumes', 'produces', 'servers',
  'tags', 'security', 'securityDefinitions',
  'paths', 'webhooks',
  'parameters', 'responses', 'definitions', 'components'
];

function canonicalOrder(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  const out = {};
  for (const key of CANONICAL_ORDER) if (key in doc) out[key] = doc[key];
  for (const key of Object.keys(doc)) if (!(key in out)) out[key] = doc[key];
  return out;
}

module.exports = { canonicalOrder };
