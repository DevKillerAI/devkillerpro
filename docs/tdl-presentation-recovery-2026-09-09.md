# TDL preview delivery: presentation-only assertions

The failed TDL build saved its records and passed PostgreSQL persistence, authentication and ownership-isolation checks. Its generated journeys expected `Prepare release notesSummarize completed workhigh` while the actual component structure and CSS render `Prepare release notes\nSummarize completed work\nHigh`.

The trusted browser runner now compares visible text without case differences or whitespace boundaries between letters. It still compares complete content, not substrings. Missing text, wrong priorities, wrong numeric results and record counts remain failures. Editable input, select and textarea values retain exact comparison. Presentation-only matches become recorded limitations rather than blockers. Failed comparisons now record the observed text as well as the expected text.

Generation instructions prefer separate stable targets for task titles, notes and status instead of concatenating an entire list. Persistence instructions require a reload followed by a saved-record assertion.

The TDL recovery preserves every source-file byte and records a separate immutable verification revision, because the verifier image changed. The old failed result remains in history; it is not rewritten or relabeled as successful. No new provider request is authorized by this recovery.

Regression checks cover both TDL strings, case changes, missing content, incorrect numbers, extra records and strict editable values. Focused tests and TypeScript validation passed.
