# Automation Workflow Standards

## Purpose
Define the standardized patterns and behaviors for the observer/publisher automation workflow in the marketing automation system.

## Core Principles
- Deterministic behavior with explicit failure conditions
- Fail-closed to prevent unintended actions
- Contract alignment between runtime code and spec-kit manifests
- Preserve existing API behavior during refactoring

## Observer Workflow
- Monitors target board for competitive positioning
- Calculates gap relative to target author posts
- Enforces minimum gap threshold before publisher activation
- Parses board content using both legacy and custom parser
- Logs all activities for audit and debugging

## Publisher Workflow
- Executes browser automation to publish content
- Loads predefined drafts from saved items
- Verifies successful submission through URL transition
- Captures diagnostic artifacts on failure
- Maintains persistent browser context for session management

## Gap Calculation Logic
- `gap` = number of posts AHEAD of ours (`sharePlanIndex` in `bot.ts`)
- `SAFE` means gap ≥ threshold, indicating it's safe to publish RIGHT NOW
- Gap-driven scheduling (not time-driven) after successful publish
- Critical gap levels trigger scheduler recheck intervals

## Error Handling
- Capture screenshots on all publisher failures
- Maintain artifact directories for debugging
- Preserve error context for post-mortem analysis
- Notify operators via Slack on critical failures

## Configuration Management
- Environment variable validation at startup
- Runtime controls with persistence across restarts
- Preset configurations for different operational modes
- Version-controlled spec-kit manifests for contract enforcement

## Security & Privacy
- Never log or commit secret values (credentials, API keys)
- Mask sensitive information in logs and artifacts
- Use secure credential storage mechanisms
- Implement proper authentication for all interfaces

## Debugging & Observability
- Optional screenshot capture for step-by-step debugging
- Playwright trace recording for session replay
- Success trace sampling to manage storage costs
- Detailed logging with configurable verbosity levels