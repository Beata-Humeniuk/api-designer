'use strict';

const assert = (ok, name) => { if (!ok) { console.error('FAIL: ' + name); process.exit(1); } };

const Module = require('module');
const listeners = { docChange: [], fileChange: [] };
const disposed = [];
const fakeVscode = {
  Uri: { file: (p) => ({ scheme: 'file', fsPath: p, toString: () => 'file://' + p }) },
  RelativePattern: function (base, pattern) { this.base = base; this.pattern = pattern; },
  ViewColumn: { One: 1 },
  window: { showErrorMessage: () => {} },
  extensions: { getExtension: () => null },
  workspace: {
    getConfiguration: () => ({ get: (key, fallback) => fallback }),
    openTextDocument: async (uri) => ({ uri, fileName: uri.fsPath, isClosed: false, getText: () => '' }),
    onDidChangeTextDocument: (cb) => { listeners.docChange.push(cb); return { dispose: () => disposed.push('doc') }; },
    createFileSystemWatcher: () => ({
      onDidChange: (cb) => listeners.fileChange.push(cb),
      onDidCreate: (cb) => listeners.fileChange.push(cb),
      dispose: () => disposed.push('watcher')
    })
  }
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (request === 'vscode') return 'vscode';
  return origResolve.apply(this, arguments);
};
require.cache['vscode'] = { id: 'vscode', filename: 'vscode', loaded: true, exports: fakeVscode };

const { buildLoadMessage, followDocument } = require('../src/designerGui');

const yamlSpec = (title) => 'openapi: 3.0.3\ninfo:\n  title: ' + title + '\n  version: "1"\npaths: {}\n';

assert(buildLoadMessage(yamlSpec('Zoo'), 'zoo.yaml', null).message.spec.info.title === 'Zoo',
  'a YAML contract loads as a spec');
assert(buildLoadMessage('{"type":"record","name":"Ev","fields":[]}', 'ev.avsc', null).message.avro.name === 'Ev',
  'an Avro schema loads as an event');
assert(buildLoadMessage('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"/>', 'a.xsd', null).message.xmlFormat === 'xsd',
  'an XSD loads as XML');
assert(!!buildLoadMessage('title: [unclosed', 'broken.yaml', null).error, 'unparsable text reports an error, not a message');
assert(!!buildLoadMessage('a: 1\n', 'plain.yaml', null).error, 'a YAML file that is not a contract reports an error');

const sent = [];
let text = yamlSpec('Before');
const doc = {
  uri: fakeVscode.Uri.file('/tmp/contract.yaml'),
  fileName: '/tmp/contract.yaml',
  isClosed: false,
  getText: () => text
};
const panel = { webview: { postMessage: (m) => sent.push(m) }, onDidDispose: () => {} };
const follow = followDocument(panel, () => doc, () => {});

const settle = () => new Promise((r) => setTimeout(r, 400));
const fireDocChange = () => listeners.docChange.forEach((cb) => cb({ document: doc }));

(async () => {
  assert(listeners.docChange.length === 1 && listeners.fileChange.length === 2,
    'the panel listens to the document and to the file behind it');

  fireDocChange();
  await settle();
  assert(sent.length === 0, 'a change that does not change the text reloads nothing');

  text = yamlSpec('After');
  fireDocChange();
  await settle();
  assert(sent.length === 1, 'a changed file reloads the panel once');
  assert(sent[0].type === 'load' && sent[0].spec.info.title === 'After', 'the panel gets the new contract');
  assert(sent[0].keepState === true, 'the reload asks the panel to keep the view the user is in');
  assert(sent[0].hasDoc === true, 'the reload carries the same context as the first open');

  text = yamlSpec('Written by the panel');
  follow.mark(text);
  fireDocChange();
  await settle();
  assert(sent.length === 1, 'the panel does not reload on its own write');

  text = 'openapi: [unclosed';
  fireDocChange();
  await settle();
  assert(sent.length === 2 && sent[1].type === 'reloadFailed',
    'a file that stops parsing leaves the last readable version on screen');

  text = yamlSpec('Written by the panel');
  follow.force();
  await settle();
  assert(sent.length === 3 && sent[2].spec.info.title === 'Written by the panel',
    'an explicit reload re-reads the file even if the panel wrote it');

  console.log('PASS: the designer panel follows the file it has open');
})().catch((e) => { console.error('FAIL: ' + (e && e.stack || e)); process.exit(1); });
