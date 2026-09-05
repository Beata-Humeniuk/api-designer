const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { readContract, targetsFor, rootCandidates, toOpenApi, toXsd, toWsdl, toAvro } = require('../src/schemaConvert');

const OPENAPI = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Orders', version: '1.0.0', description: 'Orders' },
  paths: {},
  components: {
    schemas: {
      Order: {
        type: 'object',
        description: 'An order',
        required: ['id', 'lines', 'created'],
        properties: {
          id: { type: 'string', description: 'Identyfikator' },
          created: { type: 'string', format: 'date-time' },
          amount: { type: 'number' },
          count: { type: 'integer', format: 'int32' },
          note: { type: 'string', nullable: true },
          status: { $ref: '#/components/schemas/Status' },
          lines: { type: 'array', items: { $ref: '#/components/schemas/LineItem' }, minItems: 1 },
          shipping: {
            type: 'object',
            properties: { street: { type: 'string' }, zip: { type: 'string', pattern: '[0-9]{2}-[0-9]{3}' } },
            required: ['street']
          }
        }
      },
      LineItem: {
        type: 'object',
        required: ['sku', 'quantity'],
        properties: { sku: { type: 'string', maxLength: 32 }, quantity: { type: 'integer' } }
      },
      Status: { type: 'string', enum: ['NEW', 'PAID', 'SHIPPED'], 'x-enum-descriptions': ['new', '', ''] }
    }
  }
});

const XSD = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema" targetNamespace="http://acme.io/customer" xmlns:tns="http://acme.io/customer" elementFormDefault="qualified">',
  '  <xsd:element name="CustomerMsg" type="tns:Customer"/>',
  '  <xsd:complexType name="Customer">',
  '    <xsd:annotation><xsd:documentation>A customer</xsd:documentation></xsd:annotation>',
  '    <xsd:sequence>',
  '      <xsd:element name="id" type="xsd:string"/>',
  '      <xsd:element name="tier" type="tns:TierType" minOccurs="0" nillable="true"/>',
  '      <xsd:element name="accounts" type="xsd:string" maxOccurs="unbounded"/>',
  '      <xsd:element name="address" minOccurs="0">',
  '        <xsd:complexType>',
  '          <xsd:sequence>',
  '            <xsd:element name="city" type="xsd:string"/>',
  '            <xsd:element name="zip" type="xsd:string" minOccurs="0"/>',
  '          </xsd:sequence>',
  '        </xsd:complexType>',
  '      </xsd:element>',
  '    </xsd:sequence>',
  '  </xsd:complexType>',
  '  <xsd:simpleType name="TierType">',
  '    <xsd:restriction base="xsd:string">',
  '      <xsd:enumeration value="GOLD"/>',
  '      <xsd:enumeration value="SILVER"/>',
  '    </xsd:restriction>',
  '  </xsd:simpleType>',
  '</xsd:schema>'
].join('\n');

const WSDL = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<wsdl:definitions name="CustomerService" targetNamespace="http://acme.io/svc"',
  '    xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="http://acme.io/svc"',
  '    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
  '  <wsdl:types>',
  '    <xsd:schema targetNamespace="http://acme.io/svc">',
  '      <xsd:element name="GetCustomerRequest" type="tns:GetCustomerRequest"/>',
  '      <xsd:element name="GetCustomerResponse" type="tns:GetCustomerResponse"/>',
  '      <xsd:complexType name="GetCustomerRequest">',
  '        <xsd:sequence><xsd:element name="id" type="xsd:string"/></xsd:sequence>',
  '      </xsd:complexType>',
  '      <xsd:complexType name="GetCustomerResponse">',
  '        <xsd:sequence><xsd:element name="name" type="xsd:string"/></xsd:sequence>',
  '      </xsd:complexType>',
  '      <xsd:complexType name="CustomerFault">',
  '        <xsd:sequence><xsd:element name="code" type="xsd:int"/></xsd:sequence>',
  '      </xsd:complexType>',
  '    </xsd:schema>',
  '  </wsdl:types>',
  '  <wsdl:message name="GetCustomerIn"><wsdl:part name="body" element="tns:GetCustomerRequest"/></wsdl:message>',
  '  <wsdl:message name="GetCustomerOut"><wsdl:part name="body" element="tns:GetCustomerResponse"/></wsdl:message>',
  '  <wsdl:message name="GetCustomerErr"><wsdl:part name="body" element="tns:CustomerFault"/></wsdl:message>',
  '  <wsdl:portType name="CustomerPort">',
  '    <wsdl:operation name="GetCustomer">',
  '      <wsdl:documentation>Returns a customer</wsdl:documentation>',
  '      <wsdl:input message="tns:GetCustomerIn"/>',
  '      <wsdl:output message="tns:GetCustomerOut"/>',
  '      <wsdl:fault name="notFound" message="tns:GetCustomerErr"/>',
  '    </wsdl:operation>',
  '  </wsdl:portType>',
  '</wsdl:definitions>'
].join('\n');

