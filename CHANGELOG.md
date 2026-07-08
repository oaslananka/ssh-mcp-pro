# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0](https://github.com/oaslananka/ssh-mcp-pro/compare/ssh-mcp-pro-v1.1.5...ssh-mcp-pro-v1.2.0) (2026-07-08)


### Features

* add device onboarding scripts and guide ([58f0104](https://github.com/oaslananka/ssh-mcp-pro/commit/58f0104122d7ee17e72dd3eb35064e6e55cd35db))
* add process and system management tools ([a85f3e6](https://github.com/oaslananka/ssh-mcp-pro/commit/a85f3e60b9fe02c089c9e5a276af01dfa99d3d87))
* SSH MCP server with remote control plane and ChatGPT connector ([d8058cd](https://github.com/oaslananka/ssh-mcp-pro/commit/d8058cd605c1dc9978c4217cb34ad255376856de))


### Bug Fixes

* **security:** resolve CodeQL alert [#1](https://github.com/oaslananka/ssh-mcp-pro/issues/1), add image scanning and publint ([#5](https://github.com/oaslananka/ssh-mcp-pro/issues/5)) ([1043dc8](https://github.com/oaslananka/ssh-mcp-pro/commit/1043dc80a5de75c97c8ed0705dde6ed5b68fa290))

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
