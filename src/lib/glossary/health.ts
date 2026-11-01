// Plain-English terms for the Health and Files views, risky-action alerts and phases. Same entry shape as GLOSSARY
// in explain.ts (term key -> plain-English sentence); the lead merges it there. Until then, markers render as plain text.
export const GLOSSARY_HEALTH: Record<string, string> = {
  hook: "A hook is a small script you (or an add-on you installed) set up to run automatically at certain moments, like when a session starts or after Claude changes a file.",
  healthScore:
    "A rough guide from 0 to 100, worked out on your computer by counting things like repeated steps, loops and errors. 100 means nothing stood out. It isn't a grade of you or your request.",
  fixLoop: "When Claude runs the same thing, it fails, Claude tries a fix, and it fails again, over and over. A hint from you often breaks the loop.",
  diff: "A before-and-after view of a change: removed lines are usually marked in red, added lines in green.",
  phase: "A stretch of a request where Claude was mostly doing one kind of thing: looking around, changing files, testing, checking its work or answering you.",
  bypassPermissions: "A mode where Claude Code never stops to ask before running commands or changing files. Handy for experiments, risky for real projects.",
};
