// Used by smoke.mjs (Node 22.6+): reads {main, agents} as JSON on stdin, builds the session model the page
// would build from those streamed records, and prints each step's id, tool and status as JSON.
import { buildSession } from "../src/lib/session.ts";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { main, agents } = JSON.parse(input);
const model = buildSession(main, agents ?? {}, Date.now());
const steps = model.turns.flatMap((t) => t.steps.map((s) => ({ id: s.id, tool: s.tool, status: s.status, turn: t.index })));
process.stdout.write(JSON.stringify({ turns: model.turns.length, steps }));