const AVRO = JSON.stringify({
  type: 'record',
  name: 'OrderPlaced',
  namespace: 'io.acme.events',
  doc: 'Order event',
  fields: [
    { name: 'orderId', type: 'string' },
    { name: 'total', type: 'double' },
    { name: 'note', type: ['null', 'string'], default: null },
    { name: 'tier', type: { type: 'enum', name: 'Tier', symbols: ['GOLD', 'SILVER'] } },
    {
      name: 'lines',
      type: {
        type: 'array',
        items: {
          type: 'record', name: 'Line',
          fields: [{ name: 'sku', type: 'string' }, { name: 'qty', type: 'int' }]
        }
      }
    }
  ]
});

assert.deepStrictEqual(targetsFor('swagger'), ['wsdl', 'xsd', 'avro']);

const oa = readContract(OPENAPI, 'orders.json');
assert.strictEqual(oa.kind, 'openapi');
assert.deepStrictEqual(rootCandidates(oa), ['Order'], 'the unreferenced type is the root');
const avro = toAvro(oa, 'Order');
assert.strictEqual(avro.type, 'record');
assert.strictEqual(avro.name, 'Order');
assert.strictEqual(avro.doc, 'An order');
const byName = {};
avro.fields.forEach((f) => { byName[f.name] = f; });
assert.strictEqual(byName.id.type, 'string', 'required scalar stays plain');
assert.deepStrictEqual(byName.created.type, { type: 'long', logicalType: 'timestamp-millis' });
assert.deepStrictEqual(byName.amount.type, ['null', 'double'], 'optional scalar → union with null');
assert.deepStrictEqual(byName.count.type, ['null', 'int'], 'int32 narrows to int');
assert.deepStrictEqual(byName.note.type, ['null', 'string'], 'optional+nullable → union with null');
assert.strictEqual(byName.note.default, null);
assert.deepStrictEqual(byName.status.type, ['null', { type: 'enum', name: 'Status', symbols: ['NEW', 'PAID', 'SHIPPED'] }]);
assert.strictEqual(byName.lines.type.type, 'array');
assert.strictEqual(byName.lines.type.items.name, 'LineItem', 'referenced type becomes a named record');
assert.strictEqual(byName.shipping.type[1].type, 'record', 'inline object hoisted to a named record');
assert.strictEqual(byName.shipping.type[1].name, 'Shipping');

const xsdOut = toXsd(oa);
assert.ok(xsdOut.indexOf('<xs:schema') >= 0);
const reread = readContract(xsdOut, 'orders.xsd');
assert.strictEqual(reread.kind, 'xsd');
const order = reread.schemas.Order;
assert.ok(order, 'Order survives the roundtrip');
assert.deepStrictEqual(order.required, ['id', 'created'], 'required fields survive');
assert.strictEqual(order.properties.note.nullable, true, 'nullable → nillable → nullable');
assert.strictEqual(order.properties.lines.type, 'array', 'maxOccurs=unbounded read back as array');
assert.strictEqual(order.properties.lines.minItems, 1, 'a required array carries minItems, the reader convention');
assert.deepStrictEqual(reread.schemas.Status.enum, ['NEW', 'PAID', 'SHIPPED'], 'enum survives');
assert.deepStrictEqual(reread.schemas.Status['x-enum-descriptions'], ['new', '', ''], 'enum meanings survive');
assert.ok(reread.schemas.Shipping, 'inline object emitted, hoisted back by the reader');
assert.strictEqual(reread.schemas.Shipping.properties.zip.pattern, '[0-9]{2}-[0-9]{3}', 'pattern survives');
assert.strictEqual(reread.schemas.LineItem.properties.sku.maxLength, 32, 'maxLength survives');

