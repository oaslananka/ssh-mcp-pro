# SonarQube Cloud analysis

This repository uses **SonarQube Cloud Automatic Analysis** for GitHub pull requests and the default branch. SonarScanner must not run in GitHub Actions while automatic analysis is enabled; the two methods conflict.

The GitHub CI workflow runs Node 24 and 26 test/coverage gates and uploads LCOV coverage artifacts. Vitest enforces local coverage thresholds independently of SonarQube Cloud. SonarQube Cloud automatic analysis **cannot import LCOV coverage**: its quality gate must not be interpreted as measuring this repository's test coverage. The project coverage minimum remains enforced in CI.

Do not add `SONAR_TOKEN`, another Doppler credential-fetch step, or `sonarqube-scan-action` to this workflow for automatic analysis. To migrate back to CI analysis, first explicitly switch off Automatic Analysis in SonarQube Cloud, then implement a single authenticated scanner pipeline and restore LCOV import.

Security and maintainability findings, especially new-code duplication, remain enforced by SonarQube Cloud's independent GitHub PR check. Do not weaken duplication thresholds or bypass repository rules to make CI green.
