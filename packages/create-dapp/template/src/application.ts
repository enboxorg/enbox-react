import { defineApplicationManifest } from '@enbox/react/config';
import type { CreateEnboxClientOptions } from '@enbox/react/config';

import app from './app.json' with { type: 'json' };
import { DemoProtocol } from './demo/protocol.js';

export const config = {
  application: defineApplicationManifest({ protocols: [DemoProtocol] }),
  wallet: { appName: app.name, applicationId: app.id },
} satisfies CreateEnboxClientOptions;
