# Parser System Standards

## Purpose
Define the architecture and usage patterns for the HTML parsing system that extracts structured data from web pages for the marketing automation system.

## Core Components
- `pageOutline()` - Map-first navigation (landmarks/headings/forms/interactives)
- `subtree()` - Bounded drill-down extraction
- `interactiveElements()` - Action-focused extraction
- `snapshotDiff()` - Change detection between page states

## Parser Configuration
- `maxDepth: 6` - Maximum nesting depth for DOM traversal
- `maxSiblingsPerNode: 80` - Maximum siblings per node to prevent explosion
- `maxTotalNodes: 750` - Overall node limit for performance
- `maxTextLengthPerNode: 200` - Text truncation per node

## MCP (Model Context Protocol) Server
- Dedicated parser server process
- HTTP/SSE transport for agent communication
- In-memory snapshot store with configurable limits
- Separated from main application server for scalability

## Error Handling
- Fail-closed behavior when parser confidence drops below threshold
- Combine parser confidence with legacy confidence (use minimum)
- Log detailed diagnostics when parser confidence is low
- Fallback to raw HTML for edge cases only

## Performance Considerations
- Cache parser results when appropriate
- Limit snapshot storage to prevent memory issues
- Use snapshot diffs to minimize data transfer between agent steps
- Monitor parser performance metrics in production

## Integration Points
- Board observer uses parser to extract structured data
- Publisher flow may use parser for verification
- Diagnostic artifacts include parser output
- Trend analysis may use parsed data for insights