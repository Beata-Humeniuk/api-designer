const fs = require('fs');
const path = require('path');
const { forLanguage } = require('./nls');

function editorLanguage() {
  try { return require('vscode').env.language; } catch (e) { return undefined; }
}
const nls = forLanguage(editorLanguage());

function createSkeleton(kind, vals) {
  const v = vals || {};
  if (kind === 'openapi') {
    const std = v.std || '3.0.3';
    const spec = std === '2.0'
      ? { swagger: '2.0', info: { title: v.title || 'New contract', version: v.version || '1.0.0' }, paths: {}, definitions: {} }
      : { openapi: std, info: { title: v.title || 'New contract', version: v.version || '1.0.0' }, paths: {}, components: { schemas: {} } };
    const ext = v.ext === '.json' ? '.json' : '.yaml';
    const yaml = require('js-yaml');
    const content = ext === '.json'
      ? JSON.stringify(spec, null, 2) + '\n'
      : yaml.dump(spec, { noRefs: true, lineWidth: -1, indent: 2 });
    return { ext, content, spec };
  }
  if (kind === 'wsdl') {
    const name = v.name || 'NewService';
    const ns = v.ns || 'http://example.org/' + name.toLowerCase();
    return {
      ext: '.wsdl',
      content: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<wsdl:definitions name="' + name + '"',
        '    targetNamespace="' + ns + '"',
        '    xmlns:tns="' + ns + '"',
        '    xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"',
        '    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"',
        '    xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
        '  <wsdl:documentation>' + name + (v.version ? ' — version ' + v.version : '') + '</wsdl:documentation>',
        '  <wsdl:types>',
        '    <xsd:schema targetNamespace="' + ns + '" elementFormDefault="qualified"/>',
        '  </wsdl:types>',
        '  <wsdl:portType name="' + name + 'PortType"/>',
        '  <wsdl:binding name="' + name + 'Binding" type="tns:' + name + 'PortType">',
        '    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>',
        '  </wsdl:binding>',
        '  <wsdl:service name="' + name + '">',
        '    <wsdl:port name="' + name + 'Port" binding="tns:' + name + 'Binding">',
        '      <soap:address location="' + ns.replace(/\/$/, '') + '/' + name + '"/>',
        '    </wsdl:port>',
        '  </wsdl:service>',
        '</wsdl:definitions>',
        ''
      ].join('\n')
    };
  }
  if (kind === 'xsd') {
    const name = v.name || 'schema';
    const ns = v.ns || 'http://example.org/' + name.toLowerCase();
    return {
      ext: '.xsd',
      content: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"',
        '    targetNamespace="' + ns + '"',
        '    xmlns:tns="' + ns + '"',
        '    elementFormDefault="qualified"' + (v.version ? '\n    version="' + v.version + '"' : '') + '>',
        '</xsd:schema>',
        ''
      ].join('\n')
    };
  }
  if (kind === 'avro') {
    const rec = {
      type: 'record',
      name: v.name || 'NewEvent',
      namespace: require('./schemaConvert').avroNamespace(v.ns || 'org.example') || 'org.example',
      doc: undefined,
      fields: []
    };
    delete rec.doc;
    return { ext: '.avsc', content: JSON.stringify(rec, null, 2) + '\n' };
  }
  throw new Error(nls.t('error.unknownKind', { kind }));
}

const HTML_DIR = path.join(__dirname, '..', 'media');

const SCRIPT_PARTS = [
  'designer-core.js',
  'designer-tree.js',
  'designer-views.js',
  'designer-structure.js',
  'designer-properties.js',
  'designer-xml-read.js',
  'designer-xml-write.js',
  'designer-formats.js'
];

function asset(name) {
  return fs.readFileSync(path.join(HTML_DIR, name), 'utf8');
}

let designerHtmlCache = null;

function buildDesignerHtml(languageTag) {
  if (!languageTag && designerHtmlCache) return designerHtmlCache;
  const catalog = languageTag ? forLanguage(languageTag) : nls;
  const catalogScript = [
    'const NLS = ' + JSON.stringify(catalog.stringsTable()) + ';',
    'const NLS_LANG = ' + JSON.stringify(catalog.lang) + ';'
  ].join('\n');
  const slots = {
    lang: catalog.lang,
    style: asset('designer.css'),
    script: SCRIPT_PARTS.map(asset).join('\n'),
    catalog: catalogScript
  };
  const html = asset('designer.html').replace(/\{\{([\w.]+)\}\}/g, (whole, key) =>
    key in slots ? slots[key] : catalog.t(key));
  if (!languageTag) designerHtmlCache = html;
  return html;
}

function isJsonText(text) { return /^\s*\{/.test(text); }

async function applySpecToDocument(doc, spec) {
  const vscode = require('vscode');
  const yaml = require('js-yaml');
  const { canonicalOrder } = require('./specOrder');
  const asJson = isJsonText(doc.getText());
  const updated = canonicalOrder(spec);
  const newText = asJson
    ? JSON.stringify(updated, null, 2) + '\n'
    : yaml.dump(updated, { noRefs: true, lineWidth: -1, indent: 2 });

  if (newText === doc.getText()) return true;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount + 1, 0), newText);
  return vscode.workspace.applyEdit(edit);
}

