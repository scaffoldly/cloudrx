# Security Policy

## Reporting Security Issues

If you believe you have found a security vulnerability in CloudRx, please report it to us privately. **Do not disclose security-related issues publicly**.

Please contact us at security@scaffoldly.com with details about the vulnerability.

## Security Measures

The CloudRx project takes security seriously:

1. **Dependency Monitoring**: Regular scanning of dependencies for known vulnerabilities
2. **Static Code Analysis**: Automated CodeQL scans on all pull requests and main branch commits
3. **Code Review**: All code changes undergo thorough review for security issues
4. **Secure Coding Practices**: Following industry best practices for TypeScript/JavaScript security

## Supported Versions

We currently provide security updates for these versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Secure Usage Guidelines

When using CloudRx in your applications, follow these security best practices:

1. **Minimal Permissions**: When using CloudRx with AWS DynamoDB, follow the principle of least privilege for IAM roles and users
2. **Secure Configuration**: Never hardcode credentials in your application code
3. **Input Validation**: Always validate user input before processing with CloudRx
4. **Logging Configuration**: Avoid logging sensitive data by configuring appropriate log levels

## Security-Related Examples

The repository includes security-related example files that demonstrate both vulnerable patterns to avoid (`src/util/insecure-example.ts`) and their secure alternatives (`src/util/secure-examples.ts`). These files are provided for educational purposes only and should not be used in production code.

The insecure examples intentionally contain:
- Use of `eval()` with user input
- Inefficient regular expressions vulnerable to ReDoS
- Hardcoded credentials
- SQL injection vulnerabilities

Always refer to the secure alternatives that demonstrate proper practices:
- Safe input processing with explicit operations
- Secure regular expressions
- Environment-based configuration
- Parameterized queries