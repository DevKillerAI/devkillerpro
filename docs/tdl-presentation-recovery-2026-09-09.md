# TDL preview delivery: presentation-only assertions

The failed TDL build saved its records and passed PostgreSQL persistence, authentication and ownership-isolation checks. Its generated journeys expected `Prepare release notesSummarize completed workhigh` while the actual component structure and CSS render `Prepare release notes\nSummarize completed work\nHigh`.

The trusted browser runner now compares visible text without case differences or whitespace boundaries between letters. It still compares complete content, not substrings. Missing text, wrong priorities, wrong numeric results and record counts remain failures. Editable input, select and textarea values retain exact comparison. Presentation-only matches become recorded limitations rather than blockers. Failed comparisons now record the observed text as well as the expected text.

Generation instructions prefer separate stable targets for task titles, notes and status instead of concatenating an entire list. Persistence instructions require a reload followed by a saved-record assertion.

The initial TDL recovery preserved every source-file byte and recorded a separate immutable verification revision because the verifier image changed. Further execution exposed a second test defect: the journey guessed a title-derived identifier, while the actual item used a runtime UUID. The final recovery adds stable test attributes to existing controls and text fields; it changes no business logic, CSS or SQL. Reviewed journeys now prove creation, reload persistence, editing, completion and filtering through the actual controls. The old failed results remain in history; they are not rewritten or relabeled as successful. No new provider request was authorized.

Regression checks cover both TDL strings, case changes, missing content, incorrect numbers, extra records and strict editable values. Focused tests and TypeScript validation passed.

TDL is now ready in its original owner's project list. All 33 checks passed for `stable-journeys-1`, source `ed796bbdf11bde9ada371f5aadd7559e7af72fdde99995a68616acb3bc686ecf`. Capitalized priority labels are explicitly retained as nonblocking presentation notices. Settled cost remained USD 0.159439 across the original two provider calls; recovery added zero AI cost.