function followDocument(panel, getDoc, setDoc) {
  const vscode = require('vscode');

  let mine = null;
  let timer = null;
  let watcher = null;
  let chain = Promise.resolve();

  const reload = async () => {
    let doc = getDoc();
    if (!doc) return;
    if (doc.isClosed) {

      doc = await vscode.workspace.openTextDocument(doc.uri);
      setDoc(doc);
    }
    const text = doc.getText();
    if (text === mine) return;
    mine = text;
    const built = buildLoadMessage(text, path.basename(doc.fileName), doc.uri);
    if (built.error) {

      panel.webview.postMessage({ type: 'reloadFailed' });
      return;
    }
    panel.webview.postMessage(loadMessage(built.message, true, {
      keepState: true, time: new Date().toLocaleTimeString(nls.lang)
    }));
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { chain = chain.then(reload).catch(() => {}); }, 300);
  };

  const rebind = () => {
    if (watcher) { watcher.dispose(); watcher = null; }
    const doc = getDoc();
    mine = doc ? doc.getText() : null;
    if (!doc || doc.uri.scheme !== 'file') return;

    watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(doc.uri.fsPath)), path.basename(doc.uri.fsPath)));
    watcher.onDidChange(schedule);
    watcher.onDidCreate(schedule);
  };

  const sub = vscode.workspace.onDidChangeTextDocument((e) => {
    const doc = getDoc();
    if (doc && e.document.uri.toString() === doc.uri.toString()) schedule();
  });
  panel.onDidDispose(() => {
    clearTimeout(timer);
    sub.dispose();
    if (watcher) watcher.dispose();
  });
  rebind();
  return {
    rebind,
    mark: (text) => { mine = text; },
    force: () => { mine = null; schedule(); }
  };
}

const followers = new WeakMap();

const CONTRACT_COMMANDS = ['convertContract'];

function wirePanel(panel, getDoc, setDoc) {
  const vscode = require('vscode');
  let applyChain = Promise.resolve();

  panel.onDidDispose(() => setDoc(null));
  const follow = followDocument(panel, getDoc, setDoc);
  followers.set(panel, follow);
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'reload') {
      follow.force();
      return;
    }
    if (msg.type === 'exportMd' || CONTRACT_COMMANDS.indexOf(msg.type) >= 0) {
      const doc = getDoc();
      if (!doc) {
        vscode.window.showErrorMessage(nls.t('error.saveFirst'));
        return;
      }
      if (doc.isDirty) await doc.save();
      vscode.commands.executeCommand('apiDesigner.' + msg.type, doc.uri, msg.operation || null);
      return;
    }

    if (msg.type === 'apply' || msg.type === 'applyRaw') {
      applyChain = applyChain.then(async () => {
        const doc = getDoc();
        if (!doc) {
          panel.webview.postMessage({ type: 'applied', ok: false, time: '' });
          return;
        }
        let ok;
        if (msg.type === 'applyRaw') {
          if (msg.text === doc.getText()) {
            ok = true;
          } else {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount + 1, 0), msg.text);
            ok = await vscode.workspace.applyEdit(edit);
          }
        } else {
          ok = await applySpecToDocument(doc, msg.spec);
        }
        follow.mark(doc.getText());

        panel.webview.postMessage({ type: 'applied', ok, time: new Date().toLocaleTimeString(nls.lang) });
      }).catch(() => {
        panel.webview.postMessage({ type: 'applied', ok: false, time: '' });
      });
      return;
    }
    if (msg.type === 'create') {
      try {
        const { ext, content, spec } = createSkeleton(msg.kind, msg.vals || {});
        const vals = msg.vals || {};
        const doc = getDoc();
        let baseDir;
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length) {
          baseDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
        } else if (doc && doc.uri.scheme === 'file') {
          baseDir = path.dirname(doc.uri.fsPath);
        } else {
          panel.webview.postMessage({ type: 'createError', message: nls.t('error.noWorkspace') });
          return;
        }
        const loc = (vals.loc || '/src/main/contracts').replace(/^\//, '');
        const stem = (vals.file || vals.title || vals.name || 'contract')
          .replace(/\.(json|yaml|yml|wsdl|xsd|avsc)$/i, '')
          .replace(/[^A-Za-z0-9_.-]+/g, '-').toLowerCase() || 'contract';
        const target = path.join(baseDir, loc, stem + ext);
        const targetUri = vscode.Uri.file(target);
        let exists = true;
        try { await vscode.workspace.fs.stat(targetUri); } catch (e) { exists = false; }
        if (exists) {
          panel.webview.postMessage({ type: 'createError', message: nls.t('error.exists', { name: target }) });
          return;
        }
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target)));
        await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf8'));
        const newDoc = await vscode.workspace.openTextDocument(targetUri);
        await vscode.window.showTextDocument(newDoc, { preview: false, viewColumn: vscode.ViewColumn.One });
        setDoc(newDoc);
        follow.rebind();
        panel.title = path.basename(target);
        if (msg.kind === 'openapi' && spec) {
          panel.webview.postMessage({ type: 'load', spec, fileName: path.basename(target), hasDoc: true });
        } else if (msg.kind === 'avro') {
          panel.webview.postMessage({ type: 'load', avro: JSON.parse(content), avroText: content, fileName: path.basename(target), hasDoc: true });
        } else {
          panel.webview.postMessage({ type: 'load', xmlFormat: msg.kind, xmlText: content, fileName: path.basename(target), hasDoc: true });
        }
      } catch (e) {
        panel.webview.postMessage({ type: 'createError', message: nls.t('error.failed', { error: e.message || String(e) }) });
      }
    }
  });
}

