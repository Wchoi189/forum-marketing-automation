# Agent OS Integration Guide

This document explains how to use Agent OS with the marketing automation project.

## Overview

Agent OS is integrated into this marketing automation system to provide standardized AI-assisted development practices. The integration includes project-specific standards and Claude commands that align with the system's architecture and operational patterns.

## Directory Structure

```
agent-os/
└── standards/                 # Project-specific standards
    ├── index.yml             # Catalog of available standards
    ├── tech-stack.md         # Technology stack and architecture
    ├── automation-workflow.md # Standards for observer/publisher workflow
    ├── parser-system.md      # Standards for HTML parsing system
    └── mempalace-memory-loop.md # Standards for agent memory loop
```

## Available Claude Commands

The following commands are available in `.claude/commands/agent-os/`:

- `discover-standards.md` - Extract patterns and conventions from the codebase
- `index-standards.md` - Update the standards index with new descriptions
- `inject-standards.md` - Inject relevant standards into AI context
- `plan-product.md` - Create structured plans for new features
- `shape-spec.md` - Develop better specifications for implementations

## Using Agent OS with This Project

### 1. Discovering Current Standards
When working on new features or refactoring, use the `/discover-standards` command to identify patterns in the existing codebase that should be maintained.

### 2. Understanding Architecture
Before implementing changes, review the following standards documents:
- `tech-stack.md` for technology decisions
- `automation-workflow.md` for behavioral patterns
- `parser-system.md` for data extraction patterns
- `mempalace-memory-loop.md` for agent state management

### 3. Following Established Patterns
- Maintain fail-closed behavior in automation flows
- Preserve contract alignment between runtime code and spec-kit manifests
- Follow the gap-driven scheduler logic (not time-driven)
- Use the parser system appropriately for DOM extraction

### 4. Updating Standards
When introducing new architectural patterns or changing established ones:
1. Update the relevant standards document in `agent-os/standards/`
2. Update the `index.yml` file with accurate descriptions
3. Consider the impact on existing automation behaviors

## Key Architectural Principles

### Fail-Closed Automation
The system is designed to err on the side of caution. When uncertainty exists, the automation should pause rather than risk incorrect behavior.

### Deterministic Behavior
All automation workflows should produce predictable results given the same inputs. Randomness or timing-dependent behavior should be minimized.

### Contract Alignment
Changes to runtime code must be reflected in spec-kit manifests and vice versa. Maintain synchronization between implementation and specification.

### Memory Continuity
Use the MemPalace memory loop for maintaining state across AI sessions, especially when working on complex multi-step implementations.

## Operational Considerations

### Environment Variables
- All environment variables are validated at runtime via `config/env.ts`
- Secrets are never logged or persisted
- Default values are provided for optional settings

### Debugging & Artifacts
- Publisher debugging can be enabled with `PUBLISHER_DEBUG_SCREENSHOTS`
- Playwright traces can be captured with `PUBLISHER_DEBUG_TRACE`
- Artifacts are stored under `artifacts/publisher-runs/`

### Scheduler Behavior
- The scheduler is gap-driven, not time-driven
- After successful publication, recheck intervals become more frequent
- Monitor gap levels to ensure proper scheduler operation

## Best Practices

1. **Before implementing new automation logic**, review `automation-workflow.md`
2. **When extending the parser system**, consult `parser-system.md`
3. **For state management in AI agents**, follow `mempalace-memory-loop.md`
4. **When changing architecture**, update `tech-stack.md` accordingly
5. **Always maintain backward compatibility** with existing API contracts
6. **Preserve fail-closed behavior** in all new automation features

## Troubleshooting

If the Claude commands don't appear to be working:
1. Verify that `.claude/commands/agent-os/` exists and contains the MD files
2. Restart your Claude Code session to reload commands
3. Check that your project root is correctly identified

If standards seem outdated:
1. Review the corresponding files in `agent-os/standards/`
2. Update them to reflect current implementation
3. Update the `index.yml` descriptions as needed