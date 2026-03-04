---
name: mcp
description: Manage MCP (Model Context Protocol) servers for Claude Code. Use when the user asks to add, remove, debug, list, or configure MCP servers, or asks about MCP config files, scopes, or troubleshooting.
disable-model-invocation: true
user-invocable: true
argument-hint: [action] [server-name]
allowed-tools: Bash(*), Read, Grep, Glob
---

# MCP Server Management for Claude Code

You are helping the user manage MCP servers. Interpret `$ARGUMENTS` to determine the action.

## Configuration Scopes

MCP servers operate at three scopes:

| Scope | Flag | Where it writes | Visibility |
|-------|------|-----------------|------------|
| `local` | `-s local` *(default)* | `~/.claude.json` → `projects.<path>.mcpServers` | Only you, current project only |
| `project` | `-s project` | `.mcp.json` in project root | Everyone on the project (commit this) |
| `user` | `-s user` | `~/.claude.json` → top-level `mcpServers` | Only you, all projects |

### Key points

- **`local`** (default) is the best choice for private, project-specific servers. Config lives in `~/.claude.json` nested under the project path — outside the repo, invisible to git, scoped to this project.
- **`project`** writes `.mcp.json` to the repo root — meant for team-shared servers. Add to `.gitignore` if you don't want it committed.
- **`user`** is global — server appears in every project.
- `~/.claude/settings.json` does NOT load MCP servers.

### Config Format

`.mcp.json` (project scope) uses this structure:

```json
{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@some/mcp-package"],
      "env": { "API_KEY": "your-key-here" }
    }
  }
}
```

`~/.claude.json` holds both user and local scope:

```json
{
  "mcpServers": { "my-global-tool": { ... } },
  "projects": {
    "/path/to/project": {
      "mcpServers": { "project-local-tool": { ... } }
    }
  }
}
```

### Load Order (precedence, later wins)

1. User scope (`~/.claude.json` global `mcpServers`)
2. Project scope (`.mcp.json` in project root)
3. Local scope (`~/.claude.json` under `projects.<path>.mcpServers`)

## CLI Commands

### Adding servers

```bash
# Local scope (default) — private, project-specific, outside repo
claude mcp add <name> -- <command> [args...]

# With env vars (put -e flags BEFORE --, name and command AFTER --)
claude mcp add -e API_KEY=xxx -e OTHER=yyy -- <name> <command> [args...]

# Project scope (shared via .mcp.json in repo root)
claude mcp add -s project -- <name> <command> [args...]

# User scope (all your projects)
claude mcp add -s user -- <name> <command> [args...]

# Remote (SSE)
claude mcp add --transport sse my-remote --header "Authorization: Bearer ${TOKEN}" https://api.example.com/sse

# Remote (HTTP)
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp

# JSON format (preferred for complex configs)
claude mcp add-json my-server '{"type":"stdio","command":"npx","args":["-y","@some/mcp-package"],"env":{"API_KEY":"abc123"}}'
```

**Gotcha:** The `--` separator is required when using `-e` flags. Without it, the CLI misparses the server name as an env var. Correct order: `claude mcp add -e KEY=val -- name command args`.

### Removing servers

```bash
claude mcp remove <name>               # remove from local scope (default)
claude mcp remove -s project <name>    # remove from project scope
claude mcp remove -s user <name>       # remove from user scope
```

### Other commands

```bash
claude mcp list                   # list all registered servers + health check
claude mcp get <name>             # show config for a specific server
claude mcp reset-project-choices  # reset approve/deny decisions for .mcp.json servers
```

## Debugging

### Step-by-step

1. **Check registration:** `claude mcp list` and `claude mcp get <name>`
2. **Check connection inside session:** run `/mcp` — shows `connected` or `failed` per server
3. **Verbose startup:** `claude --mcp-debug`
4. **Slow server:** `MCP_TIMEOUT=15000 claude`
5. **Test binary directly:**
   ```bash
   echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}},"id":1}' | npx -y @some/mcp-package
   ```
6. **Find stuck processes:** `ps aux | grep mcp` then `kill <pid>`

### Common issues

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Server shows `failed` | Binary not found or bad args | Test the command manually |
| Server not in `/mcp` | Config in wrong file/scope | Check `~/.claude.json` vs `.mcp.json` |
| `command not found: npx` | PATH not set | Use full path or add to `env` block |
| Server times out | Slow init | `MCP_TIMEOUT=15000` |
| Works locally, not in project | Scope mismatch | Use `-s project` or check `.mcp.json` |
| `claude mcp list` output empty | TTY rendering issue | Redirect: `claude mcp list > /tmp/out.txt; cat /tmp/out.txt` |

## Notable Servers

| Server | Package | What it does |
|--------|---------|-------------|
| context7 | `@upstash/context7-mcp` | Up-to-date library docs |
| filesystem | `@modelcontextprotocol/server-filesystem` | Read/write local files |
| github | `@modelcontextprotocol/server-github` | GitHub repos, PRs, issues |
| memory | `@modelcontextprotocol/server-memory` | Persistent memory across sessions |
| brave-search | `@modelcontextprotocol/server-brave-search` | Web search via Brave API |
| playwright | `@playwright/mcp` | Browser automation |

### Where to find more

- **Official:** [github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- **Smithery:** [smithery.ai](https://smithery.ai) — 2,200+ servers
- **MCP.so:** [mcp.so](https://mcp.so) — 3,000+ servers
- **Glama:** [glama.ai/mcp/servers](https://glama.ai/mcp/servers) — curated catalog

## Instructions

When the user invokes `/mcp`:

1. **No arguments or "help"** — Show a brief summary of available actions (add, remove, list, debug, find).
2. **"add <name>"** — Guide them through adding the server. Ask about scope if not specified. Prefer `add-json` for complex configs. Default to `local` scope for private servers.
3. **"remove <name>"** — Run `claude mcp remove <name>`. Ask about scope if needed.
4. **"list"** — Run `claude mcp list > /tmp/mcp_list.txt 2>&1; cat /tmp/mcp_list.txt` (direct output often invisible due to TTY rendering).
5. **"debug" or "fix"** — Walk through the debugging steps above. Read config files, check for common issues.
6. **"find <topic>"** or "search"** — Help them find a suitable MCP server using WebSearch if needed, then help install it.
7. **Any other query** — Use the reference above to answer their MCP-related question.

Always read the relevant config files (`~/.claude.json`, `.mcp.json`) before making changes so you understand current state. When adding servers, confirm the scope with the user if ambiguous.
