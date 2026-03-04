# Changelog

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
