# Changelog

## [1.19.0](https://github.com/Sowiedu/Edict/compare/v1.18.0...v1.19.0) (2026-03-14)


### Features

* **mcp:** bundle schema snippet with edict_examples response ([#175](https://github.com/Sowiedu/Edict/issues/175)) ([0bf02d8](https://github.com/Sowiedu/Edict/commit/0bf02d8476d090c11a90ef91d92842a1ce39baf4))

## [1.18.0](https://github.com/Sowiedu/Edict/compare/v1.17.0...v1.18.0) (2026-03-14)


### Features

* **compact:** auto-inject default empty arrays for variant and fn nodes ([#176](https://github.com/Sowiedu/Edict/issues/176)) ([5503c9f](https://github.com/Sowiedu/Edict/commit/5503c9f5f07ea5ddccaaa9e661b4da00dcb97edb))
* **schema:** add kind enum constraints to discriminated union definitions ([#177](https://github.com/Sowiedu/Edict/issues/177)) ([1daf28d](https://github.com/Sowiedu/Edict/commit/1daf28def519daa59624f2254b948d12fb3ea55f))

## [1.17.0](https://github.com/Sowiedu/Edict/compare/v1.16.1...v1.17.0) (2026-03-14)


### Features

* **codegen:** complete IR pipeline switchover ([#162](https://github.com/Sowiedu/Edict/issues/162)) ([54eade3](https://github.com/Sowiedu/Edict/commit/54eade3b3df891c1e48ffad19d647b778ad992b1))

## [1.16.1](https://github.com/Sowiedu/Edict/compare/v1.16.0...v1.16.1) (2026-03-14)


### Bug Fixes

* **coverage:** restore coverage thresholds with targeted tests and exclusions ([706ee87](https://github.com/Sowiedu/Edict/commit/706ee87392a2523d39ef75673896169dd3c11687))

## [1.16.0](https://github.com/Sowiedu/Edict/compare/v1.15.0...v1.16.0) (2026-03-13)


### Features

* auto-normalize bare variants/fields and kind synonyms in expandCompact ([783f72b](https://github.com/Sowiedu/Edict/commit/783f72b54d9003b8c2fc1e6ad8d44713e66a65e9))
* IR codegen — expression and scalar compilation from IR nodes ([#155](https://github.com/Sowiedu/Edict/issues/155)) ([bf94c9b](https://github.com/Sowiedu/Edict/commit/bf94c9bdaf4083c0ffea05a1e9c4c36c4f2e315d))

## [1.15.0](https://github.com/Sowiedu/Edict/compare/v1.14.0...v1.15.0) (2026-03-13)


### Features

* QuickJS feasibility study — self-hosting check pipeline ([#134](https://github.com/Sowiedu/Edict/issues/134)) ([d7a81ab](https://github.com/Sowiedu/Edict/commit/d7a81ab0302dba98fb373fec3bdd9a7a1b5aabdf))


### Bug Fixes

* add compact AST expansion to direct API entry points ([d501539](https://github.com/Sowiedu/Edict/commit/d501539bf696d6d4b509818ceb84ab2ac4f2fdb7))
* correct VerificationCoverage field names in browser demo + update ROADMAP stats ([7baa9fb](https://github.com/Sowiedu/Edict/commit/7baa9fb9d8ef237f1a87ac3f3ee8bc62b5785f8d))

## [1.14.0](https://github.com/Sowiedu/Edict/compare/v1.13.1...v1.14.0) (2026-03-13)


### Features

* **builtins:** add toString builtin and auto-coercion for print/println ([88af7ca](https://github.com/Sowiedu/Edict/commit/88af7ca08c7b9ea6cf933ce4b669fe0fdb9716db))

## [1.13.1](https://github.com/Sowiedu/Edict/compare/v1.13.0...v1.13.1) (2026-03-13)


### Bug Fixes

* include examples/ in npm package for edict_examples tool ([e249e4d](https://github.com/Sowiedu/Edict/commit/e249e4d138ab3aa4936d70b404ac70760ebdf54f))

## [1.13.0](https://github.com/Sowiedu/Edict/compare/v1.12.0...v1.13.0) (2026-03-13)


### Features

* **mcp:** add 'agent' format to edict_schema for one-call bootstrapping ([3eabf00](https://github.com/Sowiedu/Edict/commit/3eabf007c3d82bc8bec826693aed26378c47d7f5))
* **builtins:** add toString builtin and auto-coercion for print/println — accepts Int, Float, Bool, Int64 without explicit conversion


### Bug Fixes

* **codegen:** resolve WASM 'function body type must match' regression ([2a6bf03](https://github.com/Sowiedu/Edict/commit/2a6bf03fd2f2d3259eb3d3c51f809228ae55e93f))

## [1.12.0](https://github.com/Sowiedu/Edict/compare/v1.11.0...v1.12.0) (2026-03-13)


### Features

* add edict_package and edict_invoke_skill MCP tools ([#136](https://github.com/Sowiedu/Edict/issues/136)) ([49073eb](https://github.com/Sowiedu/Edict/commit/49073ebbdfad9eaea9cfebe85448b8aac3ecccda))
* add println builtin (print with newline) ([#143](https://github.com/Sowiedu/Edict/issues/143)) ([61bf988](https://github.com/Sowiedu/Edict/commit/61bf988891dff03ebf0157727b208d1f8a85c0b6))
* CloudflareHostAdapter for Workers edge runtime ([#138](https://github.com/Sowiedu/Edict/issues/138)) ([d610f0a](https://github.com/Sowiedu/Edict/commit/d610f0a9d0a5a05f371f46b0ff4b05e603513bb4))
* crystallized intelligence lifecycle example and integration guide ([#137](https://github.com/Sowiedu/Edict/issues/137)) ([ab156e0](https://github.com/Sowiedu/Edict/commit/ab156e09c9c4cdf5ec642ca27df6c7da6fcdcd37))
* edict_deploy MCP tool — deploy pipeline ([#140](https://github.com/Sowiedu/Edict/issues/140)) ([2d07f2a](https://github.com/Sowiedu/Edict/commit/2d07f2a48872f323b611b1521ae0be72d528cb1b))
* effect polymorphism codegen, examples & docs ([#129](https://github.com/Sowiedu/Edict/issues/129)) ([606c5c1](https://github.com/Sowiedu/Edict/commit/606c5c11eab150f0fb889d4f7efa210a4775c005))
* **effects:** effect polymorphism inference and propagation ([#128](https://github.com/Sowiedu/Edict/issues/128)) ([e4e6ad1](https://github.com/Sowiedu/Edict/commit/e4e6ad12210117f5f0bf3e1518f156e151297fc9))
* implement IR lowering pass (lowerModule) ([e8f242b](https://github.com/Sowiedu/Edict/commit/e8f242b61dd507040c2de4073d83420d249f1055)), closes [#131](https://github.com/Sowiedu/Edict/issues/131)
* IR dead code elimination pass — unused let removal + unreachable code after exit() ([fb847e5](https://github.com/Sowiedu/Edict/commit/fb847e5089db34ee8c7e32747572f63907b8e79f))
* mid-level IR type definitions ([#130](https://github.com/Sowiedu/Edict/issues/130)) ([1cca706](https://github.com/Sowiedu/Edict/commit/1cca706e5bb49d149cd1400bc0d09a2e4890c2ec))
* skill package format — packageSkill() and invokeSkill() ([#135](https://github.com/Sowiedu/Edict/issues/135)) ([0678984](https://github.com/Sowiedu/Edict/commit/0678984c9fe1a490e88e232ded72ac58a5186e0d))
* Worker scaffold generator — WASM → deployable Cloudflare Worker bundle ([#139](https://github.com/Sowiedu/Edict/issues/139)) ([3626bbe](https://github.com/Sowiedu/Edict/commit/3626bbe00e4f9dcd09f0f32a8cf3d4cc96efabe1))


### Bug Fixes

* benchmark handles multi-module ASTs and skips tool_call examples ([dbe8531](https://github.com/Sowiedu/Edict/commit/dbe8531d8844109a53547703ca1863a7878488e9))
* fail fast on unrecognized CLI arguments ([#149](https://github.com/Sowiedu/Edict/issues/149)) ([61145a5](https://github.com/Sowiedu/Edict/commit/61145a57209d6e66f0865b53c6b3895a246052c4))
* make tsx dependency conditional for production workers ([#144](https://github.com/Sowiedu/Edict/issues/144)) ([a1bd567](https://github.com/Sowiedu/Edict/commit/a1bd567841dd8452990fb175bcf69fe69840fc4f))

## [1.11.0](https://github.com/Sowiedu/Edict/compare/v1.10.1...v1.11.0) (2026-03-12)


### Features

* browser-full bundle — full compilation pipeline + WASM execution ([#75](https://github.com/Sowiedu/Edict/issues/75)) ([7fe0ced](https://github.com/Sowiedu/Edict/commit/7fe0ced8466c30c0b528ebf013ccc191b5184a01))
* effect polymorphism AST schema + validation ([#127](https://github.com/Sowiedu/Edict/issues/127)) ([f4b92e7](https://github.com/Sowiedu/Edict/commit/f4b92e707189812473b24f4a00ed1687daae721e))
* honest monomorphism — unsupported_container lint warning ([#87](https://github.com/Sowiedu/Edict/issues/87) Direction A) ([ad2260a](https://github.com/Sowiedu/Edict/commit/ad2260a3254ee8481c45ecbd4d4cb50cc70ffcac))
* integrate Z3 contract verification into browser bundle ([9b7bf7d](https://github.com/Sowiedu/Edict/commit/9b7bf7d46dc99f46acc03861f4ca9f2c6dfd4a9d)), closes [#75](https://github.com/Sowiedu/Edict/issues/75)


### Bug Fixes

* close coverage gaps — exclude browser-only files, add support handler tests ([6c0209e](https://github.com/Sowiedu/Edict/commit/6c0209e4ff5701971a2be2f29981f03ae86db414))
* increase test timeouts for worker-thread tests (30s) ([8091909](https://github.com/Sowiedu/Edict/commit/809190906a26d36f5601ca6b5172e500de6afcc2))

## [1.10.1](https://github.com/Sowiedu/Edict/compare/v1.10.0...v1.10.1) (2026-03-11)


### Bug Fixes

* update MCP barrel export test expectations for support tool/resource ([74e9750](https://github.com/Sowiedu/Edict/commit/74e9750c695765d576218b17657e4db017555e12))

## [1.10.0](https://github.com/Sowiedu/Edict/compare/v1.9.2...v1.10.0) (2026-03-11)


### Features

* browser-compatible ESM bundle with builtin-meta separation ([#75](https://github.com/Sowiedu/Edict/issues/75) Phase 1) ([3c9e742](https://github.com/Sowiedu/Edict/commit/3c9e742833be2a94f5ad12391e1efb54e9435323))
* functional BrowserHostAdapter with pure-JS crypto, sync XHR, configurable env ([#120](https://github.com/Sowiedu/Edict/issues/120)) ([80dc1c8](https://github.com/Sowiedu/Edict/commit/80dc1c8482a4e02eb8dd6a7a5723d6b44de0255f))
* **mcp:** add agent-facing donation/sponsorship system ([75b7d11](https://github.com/Sowiedu/Edict/commit/75b7d11f3bfb7a3eaf99398423428abb8963efbd))


### Bug Fixes

* eliminate stale version numbers across MCP server ([5ffd957](https://github.com/Sowiedu/Edict/commit/5ffd957cb0c1c0cbd68c06843638bf310b7cb76d))

## [1.9.2](https://github.com/Sowiedu/Edict/compare/v1.9.1...v1.9.2) (2026-03-11)


### Bug Fixes

* close test coverage gaps with targeted tests and strategic exclusions ([ee0aba6](https://github.com/Sowiedu/Edict/commit/ee0aba6de1649e8ffaae1f65d0698296157bf984))
* set 45s timeout for handleReplay test (3 worker spawns on CI) ([954f77e](https://github.com/Sowiedu/Edict/commit/954f77eab3fc0bd88beb8d5b1165685446bc619e))
* validate-examples handles multi-module and compile-exempt examples ([ee97019](https://github.com/Sowiedu/Edict/commit/ee970195570c42cef6d0a353dfa1c4b5ef42002c))

## [1.9.1](https://github.com/Sowiedu/Edict/compare/v1.9.0...v1.9.1) (2026-03-11)


### Bug Fixes

* capitalize namespace to match GitHub username (Sowiedu) ([13e20ea](https://github.com/Sowiedu/Edict/commit/13e20ead28ef7be324771ed9ba97085af82deabd))
* shorten server.json description to ≤100 chars (registry limit) ([8e1e03c](https://github.com/Sowiedu/Edict/commit/8e1e03c4619b94a0bee82ee49a552d6704c67b5a))

## [1.9.0](https://github.com/Sowiedu/Edict/compare/v1.8.0...v1.9.0) (2026-03-11)


### Features

* add approval gates — compile-time approval propagation ([#70](https://github.com/Sowiedu/Edict/issues/70)) ([c578d34](https://github.com/Sowiedu/Edict/commit/c578d34657b5661949ffc6a5faa5ca0ab5eb229f))
* add confidence-typed values ([#69](https://github.com/Sowiedu/Edict/issues/69)) ([6821218](https://github.com/Sowiedu/Edict/commit/682121827df6655f94ddedcc27c1ee732cbf3265))
* add edict_explain MCP tool ([#7](https://github.com/Sowiedu/Edict/issues/7)) ([0f38862](https://github.com/Sowiedu/Edict/commit/0f388622560c6e3d6af8f5af63c59971448ec050))
* add edict_generate_tests MCP tool (test-contract bridge, [#73](https://github.com/Sowiedu/Edict/issues/73)) ([a7c57bd](https://github.com/Sowiedu/Edict/commit/a7c57bd6d9917a8a2db308014d5c34d8948de7d9))
* agent contribution infrastructure — structured issue metadata, CI feedback, auto-labeling ([#47](https://github.com/Sowiedu/Edict/issues/47)) ([107a414](https://github.com/Sowiedu/Edict/commit/107a414daa8efb93d57d93aef4caeaa1a1858ba5))
* **blame:** add blame tracking / error attribution ([#63](https://github.com/Sowiedu/Edict/issues/63)) ([eb1cad1](https://github.com/Sowiedu/Edict/commit/eb1cad1ac217f9be82ce86b7b0ebcdec3590b944))
* execution replay — deterministic snapshot ([#65](https://github.com/Sowiedu/Edict/issues/65)) ([48d3189](https://github.com/Sowiedu/Edict/commit/48d3189124dbdc9f72e728e6317c13c00ca11be9))
* first-class tool call type — ToolDef, tool_call expression, compile-time validation ([c11d7da](https://github.com/Sowiedu/Edict/commit/c11d7da645a593d744b203543385e04b2529fef1))
* host function provenance annotation ([#115](https://github.com/Sowiedu/Edict/issues/115)) ([1117f2c](https://github.com/Sowiedu/Edict/commit/1117f2c603f98707cdd40d914576a37d69d42330))
* implement capability tokens (issue [#59](https://github.com/Sowiedu/Edict/issues/59)) ([5bb6e01](https://github.com/Sowiedu/Edict/commit/5bb6e01a47a76d03c3c815cc3c23944c81a1a248))
* incremental checking — only re-verify changed definitions ([#8](https://github.com/Sowiedu/Edict/issues/8)) ([c160774](https://github.com/Sowiedu/Edict/commit/c16077461505591a8e9f53d45df091d461c221ed))
* intent declarations — structured 'what, not how' metadata ([#62](https://github.com/Sowiedu/Edict/issues/62)) ([bef6ef5](https://github.com/Sowiedu/Edict/commit/bef6ef56faf50fb749e2c9c05088a6d01f0cf1d1))
* **lint:** auto-decomposition suggestions with reach-pointer segmentation ([#67](https://github.com/Sowiedu/Edict/issues/67)) ([e55789c](https://github.com/Sowiedu/Edict/commit/e55789c9e7b4b5bb3ac54d1363acb0fc6cfa5977))
* multi-module compilation and linking ([#30](https://github.com/Sowiedu/Edict/issues/30)) ([163aed6](https://github.com/Sowiedu/Edict/commit/163aed614d14e70332a9f570e45d37dec47a367b))
* provenance / data lineage tracking ([#60](https://github.com/Sowiedu/Edict/issues/60)) ([6e37c3c](https://github.com/Sowiedu/Edict/commit/6e37c3c37e6ac95af932f5c854969d4512a28249))
* semantic assertions — pre-built Z3 postcondition catalog (issue [#66](https://github.com/Sowiedu/Edict/issues/66)) ([f8988df](https://github.com/Sowiedu/Edict/commit/f8988df340add0c857349d2c05a628fb4e84bf6e))
* versioned schema migration — auto-migrate ASTs from older schema versions ([#64](https://github.com/Sowiedu/Edict/issues/64)) ([90b70f4](https://github.com/Sowiedu/Edict/commit/90b70f484a0c702e00fd17e5e4e6f51ed9cde222))
* WASM interop v2 — shared memory for String/Array returns ([#114](https://github.com/Sowiedu/Edict/issues/114)) ([9110667](https://github.com/Sowiedu/Edict/commit/911066721fa205bef69f4a913a1c0caac76a16ca))
* WASM module interop — import external WASM functions ([#38](https://github.com/Sowiedu/Edict/issues/38)) ([42a731f](https://github.com/Sowiedu/Edict/commit/42a731f6b826021c838755c3d571388dd13c04bd))


### Bug Fixes

* rename ApprovalGate.description to .reason + update examples/README ([0ab5231](https://github.com/Sowiedu/Edict/commit/0ab52314a6fa57ebbd355dab24ef4b13ecd5ec54))

## [1.8.0](https://github.com/Sowiedu/Edict/compare/v1.7.0...v1.8.0) (2026-03-09)


### Features

* add Docker image for Edict MCP server ([#45](https://github.com/Sowiedu/Edict/issues/45)) ([44d6ba3](https://github.com/Sowiedu/Edict/commit/44d6ba30013f7ea044b9e4481ea800c7af40b145))
* arena memory management for WASM heap ([#35](https://github.com/Sowiedu/Edict/issues/35)) ([adda3f8](https://github.com/Sowiedu/Edict/commit/adda3f8e230f9b8f91640b357a4aa7efbcc2abf4))
* **benchmarks:** add benchmark suite for pipeline performance (closes [#48](https://github.com/Sowiedu/Edict/issues/48)) ([f7c4ce3](https://github.com/Sowiedu/Edict/commit/f7c4ce309c9d70872307609883d9e1dd3eca2b70))
* composable program fragments (issue [#72](https://github.com/Sowiedu/Edict/issues/72)) ([c24e523](https://github.com/Sowiedu/Edict/commit/c24e5238af0feda88d043019484567d599f5ce0b))
* contract verification coverage metrics — 55-contract corpus + measurement script (closes [#52](https://github.com/Sowiedu/Edict/issues/52)) ([fc6338a](https://github.com/Sowiedu/Edict/commit/fc6338ac7e416616284eb815d03b4602b31b95fa))
* edict_debug MCP tool — execution tracing and crash diagnostics ([#41](https://github.com/Sowiedu/Edict/issues/41)) ([cb7d13a](https://github.com/Sowiedu/Edict/commit/cb7d13a3ce060994224120d0140756a537794521))
* error recovery benchmark improvements — 76.7% recovery rate ([d3177cf](https://github.com/Sowiedu/Edict/commit/d3177cf73d03f754c429891e0ac313500bbda806))
* **examples:** add arrays, math, constants examples + fix docs ([0b03737](https://github.com/Sowiedu/Edict/commit/0b03737820b38bcc29148aadc9e5deac2204c0f3))
* **examples:** add crypto, datetime, random, io, int64 example programs ([86ee6de](https://github.com/Sowiedu/Edict/commit/86ee6deee44455e65e3c484d3a64074d9f4bef5c))
* implement security sandbox for filesystem and HTTP ([a0a1ce7](https://github.com/Sowiedu/Edict/commit/a0a1ce76fe8c47729770a82cb1e27d741647de57)), closes [#88](https://github.com/Sowiedu/Edict/issues/88)
* implement semantic unit types (issue [#28](https://github.com/Sowiedu/Edict/issues/28)) ([88acbe7](https://github.com/Sowiedu/Edict/commit/88acbe7068e9db4dae2a14e2353ce9a8fa77c474))
* implement Universal Agent Skill Format (UASF) [#80](https://github.com/Sowiedu/Edict/issues/80) ([0fabf38](https://github.com/Sowiedu/Edict/commit/0fabf38606bce0c6996f355dc7d2aefb1d027e77))
* **mcp:** implement WASM Portable Agent Skills ([e3536c7](https://github.com/Sowiedu/Edict/commit/e3536c70c54cc5c09311b40f96e7e0e45d87dee7)), closes [#76](https://github.com/Sowiedu/Edict/issues/76)
* quantifier support in contracts — forall/exists (issue [#31](https://github.com/Sowiedu/Edict/issues/31)) ([5cc6e44](https://github.com/Sowiedu/Edict/commit/5cc6e44df119a930eb76052723dc4858d2d54e05))
* **validator:** schema-driven validation ([#90](https://github.com/Sowiedu/Edict/issues/90)) ([a7cc325](https://github.com/Sowiedu/Edict/commit/a7cc325e5282a84dc85cb044b79bdcef9215efd4))
* Z3 verification caching — structural hash + in-memory cache (issue [#93](https://github.com/Sowiedu/Edict/issues/93) Phase 1) ([34b4c40](https://github.com/Sowiedu/Edict/commit/34b4c401586c313c9e94690a23380ce7d84f69ef))
* Z3 worker thread offloading — move contract verification to worker (issue [#93](https://github.com/Sowiedu/Edict/issues/93) Phase 2) ([eabb1e4](https://github.com/Sowiedu/Edict/commit/eabb1e4fa67c6d2e456138e5cd1d7717421aa41d))


### Bug Fixes

* add main functions to 7 examples that returned exit code 1 ([a423371](https://github.com/Sowiedu/Edict/commit/a423371d00f3790e2dcd57568a9d31ced3c8890d))
* **checker:** resolve unused variable TypeScript error in generic AST visitor ([8331121](https://github.com/Sowiedu/Edict/commit/83311214bd6c5b7614d30222f269f241f158f1eb))
* **codegen:** implement tuple field access in type checker and codegen ([e5c1d52](https://github.com/Sowiedu/Edict/commit/e5c1d52b3bb966ad57762b1a2e65f01e936a99a4))
* **mcp:** resolve test suite failures (call-indirect table & missing entry point) ([df9bf2c](https://github.com/Sowiedu/Edict/commit/df9bf2c257ca0ac1928490e38db79221cdbafa10))
* meet CI coverage thresholds — exclude untestable files, add 28 targeted tests ([0e46a27](https://github.com/Sowiedu/Edict/commit/0e46a279a79289e39b1f69267cb6fc6a665bdabf))
* string + codegen emits string_concat instead of i32.add ([418307e](https://github.com/Sowiedu/Edict/commit/418307e28f1d64dcac495625a56ea8054282806a))

## [1.7.0](https://github.com/Sowiedu/Edict/compare/v1.6.0...v1.7.0) (2026-03-07)


### Features

* CI improvements — typecheck, coverage enforcement, validate-examples script, local CI mirror ([#99](https://github.com/Sowiedu/Edict/issues/99), [#100](https://github.com/Sowiedu/Edict/issues/100), [#101](https://github.com/Sowiedu/Edict/issues/101), [#103](https://github.com/Sowiedu/Edict/issues/103)) ([402a98a](https://github.com/Sowiedu/Edict/commit/402a98acd8ac279b22da1a07751e3ac1a6b5521e))
* **examples:** add option.edict.json example program ([820188c](https://github.com/Sowiedu/Edict/commit/820188c1392a979caadf6f341bbeaae50c80391e))


### Bug Fixes

* correct schema drift check paths in CI and pre-commit ([#98](https://github.com/Sowiedu/Edict/issues/98)) ([9ad6b8b](https://github.com/Sowiedu/Edict/commit/9ad6b8b5f16f96a13e1cc981bc008da19cf1371d))
* meet CI coverage thresholds with targeted tests + exclusions ([8008fa3](https://github.com/Sowiedu/Edict/commit/8008fa35d181e324b7e8df7200976676cb1fc0fe))
* scope coverage/ gitignore to root only ([43ba743](https://github.com/Sowiedu/Edict/commit/43ba743d7918ca805dc8b9a3426ee8e77e5ccb5b))
* update example count 18→19, skip unimplemented tuple-access tests, update docs ([d96f1a2](https://github.com/Sowiedu/Edict/commit/d96f1a2c9d6d3899bfb1dcd2b04974f9af25b03b))


### Performance Improvements

* skip vitest in pre-commit when no test/example files staged ([400937f](https://github.com/Sowiedu/Edict/commit/400937f8a3232ac7f3a3b9b150a0d2c1cbbc5699))
* **tests:** switch slow tests to runDirect, add shared WASM fixtures ([9ee7a21](https://github.com/Sowiedu/Edict/commit/9ee7a21bb9946ec7a23cb84610f2e5d68d0e7575))

## [1.6.0](https://github.com/Sowiedu/Edict/compare/v1.5.0...v1.6.0) (2026-03-07)


### Features

* report analysis uncertainty instead of silently passing ([#85](https://github.com/Sowiedu/Edict/issues/85)) ([d3f3049](https://github.com/Sowiedu/Edict/commit/d3f3049d6c80cb1673ddf809f02876da422c2128))
* typed import declarations — stop guessing ABI at codegen time ([#86](https://github.com/Sowiedu/Edict/issues/86)) ([0caa6b2](https://github.com/Sowiedu/Edict/commit/0caa6b2e833e49d5ababaf058639987385e5dc51))
* unify builtin registration — single source of truth ([#84](https://github.com/Sowiedu/Edict/issues/84)) ([0c2bb07](https://github.com/Sowiedu/Edict/commit/0c2bb07bff8e1d5f464f4352385e98ce6731307d))


### Bug Fixes

* **#83:** stop AST mutation in type checker — use TypedModuleInfo side-table ([8e14447](https://github.com/Sowiedu/Edict/commit/8e14447721882e22ac4faedfae96e191809c762b)), closes [#83](https://github.com/Sowiedu/Edict/issues/83)
* **ci:** increase WASM execution timeouts for CI runners ([52384f9](https://github.com/Sowiedu/Edict/commit/52384f90bb93a88ebecc136f224484c2b8671ad6))

## [1.5.0](https://github.com/Sowiedu/Edict/compare/v1.4.0...v1.5.0) (2026-03-06)


### Features

* add crypto hashing builtins — sha256, md5, hmac ([#25](https://github.com/Sowiedu/Edict/issues/25)) ([ebaa61b](https://github.com/Sowiedu/Edict/commit/ebaa61be0d3be6c5559f4ed9867b6d0be56c91f1))
* add date/time builtins (now, formatDate, parseDate, diffMs) ([d7ee5c9](https://github.com/Sowiedu/Edict/commit/d7ee5c9e186416c22c48b13c3970c125fa3f10bd))
* add Int64 type support (WASM i64 / JS BigInt) ([2e5e757](https://github.com/Sowiedu/Edict/commit/2e5e7570745b4ae191e8c175c33338fbf8fb3989))
* add regex builtins (regexTest, regexMatch, regexReplace) ([5db4c68](https://github.com/Sowiedu/Edict/commit/5db4c684291a254aa41d47c3e632b2a4e1a381c1))
* compact AST format — 25-60% token reduction for agents ([6a78a97](https://github.com/Sowiedu/Edict/commit/6a78a97f03fe8ad80010dadb96d18336a9aedf74)), closes [#11](https://github.com/Sowiedu/Edict/issues/11)
* document AST patch protocol as JSON Schema + fix all TSC errors ([a079d41](https://github.com/Sowiedu/Edict/commit/a079d413a7460eff1047ff2f5842ff419ae5e3d6)), closes [#13](https://github.com/Sowiedu/Edict/issues/13)
* implement array_find and array_sort HOF builtins ([d951cef](https://github.com/Sowiedu/Edict/commit/d951cefad7e683f8571191cde551e76d00ee9e15))
* implement HTTP client builtins (httpGet, httpPost, httpPut, httpDelete) ([4e99383](https://github.com/Sowiedu/Edict/commit/4e9938319c72a496b5d530dbcd6a7a653e3dc8fc)), closes [#20](https://github.com/Sowiedu/Edict/issues/20)
* implement IO builtins — readFile, writeFile, env, args, exit ([#19](https://github.com/Sowiedu/Edict/issues/19)) ([7796bc1](https://github.com/Sowiedu/Edict/commit/7796bc13b7baca6be56952bf737951b616dcf6ed))
* implement JSON and Random builtins ([#21](https://github.com/Sowiedu/Edict/issues/21), [#23](https://github.com/Sowiedu/Edict/issues/23)) ([3033483](https://github.com/Sowiedu/Edict/commit/303348353f210aa75a7abaf7e515bb2d731d5e20))
* implement Result runtime support ([0b6aaa2](https://github.com/Sowiedu/Edict/commit/0b6aaa268b56749c4b4720670f0356e87590ff8e))
* lambda parameter type inference from call-site context ([#29](https://github.com/Sowiedu/Edict/issues/29)) ([e8e61d8](https://github.com/Sowiedu/Edict/commit/e8e61d82ce6db279fadd1774c992e71fb99672dc))
* let binding type inference — backfill inferred types onto AST ([3ab738e](https://github.com/Sowiedu/Edict/commit/3ab738e313f3aeef50774990cc68d26207a523ad))
* make FunctionDef.returnType optional with inference from body ([#29](https://github.com/Sowiedu/Edict/issues/29)) ([084db6c](https://github.com/Sowiedu/Edict/commit/084db6cfccde8c7784019a36597b68dd33570de1))


### Bug Fixes

* **codegen:** heap bounds checking + string length propagation ([#82](https://github.com/Sowiedu/Edict/issues/82)) ([310423e](https://github.com/Sowiedu/Edict/commit/310423e29b91df32490d19219bab8f7d96480537))

## [1.4.0](https://github.com/Sowiedu/Edict/compare/v1.3.0...v1.4.0) (2026-03-05)


### Features

* add edict_lint MCP tool — 6 non-blocking quality warnings (closes [#42](https://github.com/Sowiedu/Edict/issues/42)) ([641d0cd](https://github.com/Sowiedu/Edict/commit/641d0cdfb682232e63fcc7e859ca0867d3a84246))
* add HOF array builtins, closures/HOF/string examples, update test counts ([1b2f6b6](https://github.com/Sowiedu/Edict/commit/1b2f6b6a51f03f837a237f3e0eb82e1b1ec8af7b))
* implement Option runtime support ([#26](https://github.com/Sowiedu/Edict/issues/26)) ([620b189](https://github.com/Sowiedu/Edict/commit/620b189ea694c486316946f2d90bb16503b11db3))

## [1.3.0](https://github.com/Sowiedu/Edict/compare/v1.2.0...v1.3.0) (2026-03-04)


### Features

* add end-to-end agent loop smoke test (closes [#4](https://github.com/Sowiedu/Edict/issues/4)) ([c06bfeb](https://github.com/Sowiedu/Edict/commit/c06bfeb9e0809f76a4503e1efb4f35fd0fc9037a))
* add execution sandbox limits (timeout, memory cap) ([851873b](https://github.com/Sowiedu/Edict/commit/851873b585cfec05428fc4d19a776faed8415e24)), closes [#37](https://github.com/Sowiedu/Edict/issues/37)
* add MCP prompt templates for agent bootstrapping (closes [#40](https://github.com/Sowiedu/Edict/issues/40)) ([a5880a2](https://github.com/Sowiedu/Edict/commit/a5880a2b51d2378e2ad8e3da8a6c1fbb752cab62))
* add mutual recursion tests and example program (closes [#36](https://github.com/Sowiedu/Edict/issues/36)) ([ee4637b](https://github.com/Sowiedu/Edict/commit/ee4637b3914f70c5d5dfe8dabf6b545bbe7e9c84))
* **codegen:** implement higher-order functions via WASM function tables ([#33](https://github.com/Sowiedu/Edict/issues/33)) ([6d8407d](https://github.com/Sowiedu/Edict/commit/6d8407dcc778240c430eea3a06954c62af916b45))
* implement closures — lambda expressions capture outer scope ([#34](https://github.com/Sowiedu/Edict/issues/34)) ([4ba5a18](https://github.com/Sowiedu/Edict/commit/4ba5a1835273eade30f14275211ed587a5883399))
* validate generated WASM binaries with structured errors ([215a429](https://github.com/Sowiedu/Edict/commit/215a4299d74b0883fd2f2d173bb384c594f5e192)), closes [#51](https://github.com/Sowiedu/Edict/issues/51)

## [1.2.0](https://github.com/Sowiedu/Edict/compare/v1.1.0...v1.2.0) (2026-03-04)


### Features

* add array builtins (length, get, set, push, pop, concat, slice, isEmpty, contains, reverse) ([6e67aa7](https://github.com/Sowiedu/Edict/commit/6e67aa77fc0a010123c8857c9aa094b294a8d95a))
* add edict://errors MCP resource and edict_errors tool — machine-readable error catalog ([6b7cf0f](https://github.com/Sowiedu/Edict/commit/6b7cf0f5d4e8b49be9482f2edbbc84b7fa712ede)), closes [#10](https://github.com/Sowiedu/Edict/issues/10)
* add minimal schema variant for token-efficient agent bootstrap ([43cb6dc](https://github.com/Sowiedu/Edict/commit/43cb6dcd1457bb7b011bf0ced5a77429275cb345)), closes [#12](https://github.com/Sowiedu/Edict/issues/12)
* add string builtins (length, substring, concat, indexOf, upper/lower, trim, startsWith, endsWith, contains, repeat) ([119ed1c](https://github.com/Sowiedu/Edict/commit/119ed1c46bf449a887c4dde45d58063897cd7838))
* add string_interp expression (closes [#32](https://github.com/Sowiedu/Edict/issues/32)) ([4209f4c](https://github.com/Sowiedu/Edict/commit/4209f4ca5eaccc378bf8acdd5fafcf8aeb10912e))

## [1.1.0](https://github.com/Sowiedu/Edict/compare/v1.0.0...v1.1.0) (2026-03-04)


### Features

* add edict_patch MCP tool for surgical AST patching ([c0ef2c4](https://github.com/Sowiedu/Edict/commit/c0ef2c4916f3e5abb04316b47c7445710d70f7c9)), closes [#6](https://github.com/Sowiedu/Edict/issues/6)
* add math builtins (abs, min, max, pow, sqrt, floor, ceil, round) ([83f205b](https://github.com/Sowiedu/Edict/commit/83f205bf84aa4736885405f6f3b0f9b4ea0c5338)), closes [#15](https://github.com/Sowiedu/Edict/issues/15)

## 1.0.0 (2026-03-04)


### Features

* add fix suggestions to structured errors ([21c0519](https://github.com/Sowiedu/Edict/commit/21c05192818efb0d89d895650cf3311c8fdcdd74))
* add main functions to arithmetic and fibonacci examples ([72c87fd](https://github.com/Sowiedu/Edict/commit/72c87fd6228e6ed5fafebbe5af616e43ad798a4d))
* add string_replace builtin and dash-to-hyphen example program ([2b102e2](https://github.com/Sowiedu/Edict/commit/2b102e2d0bc106750ace99b3d39e5720e1902b9f))
* Implement Tier 1 (HTTP Transport, edict_version, npm publishing) 🚀 ([462aef4](https://github.com/Sowiedu/Edict/commit/462aef47b334c02e53631e6d09f6d023a7de7a1f))
* MCP toolchain + codegen expansion (10/10 examples compile) ([ca57391](https://github.com/Sowiedu/Edict/commit/ca57391220cc93fa610488587949f606929c1925))


### Bug Fixes

* **ci:** use googleapis/release-please-action (google-github-actions deprecated) ([2fd8311](https://github.com/Sowiedu/Edict/commit/2fd831180a36e24af005c150f239847b2d1f46fd))
