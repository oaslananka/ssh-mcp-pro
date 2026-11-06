# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0](https://github.com/oaslananka/ssh-mcp-pro/compare/ssh-mcp-pro-v1.3.0...ssh-mcp-pro-v1.4.0) (2026-11-06)


### Features

* **mcp:** support 2026 protocol on authenticated remote-agent endpoint ([#181](https://github.com/oaslananka/ssh-mcp-pro/issues/181)) ([8f5df37](https://github.com/oaslananka/ssh-mcp-pro/commit/8f5df3700657118d26743eebf314bdb3850cceb7))
* **remote:** add hosted dashboard and Coolify deployment support ([#127](https://github.com/oaslananka/ssh-mcp-pro/issues/127)) ([7a4ba63](https://github.com/oaslananka/ssh-mcp-pro/commit/7a4ba63cc8d2a3ec8080ecdddf57e854d08e1de2))


### Bug Fixes

* **agent:** launch Windows scheduled task with npm CMD shim ([#130](https://github.com/oaslananka/ssh-mcp-pro/issues/130)) ([cf6fdb5](https://github.com/oaslananka/ssh-mcp-pro/commit/cf6fdb511af552d0538659a8fa7420bb586cfb69))
* **agent:** resolve Linux npm CLI discovery and system runtime identity ([#176](https://github.com/oaslananka/ssh-mcp-pro/issues/176)) ([16b7ce3](https://github.com/oaslananka/ssh-mcp-pro/commit/16b7ce3ea57931482e46af539223e2e481d47c35))
* **agent:** restart service after enrollment identity changes ([#180](https://github.com/oaslananka/ssh-mcp-pro/issues/180)) ([d770763](https://github.com/oaslananka/ssh-mcp-pro/commit/d770763936a5e1c7f0c40e87414a8917f1c21b7a))
* **agent:** restart Windows agent after WebSocket disconnect ([#129](https://github.com/oaslananka/ssh-mcp-pro/issues/129)) ([8df07ee](https://github.com/oaslananka/ssh-mcp-pro/commit/8df07ee08a55eb665679dffc33d8701b4e063ca9))
* **agent:** surface Linux installer download failures ([#132](https://github.com/oaslananka/ssh-mcp-pro/issues/132)) ([79f166d](https://github.com/oaslananka/ssh-mcp-pro/commit/79f166d50ffd52d0b9253b318703486fd5a72e8a))
* **apps:** correct publication legal-document attestations ([#157](https://github.com/oaslananka/ssh-mcp-pro/issues/157)) ([7e8b42d](https://github.com/oaslananka/ssh-mcp-pro/commit/7e8b42d9e5032c657fd65920c004bafc3d41abf6))
* **auth:** restrict fixture identities to loopback test mode ([#128](https://github.com/oaslananka/ssh-mcp-pro/issues/128)) ([a0a1d19](https://github.com/oaslananka/ssh-mcp-pro/commit/a0a1d1991dc665db3be2a017ddea039d4b642803))
* **automation:** avoid stalled dependency PR creation ([#153](https://github.com/oaslananka/ssh-mcp-pro/issues/153)) ([209c084](https://github.com/oaslananka/ssh-mcp-pro/commit/209c084294188a46baf878bfc326676b25e49781))
* **dashboard:** correct Gemini and Copilot setup examples ([#161](https://github.com/oaslananka/ssh-mcp-pro/issues/161)) ([be00c8c](https://github.com/oaslananka/ssh-mcp-pro/commit/be00c8c0f77c38d08b6b68f78e6fe2118c1bfeb2))
* **dashboard:** correct MCP client setup examples ([#146](https://github.com/oaslananka/ssh-mcp-pro/issues/146)) ([71ed56a](https://github.com/oaslananka/ssh-mcp-pro/commit/71ed56a45f024812cf15d89f4de861cf631a65bd))
* **dashboard:** display host metadata and stream agent activity logs ([#183](https://github.com/oaslananka/ssh-mcp-pro/issues/183)) ([30d294a](https://github.com/oaslananka/ssh-mcp-pro/commit/30d294acb367ae06d25ec1caff9f68bad113ea2d))
* **dashboard:** distinguish remote MCP connector setup ([#147](https://github.com/oaslananka/ssh-mcp-pro/issues/147)) ([621948d](https://github.com/oaslananka/ssh-mcp-pro/commit/621948d03bffe62282daa96dbb41d741aca83311))
* **dashboard:** make navigation keyboard accessible ([#160](https://github.com/oaslananka/ssh-mcp-pro/issues/160)) ([6261f7f](https://github.com/oaslananka/ssh-mcp-pro/commit/6261f7f3b92a53b7f9e474e6159aa36c468a6ed3))
* **dashboard:** remove revoked devices from inventory ([#149](https://github.com/oaslananka/ssh-mcp-pro/issues/149)) ([715edb8](https://github.com/oaslananka/ssh-mcp-pro/commit/715edb8511f908d70bb2400767942cd17e3bbe21))
* **dashboard:** separate device revoke and remove actions ([#182](https://github.com/oaslananka/ssh-mcp-pro/issues/182)) ([1e78176](https://github.com/oaslananka/ssh-mcp-pro/commit/1e7817642ebead581435fc169d9a46eed74fa6f6))
* **docs:** mark Google cloud connector as not publish-ready ([#134](https://github.com/oaslananka/ssh-mcp-pro/issues/134)) ([c3889af](https://github.com/oaslananka/ssh-mcp-pro/commit/c3889afda29889dfa3cbd96b55c28fe852fc9dc6))
* **http:** classify invalid JSON requests as bad input ([#136](https://github.com/oaslananka/ssh-mcp-pro/issues/136)) ([7fbbee2](https://github.com/oaslananka/ssh-mcp-pro/commit/7fbbee20f8ea141b36230dd8336d16172da525da))
* **http:** deny browser origins with no explicit allowlist ([#135](https://github.com/oaslananka/ssh-mcp-pro/issues/135)) ([ac3bf2c](https://github.com/oaslananka/ssh-mcp-pro/commit/ac3bf2cbdd6a63d92812b07b194b0b35269a040f))
* **oauth:** allow configured identity provider form redirects ([#150](https://github.com/oaslananka/ssh-mcp-pro/issues/150)) ([d78c067](https://github.com/oaslananka/ssh-mcp-pro/commit/d78c0676df29066e903bc53d2244944e6d82f819))
* **oauth:** prevent Chromium form redirects and restore enrollment tokens ([#179](https://github.com/oaslananka/ssh-mcp-pro/issues/179)) ([19f337c](https://github.com/oaslananka/ssh-mcp-pro/commit/19f337c9161e5496313349c66317586676cbb910))
* **oauth:** use registered Google callback for dashboard and MCP ([#178](https://github.com/oaslananka/ssh-mcp-pro/issues/178)) ([638d3f5](https://github.com/oaslananka/ssh-mcp-pro/commit/638d3f55ba4bb462c518a3fa8af3a4262c294414))
* **release:** add provenance-verified v1.3.0 asset recovery ([#126](https://github.com/oaslananka/ssh-mcp-pro/issues/126)) ([42254ec](https://github.com/oaslananka/ssh-mcp-pro/commit/42254ec23e50afa75cbd0fd467898fc93ab403f8))
* **release:** classify pinned legacy SSE migration bridge as advisory ([#123](https://github.com/oaslananka/ssh-mcp-pro/issues/123)) ([f262e93](https://github.com/oaslananka/ssh-mcp-pro/commit/f262e93c10465a96a002ee27c8dd77e69ad62dcb))
* **release:** sync Gemini connector version metadata ([#141](https://github.com/oaslananka/ssh-mcp-pro/issues/141)) ([feada05](https://github.com/oaslananka/ssh-mcp-pro/commit/feada051b38b7825a2142a0c8c78eae1b37e17f1))
* **remote:** advertise HSTS for HTTPS endpoints ([#155](https://github.com/oaslananka/ssh-mcp-pro/issues/155)) ([1c8baac](https://github.com/oaslananka/ssh-mcp-pro/commit/1c8baacb813a1dcb441a587c7b316999517fdddb))
* **remote:** prune expired transient credential records ([#159](https://github.com/oaslananka/ssh-mcp-pro/issues/159)) ([a8b0dfc](https://github.com/oaslananka/ssh-mcp-pro/commit/a8b0dfc9023f7e6d31b43d1004857b6b3b4e9c44))
* **test:** bind SSH fixture to loopback without sudo ([#133](https://github.com/oaslananka/ssh-mcp-pro/issues/133)) ([3c0a80f](https://github.com/oaslananka/ssh-mcp-pro/commit/3c0a80ffad507ab167a5ad7bc37a0ca513b478e6))

## [1.3.0](https://github.com/oaslananka/ssh-mcp-pro/compare/ssh-mcp-pro-v1.2.3...ssh-mcp-pro-v1.3.0) (2026-11-02)


### Features

* **mcp:** support 2026 protocol on standard transports ([#121](https://github.com/oaslananka/ssh-mcp-pro/issues/121)) ([c975504](https://github.com/oaslananka/ssh-mcp-pro/commit/c975504f1b0d0e8ea270be3f87f6191e8bec1fa9))


### Bug Fixes

* **docker:** patch Alpine musl CVE-2026-107891 ([#98](https://github.com/oaslananka/ssh-mcp-pro/issues/98)) ([4186138](https://github.com/oaslananka/ssh-mcp-pro/commit/41861382dacfc3b25c6715b303f30d54f3c605bb))
* **quality:** remove stale lock helper and simplify safe string escaping ([#114](https://github.com/oaslananka/ssh-mcp-pro/issues/114)) ([d8d6c56](https://github.com/oaslananka/ssh-mcp-pro/commit/d8d6c565debc3cfbfb425ba16a71ad29e49c483c))
* **reliability:** report actual retry attempts and parallelize independent version checks ([#119](https://github.com/oaslananka/ssh-mcp-pro/issues/119)) ([bc64b36](https://github.com/oaslananka/ssh-mcp-pro/commit/bc64b36a33b15aa9a9ee418f4f06ccb4b87f33f0))
* **security:** reject unsafe Windows shim path characters ([#100](https://github.com/oaslananka/ssh-mcp-pro/issues/100)) ([083e133](https://github.com/oaslananka/ssh-mcp-pro/commit/083e133b81affb79a192ed6859f680ce0f79f478))
* **ssh:** apply multi-pattern Host options to every alias ([#120](https://github.com/oaslananka/ssh-mcp-pro/issues/120)) ([6d7b9f2](https://github.com/oaslananka/ssh-mcp-pro/commit/6d7b9f2a98712a18c6cb23002ed5a08152c0b02b))

## [1.2.3](https://github.com/oaslananka/ssh-mcp-pro/compare/ssh-mcp-pro-v1.2.2...ssh-mcp-pro-v1.2.3) (2026-10-09)


### Bug Fixes

* **release:** one-click GitHub npm publishing and CodeQL coverage ([#72](https://github.com/oaslananka/ssh-mcp-pro/issues/72)) ([9a0d7f3](https://github.com/oaslananka/ssh-mcp-pro/commit/9a0d7f344d20bd5efe9e3a54f47c92f8d4a09ce3))

## [1.2.2](https://github.com/oaslananka/ssh-mcp-pro/compare/ssh-mcp-pro-v1.2.1...ssh-mcp-pro-v1.2.2) (2026-10-09)


### Bug Fixes

* **docker:** install patched Alpine zlib in both stages ([#69](https://github.com/oaslananka/ssh-mcp-pro/issues/69)) ([459fd52](https://github.com/oaslananka/ssh-mcp-pro/commit/459fd52223e3d07dd36991b89f539eb09426b89f))
* harden remote control plane and SSH session safety ([#67](https://github.com/oaslananka/ssh-mcp-pro/issues/67)) ([e265a4a](https://github.com/oaslananka/ssh-mcp-pro/commit/e265a4ab98fc6ad7737c6817790b64b358b35463))
* **release:** gate releases before tagging and reconcile distribution ([#70](https://github.com/oaslananka/ssh-mcp-pro/issues/70)) ([eb638cb](https://github.com/oaslananka/ssh-mcp-pro/commit/eb638cb2e8ea39217f3e894f4a29a9a573d7ae57))
* **release:** make published checksums artifact-relative ([#71](https://github.com/oaslananka/ssh-mcp-pro/issues/71)) ([eab0929](https://github.com/oaslananka/ssh-mcp-pro/commit/eab09299ac7aa21d114d089bfaeca9f3e5dc551b))

## [1.2.1](https://github.com/oaslananka/ssh-mcp-pro/compare/ssh-mcp-pro-v1.2.0...ssh-mcp-pro-v1.2.1) (2026-10-06)


### Bug Fixes

* dependency audit failures and restore green Quality Gates on main ([#49](https://github.com/oaslananka/ssh-mcp-pro/issues/49)) ([7b29f74](https://github.com/oaslananka/ssh-mcp-pro/commit/7b29f74ae9d967c2e1032788c2626f78ba3fed47))
* Security remediation: oaslananka/ssh-mcp-pro dependabot (8) ([#50](https://github.com/oaslananka/ssh-mcp-pro/issues/50)) ([7f8c389](https://github.com/oaslananka/ssh-mcp-pro/commit/7f8c389898ceb0f0fd2e76688339e24659353889))

## [1.2.0](https://github.com/oaslananka/ssh-mcp-pro/compare/ssh-mcp-pro-v1.1.5...ssh-mcp-pro-v1.2.0) (2026-07-24)


### Features

* add device onboarding scripts and guide ([58f0104](https://github.com/oaslananka/ssh-mcp-pro/commit/58f0104122d7ee17e72dd3eb35064e6e55cd35db))
* add process and system management tools ([a85f3e6](https://github.com/oaslananka/ssh-mcp-pro/commit/a85f3e60b9fe02c089c9e5a276af01dfa99d3d87))
* SSH MCP server with remote control plane and ChatGPT connector ([d8058cd](https://github.com/oaslananka/ssh-mcp-pro/commit/d8058cd605c1dc9978c4217cb34ad255376856de))


### Bug Fixes

* **agent:** enforce canonical path boundaries ([#36](https://github.com/oaslananka/ssh-mcp-pro/issues/36)) ([026a7b2](https://github.com/oaslananka/ssh-mcp-pro/commit/026a7b2fadd4496c0c73aa5601d9edb056506db5)), closes [#20](https://github.com/oaslananka/ssh-mcp-pro/issues/20)
* **agent:** reject replayed policy updates ([#38](https://github.com/oaslananka/ssh-mcp-pro/issues/38)) ([f1a7ffd](https://github.com/oaslananka/ssh-mcp-pro/commit/f1a7ffdf3b82e6c32ec8e44f9f2feae1916c9c2f))
* **deps:** remediate dependency advisories ([#34](https://github.com/oaslananka/ssh-mcp-pro/issues/34)) ([081ab59](https://github.com/oaslananka/ssh-mcp-pro/commit/081ab5955318c54724c787916a42cdf969d16cbf)), closes [#23](https://github.com/oaslananka/ssh-mcp-pro/issues/23)
* **http:** validate effective remote tool sets ([#37](https://github.com/oaslananka/ssh-mcp-pro/issues/37)) ([d22d7f1](https://github.com/oaslananka/ssh-mcp-pro/commit/d22d7f133c4b7714765551660bd40f1cfffbbe26)), closes [#21](https://github.com/oaslananka/ssh-mcp-pro/issues/21)
* **lint:** enforce trailing default parameters ([4aedfe8](https://github.com/oaslananka/ssh-mcp-pro/commit/4aedfe837d5062c9523db2de3e382bf84c2c53a4))
* **remote:** enforce tool capability invariant ([#33](https://github.com/oaslananka/ssh-mcp-pro/issues/33)) ([f5050dd](https://github.com/oaslananka/ssh-mcp-pro/commit/f5050dd04e411abf43f37f6b418a54888f407e95)), closes [#19](https://github.com/oaslananka/ssh-mcp-pro/issues/19)
* **security:** resolve CodeQL alert [#1](https://github.com/oaslananka/ssh-mcp-pro/issues/1), add image scanning and publint ([#5](https://github.com/oaslananka/ssh-mcp-pro/issues/5)) ([1043dc8](https://github.com/oaslananka/ssh-mcp-pro/commit/1043dc80a5de75c97c8ed0705dde6ed5b68fa290))
* **security:** resolve SonarQube Quality Gate failures ([#45](https://github.com/oaslananka/ssh-mcp-pro/issues/45)) ([cb644d9](https://github.com/oaslananka/ssh-mcp-pro/commit/cb644d9c0cf359d6080530030c732fa74322e633))

## [1.1.4](https://github.com/oaslananka/ssh-mcp-pro/compare/ssh-mcp-pro-v1.1.3...ssh-mcp-pro-v1.1.4) (2026-06-16)


### Bug Fixes

* harden ssh automation release and runtime paths ([d1d9faf](https://github.com/oaslananka/ssh-mcp-pro/commit/d1d9fafd286e0b0019f0957a06eb3f08d16ad576))

## [1.1.3](https://github.com/oaslananka/ssh-mcp-pro/compare/ssh-mcp-pro-v1.1.2...ssh-mcp-pro-v1.1.3) (2026-06-11)


### Bug Fixes

* **ci:** disable scorecard publish_results to fix OpenSSF failure ([ac5ce05](https://github.com/oaslananka/ssh-mcp-pro/commit/ac5ce054d046e12c6683b3390176005879f646a4))

## [1.1.2](https://github.com/oaslananka/ssh-mcp-pro/compare/ssh-mcp-pro-v1.1.1...ssh-mcp-pro-v1.1.2) (2026-06-05)


### Bug Fixes

* **ci:** add serialNumber to CycloneDX SBOM for actions/attest compatibility ([f76ed32](https://github.com/oaslananka/ssh-mcp-pro/commit/f76ed323634fc2b2949262d034045f6f557c6c11))
* **ci:** add serialNumber to SBOM and fix Windows PATH resolution ([d21ddd6](https://github.com/oaslananka/ssh-mcp-pro/commit/d21ddd635dca6b68bf7be57e313cbe46434a37bd))

## [1.1.1](https://github.com/oaslananka/ssh-mcp-pro/compare/ssh-mcp-pro-v1.1.0...ssh-mcp-pro-v1.1.1) (2026-06-05)


### Bug Fixes

* remove stale normalizeOutput reference in check-licenses.mjs ([482a083](https://github.com/oaslananka/ssh-mcp-pro/commit/482a083b0502d37a9d6dfbda3955786f65330430))

## [1.1.0](https://github.com/oaslananka/ssh-mcp-pro/compare/ssh-mcp-pro-v1.0.0...ssh-mcp-pro-v1.1.0) (2026-06-05)


### Features

* add per-session rate limiting ([4c2426e](https://github.com/oaslananka/ssh-mcp-pro/commit/4c2426ead396a2540d4816c5488466c92c6c6cab))


### Bug Fixes

* add connector profile tool sets ([37d57b7](https://github.com/oaslananka/ssh-mcp-pro/commit/37d57b737f38e2d5ac75421cb1a2f72a878f1e9e))
* add HTTP rate limit headers ([#27](https://github.com/oaslananka/ssh-mcp-pro/issues/27)) ([fd57534](https://github.com/oaslananka/ssh-mcp-pro/commit/fd57534dbfe9fe47dae9798d4ad253440fe10627))
* add typed structured tool errors ([5f25ccb](https://github.com/oaslananka/ssh-mcp-pro/commit/5f25ccbacc1980968032ed8cfa86363c0e433c4d))
* avoid nullable record comparison ([cafc29c](https://github.com/oaslananka/ssh-mcp-pro/commit/cafc29c00fe917d25e8a3e10a7a0682ec3758037))
* **ci:** refresh actions/checkout SHA to v6.0.3 across 5 workflows ([e827a88](https://github.com/oaslananka/ssh-mcp-pro/commit/e827a885a8538927544240abf5de98184c56ac13))
* **ci:** restore baseline checks ([670455c](https://github.com/oaslananka/ssh-mcp-pro/commit/670455c540eafed28ffc21fcdb3a7837449b5673))
* **compatibility:** negotiate latest MCP protocol ([6c5e5d7](https://github.com/oaslananka/ssh-mcp-pro/commit/6c5e5d7d7cd7f165dd7dd83a85b1a0412dd8ec3f)), closes [#70](https://github.com/oaslananka/ssh-mcp-pro/issues/70)
* **dx:** restore package script entrypoints ([26b11cc](https://github.com/oaslananka/ssh-mcp-pro/commit/26b11ccf4f13e6bc1e4129cbec1b823991b4ccf3)), closes [#57](https://github.com/oaslananka/ssh-mcp-pro/issues/57)
* migrate otel semantic convention constants ([#25](https://github.com/oaslananka/ssh-mcp-pro/issues/25)) ([233c342](https://github.com/oaslananka/ssh-mcp-pro/commit/233c3422108fa2fa0e78f87cdae7eb9c15cfbd82))
* **release:** restore release dry-run gate ([d66e745](https://github.com/oaslananka/ssh-mcp-pro/commit/d66e7458a90bb328704f2a13ceb1da23ab12168e))
* **release:** restore release dry-run gate ([f5c79a6](https://github.com/oaslananka/ssh-mcp-pro/commit/f5c79a652b818596c8a96e690a73f7e570ec3b3c))
* **release:** restore release dry-run gate ([#59](https://github.com/oaslananka/ssh-mcp-pro/issues/59)) ([d66e745](https://github.com/oaslananka/ssh-mcp-pro/commit/d66e7458a90bb328704f2a13ceb1da23ab12168e))
* resolve codeql alert triage ([#35](https://github.com/oaslananka/ssh-mcp-pro/issues/35)) ([5c41528](https://github.com/oaslananka/ssh-mcp-pro/commit/5c415285c40a04883d5b454ab731542139683ab8))
* return structured tool content ([780633b](https://github.com/oaslananka/ssh-mcp-pro/commit/780633b65e753416e1908d301df7617bd2055854))
* **security:** align main branch protection ([1e3ee6c](https://github.com/oaslananka/ssh-mcp-pro/commit/1e3ee6c1c11ebf55f79fdbabb193e146747f36cf))
* **security:** resolve CodeQL high findings ([a97df95](https://github.com/oaslananka/ssh-mcp-pro/commit/a97df959e8b7d361d22a2ca6a921281f6ee213a7))
* **testing:** stabilize unit tests on Windows ([#58](https://github.com/oaslananka/ssh-mcp-pro/issues/58) [#60](https://github.com/oaslananka/ssh-mcp-pro/issues/60)) ([e827a88](https://github.com/oaslananka/ssh-mcp-pro/commit/e827a885a8538927544240abf5de98184c56ac13))
* validate node sqlite startup ([#26](https://github.com/oaslananka/ssh-mcp-pro/issues/26)) ([b89c805](https://github.com/oaslananka/ssh-mcp-pro/commit/b89c80567bb24d957ba6f9a68d1a3a2de70cccc6))

## [Unreleased]

### Added

- Publish generated TypeDoc API reference through GitHub Pages.
- Add repository Taskfile shortcuts for common quality and release checks.

### Changed

- Complete README usage, contributing, and license guidance.
- Remove prohibited attribution and placeholder-marker literals from repository text.

[Unreleased]: https://github.com/oaslananka/ssh-mcp-pro/compare/v1.0.0...HEAD
