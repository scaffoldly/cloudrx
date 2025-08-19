# Setting Up CodeQL for CloudRx

This guide explains how to set up CodeQL analysis for the CloudRx project to detect and fix security vulnerabilities.

## Setup Instructions

To enable CodeQL security scanning on this repository, you'll need to create a GitHub workflow file. Since the Claude GitHub Action doesn't have permission to create workflow files directly, follow these manual steps:

1. Create a file at `.github/workflows/codeql.yml` with the following content:

```yaml
name: "CodeQL"

on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]
  schedule:
    - cron: '0 0 * * 0'  # Run every Sunday at midnight

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      security-events: write

    strategy:
      fail-fast: false
      matrix:
        language: [ 'javascript' ]

    steps:
    - name: Checkout repository
      uses: actions/checkout@v4

    - name: Initialize CodeQL
      uses: github/codeql-action/init@v3
      with:
        languages: ${{ matrix.language }}
        config-file: .github/codeql-config.yml

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Build
      run: npm run build

    - name: Perform CodeQL Analysis
      uses: github/codeql-action/analyze@v3
      with:
        category: "/language:${{matrix.language}}"
```

2. Create a CodeQL configuration file at `.github/codeql-config.yml` with the following content:

```yaml
name: "CloudRx CodeQL Config"

queries:
  - uses: security-extended
  - uses: security-and-quality

paths:
  - src

paths-ignore:
  - node_modules
  - dist
  - tests

query-filters:
  - exclude:
      problem.severity:
        - note
        - warning
```

3. Enable CodeQL in your repository settings:
   - Go to Settings > Code security and analysis
   - Enable "Code scanning" with GitHub Actions
   - Select the CodeQL Analysis workflow

## Expected Results

Once configured, CodeQL will detect the security vulnerabilities in `src/util/insecure-example.ts`, including:

1. Use of `eval()` with user input (Critical)
2. Regular expression denial of service (ReDoS) vulnerability (High)
3. Hardcoded credentials (Medium)
4. SQL injection vulnerability (Critical)

The secure alternatives are provided in `src/util/secure-examples.ts` as a reference for resolving these issues.