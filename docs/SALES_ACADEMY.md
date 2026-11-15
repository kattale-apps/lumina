# Solar Switch Sales Academy

An in-app course for staff at `/dashboard/academy`.

## How it works
- Four modules in a fixed order: solar and power basics; finding and qualifying leads; assessing needs with Solar Switch; presenting, closing and selling ethically.
- Each module has lessons (text, with an optional video link per lesson) and a quiz. Answers are shown in a new order on every attempt.
- A learner passes a module by reaching its pass mark (80% by default). Retakes are allowed, up to 10 attempts per module per day.
- When a member of staff has passed all four modules the app issues one numbered certificate (`SSA-<year>-<sequence>`), which they can download as a PDF.
- The certificate records sales training only. It does not unlock or block anything else in the app, and it is not an electrical qualification.

## Who can do what
| Action | Roles |
| --- | --- |
| Take the course, download own certificate | Every active member of staff |
| See team progress | Super administrator, sales manager |
| Edit module content | Super administrator |

## Editing content
`/dashboard/academy/manage` lets the administrator change each module's title, summary, pass mark, lessons and quiz questions, or restore the original text.
- The built-in text lives in `convex/lib/academyContent.ts`. A company's edited module is stored in `academyModules` and replaces the built-in text for that company only.
- Every save raises the module's version. A learner who was mid-quiz is asked to reload instead of being marked against questions they did not see.
- Earlier passes and issued certificates stand when content changes.
- Lesson text is plain text: a blank line starts a paragraph, `## ` starts a sub-heading, `- ` starts a bullet. Video links must be `https://`; YouTube and Vimeo links play in the page, others open as a link.

## Integrity
- Quizzes are marked on the server. Correct answers and explanations are sent to a learner only after they pass; a failed attempt shows which questions were wrong.
- Saving a module and issuing a certificate are audited.
