# Contributing

claude-budget-mcp is open source under the [MIT License](LICENSE).

## Issues

Issues, bug reports and ideas are very welcome. Pick the matching [issue form](https://github.com/pihme/claude-budget-mcp/issues/new/choose) (bug report, endpoint or login change, feature request, documentation, question). A good report names the claude-budget-mcp version or commit, your OS, Node.js and Claude Code versions, which tool you called, what you expected and what happened.

## Pull requests

Pull requests are welcome; contributions are accepted under the [MIT License](LICENSE). For anything bigger than a small fix, please open an issue first so we can agree on the change. Keep a pull request to one change, fill in the [pull request template](.github/pull_request_template.md), give it a [Conventional Commit](https://www.conventionalcommits.org/) title (`fix: …`, `feat: …`, `docs: …`; it becomes the squash commit and decides the next release), and make sure `npm test` passes.

## Security and secrets

The tracker is public. Never paste your `.credentials.json`, a token, an `Authorization` header or the raw usage response into an issue or pull request; field names and their types are enough. Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## Build and test locally

Needs Node.js 22+ and npm. The tests need no Claude account: they mock the usage endpoint and use synthetic credentials files.

```bash
npm install
npm run build
npm test
```

`npm run smoke` is optional: it starts the server over stdio and calls `get_budget` once with **your** real Claude Code login, which is one request to the unofficial endpoint.
