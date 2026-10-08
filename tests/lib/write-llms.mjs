// Writes llms.txt, the instructions an AI agent reads to write a Snapblade diagram, from agentSpec() in index.html.
// Run after changing anything it documents: npm run docs. The layout tests fail while it's out of date.
import { writeFileSync } from 'node:fs';
import { loadCore } from './core.mjs';

writeFileSync(new URL('../../llms.txt', import.meta.url), loadCore()('agentSpec()'));
console.log('wrote llms.txt');
