# Changelog

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
