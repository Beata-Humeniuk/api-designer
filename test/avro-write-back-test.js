const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'media', 'designer-xml-write.js'), 'utf8');
const from = source.indexOf('function jsonSpanTree(');
const to = source.indexOf('function avroBaseOf(');
assert.ok(from > 0 && to > from, 'JSON layout block found in the designer source');
const { jsonInLayoutOf } = eval('(function () {' + source.slice(from, to) +
  '\nreturn { jsonInLayoutOf: jsonInLayoutOf };\n})()');

const roundTrip = (label, text) => {
  assert.strictEqual(jsonInLayoutOf(JSON.parse(text), text), text, 'unchanged schema written back byte for byte: ' + label);
};

const compact = `{
  "type": "record",
  "name": "CustomerCreated",
  "namespace": "io.acme.events",
  "fields": [
    { "name": "eventId", "type": "string", "doc": "id" },
    { "name": "amount", "type": { "type": "bytes", "logicalType": "decimal", "precision": 9, "scale": 2 } },
    { "name": "tier", "type": { "type": "enum", "name": "Tier", "symbols": ["GOLD", "SILVER"], "default": "SILVER" } },
    { "name": "note", "type": ["null", "string"], "default": null, "aliases": ["comment"] }
  ]
}`;
const expanded = `{
    "type": "record",
    "name": "Order",
    "fields": [
        {
            "name": "id",
            "type": "string"
        },
        {
            "name": "lines",
            "type": {
                "type": "array",
                "items": "string"
            }
        }
    ]
}
`;
const tabs = '{\n\t"type": "record",\n\t"name": "T",\n\t"fields": [\n\t\t{ "name": "a", "type": "int" }\n\t]\n}\n';
const tight = '{"type":"record","name":"T","fields":[{"name":"a","type":"int"}]}';
const crlf = compact.replace(/\n/g, '\r\n') + '\r\n';

roundTrip('inline fields, no trailing newline', compact);
roundTrip('four spaces, one key per line', expanded);
roundTrip('tabs', tabs);
roundTrip('everything on one line', tight);
roundTrip('CRLF with a trailing newline', crlf);

const renamed = JSON.parse(compact);
renamed.fields[0].name = 'eventUuid';
const out = jsonInLayoutOf(renamed, compact);
assert.strictEqual(out, compact.replace('"eventId"', '"eventUuid"'), 'renaming a field rewrites that field only');
assert.ok(out.indexOf('"logicalType": "decimal"') > 0 && out.indexOf('"precision": 9') > 0,
  'logicalType and its parameters survive an edit');
assert.ok(out.indexOf('"aliases": ["comment"]') > 0, 'field aliases survive an edit');
assert.ok(out.indexOf('"default": "SILVER"') > 0, 'the enum default survives an edit');
assert.ok(out.slice(-1) === '}', 'no newline appended to a file that had none');

const added = JSON.parse(compact);
added.fields.push({ name: 'source', type: 'string' });
const withAdded = jsonInLayoutOf(added, compact);
assert.ok(withAdded.indexOf('    { "name": "source", "type": "string" }\n') > 0,
  'a new field follows the layout of its siblings');

const fresh = jsonInLayoutOf({ type: 'record', name: 'T', fields: [] }, null);
assert.strictEqual(fresh, '{\n  "type": "record",\n  "name": "T",\n  "fields": []\n}\n', 'no original: canonical 2-space JSON');

console.log('PASS: avro write-back keeps the layout and everything the designer does not model');

const nested = `{
  "type": "record",
  "name": "OrderEvent",
  "fields": [
    { "name": "eventId", "type": "string" },
    { "name": "customer", "type": { "type": "record", "name": "Customer", "fields": [
      { "name": "taxId", "type": "string" },
      { "name": "firstName", "type": ["null", "string"], "default": null }
    ] } },
    { "name": "note", "type": ["null", "string"], "default": null }
  ]
}`;
const before = JSON.parse(nested);
const edited = JSON.parse(nested);
edited.fields[2].type = 'string';
delete edited.fields[2].default;
const written = jsonInLayoutOf(edited, nested);
assert.ok(written.includes('"customer", "type": { "type": "record", "name": "Customer", "fields": ['),
  'the untouched nested record keeps the shape it had in the file');
assert.strictEqual(written.split('\n').length, nested.split('\n').length,
  'the file does not grow because one field changed');
assert.strictEqual(JSON.parse(written).fields[2].type, 'string', 'the edit itself landed');
assert.strictEqual(jsonInLayoutOf(before, nested), nested, 'no change, no diff');
console.log('PASS: one edit moves one field, the rest of the file is untouched');
