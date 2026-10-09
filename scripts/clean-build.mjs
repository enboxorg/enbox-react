import { rmSync } from 'node:fs';

// Remove generated modules left behind by source renames or deletions.
rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