const xm = readContract(XSD, 'customer.xsd');
assert.strictEqual(xm.kind, 'xsd');
const doc = toOpenApi(xm);
assert.strictEqual(doc.openapi, '3.0.3');
assert.ok(doc.components.schemas.Customer);
assert.deepStrictEqual(doc.components.schemas.Customer.required, ['id']);
assert.strictEqual(doc.components.schemas.Customer.properties.tier.$ref, '#/components/schemas/TierType');
assert.strictEqual(doc.components.schemas.Customer.properties.accounts.type, 'array');
assert.strictEqual(doc.components.schemas.Customer.properties.accounts.minItems, 1);

assert.deepStrictEqual(rootCandidates(xm), ['Customer']);
const avroFromXsd = toAvro(xm, 'Customer');
assert.strictEqual(avroFromXsd.name, 'Customer');
assert.strictEqual(avroFromXsd.namespace, 'io.acme.customer', 'URI namespace → reversed-host dotted form');
const xf = {};
avroFromXsd.fields.forEach((f) => { xf[f.name] = f; });
assert.deepStrictEqual(xf.tier.type, ['null', { type: 'enum', name: 'TierType', symbols: ['GOLD', 'SILVER'] }]);
assert.strictEqual(xf.accounts.type.type, 'array');
assert.strictEqual(xf.address.type[1].name, 'Address', 'hoisted inline type becomes a record');

const wm = readContract(WSDL, 'customer.wsdl');
assert.strictEqual(wm.kind, 'wsdl');
const rest = toOpenApi(wm);
const post = rest.paths['/GetCustomer'].post;
assert.strictEqual(post.operationId, 'GetCustomer');
assert.strictEqual(post.summary, 'Returns a customer');
assert.strictEqual(post.requestBody.content['application/json'].schema.$ref, '#/components/schemas/GetCustomerRequest');
assert.strictEqual(post.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/GetCustomerResponse');
assert.strictEqual(post.responses['500'].content['application/json'].schema.$ref, '#/components/schemas/CustomerFault');
assert.ok(rest.components.schemas.GetCustomerRequest);

const am = readContract(AVRO, 'order-placed.avsc');
assert.strictEqual(am.kind, 'avro');
const fromAvro = toOpenApi(am);
const placed = fromAvro.components.schemas.OrderPlaced;
assert.ok(placed, 'root record present');
assert.deepStrictEqual(placed.required, ['orderId', 'total', 'tier', 'lines'], 'null union drops from required');
assert.strictEqual(placed.properties.lines.type, 'array');
assert.strictEqual(placed.properties.lines.items.$ref, '#/components/schemas/Line');
assert.deepStrictEqual(fromAvro.components.schemas.Tier.enum, ['GOLD', 'SILVER']);

assert.deepStrictEqual(rootCandidates(am), ['OrderPlaced'], 'avro model keeps its root');
const xsdFromAvro = toXsd(am);
const rereadAvro = readContract(xsdFromAvro, 'order-placed.xsd');
assert.ok(rereadAvro.schemas.OrderPlaced);
assert.ok(rereadAvro.schemas.Line);
assert.deepStrictEqual(rereadAvro.schemas.Tier.enum, ['GOLD', 'SILVER']);
assert.strictEqual(rereadAvro.elementType.OrderPlaced, 'OrderPlaced', 'root element declared');

const petstore = fs.readFileSync(path.join(__dirname, 'petstore-swagger2.json'), 'utf8');
const sm = readContract(petstore, 'petstore-swagger2.json');
assert.strictEqual(sm.kind, 'swagger');
assert.ok(Object.keys(sm.schemas).length > 0, 'definitions read');
assert.strictEqual(JSON.stringify(sm.schemas).indexOf('#/definitions/'), -1, 'no swagger-2 refs left');
const petRoots = rootCandidates(sm);
assert.ok(petRoots.length > 0, 'petstore has a root candidate');
toXsd(sm);
toAvro(sm, petRoots[0]);

const recursive = readContract(JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Tree', version: '1' },
  paths: {},
  components: {
    schemas: {
      Node: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          children: { type: 'array', items: { $ref: '#/components/schemas/Node' } }
        }
      }
    }
  }
}), 'tree.json');
const tree = toAvro(recursive, 'Node');
const children = tree.fields.find((f) => f.name === 'children');
assert.strictEqual(children.type[1].items, 'Node', 'recursive ref is a name, not a copy');

