'use strict';

const EN = {

  'ask.saveResult': 'Save the result?',
  'info.saved': 'Saved: {path}',
  'error.opNotFound': 'Operation {method} {path} not found in the contract.',
  'error.notContract': 'This is not a Swagger 2.0/OpenAPI 3.x specification, a WSDL, an XSD or an Avro schema (.avsc).',
  'ask.saveAs': 'Save as {path}?',
  'error.writeBack': 'The change could not be written back to the file — the file was left as it was.',
  'error.saveFirst': 'Save the contract to a file first — this action reads the file, not the preview.',
  'error.renameWhereDefined': 'This name is changed where the type is defined: a nested class through the field in its parent class, a type from an imported XSD in its own file.',
  'convert.pickTarget': 'Convert the schema to which format?',
  'convert.pickRoot': 'Which object?',




  'error.unknownKind': 'Unknown contract kind: {kind}',
  'error.noWorkspace': 'No workspace folder open — open the folder the contract should be created in.',

  'status.applied': '● Changes applied {time} — save the file (Ctrl+S)',
  'status.reloaded': '● Read from the file {time}',
  'status.reloadFailed': 'The file changed but does not parse — the last readable version is shown',
  'status.clickToCopy': 'Click to copy: {path}',
  'error.copyFailed': 'Could not copy.',

  'tree.empty': 'No contract open. Create one with "API Designer: New contract" or right-click a contract file and choose "API Designer".',
  'tree.pasteSchema': '＋ Paste a schema (JSON/XML)',
  'tree.more': '+{count} more',
  'tree.baseType': 'Base type: {name}',

  'empty.noOps': 'No operations yet — add the first one with "＋" in the tree.',
  'tree.noMatch': 'Nothing matches the filter.',
  'empty.noFields': 'No fields.',

  'security.apiKeyHeader': 'apiKeyAuth (X-API-Key header)',
  'error.exists': '"{name}" already exists.',
  'error.inUse': '"{name}" is used elsewhere in the contract{by} — change those uses first.',
  'error.readFailed': 'Could not read it: {error}',
  'action.delete': 'Delete {name}',
  'error.required': 'This cannot be empty.',
  'error.noOperations': 'The contract has no operation to work with.',
  'error.convertNothing': 'Nothing to convert — the contract has no named object type to build the result from.',
  'error.failed': 'It did not work: {error}',
  'status.preview': 'Preview — the file is not modified',
  'status.writeFailed': 'Could not write the change to the file{error}',
  'paste.body': 'a schema, a fragment, a JSON example, an XSD or a list of values',
  'error.badHttpCode': 'Enter an HTTP code (100–599) or "default".',
  'error.needContentType': 'The request must keep at least one content-type.',
  'error.nestedClassDelete': 'A nested class is deleted by deleting its field (the connection) in the parent class.',
  'error.badAvroType': 'Enter an Avro type: a plain name (e.g. long) or an object with a type field, e.g. {"type":"string","avro.java.string":"String"}.',

  'choice.caption': 'pick 1 of {count}',
  'choice.exactlyOne': 'choice — exactly one of {count}',
  'choice.atLeastOne': 'choice — at least one of {count}',


  'create.stdVersion': 'Swagger/OpenAPI standard version',

  'types.noneMatch': 'Nothing matches the filter.',

  'paste.nameLabel': 'name (when pasting a single element)',

  'error.avroAnonObject': 'a nested object without a name — Avro requires named records, extract it as a schema',
  'warn.avroUnreachable': 'Left out of the file: {names} — Avro writes only types reachable from the root record ({root}).',
  'warn.xsdRebuilt': 'The surgical write failed ({error}) — the file was rebuilt from scratch.',
};

const TRANSLATIONS = {};

function baseLanguage(tag) {
  return String(tag || 'en').toLowerCase().split(/[-_]/)[0];
}

function forLanguage(tag) {
  const lang = baseLanguage(tag);
  const table = TRANSLATIONS[lang] || {};

  const lookup = (key) => {
    const value = table[key];
    if (typeof value === 'string' && value !== '') return value;
    return EN[key];
  };

  const t = (key, params) => {
    const text = lookup(key);
    if (typeof text !== 'string') return key;
    return text.replace(/\{(\w+)\}/g, (whole, name) =>
      params && name in params ? String(params[name]) : whole);
  };

  const stringsTable = () => {
    const out = {};
    for (const key of Object.keys(EN)) {
      const value = lookup(key);
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  };

  return { lang: lang === 'en' ? 'en' : 'en', t, stringsTable };
}

module.exports = { forLanguage, baseLanguage, EN, TRANSLATIONS };
