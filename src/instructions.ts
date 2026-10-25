import { serverInstructions } from 'skyrim-modding-tools-core';

/**
 * What the modding agents read at the end of their system prompt: the core's instructions — what the MCP server
 * announces, which OpenClaw drops — then what only OpenClaw's agents need, about OpenClaw's own file tools.
 * instructions.test.ts names the eval round behind each line.
 */
export function agentInstructions(target: string): string {
    return [
        serverInstructions(target),
        '',
        'Your file tools:',
        '- A whole record, or a file changed in many places, you `write` anew; `edit` is for a few lines.',
        '- `edit` finds each `oldText` exactly as the file holds it: whole lines with their indentation, and real line ' +
        'breaks — never `\\n` typed. `edit` refused: `read` the file, then edit what it holds now.'
    ].join('\n');
}
