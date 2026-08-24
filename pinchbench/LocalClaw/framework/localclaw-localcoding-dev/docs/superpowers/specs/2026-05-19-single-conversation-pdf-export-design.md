# Single Conversation PDF Export Design

## Goal

Support exporting the currently active chat conversation as a directly downloaded PDF file.

The exported PDF must:
- include only the current active session
- include user messages and assistant final replies
- include image attachment previews
- show non-image attachments as filename cards
- exclude tool call output, execution traces, right-panel content, input area, loading indicators, and result toggles

## Scope

This feature is limited to the chat client.

Included:
- export trigger for the active session
- PDF generation in the client
- export-only conversation rendering
- filename generation for the downloaded PDF

Excluded:
- batch export
- exporting multiple sessions at once
- backend PDF generation APIs
- full-fidelity export of tool execution cards
- cron/channel session export behavior beyond the existing chat session view

## User Experience

### Trigger

Add an export action in the active conversation area so the user can export the currently open session without leaving the chat view.

### Output Rules

The PDF contains a clean transcript view for the current session:
- user prompts are included
- assistant readable message content is included
- image attachments are rendered as previews
- non-image attachments are rendered as compact file cards with filename and type if available
- tool outputs and execution metadata are omitted

### File Naming

The downloaded filename uses the active session title when available:
- `<session-title>-YYYY-MM-DD.pdf`
- fallback: `session-YYYY-MM-DD.pdf`

The title must be sanitized so it is safe for filesystem download names.

## Recommended Approach

Use client-side PDF generation.

Why this approach:
- matches the required interaction of direct file download
- avoids adding a server endpoint and browser automation runtime
- reuses the existing active session state already present in the client

Why not browser print:
- it typically gives good layout fidelity, but it is not a direct download flow

Why not server-side PDF generation:
- it expands the scope into backend rendering and deployment concerns without clear need for a single-session export

## Architecture

### Export Data Source

The source of truth is the active session already loaded in the client store and rendered in the main conversation column.

The export pipeline should not scrape the live DOM of the interactive chat view. Instead, it should derive a filtered export model from the active session messages and render that model into a dedicated export container.

### Export View Model

Create a small export-specific transformation layer that converts current session messages into export-safe entries.

The transformation must:
- keep user prompt text
- keep user attachments, split into image previews and non-image file cards
- keep assistant final readable text content
- discard tool output cards, permission UI, execution traces, thinking states, and other non-transcript chrome

This separation reduces coupling to the interactive chat layout and gives a stable surface for PDF rendering and testing.

### Export Renderer

Render the filtered transcript into an off-screen or print-hidden export container in the client.

The export renderer should:
- preserve markdown readability
- use export-specific spacing and fixed-width constraints suitable for PDF pages
- avoid sticky, animated, interactive, or overlay UI
- ensure wide content such as code blocks and tables remains readable within page width constraints

### PDF Generation

Use a client-side PDF library that can capture a specific DOM container and save it as a PDF.

Requirements for the PDF layer:
- direct file download from the current page
- multi-page output support
- acceptable rendering of text, markdown blocks, tables, and inline images
- no backend dependency

## Component Changes

### Active Session Actions

Add an export action near the current session view controls in the main chat area.

Behavior:
- enabled only when there is an active session
- can optionally show a temporary exporting state while the PDF is being generated

### Export Utilities

Introduce focused utilities for:
- filtering session messages into exportable entries
- generating safe PDF filenames
- invoking PDF generation for a supplied container element

These utilities should be small and individually testable.

### Export Transcript Component

Add a dedicated transcript renderer for PDF export rather than reusing the whole interactive conversation tree directly.

This component is responsible only for printable transcript presentation.

## Error Handling

If export cannot proceed:
- no active session: do nothing or keep the action hidden/disabled
- PDF generation failure: surface a user-visible error toast
- missing attachments: continue export with the remaining transcript content instead of failing the whole export

The export path should degrade gracefully. Partial transcript export is preferable to a hard failure where possible.

## Testing Strategy

### Unit-Level Checks

Add focused tests for the pure logic:
- filtering removes tool output and execution-only content
- image attachments remain in export entries
- non-image attachments become filename cards
- filename generation sanitizes titles and applies fallback names

### Validation

After implementation:
- run the focused tests for the export utility layer
- run the client build from repo root with `pnpm build`

## Risks And Mitigations

### Risk: Interactive message components do not map cleanly to export output

Mitigation:
- build a dedicated export view model and export renderer instead of serializing the live UI

### Risk: PDF library introduces heavy rendering quirks for long conversations

Mitigation:
- keep the export container simple and print-oriented
- validate with long markdown, tables, images, and code blocks

### Risk: Assistant message shapes vary across message types

Mitigation:
- keep export filtering conservative and only include clearly readable final transcript content
- leave tool/result-only message variants out of scope for the first version

## Success Criteria

The feature is successful when:
- the user can export the currently open chat session with one action
- the browser downloads a PDF immediately
- the PDF includes only transcript content relevant to human reading
- image attachments are visible in the exported file
- non-image attachments are represented by filename cards
- the feature builds successfully in the existing client pipeline