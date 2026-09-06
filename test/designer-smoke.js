const { buildDesignerHtml, createSkeleton } = require('../src/designerGui');

const html = buildDesignerHtml();

const checks = [
  [html.includes("default-src 'none'"), 'CSP default-src none'],
  [!html.includes('http://') && !html.includes('https://') || false, 'no external URLs in webview HTML'],
  [html.includes('acquireVsCodeApi'), 'client script inlined'],
  [!html.includes('${'), 'no template interpolation leftovers'],
  [!/\b(prompt|alert|confirm)\s*\(/.test(html), 'no blocked native dialogs (prompt/alert/confirm)'],
  [html.includes('<html lang="en">'), 'English base without a display language'],
  [html.includes('const NLS = ') && html.includes('const NLS_LANG = '),
    'message catalog injected into the page'],
  [html.includes('function M(key, params)'), 'M() defined in the page'],
  [!html.includes('id="activity"') && !html.includes('id="sidehead"') && !html.includes('Contract explorer'),
    'no icon rail and no panel captions — the tree stands on its own'],
  [html.includes('Filter the tree'), 'tree filter present'],
  [html.includes("if (t.kind === 'operation') {") && html.includes('paramList') &&
    !html.includes("'Operation properties'"),
    'an operation is edited only in the properties panel; the centre column lists its parameters'],
  [html.includes("label: '＋ Add operation'") && !html.includes("'(no tag)'"),
    'the add row says what it adds, and an untagged operation never invents a tag group'],
  [html.includes("title: 'Add a parameter', text: '＋'"), 'parameters can be added — the plus alone, the words in its tooltip'],
  [html.includes('New contract'), 'create-contract view present'],
  [html.includes('Type definitions'), 'type-definitions view present'],
  [html.includes('Standard types') && html.includes('Custom types'), 'standard + custom types sections present'],
  [!html.includes('linkBends') && !html.includes("id: 'dsvg'") && !html.includes("cls: 'card'") &&
    html.includes('＋ Add schema') && html.includes("label: '＋ Add operation'"),
    'class diagram gone (no svg canvas, cards or bends); tree add-rows kept'],
  [html.includes('Expand all') && html.includes('S.treeAll = !S.treeAll') && html.includes('return S.treeAll;'),
    'structure folds to a single switch, everything collapsed by default'],
  [!html.includes('…') && !html.includes('⋯'), 'no ellipsis glyphs in the UI'],
  [html.includes("function methodsFor()") && html.includes("m !== 'TRACE'") &&
    html.includes("function nullableKey() { return isV2() ? 'x-nullable' : 'nullable'; }"),
    'the method list and the nullable keyword follow the dialect'],
  [html.includes('function propsHost(schema)') && html.includes('const fresh = uniquePropName(target);') &&
    !html.includes("properties[''] = { type: 'string' }"),
    'allOf inline fields are edited in place; a new field is never written unnamed'],
  [html.includes('const facets = !xmlDoc;'),
    'an XML contract is offered only the fields its writer can persist'],
  [html.includes('function makeActivatable(n, tag, attrs, onClick)') && html.includes("n.tabIndex = 0;") &&
    html.includes("role: 'treeitem'") && html.includes("role: 'tab'") && html.includes("role: 'switch'"),
    'clickable elements are reachable by keyboard and named for assistive technology'],
  [html.includes('function jsonSame(a, b)') && html.includes('if (src && src.text && jsonSame(node, spanValue(src))) return src.text;'),
    'an untouched JSON subtree is written back byte for byte'],
  [html.includes('function reserializeRoot(origText, rootEl, attrSnapshotBefore)') &&
    html.includes('return { text: reserializeRoot(wsdlOrigText, rootEl, rootAttrs) };') &&
    !html.includes("serializeToString(doc) + '\\n'"),
    'the WSDL envelope is put back the way it was found — prolog, comments and start tag — not re-serialised whole'],
  [html.includes("if (e.getAttribute('nillable') === 'true') p.nullable = true;") && html.includes("' nillable=\"true\"'") && html.includes("label: xmlDoc ? 'nillable' : nullableKey()"),
    'xsd:nillable read, editable and written back'],
  [html.includes("if (docKind !== 'xsd') {") && html.includes("if (spec && docKind !== 'xsd')"),
    'XSD opens straight into the structure — no back button, no contract tab'],
  [html.includes("'Undo'") && html.includes("'Redo'"), 'undo/redo present'],
  [html.includes("if (P.empty && spec && S.propTarget.kind !== 'interface')") &&
    html.includes("panel.className = 'hidden';"),
    'the properties panel never stands empty: it falls back to the contract, and collapses when there is no contract'],
  [html.includes("active: S.propTarget.kind === 'interface',") &&
    html.includes("onClick: function () { selectProps({ kind: 'interface' }); render(); } }));"),
    'the contract row opens the contract settings, the same place the gear opens'],
  [html.includes('id="props"') && html.includes('id="propsreopen"') && html.includes('id="propssettings"'),
    'properties panel present, and the gear is its handle whether it is open or collapsed'],
  [!html.includes("text: 'API Editor'") && html.includes('saveStatus'), 'status bar minimal: file + save state, no brand/format clutter'],
  [html.includes('genSpecButton') && !html.includes('Specification (Word)') && !html.includes('exportDocx'),
    'no Word specification anywhere in the page'],
  [html.includes("function operationActions(operation)") &&
    html.includes("return operationActions({ path: S.selOp.path, method: S.selOp.method });") &&
    html.includes("return operationActions({ name: op.name });") &&
    !html.includes('function opSectionHead('),
    'the per-service md export sits in the panel of the service it acts on, REST and SOAP alike'],
  [html.includes("kind: 'event'") && html.includes("return operationActions({});"),
    'the Avro event carries the same export, in its own panel'],
  [!html.includes("cursor:pointer;text-decoration:underline', text: 'Specyfikacja (Word)"),
    'no interface-level generate link in the status bar'],
  [html.includes('Export to md') && html.includes("type: 'exportMd', operation: operation"),
    'Markdown export action on the operation, beside the specification'],
  [!html.includes('id="cbar"') && !html.includes("{ type: 'importMd' }") &&
    html.includes('function contractActions()') &&
    html.includes("act('Convert schema', { type: 'convertContract' })") &&
    html.includes("act('Export to md', { type: 'exportMd' })") &&
    html.includes('id="propssettings"'),
    'contract-wide actions live only in the settings behind the gear; no action bar, no md import'],
  [html.includes('x-api-editor'), 'layout persistence wired (vendor extension)'],
  [html.includes('Swagger/OpenAPI') && html.includes('WSDL') && html.includes('XSD') && html.includes('Avro'), 'all four contract kinds present'],
  [html.includes('multiplicity') && !html.includes("options: ['association'"), 'multiplicity edited on the attribute; no UML link editor'],
  [html.includes('if (modelsMode || wsdlMeta) renderModelsTree(') && html.includes("onDblClick: function () { openStructure({ kind: 'models' }); }"),
    'WSDL tree keeps the schema section; double click opens the whole model structure'],
  [html.includes('m.xmlIncludes') && html.includes('editableCount: schemaEls.length'),
    'imported XSD schemas loaded into the WSDL/XSD preview'],
  [html.includes("conv.elementType[msg.ns + '|' + msg.name]") && html.includes('o.inputNs') && html.includes('o.outputNs'),
    'request/response resolved through the element namespace (ISO 20022 "Document" disambiguation)'],
  [html.includes('xmlMeta.imported && xmlMeta.imported[n]') && html.includes('importDecls'),
    'imported types excluded from write-back; xsd:import/include declarations preserved'],
  [html.includes("tile('Request', op.inputMsg, op.input, op.inputNs") && html.includes("tile('Response', op.outputMsg, op.output, op.outputNs"),
    'request/response tiles named after the wsdl:message, resolved type as the structure link'],
  [html.includes("'x-xsd-name'") && html.includes('schemaSourceName') && html.includes('schemaSourceNs'),
    'classes display the source tag name from the XSD, namespace as a separate annotation'],
  [html.includes('function isOas31()') && html.includes('exampleOrDel(core)') && html.includes('writeExample(wrapper') && !html.includes("numOrDel(core, 'example')"),
    'example written in the dialect of the open contract (3.0 example / 3.1 examples[])'],
  [html.includes('xchoicelab') && html.includes('choice — exactly one of') && html.includes('choice — at least one of'),
    'choice/oneOf/anyOf labelled in words in the structure'],
  [!html.includes('⟲') && html.includes("'(cycle)'") && !/M1 6 H6 M6 6 C9/.test(html),
    'no cryptic glyphs left in the structure (choice fork, cycle arrow)'],
  [html.includes('pick 1 of'), 'the field list captions the members of a choice']
];

checks[1] = [!html.includes('http://') && !html.includes('https://'), 'no external URLs in webview HTML'];

const polishHtml = buildDesignerHtml('pl-PL');
checks.push([polishHtml.includes('<html lang="en">'), 'a Polish editor still gets the English lang attribute']);
checks.push([polishHtml.includes('Filter the tree') && polishHtml.includes("label: '＋ Add operation'"),
  'English strings for a Polish editor']);
checks.push([polishHtml.includes("'Parameters'") && polishHtml.includes("'Undo'"),
  'English text in the page, whatever the editor language']);
checks.push([polishHtml === html, 'the page does not depend on the editor language']);

const oa = createSkeleton('openapi', { title: 'T', version: '1.0.0', std: '3.0.3', ext: '.yaml' });
checks.push([oa.ext === '.yaml' && /openapi: 3\.0\.3/.test(oa.content) && oa.spec.info.title === 'T', 'openapi 3.x skeleton valid']);
const oa2 = createSkeleton('openapi', { std: '2.0', ext: '.json' });
checks.push([oa2.ext === '.json' && JSON.parse(oa2.content).swagger === '2.0', 'swagger 2.0 skeleton valid']);
const ws = createSkeleton('wsdl', { name: 'CustomerService', ns: 'http://acme.io/customer/v1', version: '1.2' });
checks.push([ws.ext === '.wsdl' && ws.content.includes('wsdl:definitions') && ws.content.includes('CustomerServicePortType') && ws.content.includes('http://acme.io/customer/v1'), 'wsdl skeleton valid']);
const xs = createSkeleton('xsd', { name: 'customer', ns: 'http://acme.io/customer' });
checks.push([xs.ext === '.xsd' && xs.content.includes('xsd:schema') && xs.content.includes('targetNamespace="http://acme.io/customer"'), 'xsd skeleton valid']);
const av = createSkeleton('avro', { name: 'CustomerCreated', ns: 'http://acme.io/events', version: '1.0' });
const avRec = JSON.parse(av.content);
checks.push([av.ext === '.avsc' && avRec.type === 'record' && avRec.name === 'CustomerCreated' &&
  avRec.namespace === 'io.acme.events' && avRec.doc === undefined,
  'avro skeleton: the namespace is derived the same way the converter derives it, and no version is smuggled into doc']);
checks.push([ws.content.includes('<wsdl:binding name="CustomerServiceBinding"') && ws.content.includes('<wsdl:service name="CustomerService">'),
  'wsdl skeleton names an endpoint, not just a portType']);

checks.push([html.includes('function snapshotState()') && html.includes('m.keepState ? snapshotState() : null') && html.includes('function restoreKept('),
  'a reload lays the open view back over the freshly read contract']);
checks.push([html.includes("vscodeApi.postMessage({ type: 'reload' })") && html.includes("'Read the file again'"),
  'the status bar offers an explicit re-read of the file']);

let failed = false;
for (const [ok, name] of checks) {
  if (!ok) { console.error('FAIL: ' + name); failed = true; }
  else console.log('OK: ' + name);
}
process.exit(failed ? 1 : 0);