const panelsByUri = new Map();

function createPanel(title, uriKey) {
  const vscode = require('vscode');
  const panel = vscode.window.createWebviewPanel(
    'apiDesignerGui',
    title,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  try {
    panel.iconPath = vscode.Uri.file(path.join(__dirname, '..', 'icon.png'));
  } catch (e) {  }
  if (uriKey) panelsByUri.set(uriKey, panel);
  panel.onDidDispose(() => {
    if (uriKey && panelsByUri.get(uriKey) === panel) panelsByUri.delete(uriKey);
  });
  return panel;
}

function collectXsdIncludes(text, filePath) {
  const fs = require('fs');
  const seen = new Set();
  const out = [];
  const visit = function (src, fromFile) {
    const re = /schemaLocation\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(src))) {
      const location = m[1] !== undefined ? m[1] : m[2];
      if (!location || /^https?:/i.test(location)) continue;
      const resolved = path.resolve(path.dirname(fromFile), location);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      let included = null;
      try { included = fs.readFileSync(resolved, 'utf8'); } catch (e) { continue; }
      out.push(included);
      visit(included, resolved);
    }
  };
  if (filePath) visit(text, filePath);
  return out;
}

function buildLoadMessage(text, base, uri) {
  const yaml = require('js-yaml');
  let xmlFormat = null;
  if (/\.wsdl$/i.test(base) || (/<\s*[\w:]*definitions[\s>]/.test(text) && text.indexOf('schemas.xmlsoap.org/wsdl') >= 0)) xmlFormat = 'wsdl';
  else if (/\.xsd$/i.test(base) || (/<\s*[\w:]*schema[\s>]/.test(text) && text.indexOf('XMLSchema') >= 0)) xmlFormat = 'xsd';
  if (xmlFormat) {
    const xmlIncludes = uri && uri.scheme === 'file' ? collectXsdIncludes(text, uri.fsPath) : [];
    return { message: { type: 'load', xmlFormat, xmlText: text, xmlIncludes, fileName: base } };
  }
  let spec;
  try {
    spec = JSON.parse(text);
  } catch (jsonErr) {
    try {
      spec = yaml.load(text);
    } catch (yamlErr) {
      const e = isJsonText(text) ? jsonErr : yamlErr;
      return { error: nls.t('error.readFailed', { error: e.message }) };
    }
  }
  if (spec && typeof spec === 'object' && spec.type === 'record' && Array.isArray(spec.fields)) {
    return { message: { type: 'load', avro: spec, avroText: text, fileName: base } };
  }
  if (!spec || typeof spec !== 'object' || (spec.swagger !== '2.0' && typeof spec.openapi !== 'string')) {
    return { error: nls.t('error.notContract') };
  }
  return { message: { type: 'load', spec, fileName: base } };
}

function loadMessage(message, hasDoc, extra) {
  return Object.assign({}, message, {
    hasDoc: !!hasDoc
  }, extra || {});
}

async function openDesigner(uri) {
  const vscode = require('vscode');
  let doc;
  if (uri && uri.fsPath) {
    doc = await vscode.workspace.openTextDocument(uri);
  } else if (vscode.window.activeTextEditor) {
    doc = vscode.window.activeTextEditor.document;
  } else {
    vscode.window.showErrorMessage(nls.t('error.notContract'));
    return;
  }
  const panelKey = doc.uri.toString();
  const existing = panelsByUri.get(panelKey);
  if (existing) {
    existing.reveal(vscode.ViewColumn.One);
    const follow = followers.get(existing);
    if (follow) follow.force();
    return;
  }
  const base = path.basename(doc.fileName);
  const built = buildLoadMessage(doc.getText(), base, doc.uri);
  if (built.error) {
    vscode.window.showErrorMessage(built.error);
    return;
  }
  const panel = createPanel(base, panelKey);
  panel.webview.html = buildDesignerHtml();
  let bound = doc;
  wirePanel(panel, () => bound, (d) => { bound = d; });
  panel.webview.postMessage(loadMessage(built.message, true));
}

function openNewContract() {
  const panel = createPanel('New contract');
  panel.webview.html = buildDesignerHtml();
  let boundDoc = null;
  wirePanel(panel, () => boundDoc, (d) => { boundDoc = d; });
  panel.webview.postMessage(loadMessage({ type: 'load', spec: null, fileName: '' }, false));
}

module.exports = { buildDesignerHtml, createSkeleton, openDesigner, openNewContract, buildLoadMessage, followDocument };
