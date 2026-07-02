# Security Policy

## Supported versions

Only the latest published npm version of `mediamcp` is supported.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead use
[GitHub private vulnerability reporting](https://github.com/legolev/mediamcp/security/advisories/new)
(Security → Report a vulnerability). You'll get a response within a few days.

## Scope notes

- mediamcp runs locally over stdio and sends your prompt/images to the endpoint you configure (OpenRouter by default). It never sends your API key anywhere except the configured endpoint's origin.
- API keys are redacted from all error messages and logs; if you find a code path where a key can leak, that's a vulnerability — please report it.
