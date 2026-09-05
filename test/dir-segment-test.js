'use strict';

const { slugOf, dirSegment } = require('../src/dirSegment');

const checks = [
  [dirSegment('orders') === 'orders',
    'plain segment passes through unchanged'],
  [dirSegment('{id}') === '_id',
    'a path parameter loses its braces and gains the underscore prefix'],
  [dirSegment('{orderId}') === '_orderid',
    'a camelCase parameter is lowercased the same way everywhere'],
  [dirSegment('{ïdentifierPäth}') === '_identifierpath',
    'diacritics in a parameter name are flattened, not carried into a directory name'],
  [slugOf('Zürich Çlient') === 'zurich-client',
    'slug: diacritics flattened, spaces become single dashes'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (ok) {
    console.log('OK: ' + label);
  } else {
    console.error('FAIL: ' + label);
    failed = 1;
  }
}
process.exit(failed);
