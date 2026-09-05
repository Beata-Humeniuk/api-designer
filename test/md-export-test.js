const fs = require('fs');
const path = require('path');
const { specToMarkdown } = require('../src/mdExport');
const { operationSpec } = require('../src/operationSlice');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const petstore = JSON.parse(fs.readFileSync(path.join(__dirname, 'petstore-swagger2.json'), 'utf8'));
const mdPet = specToMarkdown(petstore);
assert(mdPet.startsWith('# '), 'title heading present');
assert(mdPet.includes('Swagger 2.0'), 'format row present');
assert(mdPet.includes('## Endpoints'), 'endpoints section present');
assert(mdPet.includes('## Data model'), 'data model section present');
assert(mdPet.includes('### Pet'), 'schema section per class');

const spec = {
  openapi: '3.0.3',
  info: { title: 'Menagerie', version: '2.1', description: 'Shelter API.' },
  servers: [{ url: 'https://api.example', description: 'prod' }],
  paths: {
    '/dogs': {
      get: {
        tags: ['Dogs'],
        operationId: 'listDogs',
        summary: 'Dog list',
        parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer' }, description: 'how | many' }],
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Dog' } } } } } }
      },
      post: {
        tags: ['Dogs'],
        operationId: 'createDog',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Dog' } } } },
        responses: { '201': { description: 'Created' }, '400': { description: 'Validation error' } }
      }
    }
  },
  components: {
    schemas: {
      Animal: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, description: 'name' } } },
      Dog: {
        allOf: [
          { $ref: '#/components/schemas/Animal' },
          { type: 'object', properties: { barks: { type: 'boolean', default: true } } }
        ]
      },
      Kennel: { type: 'object', properties: { city: { type: 'string' } } }
    }
  }
};
const md = specToMarkdown(spec);
assert(md.includes('# Menagerie'), 'title from info');
assert(md.includes('OpenAPI 3.0.3'), 'openapi version shown');
assert(md.includes('https://api.example'), 'server listed');
assert(md.includes('### Dogs') && md.includes('#### `GET /dogs`') && md.includes('#### `POST /dogs`'),
  'endpoints grouped under tag');
assert(md.includes('| limit | query |'), 'parameter row present');
assert(md.includes('how \\| many'), 'pipes escaped in table cells');
assert(md.includes('| 400 | Validation error |'), 'response codes table');
assert(md.includes('response: [Dog](#dog)[]'), 'response type cross-linked');
assert(md.includes('- inherits from: [Animal](#animal)'), 'allOf inheritance noted');
assert(md.includes('| barks | boolean | no |'), 'allOf inline fields merged into table');
assert(md.includes('minLength: 1'), 'constraints column filled');
assert(!md.includes('\n\n\n'), 'no triple blank lines');

const one = specToMarkdown(operationSpec(spec, { path: '/dogs', method: 'POST' }));
assert(one.includes('#### `POST /dogs`'), 'the exported service is there');
assert(!one.includes('#### `GET /dogs`'), 'sibling method left out');
assert(one.includes('### Dog') && one.includes('### Animal'), 'classes it reaches (incl. through allOf) exported');
assert(md.includes('### Kennel') && !one.includes('### Kennel'), 'classes it does not use stay out');

console.log('PASS: markdown export ok (whole contract + per-service)');

const withMeta = specToMarkdown(spec, {
  type: 'contract',
  generator: 'api-designer@1.0.0',
  generated: '2026-08-11',
  source: 'api/pet store.yaml',
  managed: true
});
assert(withMeta.startsWith('---\ntype: contract\ngenerator: api-designer@1.0.0\ngenerated: 2026-08-11\nsource: "api/pet store.yaml"\nmanaged: true\n---\n\n# Menagerie'),
  'frontmatter precedes title with fixed key order and quoting');
assert(!specToMarkdown(spec).startsWith('---'), 'no frontmatter without meta');
assert(!specToMarkdown(spec, {}).startsWith('---'), 'no frontmatter for empty meta');

console.log('PASS: markdown frontmatter ok');
