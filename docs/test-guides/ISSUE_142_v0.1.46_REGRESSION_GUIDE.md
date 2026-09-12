# Issue 142: stable scrollback after streamed history reflows

## Required behavior

After a long conversation is produced incrementally, scrolling back must preserve the text's
position apart from the user's requested scroll. This applies both while the Agent is active
and after it completes, including after the conversation width changes. Reload must not be
required to restore stable reading. Keep native scrolling and offscreen rendering optimization.

## Reproduction and diagnosis

1. Produce a long conversation in a narrow window, with multiple queries, wrapped assistant
   paragraphs and collapsed tool receipts.
2. Finish the task, widen the window (or close a side panel), then scroll upward in small steps.
3. Before the fix, the measured paragraph moves an extra 22.75 px when an older row loses a
   wrapped line. Its own height stays unchanged; the app does not write `scrollTop`.
4. The full-height decorative timeline can win native anchor selection. Its top stays fixed
   when history rows change height, so it cannot compensate for the text's displacement.
   Excluding the timeline and marker dots with `overflow-anchor: none` lets the browser anchor
   actual conversation content. Neither SDK data nor the offscreen rendering policy changes.

The investigation reproduced this with an isolated copy of session
`20260911_100157_8gbfe22d504b2f`'s text and then with generated text. The committed tests contain
only generated data. This closes the diagnosed scroll-anchor defect, not the broader Issue 142
performance/virtualization work.

## Automated verification

With the renderer and Electron main already built:

```powershell
npx playwright test tests/e2e/conversation-receipts-scroll.spec.ts
```

The new completed/full-quality and active/balanced-quality cases compare the same paragraph
before and after each real wheel gesture, including a settling interval. The existing test
covers receipt expansion, sidebar resizing, hidden-pane restoration and jumping to the bottom.

## Manual verification

- Repeat narrow-to-wide scrollback before and after completion without Ctrl+R. Paragraphs
  should track wheel input without an extra hop after the gesture.
- Load an older page, expand/collapse tool or thinking receipts, and resize a side panel while
  reading. Verify reading position remains stable and Jump to bottom still reaches the tail.
- Repeat with full and balanced visual quality. Confirm long histories still defer offscreen
  layout instead of rendering every row eagerly.
