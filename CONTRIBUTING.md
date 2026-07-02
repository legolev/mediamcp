# Contributing to mediamcp

Thanks for your interest! Issues and PRs are welcome in English or Russian. / Ишьюс и PR приветствуются на английском или русском.

## Quick start

```bash
git clone https://github.com/legolev/mediamcp && cd mediamcp
npm install
npm run dev          # run the server from sources (tsx)
npm run inspect      # poke the tools interactively via MCP Inspector
```

Before opening a PR, make sure the full check passes:

```bash
npm run typecheck && npm run build && npm test && npm run smoke
```

## Guidelines

- **Bugs**: open an issue with the output of the `check_config` tool (it masks your API key) and the exact tool call that failed.
- **Features**: open an issue first for anything non-trivial — especially new providers or new tools — so we can agree on the shape before you write code.
- **Code style**: strict TypeScript, no `any`, keep the provider abstraction (`src/providers/types.ts`) intact. New behavior needs a unit test in `test/`.
- **Commits**: plain descriptive messages; English preferred.

## Release process (maintainers)

`npm version patch|minor && git push --follow-tags` — the `release.yml` workflow publishes to npm (Trusted Publishing) and to the MCP registry.
