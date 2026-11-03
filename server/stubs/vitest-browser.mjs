// Stand-in for "vitest/browser", which only resolves inside a Vitest browser
// run. Storybook setups that load it lazily (to reach Vitest's commands) see
// "no commands" here and skip that work.
export const commands = undefined;
