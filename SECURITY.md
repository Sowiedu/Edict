# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.5.x   | ✅ Current |

## Reporting a Vulnerability

Edict compiles and runs agent-generated code in a WASM sandbox. Security matters.

**To report a vulnerability:**

1. **Do not** open a public issue
2. Email **security@sowiedu.dev** or use [GitHub's private vulnerability reporting](https://github.com/Sowiedu/Edict/security/advisories/new)
3. Include: description, reproduction steps, and potential impact

**Response timeline:**
- Acknowledgment within 48 hours
- Assessment within 1 week
- Fix or mitigation within 2 weeks for confirmed vulnerabilities

## Scope

Security-relevant areas include:
- WASM sandbox escapes
- Contract verification bypasses (Z3 integration)
- MCP tool injection or privilege escalation
- Denial of service via crafted ASTs (e.g., triggering unbounded Z3 computation)
