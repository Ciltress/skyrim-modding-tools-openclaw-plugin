import type { FinalizeRevision } from './buildCheck.js';

/**
 * A call's opening tag in a model's own call syntax, written as words — `<tool_call>`, `<|tool_call>`, `<call>`,
 * `<tool_code>` — with the `call:` a model's tool-call tokens put before the name.
 */
const CALL_TAG = /<\|?(?:tool_call|call|tool_code|function_call)\|?>\s*(?:call:)?/g;
const NAME = /[A-Za-z_][\w-]*/y;
/** The keys a call written as JSON names its tool under: `{"tool_name": "readSkill", "tool_args": {…}}`. */
const NAME_KEYS = 'tool_name|tool|name|function|function_name|id';
/** What may follow a call at an answer's end: closing tags, a code fence, the parenthesis of a `print(…)` around it. */
const AFTER_CALL = /^(?:\s|<\/?\|?[\w-]+\|?>|```|\))*$/;
/** OpenClaw's Tool Search tools, by which a model calls a tool the catalog keeps: `openclaw_tool_call{id: "readSkill", …}`. */
const OPENCLAW_TOOLS = ['openclaw_tool_call', 'tool_search', 'tool_describe'];

/** A tool call found written in an answer's text, and whether a call tag wrapped it. */
interface WrittenCall {
    text: string;
    tagged: boolean;
}

/**
 * One more pass for an answer that wrote a tool call as text, which runs nothing. The model's first turn ended so, the
 * run with nothing made, five times in eval rounds 65–76, no two alike: `<call>readSkill{skill:skyrim-modding-basics}</call>`
 * and `<tool_code>\nreadSkill{skill: "skyrim-modding-basics"}\n</tool_code>` (round 65), `<tool_call>readSkill{…}</tool_call>`
 * (round 69), `[Tool Call] {"tool_name": "readSkill", "tool_args": {…}}` and `openclaw_tool_call{id: "readSkill", args: {…}}`
 * (round 76). A call in a tag counts wherever it is; one of the agent's tools named with its arguments in braces or
 * parentheses, or as a JSON field's value, counts where the answer ends on it — and is asked for as a call meant to run,
 * so an answer that shows one to the user can stand.
 *
 * OpenClaw makes the pass only in a run with no call it cannot replay (see BuildCheck) — so for a text call in the
 * run's first answer, as all five were; after a plugin call or a write it logs the request and lets the answer stand.
 *
 * @param tools The names of the tools the agent may call.
 */
export function textCallRevision(lastAssistantMessage: string | undefined, runId: string | undefined,
    tools: readonly string[] = []): FinalizeRevision | undefined {
    const call = runId && lastAssistantMessage ? writtenCall(lastAssistantMessage, tools) : undefined;
    if (!call) return undefined;
    return {
        action: 'revise',
        reason: `The answer wrote a tool call as text: ${call.text}.`,
        retry: {
            instruction:
                `Your last message wrote a tool call as text — ${call.text} — and text runs nothing: no call was made. ` +
                (call.tagged
                    ? 'Make it as a tool call now, then go on with the task.'
                    : 'If you meant it to run, make it as a tool call now, then go on with the task; if you wrote it for the ' +
                        'user to read, answer as you did.'),
            idempotencyKey: `skyrim-modding-tools:text-call:${runId}`,
            maxAttempts: 1
        }
    };
}

/** The first call written in a call tag; else the last of the agent's tools written as a call, where the answer ends on it. */
export function writtenCall(text: string, tools: readonly string[]): WrittenCall | undefined {
    for (const tag of text.matchAll(CALL_TAG)) {
        NAME.lastIndex = tag.index + tag[0].length;
        const name = NAME.exec(text);
        if (!name) continue;
        const open = text.slice(NAME.lastIndex).search(/\S/) + NAME.lastIndex;
        const end = text[open] === '{' || text[open] === '(' ? closing(text, open) : NAME.lastIndex;
        return { text: flat(text.slice(name.index, end)), tagged: true };
    }

    const names = [...new Set([...tools, ...OPENCLAW_TOOLS])].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    if (!names) return undefined;
    const spans: { start: number; end: number }[] = [];
    // A name with its arguments: readSkill{…}, readSkill(…), default_api.readSkill(…).
    for (const named of text.matchAll(new RegExp(`(?<![\\w-])(?:${names})\\s*[({]`, 'g'))) {
        spans.push({ start: named.index, end: closing(text, named.index + named[0].length - 1) });
    }
    // A name as a JSON field's value: the object around it is the call.
    for (const keyed of text.matchAll(new RegExp(`"(?:${NAME_KEYS})"\\s*:\\s*"(?:${names})"`, 'g'))) {
        const open = opening(text, keyed.index);
        if (open >= 0) spans.push({ start: open, end: closing(text, open) });
    }
    const last = spans.sort((a, b) => a.end - b.end).at(-1);
    return last && AFTER_CALL.test(text.slice(last.end)) ? { text: flat(text.slice(last.start, last.end)), tagged: false } : undefined;
}

/** Where the bracket opened at `open` closes, past it — strings skipped; the text's end where it never does. */
function closing(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
        } else if (c === '{' || c === '(' || c === '[') depth++;
        else if ((c === '}' || c === ')' || c === ']') && --depth === 0) return i + 1;
    }
    return text.length;
}

/** The brace that opens the JSON object around `at`, or -1. */
function opening(text: string, at: number): number {
    let depth = 0;
    for (let i = at - 1; i >= 0; i--) {
        if (text[i] === '}') depth++;
        else if (text[i] === '{' && depth-- === 0) return i;
    }
    return -1;
}

/** A call as one line, for the instruction and the log. */
const flat = (call: string) => call.replace(/\s+/g, ' ').trim();
