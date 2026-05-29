## Mermaid Rules

The mermaid is detailed in the table below, with a serial number column

### Layout and structure

- Specify layout orientation (TB/RL/BT/LR)
- Use subgraph to define logical areas, format: subgraph ID [display name]
- Support nested subgraphs to represent hierarchical relationships
- Use the ID [Show Text] format for each node

### Connecting relationships

- Use the -- "description" --> syntax to represent labeled connections
- Distinguish between different types of relationships (data flows, control flows, dependencies, etc.)
- Different semantics can be expressed using dotted lines, arrow styles, etc

- If the node text contains [, ], {, }, (, ), -->, ==> and other Mermaid reserved characters or special characters, especially [ and ], they must be wrapped in double quotation marks, for example: ["The text contains [square brackets]"]
- Avoid using unescaped symbols such as [, ], (, ), >, : and so on directly in the node tag
- Declare in directions using standard graph TD / LR / BT etc
- Keep hierarchies clear and node names concise and readable
- Verify grammatical correctness before output
- If it is a static graph, it is forbidden to include arrows and process relationships
- Direct use of double-quoted text as the node ID is not supported in the connection statement unless the node is properly defined. You can use underscores instead of spaces and remove double quotes

### Style

- Use init syntax to define modernized topics
- Set the container style for the main region: style SubgraphID fill:#color,stroke:#color,stroke-width:npx
- Define classDef:classDef typeName fill:#color,stroke:#color for the node type
- Apply the style class to the nodes: class node1, node2, typeName
- Support for dotted borders: stroke-dasharray: 5 5

### Universal color rule system

- Hierarchical distinction:

  - Layer 1 (core): fill:#e6f3ff, stroke:#0066cc
  - Layer 2 (middle): fill:#fff0e6, stroke:#ff9900
  - Layer 3 (edge): fill:#f9f9f9, stroke:#ccc

- Function Type:

  - Processing unit: fill:#cce5ff, stroke:#0066cc
  - Memory Unit: fill:#e6ffe6, stroke:#009900
  - Monitoring unit: fill:#fff3cd, stroke:#ffc107
  - Network components: fill:#f8f9fa, stroke:#495057

- Status indication:

  - Active state: stroke:#007bff, stroke-width:2px
  - Warning status: fill:#fff3cd, stroke:#ffc107
  - Error status: fill:#f8d7da, stroke:#dc3545
  - Success status: fill:#d1e7dd, stroke:#198754

- Visual Hierarchy:

  - Main components: fill:#f8f9fa, stroke:#495057
  - Secondary components: fill:#e9ecef, stroke:#6c757d
  - Auxiliary components: fill:#dee2e6, stroke:#adb5bd

- Color scheme:

  - Cool tones: blue (#cce5ff, #e6f3ff, #0066cc)
  - Warm tones: orange (#fff0e6, #ffebcc, #ff9900)
  - Neutral colors: gray (#f9f9f9, #f0f0f0, #ccc)
  - Highlights: Green (#e6ffe6, #ccffcc, #009900)

### Documentation

- Use %% to add comments to explain the features of each section
- Annotate complex processes in segments
- Keep your code organized clearly, with empty lines separating logical blocks

### Best Practices

- Define the structure before adding the style
- Use consistent naming conventions
- Keep the layout balanced and avoid cross-connecting
- Prioritize vertical layout (TB), consider landscape (RL) for complex scenes
- Test readability at different zoom levels
- Maintains text color contrast with background (usually color:#000)

- Fill can be used as component base colors such as '#ffe6cc', '#fff2cc', '#f8cecc', '#dae8fc', '#d5e8d4', '#e1d5e7', '#f5f5f5', etc
- The border stroke is a slightly darker color
- The border width stroke-wide is 2px
- Every subgraph should have a style
- The subgraph and the internal components should use a similar color system (not exactly the same, there must be a degree of distinction), and the subgraph should be light
