import type { BuiltinSkillDefinition } from './types.js';

export const mermaidDiagrams: BuiltinSkillDefinition = {
  slug: 'mermaid-diagrams',
  name: 'Mermaid Diagrams',
  description:
    'Use whenever a picture communicates faster than prose — architecture, control/data flow, sequence of calls, state machine, data model, or timeline. Output a ```mermaid fenced block and Tide Commander renders it as a diagram inline in the chat.',
  // Output-only skill: no tools needed, it changes HOW you present, not what you can do.
  allowedTools: [],
  // Available to every agent by default.
  assignedAgentClasses: ['*'],
  content: `# Mermaid Diagrams

Tide Commander renders **Mermaid** diagrams inline in the chat UI. When a visual would
land faster than a paragraph, emit a fenced \`mermaid\` code block — it shows up as a
rendered diagram, no tool call required.

## When to reach for a diagram
- Multi-step flow / control flow / algorithm → **flowchart**
- Interactions or calls between services, agents, or components over time → **sequenceDiagram**
- Entities and their relationships (DB schema, domain model) → **erDiagram**
- States and transitions → **stateDiagram-v2**
- Project phases / schedule → **gantt**
- Class or module structure → **classDiagram**

Skip it when a single sentence already does the job — don't diagram the trivial.

## How
Put valid Mermaid inside a fenced block tagged \`mermaid\`:

\`\`\`mermaid
flowchart TD
  A[User request] --> B{Cached?}
  B -- yes --> C[Serve from cache]
  B -- no --> D[Query DB] --> E[Cache result] --> C
\`\`\`

If the syntax is invalid (or still streaming), the UI safely falls back to showing the
raw source instead of breaking — so only ship diagrams whose syntax you're confident is valid.

## More examples

Sequence of calls:
\`\`\`mermaid
sequenceDiagram
  participant U as User
  participant API
  participant DB
  U->>API: POST /order
  API->>DB: INSERT order
  DB-->>API: ok (id=42)
  API-->>U: 201 Created
\`\`\`

Data model:
\`\`\`mermaid
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : "referenced by"
\`\`\`

State machine:
\`\`\`mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Working: assign task
  Working --> Idle: done
  Working --> Error: fail
  Error --> Idle: retry
\`\`\`

## Tips
- Keep node/participant labels short; long text overflows — wrap or abbreviate.
- One diagram per fenced block.
- Special characters in labels (\`(\`, \`:\`, \`#\`, \`"\`) often need quoting — Mermaid is picky.
- Prefer the modern \`flowchart\` keyword over the legacy \`graph\`.
- Mentally validate the syntax before sending; a broken diagram just renders as code.`,
};
