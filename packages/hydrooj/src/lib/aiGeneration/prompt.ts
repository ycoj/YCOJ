/* eslint-disable max-len -- keep agent instructions readable as prompt paragraphs */

export const AI_TESTDATA_SYSTEM_PROMPT = `You are an autonomous competitive-programming test-data engineer working inside a persistent, network-isolated sandbox.

Your goal is to produce high-strength judge data that distinguishes correct solutions from plausible wrong and inefficient solutions. Do not settle for a few simple random examples. Analyze the statement, constraints, algorithmic bottlenecks, overflow risks, degenerate structures, adversarial orderings, boundary values, and common implementation mistakes.

You have exactly three tools: Read, Edit, and Shell. They operate only in the sandbox workspace. Never attempt network access, package installation, or access outside the workspace. Python 3 and the cyaron library are already installed. Read docs/cyaron.md only when you need its API; its body is intentionally not included in this prompt.

Required workflow:
1. Read problem.md and problem-config.yaml. Infer the intended solution and data limits.
2. Implement a trustworthy standard solution if one is not already available in the workspace.
3. Implement deterministic or seeded generation scripts, including targeted adversarial families and boundary cases rather than only uniform randomness.
4. Run the generator and standard solution to create every input and answer.
5. Validate formats, pairings, determinism, answer correctness, diversity, maximum-scale behavior, and strength against likely wrong or slow solutions. Iterate when coverage is weak.
6. Put only final judge artifacts in output/: exactly one output/config.yaml and one or more flat, matching NAME.in and NAME.out pairs. Keep source code, scripts, and logs outside output/.

The final config.yaml must be valid Hydro problem configuration and select all generated cases. Do not use symlinks. Do not claim success until you have run local checks. In your final response, concisely report the strategy, case families, validation performed, and any assumptions.`;

export const CYARON_GUIDE = `# CYaRon quick reference

CYaRon is installed for Python 3. Import only what you use:

\`from cyaron import IO, Graph, Vector, Sequence\`

## Files and output

\`io = IO(file_prefix="output/case", data_id=1)\` creates output/case1.in and output/case1.out.
Write input with \`io.input_writeln(...)\` or \`io.input_write(...)\`.
Write a known answer with \`io.output_writeln(...)\`, or run a standard program with
\`io.output_gen("./std")\`. Compile the standard program first when necessary.
You may instead use normal Python file I/O when it is clearer.

## Random data

Seed Python's random module for reproducibility. CYaRon helpers commonly include:

- \`Vector.random(n, [(lo, hi)])\` for one-dimensional integer vectors.
- \`Vector.random([rows, cols], [(lo, hi)])\` for matrices.
- \`Sequence(lambda i, f: ..., [initial_values]).get(n)\` for recurrences.

Always mix structured adversarial data with randomized data. Avoid relying on undocumented APIs: inspect the installed package from Python if uncertain.

## Graphs

Common constructors include \`Graph.tree(n)\`, \`Graph.chain(n)\`, \`Graph.flower(n)\`, and
\`Graph.graph(n, m)\`. Graph objects can be printed with \`io.input_writeln(graph)\`.
Constructor signatures can vary by release, so verify them with Python \`help(...)\` before use.

## Reliability checklist

- Create output/ before writing.
- Use fixed seeds.
- Check every input parses and respects constraints.
- Ensure every .in has the same-base .out.
- Generate answers with an independently reviewed standard solution.
- Include minima, maxima, degenerate cases, overflow cases, and worst-case complexity shapes.
- Keep final files within the configured count and size limits.
`;

export function buildInitialPrompt(instructions?: string) {
    return `Generate and validate production-quality test data for the problem in this workspace.${instructions?.trim()
        ? `\n\nAdditional instructions from the problem editor:\n${instructions.trim()}` : ''}`;
}

export function buildRepairPrompt(error: string, attempt: number) {
    return `Artifact validation failed after your previous attempt (repair ${attempt}/3):\n${error}\n\nInspect output/, fix the concrete issue, rerun all relevant validation, and leave a complete valid artifact set in output/.`;
}
