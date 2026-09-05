# Changelog

Notable changes to API Designer. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

First public release.

### Added

- **Visual editor** for Swagger 2.0, OpenAPI 3.x, WSDL, XSD and Avro (`.avsc`),
  available from the editor title bar, context menu and Command Palette.
- **Contract tree** with filtering, operations grouped by tag, models and type definitions.
- **Collapsible schema view** showing field types, multiplicities, enums,
  inheritance and alternatives, with undo and redo.
- **Properties panel** for editing contract details, operations, requests,
  responses, parameters, schemas, fields and custom types.
- **Source editing** in the contract's original format. OpenAPI and Swagger
  use a consistent field order; WSDL, XSD and Avro preserve unrelated content
  and formatting.
- **New contract** templates for Swagger, OpenAPI, WSDL, XSD and Avro.
- **Paste a schema** from JSON, XML, a data sample or an XSD fragment,
  with inferred types and nullability.
- **Markdown export** for one operation or the whole contract, including
  metadata, operations grouped by tag, parameter constraints, response codes
  with descriptions and model tables.
- **Schema conversion** between all four formats: every contract can be
  converted to OpenAPI, WSDL, XSD or Avro. Operations travel where the target
  has them — an OpenAPI operation becomes a WSDL operation with request,
  response and fault messages, and a WSDL operation becomes a POST endpoint.
  A source without operations receives exactly one. Alternatives map to the
  target format, such as XSD `choice` to OpenAPI `oneOf`, or `oneOf`
  properties to Avro unions.

[1.0.0]: https://github.com/Beata-Humeniuk/api-designer/releases/tag/v1.0.0
