/** Optional shared demos with checkout-rooted cwd; arguments remain literal. */

import { builtinFixtures } from '../../../shared/fixtures.js';
import { withAbsolutePaths } from './expandPaths.js';

export const serverBuiltinFixtures = builtinFixtures.map(withAbsolutePaths);
