ultracode. Work at maximum effort. MORNING RUN (Oct 10, from 08:45): the overnight run was cut off at 02:13 by a machine
failure; the owner is awake and wants EVERYTHING left in PLAN.md done FAST, version by version, "super good"
(generation, playability, transitions, polish). You may use the Workflow tool for multi-agent
work (fan-out, adversarial verification, reviews), with these LAPTOP-SAFETY limits (the owner: "don't crash the
laptop"): at most 3 concurrent agents in any workflow (the night's account capacity is finite: be frugal, no idle fan-out); at most ONE agent at a time may run browsers, servers or the
e2e harness; before any fan-out check `.orch/status/HOLD` (if it exists the laptop is under pressure: work serially)
and `tail -2 .orch/status/vitals.log`; kill only processes you started, by PID or by your own port.

Context: you are one of several headless workers building Space Party overnight, version by version, a
multiplayer party game (up to 25 players) where each player DRAWS two things on paper or on the phone: an ENTITY
(their spaceship, later an astronaut / car / bike / animal on the planet) that becomes a 3D object whose skills
come only from what is drawn on it, and a CONTROLLER whose drawn buttons become the phone's controls. A big screen
is the spectator TV. Repo: /Users/jaumepuig/Documents/growth-hackathon (branch v1). THE SOURCE OF TRUTH IS PLAN.md
SECTION 0 ("Design decisions") and the sections it points to; older text that disagrees is outdated. The owner's
bar: "super good": generation, playability, transitions, everything polished. Every version must be fully playable
end to end. SPEED MATTERS MOST THIS MORNING: finish your task in about 60 minutes of work (hard stop 80 min), verified
with numbers; leave anything bigger as a precise nextTask instead of running long.

Before you start:
- Read .orch/CONTRACT.md completely and obey it. If it conflicts with this brief, it wins; report the conflict.
- Read PLAN.md (the spec) and contract.js (the shared contract) before writing code.
- Create .orch/progress/<your label>.md now and keep it current: what you did, what is left, how to resume. You may be
  cut off at any time by an account limit; a new worker will continue from it. If it already exists, you ARE that new
  worker: resume from it instead of starting over.
- Edit ONLY the files listed under OWN.

Report (structured output, at the very end):
- summary: what you built and the key decisions.
- pass: true only if every test and gate in your task passed.
- files: every file you created or changed.
- verification: every check with numbers and the time measured.
- followups: anything the orchestrator must know (contract changes needed, assumptions about other lanes, exact
  field semantics you chose). Prefix owner decisions with "Needs Jaume:".
- nextTasks: genuinely new work only, as {label, goal, owns, after}.

