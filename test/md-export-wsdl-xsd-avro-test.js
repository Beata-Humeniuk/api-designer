const assert = require('assert');
const { parseXmlContract, isAvroSpec, avroToModel, wsdlOperationModel } = require('../src/wsdlXsdAvro');
const { modelToMarkdown } = require('../src/mdExport');

const WSDL = `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions name="OrderService"
    targetNamespace="http://example.com/orders"
    xmlns:tns="http://example.com/orders"
    xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <wsdl:documentation>Order service — test version</wsdl:documentation>
  <wsdl:types>
    <xsd:schema targetNamespace="http://example.com/orders" elementFormDefault="qualified">
      <xsd:element name="GetOrderRequest" type="tns:GetOrderRequestType"/>
      <xsd:element name="GetOrderResponse" type="tns:OrderType"/>
      <xsd:element name="OrderFault" type="tns:FaultType"/>
      <xsd:complexType name="GetOrderRequestType">
        <xsd:sequence>
          <xsd:element name="orderId" type="xsd:string">
            <xsd:annotation><xsd:documentation>Order identifier</xsd:documentation></xsd:annotation>
          </xsd:element>
        </xsd:sequence>
      </xsd:complexType>
      <xsd:complexType name="OrderType">
        <xsd:sequence>
          <xsd:element name="orderId" type="xsd:string"/>
          <xsd:element name="status" type="tns:StatusType"/>
          <xsd:element name="note" type="xsd:string" nillable="true"/>
          <xsd:element name="lines" type="tns:OrderLineType" minOccurs="0" maxOccurs="unbounded"/>
        </xsd:sequence>
        <xsd:attribute name="version" type="xsd:int" use="required"/>
      </xsd:complexType>
      <xsd:complexType name="OrderLineType">
        <xsd:sequence>
          <xsd:element name="sku" type="xsd:string"/>
          <xsd:element name="quantity" type="xsd:int"/>
        </xsd:sequence>
      </xsd:complexType>
      <xsd:complexType name="FaultType">
        <xsd:sequence>
          <xsd:element name="code" type="xsd:string"/>
        </xsd:sequence>
      </xsd:complexType>
      <xsd:simpleType name="StatusType">
        <xsd:restriction base="xsd:string">
          <xsd:enumeration value="NEW"/>
          <xsd:enumeration value="SHIPPED"/>
        </xsd:restriction>
      </xsd:simpleType>
    </xsd:schema>
  </wsdl:types>
  <wsdl:message name="GetOrderIn"><wsdl:part name="body" element="tns:GetOrderRequest"/></wsdl:message>
  <wsdl:message name="GetOrderOut"><wsdl:part name="body" element="tns:GetOrderResponse"/></wsdl:message>
  <wsdl:message name="GetOrderFault"><wsdl:part name="body" element="tns:OrderFault"/></wsdl:message>
  <wsdl:portType name="OrderPortType">
    <wsdl:operation name="GetOrder">
      <wsdl:documentation>Fetches an order by identifier</wsdl:documentation>
      <wsdl:input message="tns:GetOrderIn"/>
      <wsdl:output message="tns:GetOrderOut"/>
      <wsdl:fault name="notFound" message="tns:GetOrderFault"/>
    </wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="OrderBinding" type="tns:OrderPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
  </wsdl:binding>
</wsdl:definitions>`;

const wsdlModel = parseXmlContract(WSDL, 'order-service.wsdl');
assert.ok(wsdlModel && wsdlModel.kind === 'wsdl', 'WSDL detected');
assert.strictEqual(wsdlModel.name, 'OrderService');
assert.strictEqual(wsdlModel.protocol, 'SOAP 1.1');
assert.strictEqual(wsdlModel.operations.length, 1);
const op = wsdlModel.operations[0];
assert.strictEqual(op.name, 'GetOrder');
assert.strictEqual(op.input, 'GetOrderRequestType');
assert.strictEqual(op.output, 'OrderType');
assert.strictEqual(op.faults[0].className, 'FaultType');
assert.ok(wsdlModel.schemas.OrderType, 'OrderType schema from the types section');
assert.strictEqual(wsdlModel.schemas.OrderType.properties.note.nullable, true,
  'xsd:nillable read as nullable');
assert.ok(wsdlModel.schemas.StatusType.enum.includes('SHIPPED'), 'enum from simpleType');

