# Environment and Configuration Management Standards

## Purpose
Define standardized approaches for managing environment variables, configuration, and runtime settings in the marketing automation system.

## Core Principles
- Strict validation of environment variables at startup
- Clear separation between configuration and code
- Secure handling of sensitive information
- Consistent naming conventions across the system

## Environment Variable Organization

### Canonical Locations
- Runtime parsing/validation: `config/env.ts`
- Contract list: `.agent/contracts/env.contract.json`
- Schema constraints: `.planning/spec-kit/manifest/schemas/env.schema.json`

### Required Variables
- `PROJECT_ROOT` - Absolute path to project directory
- `FORUM_PRIMARY_ID` - Identifier for target forum (currently "ppomppu")
- `PPOMPPU_USER_ID` - Forum account username
- `PPOMPPU_USER_PW` - Forum account password
- `BOT_PROFILE_DIR` - Browser profile directory
- `ACTIVITY_LOG_PATH` - Path for activity logs

### Optional Variables
- `OBSERVER_GAP_THRESHOLD` - Minimum gap before publisher activation
- `RUN_INTERVAL_MINUTES` - Base interval for scheduler
- `BROWSER_HEADLESS` - Headless vs headed browser mode
- `DRY_RUN_MODE` - Simulation mode for testing
- `LOG_LEVEL` - Logging verbosity ('error', 'warn', 'info', 'debug')

## Configuration Validation

### At Startup
- All required environment variables must be present
- Values must pass type and range validation
- Absolute paths must be properly formatted
- Conflicting settings must be resolved predictably

### Runtime Validation
- Environment variables are parsed with appropriate defaults
- Invalid values trigger clear error messages
- Type coercion follows predictable patterns
- Validation errors prevent system startup

## Security Standards

### Secret Handling
- Never log sensitive environment variables
- Never commit credentials to version control
- Mask secrets in error messages and logs
- Use secure credential storage in production

### Access Controls
- Environment variables are accessed through centralized config object
- No direct access to `process.env` in business logic
- Validation occurs at a single entry point
- Configuration changes are auditable

## Naming Conventions

### Environment Variables
- Use uppercase with underscores (e.g., `BROWSER_HEADLESS`)
- Prefix related groups (e.g., `KAKAO_*` for Kakao integration)
- Use descriptive names that clearly indicate purpose
- Follow the contract definitions in `.agent/contracts/env.contract.json`

### Configuration Properties
- Use camelCase for runtime properties (e.g., `browserHeadless`)
- Maintain correspondence between env var and property names
- Use appropriate TypeScript types for all properties
- Document all configuration options

## Runtime Configuration

### Dynamic Settings
- Some settings can be adjusted at runtime via API
- Changes are persisted to ensure continuity across restarts
- Version control prevents conflicting updates
- Validation applies to runtime changes as well

### Persistence Mechanism
- Runtime controls are saved to `.agent/state/`
- State versioning prevents conflicts
- Atomic writes ensure consistency
- Backup mechanisms protect against corruption

## Specialized Configurations

### Parser Configuration
- `CUSTOM_PARSER_ENABLED` - Toggle for custom parser system
- `BROWSER_REQUEST_LOGGING` - Enable detailed request logging
- `PARSER_DETAILED_LOGGING` - Additional parser diagnostics

### Publisher Configuration
- `PUBLISHER_DEBUG_SCREENSHOTS` - Capture step screenshots
- `PUBLISHER_DEBUG_TRACE` - Record Playwright traces
- `PUBLISHER_POST_SUBMIT_WAIT_MS` - Wait time after submission

### Scheduler Configuration
- `SCHEDULER_JITTER_PERCENT` - Randomization of schedule intervals
- `SCHEDULER_JITTER_MODE` - Jitter algorithm selection
- `TARGET_PUBLISH_INTERVAL_MINUTES` - Desired publication frequency

## Error Handling

### Validation Failures
- Clear error messages indicating which variable is invalid
- Specific guidance on expected format/type/range
- Prevention of system startup with invalid configuration
- Logging of validation failures for debugging

### Missing Required Variables
- Explicit identification of missing variables
- Reference to documentation or examples
- Prevention of system operation without required settings
- Clear instructions for remediation

## Documentation Standards

### Inline Comments
- Explain purpose of non-obvious configuration options
- Provide examples for complex value formats
- Reference related configuration options
- Indicate default behavior when option is absent

### External Documentation
- Update contract files when adding new variables
- Reflect changes in schema definitions
- Update example files (`.env.example`)
- Document impact of configuration changes