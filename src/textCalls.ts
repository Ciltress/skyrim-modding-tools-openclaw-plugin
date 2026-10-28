import type { FinalizeRevision } from './buildCheck.js';

/**
 * A tool call written in an answer's text — `<tool_call>readSkill{skill:skyrim-modding-basics}</tool_call>`, or the
 * `call:` form a model's own tool-call tokens wrap — its name, and its arguments where written in braces.
 */
const TEXT_CALL = /<\|?tool_call\|?>\s*(?:call:)?([A-Za-z_][\w-]*)\s*(\{[^\n]*?\})?/;

/**
 * One more pass for an answer that ends on a tool call written as text, which runs nothing: the model's first turn in eval
 * round 69's npc #1 wrote `<tool_call>readSkill{skill:skyrim-modding-basics}</tool_call>` as plain words, not the
 * tokens Ollama's tool-call parser reads as a call, and the run ended there with nothing made.
 *
 * OpenClaw makes the pass only in a run with no call it cannot replay (see BuildCheck) — so for a text call in the
 * run's first answer, as that one was; after a plugin call or a write it logs the request and lets the answer stand.
 */
export function textCallRevision(lastAssistantMessage: string | undefined, runId: string | undefined): FinalizeRevision | undefined {
    const call = runId && lastAssistantMessage ? TEXT_CALL.exec(lastAssistantMessage) : null;
    if (!call) return undefined;
    const written = `${call[1]}${call[2] ?? ''}`;
    return {
        action: 'revise',
        reason: `The answer wrote a tool call as text: ${written}.`,
        retry: {
            instruction:
                `Your last message wrote a tool call as text — ${written} — and text runs nothing: no call was made. ` +
                `Make it as a tool call now, then go on with the task.`,
            idempotencyKey: `skyrim-modding-tools:text-call:${runId}`,
            maxAttempts: 1
        }
    };
}