const eventModel = readContract(JSON.stringify({
  type: 'record',
  name: 'OrderPlaced',
  namespace: 'shop.orders',
  fields: [
    { name: 'orderId', type: 'string' },
    { name: 'total', type: 'double' }
  ]
}), 'order-placed.avsc');

const fromEvent = toOpenApi(eventModel, 'OrderPlaced');
const eventPaths = Object.keys(fromEvent.paths);
assert.strictEqual(eventPaths.length, 1, 'an event becomes a contract with exactly one operation');
assert.deepStrictEqual(Object.keys(fromEvent.paths[eventPaths[0]]), ['get'],
  'that one operation is a GET');
assert.strictEqual(eventPaths[0], '/order-placed', 'the path is named after the object');
assert.strictEqual(
  fromEvent.paths[eventPaths[0]].get.responses['200'].content['application/json'].schema.$ref,
  '#/components/schemas/OrderPlaced',
  'the object is the response of that GET');

assert.strictEqual(Object.keys(toOpenApi(eventModel, null).paths).length, 0,
  'without a chosen object no operation is invented');

const twoRoots = readContract(JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Two', version: '1' },
  paths: {},
  components: {
    schemas: {
      Alpha: { type: 'object', properties: { a: { type: 'string' } } },
      Beta: { type: 'object', properties: { b: { type: 'string' } } }
    }
  }
}), 'two.json');
const narrowed = toXsd(twoRoots, 'Beta');
assert.ok(narrowed.includes('<xs:element name="Beta"'), 'the chosen object is the root element');
assert.ok(!narrowed.includes('<xs:element name="Alpha" type='),
  'the object that was not chosen is not a root element');
assert.ok(narrowed.includes('<xs:complexType name="Alpha">'),
  'every type is still declared — only the root element narrows');

const anchored = toXsd(readContract(JSON.stringify({
  openapi: '3.0.3', info: { title: 'A', version: '1' }, paths: {},
  components: { schemas: { Line: { type: 'object', properties: { sku: { type: 'string', pattern: '^[A-Z0-9-]{3,20}$' } } } } }
}), 'a.json'), 'Line');
assert.ok(anchored.includes('<xs:pattern value="[A-Z0-9-]{3,20}"/>'),
  'the ^ and $ of a JSON Schema pattern are not carried into xs:pattern, where they are literal characters');
assert.ok(!anchored.includes('elementFormDefault'),
  'no elementFormDefault without a targetNamespace to qualify into');

const choiceModel = {
  kind: 'wsdl', name: 'P', namespace: '', documentation: '', schemas: {
    Pay: {
      type: 'object', required: ['Header', 'Card', 'Account'],
      'x-xsd-choice': [['Card', 'Account']],
      properties: { Header: { type: 'string' }, Card: { type: 'string' }, Account: { type: 'string' } }
    }
  }
};
const converted = toOpenApi(choiceModel, null).components.schemas.Pay;
assert.deepStrictEqual(converted.required, ['Header'], 'choice members leave the required list');
assert.deepStrictEqual(converted.oneOf, [{ required: ['Card'] }, { required: ['Account'] }],
  'a choice becomes a oneOf of required-lists, not "all of them required"');

