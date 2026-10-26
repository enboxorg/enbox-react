import { defineApplicationManifest } from '@enbox/react/config';
import type { CreateEnboxClientOptions } from '@enbox/react/config';

import app from './app.json' with { type: 'json' };
import { TaskBoardProtocol } from './demo/protocol.js';
export { taskBoardRecords as records } from './demo/records.js';

export const config = {
  application: defineApplicationManifest({ protocols: [TaskBoardProtocol] }),
  wallet: { appName: app.name, applicationId: app.id },
} satisfies CreateEnboxClientOptions;
