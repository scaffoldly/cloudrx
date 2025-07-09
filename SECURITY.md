# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| beta    | :white_check_mark: |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of CloudRx seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please use GitHub's security advisory feature to report vulnerabilities privately:

**[Report a Security Vulnerability](https://github.com/scaffoldly/cloudrx/security/advisories/new)**

This allows us to work with you in a private, secure environment to understand and resolve the issue before any public disclosure.

You should receive a response within 24 hours. The GitHub security advisory system will notify the maintainers automatically.

### What to Include

Please include the following information in your report:

- Type of issue (e.g. buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit the issue

This information will help us triage your report more quickly.

## Security Considerations

When using CloudRx, please consider the following security best practices:

### AWS Credentials

- **Never commit AWS credentials** to version control
- Use IAM roles with minimal required permissions
- Rotate credentials regularly
- Use AWS credential management best practices

### Data Protection

- **Sensitive Data**: Never log or persist sensitive information like passwords, API keys, or personal data
- **Encryption**: Consider encrypting sensitive data before persistence
- **TTL Configuration**: Use appropriate TTL settings to ensure data doesn't persist longer than necessary

### Network Security

- Use VPC endpoints when possible for AWS service communication
- Implement proper network access controls
- Monitor CloudTrail logs for unusual activity

### Code Security

- Keep dependencies up to date
- Use TypeScript strict mode for type safety
- Implement proper input validation
- Handle AbortSignals properly to prevent resource leaks

## Preferred Languages

We prefer all communications to be in English.

## Policy

We follow the principle of [Coordinated Vulnerability Disclosure](https://www.cisa.gov/coordinated-vulnerability-disclosure-process).
