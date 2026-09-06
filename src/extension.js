const vscode = require('vscode');
const path = require('path');
const { forLanguage } = require('./nls');

const nls = forLanguage(vscode.env && vscode.env.language);

function parseSpec(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return require('js-yaml').load(text);
  }
}

function serialize(obj, isYaml) {
  return isYaml
    ? require('js-yaml').dump(obj, { noRefs: true, lineWidth: -1, indent: 2 })
    : JSON.stringify(obj, null, 2) + '\n';
}

async function loadSource(uri) {
  if (uri && uri.fsPath) {
    const doc = await vscode.workspace.openTextDocument(uri);
    return { text: doc.getText(), uri };
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error(nls.t('error.notContract'));
  }
  return { text: editor.document.getText(), uri: editor.document.uri };
}

async function pickFormat(placeHolder) {
  const format = await vscode.window.showQuickPick(
    [
      { label: 'YAML' },
      { label: 'JSON' }
    ],
    { placeHolder }
  );
  return format ? format.label === 'YAML' : null;
}

let extensionVersion = '';

function isoToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function workspaceRelative(uri) {
  if (!uri || uri.scheme !== 'file') return '';
  const rel = vscode.workspace.asRelativePath(uri, false);
  return rel === uri.fsPath ? path.basename(uri.fsPath) : rel;
}

function asOperation(arg) {
  if (!arg || typeof arg !== 'object' || Array.isArray(arg)) return null;
  if (typeof arg.path === 'string' && typeof arg.method === 'string') return arg;
  if (typeof arg.name === 'string') return arg;
  return null;
}

async function exportMdCommand(uri, operationArg) {
  let source;
  try {
    source = await loadSource(uri);
  } catch (e) {
    vscode.window.showErrorMessage(e.message);
    return;
  }
  const operation = asOperation(operationArg);
  const { specToMarkdown, modelToMarkdown } = require('./mdExport');
  const { parseXmlContract, isAvroSpec, avroToModel, wsdlOperationModel } = require('./wsdlXsdAvro');
  const { findOperation, operationSpec, operationLabel, fileSlug } = require('./operationSlice');
  const base = source.uri && source.uri.fsPath ? path.basename(source.uri.fsPath) : '';
  const meta = {
    type: 'contract',
    generator: 'api-editor@' + extensionVersion,
    generated: isoToday(),
    source: workspaceRelative(source.uri) || undefined,
    managed: true
  };

  let content = null;
  let opLabel = '';
  try {
    const xmlModel = parseXmlContract(source.text, base);
    if (xmlModel) {
      let model = xmlModel;
      if (operation && operation.name) {
        model = wsdlOperationModel(xmlModel, operation.name);
        if (!model) {
          vscode.window.showErrorMessage(nls.t('error.opNotFound', { name: operation.name }));
          return;
        }
        opLabel = operation.name;
        meta.operation = opLabel;
      }
      content = modelToMarkdown(model, meta);
    }
  } catch (e) {

    const detail = e.message === 'wsdl-no-definitions' ? t('error.writeBack')
      : e.message === 'xsd-no-schema' ? nls.t('error.writeBack')
      : (e.message || String(e));
    vscode.window.showErrorMessage(nls.t('error.readFailed', { error: detail }));
    return;
  }
  if (content === null) {
    let spec = null;
    try { spec = parseSpec(source.text); } catch (e) {  }
    if (isAvroSpec(spec)) {
      content = modelToMarkdown(avroToModel(spec), meta);
    } else if (spec && typeof spec === 'object' && (spec.swagger === '2.0' || typeof spec.openapi === 'string')) {
      let narrowed = spec;
      if (operation && operation.path) {
        const found = findOperation(spec, operation);
        if (!found) {
          vscode.window.showErrorMessage(nls.t('error.opNotFound', { method: operation.method, path: operation.path }));
          return;
        }
        opLabel = operationLabel(found);
        meta.operation = opLabel;
        narrowed = operationSpec(spec, operation);
      }
      content = specToMarkdown(narrowed, meta);
    } else {
      vscode.window.showErrorMessage(nls.t('error.notContract'));
      return;
    }
  }
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  await vscode.window.showTextDocument(doc, { preview: false });
  await offerSaveBesideExt(source, content, opLabel ? '-' + fileSlug(opLabel) + '.md' : '.md');
}

async function offerSaveBesideExt(source, content, ext, message) {
  if (!source.uri || source.uri.scheme !== 'file') return;
  const src = source.uri.fsPath;
  const base = path.basename(src).replace(/\.(json|yaml|yml|wsdl|xsd|avsc|xml)$/i, '');
  const target = vscode.Uri.file(path.join(path.dirname(src), base + ext));
  const label = vscode.workspace.asRelativePath(target, false);
  const save = 'Save';
  const prompt = nls.t('ask.saveAs', { path: label });
  const pick = await vscode.window.showInformationMessage(
    message ? message + ' ' + prompt : prompt,
    save
  );
  if (pick === save) {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    await vscode.workspace.fs.writeFile(target, data);
    vscode.window.showInformationMessage(nls.t('info.saved', { path: label }));
  }
}