const union = toAvro(readContract(JSON.stringify({
  openapi: '3.0.3', info: { title: 'P', version: '1' }, paths: {},
  components: {
    schemas: {
      Payment: { type: 'object', required: ['instrument'], properties: { instrument: { oneOf: [{ $ref: '#/components/schemas/Card' }, { $ref: '#/components/schemas/Bank' }] } } },
      Card: { type: 'object', properties: { pan: { type: 'string' } } },
      Bank: { type: 'object', properties: { iban: { type: 'string' } } }
    }
  }
}), 'p.json'), 'Payment');
const instrument = union.fields.find((f) => f.name === 'instrument');
assert.ok(Array.isArray(instrument.type) && instrument.type.length === 2,
  'a oneOf property becomes an Avro union, not a string');
assert.deepStrictEqual(instrument.type.map((t) => t.name), ['Card', 'Bank'],
  'both variant records survive the conversion');

console.log('PASS: schema conversion ok (OpenAPI ⇄ XSD ⇄ Avro, WSDL → OpenAPI/Avro, one object → one GET)');

const wsdlFromRest = toWsdl(readContract(JSON.stringify({
  openapi: '3.0.3', info: { title: 'Orders API', version: '1' },
  paths: {
    '/orders': { post: { operationId: 'createOrder', summary: 'Place an order',
      requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderRequest' } } } },
      responses: {
        '201': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderCreated' } } } },
        '400': { description: 'bad', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
      } } },
    '/orders/{id}': { get: { operationId: 'getOrder',
      responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } } } } }
  },
  components: { schemas: {
    OrderRequest: { type: 'object', properties: { sku: { type: 'string' } } },
    OrderCreated: { type: 'object', properties: { id: { type: 'string' } } },
    Order: { type: 'object', properties: { id: { type: 'string' } } },
    Error: { type: 'object', properties: { code: { type: 'string' } } }
  } }
}), 'orders.json'), null);

assert.ok(wsdlFromRest.startsWith('<?xml'), 'the WSDL carries one XML declaration');
assert.strictEqual((wsdlFromRest.match(/<\?xml/g) || []).length, 1,
  'the inlined schema does not bring a second declaration');
assert.ok(wsdlFromRest.includes('<wsdl:operation name="CreateOrder">'), 'an operation per endpoint');
assert.ok(wsdlFromRest.includes('<wsdl:operation name="GetOrder">'), 'including the one with no request body');
assert.ok(wsdlFromRest.includes('<wsdl:part name="parameters" element="tns:OrderRequest"/>'),
  'the request message carries the request element');
assert.ok(wsdlFromRest.includes('<wsdl:part name="parameters" element="tns:GetOrderRequest"/>'),
  'an operation with no body of its own gets an empty request wrapper, not a message without a part');
assert.ok(wsdlFromRest.includes('<wsdl:fault name="fault" message="tns:CreateOrderFault"/>'),
  'an error response becomes a fault');
assert.ok(wsdlFromRest.includes('<wsdl:binding name="OrdersAPIBinding"') &&
  wsdlFromRest.includes('<wsdl:service name="OrdersAPI">') &&
  wsdlFromRest.includes('<soap:address location='),
  'the WSDL names an endpoint: binding, service and address');

const wsdlFromEvent = toWsdl(readContract(JSON.stringify({
  type: 'record', name: 'OrderPlaced', namespace: 'shop.orders',
  fields: [{ name: 'orderId', type: 'string' }]
}), 'order-placed.avsc'), 'OrderPlaced');
assert.ok(wsdlFromEvent.includes('<wsdl:operation name="GetOrderPlaced">'),
  'a source with no operations becomes a service with exactly one');
assert.ok(wsdlFromEvent.includes('element="tns:OrderPlaced"'), 'answering with the chosen object');

assert.deepStrictEqual(targetsFor('openapi'), ['wsdl', 'xsd', 'avro'], 'every family reaches every other one');
assert.deepStrictEqual(targetsFor('wsdl'), ['openapi', 'xsd', 'avro']);
assert.deepStrictEqual(targetsFor('xsd'), ['openapi', 'wsdl', 'avro']);
assert.deepStrictEqual(targetsFor('avro'), ['openapi', 'wsdl', 'xsd']);

console.log('PASS: WSDL is a target, with messages, faults, a binding and a service');
