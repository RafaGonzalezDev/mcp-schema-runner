/**
 * Fixtures del server con paths absolutos.
 *
 * Toma la lista compartida desde `shared/fixtures.ts` y la expande
 * para que los paths relativos se resuelvan al CWD del repo y no
 * al CWD del proceso del server.
 */

import { builtinFixtures } from '../../../shared/fixtures.js';
import { withAbsolutePaths } from './expandPaths.js';

export const serverBuiltinFixtures = builtinFixtures.map(withAbsolutePaths);
