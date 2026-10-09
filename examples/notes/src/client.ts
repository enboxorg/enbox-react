import { createEnboxClient } from '@enbox/react/config';

import { application } from './application.js';

export const client = createEnboxClient({ application, wallet: { appName: 'Enbox React Notes' } });