const wsdlMd = modelToMarkdown(wsdlModel);
assert.ok(wsdlMd.startsWith('# OrderService'), 'title from the service name');
assert.ok(wsdlMd.includes('| Format | WSDL 1.1 |'), 'format in metadata');
assert.ok(wsdlMd.includes('| Protocol | SOAP 1.1 |'), 'protocol in metadata');
assert.ok(wsdlMd.includes('Order service — test version'), 'service documentation');
assert.ok(wsdlMd.includes('## Operations'), 'operations section');
assert.ok(wsdlMd.includes('### `GetOrder`'), 'operation heading');
assert.ok(wsdlMd.includes('- input: [GetOrderRequestType](#getorderrequesttype)'), 'input link');
assert.ok(wsdlMd.includes('- output: [OrderType](#ordertype)'), 'output link');
assert.ok(wsdlMd.includes('- fault (`notFound`): [FaultType](#faulttype)'), 'fault');
assert.ok(wsdlMd.includes('## Data model'), 'data model section');
assert.ok(wsdlMd.includes('### OrderType'), 'OrderType class');
assert.ok(wsdlMd.includes('| lines | [OrderLineType](#orderlinetype)[] |'), 'array from maxOccurs');
assert.ok(wsdlMd.includes('| version | integer | yes |'), 'required attribute (use=required)');
assert.ok(wsdlMd.includes('| NEW |'), 'enum values in the simple type table');
assert.ok(wsdlMd.includes('Order identifier'), 'field documentation');
const WSDL2 = WSDL
  .replace('</xsd:schema>',
    '<xsd:element name="CancelRequest" type="tns:CancelType"/>' +
    '<xsd:element name="CancelResponse" type="tns:CancelResultType"/>' +
    '<xsd:complexType name="CancelType"><xsd:sequence>' +
    '<xsd:element name="orderId" type="xsd:string"/></xsd:sequence></xsd:complexType>' +
    '<xsd:complexType name="CancelResultType"><xsd:sequence>' +
    '<xsd:element name="ok" type="xsd:boolean"/></xsd:sequence></xsd:complexType>' +
    '</xsd:schema>')
  .replace('<wsdl:portType',
    '<wsdl:message name="CancelIn"><wsdl:part name="body" element="tns:CancelRequest"/></wsdl:message>' +
    '<wsdl:message name="CancelOut"><wsdl:part name="body" element="tns:CancelResponse"/></wsdl:message>' +
    '<wsdl:portType')
  .replace('</wsdl:portType>',
    '<wsdl:operation name="Cancel"><wsdl:documentation>Cancels an order</wsdl:documentation>' +
    '<wsdl:input message="tns:CancelIn"/><wsdl:output message="tns:CancelOut"/>' +
    '</wsdl:operation></wsdl:portType>');

const twoOps = parseXmlContract(WSDL2, 'order-service.wsdl');
assert.strictEqual(twoOps.operations.length, 2, 'both operations in the whole contract');

const cancelOnly = wsdlOperationModel(twoOps, 'Cancel');
assert.strictEqual(cancelOnly.operations.length, 1, 'model narrowed to one operation');
assert.strictEqual(cancelOnly.operations[0].name, 'Cancel');
assert.ok(cancelOnly.schemas.CancelType && cancelOnly.schemas.CancelResultType, 'schemas of this operation stay');
assert.ok(!cancelOnly.schemas.OrderType && !cancelOnly.schemas.StatusType, 'sibling schemas drop out');
assert.strictEqual(cancelOnly.name, 'OrderService', 'service identity unchanged');

const getOnly = wsdlOperationModel(twoOps, 'GetOrder');
assert.ok(getOnly.schemas.OrderType && getOnly.schemas.OrderLineType && getOnly.schemas.StatusType &&
  getOnly.schemas.FaultType, 'the other operation carries its own schemas (incl. fault and nested)');
assert.ok(!getOnly.schemas.CancelType, 'and nothing more');
assert.strictEqual(wsdlOperationModel(twoOps, 'Nonexistent'), null, 'unknown operation -> null');

const cancelMd = modelToMarkdown(cancelOnly);
assert.ok(cancelMd.includes('### `Cancel`') && !cancelMd.includes('### `GetOrder`'), 'md describes only the chosen operation');

console.log('PASS: wsdl -> markdown ok (whole contract + single operation)');

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:tns="http://example.com/customer"
    targetNamespace="http://example.com/customer" elementFormDefault="qualified">
  <xs:element name="Customer" type="tns:CustomerType"/>
  <xs:complexType name="CustomerType">
    <xs:complexContent>
      <xs:extension base="tns:PartyType">
        <xs:sequence>
          <xs:element name="email" type="xs:string" minOccurs="0"/>
          <xs:element name="segment" type="tns:SegmentType"/>
        </xs:sequence>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>
  <xs:complexType name="PartyType">
    <xs:sequence>
      <xs:element name="name" type="xs:string"/>
      <xs:element name="createdAt" type="xs:dateTime"/>
    </xs:sequence>
  </xs:complexType>
  <xs:simpleType name="SegmentType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="RETAIL"><xs:annotation><xs:documentation>Retail customer</xs:documentation></xs:annotation></xs:enumeration>
      <xs:enumeration value="CORPO"><xs:annotation><xs:documentation>Corporate customer</xs:documentation></xs:annotation></xs:enumeration>
    </xs:restriction>
  </xs:simpleType>
  <xs:simpleType name="NationalId">
    <xs:restriction base="xs:string">
      <xs:pattern value="[0-9]{11}"/>
      <xs:maxLength value="11"/>
    </xs:restriction>
  </xs:simpleType>
