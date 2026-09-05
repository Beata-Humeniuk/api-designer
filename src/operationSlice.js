const { schemaHost, refName } = require('./schemaShared');

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function reachableSchemas(host, roots, stopAt) {
  const keep = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const target = refName(node.$ref);
    if (target && host[target] && !keep.has(target) && !(stopAt && stopAt.has(target))) {
      keep.add(target);
      visit(host[target]);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== '$ref') visit(value);
    }
  };
  roots.forEach(visit);
  return keep;
}

function findOperation(spec, sel) {
  if (!sel) return null;
  const wantMethod = sel.method ? String(sel.method).toLowerCase() : null;
  for (const [route, item] of Object.entries((spec && spec.paths) || {})) {
    if (!item || typeof item !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      if (sel.path !== undefined || wantMethod) {
        if (route === sel.path && method === wantMethod) return { path: route, method, op };
      } else if (sel.operationId && op.operationId === sel.operationId) {
        return { path: route, method, op };
      }
    }
  }
  return null;
}

function fileSlug(s) {
  return String(s).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'operation';
}

function operationLabel(found) {
  if (!found) return '';
  return (found.op && found.op.operationId) || (found.method.toUpperCase() + ' ' + found.path);
}

function operationSpec(spec, sel) {
  const found = findOperation(spec, sel);
  if (!found) return null;
  const item = spec.paths[found.path];
  const narrowedItem = {};
  for (const [key, value] of Object.entries(item)) {
    if (!HTTP_METHODS.includes(key.toLowerCase()) || key === found.method) narrowedItem[key] = value;
  }
  const out = Object.assign({}, spec, { paths: { [found.path]: narrowedItem } });
  const host = schemaHost(spec);
  const keep = reachableSchemas(host, [narrowedItem]);
  const pruned = {};
  for (const name of Object.keys(host)) if (keep.has(name)) pruned[name] = host[name];
  if (spec.definitions) out.definitions = pruned;
  if (spec.components && spec.components.schemas) {
    out.components = Object.assign({}, spec.components, { schemas: pruned });
  }
  return out;
}

module.exports = {
  HTTP_METHODS, reachableSchemas, findOperation, fileSlug, operationLabel, operationSpec
};
