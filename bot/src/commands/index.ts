import type { Command } from '../types/index.js';
import { joinCommand } from './join.js';
import { leaveCommand } from './leave.js';
import { statusCommand } from './status.js';
import { searchCommand, setSqliteStoreManager } from './search.js';

/**
 * 利用可能なすべてのコマンド
 */
export const commands: Command[] = [
  joinCommand,
  leaveCommand,
  statusCommand,
  searchCommand,
];

export { joinCommand, leaveCommand, statusCommand, searchCommand, setSqliteStoreManager };