async function offerSaveConverted(source, content, ext, formatLabel) {
  if (!source.uri || source.uri.scheme !== 'file') return;
  const src = source.uri.fsPath;
  const base = path.basename(src).replace(/\.(json|yaml|yml|wsdl|xsd|avsc|xml)$/i, '');
  const target = path.join(path.dirname(src), base + ext);
  const saveAs = 'Save as';
  const pick = await vscode.window.showInformationMessage(
    nls.t('ask.saveResult'), saveAs);
  if (pick !== saveAs) return;
  const filters = ext === '.wsdl' ? { 'WSDL': ['wsdl'] }
    : ext === '.xsd' ? { 'XSD': ['xsd'] }
    : ext === '.avsc' ? { 'Avro': ['avsc'] }
    : ext === '.yaml' ? { 'YAML': ['yaml', 'yml'], 'JSON': ['json'] }
    : { 'JSON': ['json'], 'YAML': ['yaml', 'yml'] };
  const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(target), filters });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  vscode.window.showInformationMessage(nls.t('info.saved', { path: uri.fsPath }));
}

async function convertContractCommand(uri) {
  let source;
  try {
    source = await loadSource(uri);
  } catch (e) {
    vscode.window.showErrorMessage(e.message);
    return;
  }
  const conv = require('./schemaConvert');
  const base = source.uri && source.uri.fsPath ? path.basename(source.uri.fsPath) : '';
  let model;
  try {
    model = conv.readContract(source.text, base);
  } catch (e) {
    const detail = e.message === 'wsdl-no-definitions' ? t('error.writeBack')
      : e.message === 'xsd-no-schema' ? nls.t('error.writeBack')
      : (e.message || String(e));
    vscode.window.showErrorMessage(nls.t('error.readFailed', { error: detail }));
    return;
  }
  if (!model) {
    vscode.window.showErrorMessage(nls.t('error.notContract'));
    return;
  }
  if (!Object.keys(model.schemas || {}).length) {
    vscode.window.showErrorMessage(nls.t('error.convertNothing'));
    return;
  }
  const targets = conv.targetsFor(model.kind);
  const items = [];
  if (targets.indexOf('openapi') >= 0) {
    items.push({ id: 'openapi-yaml', label: 'OpenAPI 3.0 · YAML' });
    items.push({ id: 'openapi-json', label: 'OpenAPI 3.0 · JSON' });
  }
  if (targets.indexOf('wsdl') >= 0) {
    items.push({ id: 'wsdl', label: 'WSDL' });
  }
  if (targets.indexOf('xsd') >= 0) {
    items.push({ id: 'xsd', label: 'XSD' });
  }
  if (targets.indexOf('avro') >= 0) {
    items.push({ id: 'avro', label: 'Avro (.avsc)' });
  }
  const picked = await vscode.window.showQuickPick(items, { placeHolder: nls.t('convert.pickTarget') });
  if (!picked) return;

  const buildsOperation = (picked.id.indexOf('openapi') === 0 || picked.id === 'wsdl') &&
    !(model.operations && model.operations.length);
  const namesAnElement = picked.id === 'xsd' || picked.id === 'avro';
  let root = null;
  if (namesAnElement || buildsOperation) {
    const roots = conv.rootCandidates(model);
    if (!roots.length) {
      vscode.window.showErrorMessage(nls.t('error.convertNothing'));
      return;
    }
    root = await vscode.window.showQuickPick(roots, { placeHolder: nls.t('convert.pickRoot') });
    if (!root) return;
  }

  let content;
  let ext;
  let language;
  try {
    if (picked.id === 'wsdl') {
      content = conv.toWsdl(model, root);
      ext = '.wsdl';
      language = 'xml';
    } else if (picked.id === 'xsd') {
      content = conv.toXsd(model, root);
      ext = '.xsd';
      language = 'xml';
    } else if (picked.id === 'avro') {
      content = JSON.stringify(conv.toAvro(model, root), null, 2) + '\n';
      ext = '.avsc';
      language = 'json';
    } else {
      const isYaml = picked.id === 'openapi-yaml';
      content = serialize(conv.toOpenApi(model, buildsOperation ? root : null), isYaml);
      ext = isYaml ? '.yaml' : '.json';
      language = isYaml ? 'yaml' : 'json';
    }
  } catch (e) {
    const detail = e.message === 'avro-root-not-object' ? nls.t('error.convertNothing') : (e.message || String(e));
    vscode.window.showErrorMessage(nls.t('error.failed', { error: detail }));
    return;
  }
  const doc = await vscode.workspace.openTextDocument({ language, content });
  await vscode.window.showTextDocument(doc, { preview: false });
  await offerSaveConverted(source, content, ext, picked.label);
}

function activate(context) {
  extensionVersion = (context.extension && context.extension.packageJSON &&
    context.extension.packageJSON.version) || '';
  context.subscriptions.push(
    vscode.commands.registerCommand('apiEditor.editGui', (uri) =>
      require('./designerGui').openDesigner(uri)),
    vscode.commands.registerCommand('apiEditor.newContract', () => require('./designerGui').openNewContract()),
    vscode.commands.registerCommand('apiEditor.exportMd', exportMdCommand),
    vscode.commands.registerCommand('apiEditor.convertContract', convertContractCommand),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