</xs:schema>`;

const xsdModel = parseXmlContract(XSD, 'customer.xsd');
assert.ok(xsdModel && xsdModel.kind === 'xsd', 'XSD detected');
assert.strictEqual(xsdModel.name, 'customer');
assert.deepStrictEqual(xsdModel.elementType, { Customer: 'CustomerType' });
assert.ok(xsdModel.schemas.CustomerType.allOf, 'inheritance from extension base');

const xsdMd = modelToMarkdown(xsdModel);
assert.ok(xsdMd.startsWith('# customer'), 'title from the file name');
assert.ok(xsdMd.includes('| Format | XSD |'), 'format in metadata');
assert.ok(xsdMd.includes('| Namespace | http://example.com/customer |'), 'namespace');
assert.ok(xsdMd.includes('## Root elements'), 'elements section');
assert.ok(xsdMd.includes('| Customer | [CustomerType](#customertype) |'), 'element -> type');
assert.ok(xsdMd.includes('- inherits from: [PartyType](#partytype)'), 'inheritance');
assert.ok(xsdMd.includes('| email | string | no |'), 'optional field (minOccurs=0)');
assert.ok(xsdMd.includes('| createdAt | string (date-time) |'), 'dateTime mapping');
assert.ok(xsdMd.includes('| RETAIL | Retail customer |'), 'enum with descriptions');
assert.ok(xsdMd.includes('pattern: `[0-9]{11}`'), 'simple type pattern');
console.log('PASS: xsd -> markdown ok');

const byContent = parseXmlContract(XSD, 'customer.xml');
assert.ok(byContent && byContent.kind === 'xsd', 'XSD in a .xml file detected by content');

assert.strictEqual(parseXmlContract('<root><a>1</a></root>', 'data.xml'), null);

const AVRO = {
  type: 'record',
  name: 'OrderPlaced',
  namespace: 'com.example.orders',
  doc: 'Order placed event',
  fields: [
    { name: 'orderId', type: 'string', doc: 'Order identifier' },
    { name: 'amount', type: 'double' },
    { name: 'note', type: ['null', 'string'] },
    { name: 'status', type: { type: 'enum', name: 'OrderStatus', symbols: ['NEW', 'PAID'] } },
    { name: 'lines', type: { type: 'array', items: { type: 'record', name: 'OrderLine', fields: [
      { name: 'sku', type: 'string' },
      { name: 'quantity', type: 'int' }
    ] } } }
  ]
};

assert.ok(isAvroSpec(AVRO), 'Avro schema recognized');
assert.ok(!isAvroSpec({ openapi: '3.0.0' }), 'OpenAPI is not Avro');
const avroModel = avroToModel(AVRO);
assert.strictEqual(avroModel.kind, 'avro');
assert.ok(avroModel.schemas.OrderPlaced && avroModel.schemas.OrderLine && avroModel.schemas.OrderStatus);

const avroMd = modelToMarkdown(avroModel);
assert.ok(avroMd.startsWith('# OrderPlaced'), 'title from the record name');
assert.ok(avroMd.includes('| Format | Avro |'), 'format in metadata');
assert.ok(avroMd.includes('| Namespace | com.example.orders |'), 'namespace');
assert.ok(avroMd.includes('Order placed event'), 'record doc');
const rootIdx = avroMd.indexOf('### OrderPlaced');
const lineIdx = avroMd.indexOf('### OrderLine');
assert.ok(rootIdx >= 0 && lineIdx > rootIdx, 'root record before nested ones');
assert.ok(avroMd.includes('| note | string | no |'), 'union with null -> optional field');
assert.ok(avroMd.includes('| status | [OrderStatus](#orderstatus) | yes |'), 'enum as a separate type');
assert.ok(avroMd.includes('| lines | [OrderLine](#orderline)[] | yes |'), 'array of records');
assert.ok(avroMd.includes('| NEW |'), 'enum values');
console.log('PASS: avro -> markdown ok');

const CHOICE_XSD = `<?xml version="1.0"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:tns="urn:example:id" targetNamespace="urn:example:id">
  <xsd:element name="Identify" type="tns:IdentifyType"/>
  <xsd:complexType name="IdentifyType">
    <xsd:sequence>
      <xsd:element name="customerId" type="xsd:string"/>
      <xsd:choice>
        <xsd:element name="taxId" type="xsd:string"/>
        <xsd:element name="idCard" type="xsd:string"/>
      </xsd:choice>
    </xsd:sequence>
  </xsd:complexType>
</xsd:schema>`;

const choiceModel = parseXmlContract(CHOICE_XSD, 'identify.xsd');
assert.deepStrictEqual(choiceModel.schemas.IdentifyType['x-xsd-choice'], [['taxId', 'idCard']], 'choice group kept in the model');
const choiceMd = modelToMarkdown(choiceModel);
assert.ok(choiceMd.includes('- choice — exactly one of: `taxId`, `idCard`'), 'choice spelled out above the field table');
assert.ok(/\| taxId \|[^\n]*\| choice: 1 of 2 \|/.test(choiceMd), 'every alternative tagged in its row');
assert.ok(/\| customerId \|[^\n]*\|  \|/.test(choiceMd), 'ordinary fields keep an empty constraints cell');
console.log('PASS: choice -> markdown ok');

console.log('PASS: markdown export (wsdl/xsd/avro) ok');
