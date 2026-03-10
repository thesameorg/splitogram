import type { AuthContext } from '../../middleware/auth';
import type { DBContext } from '../../middleware/db';

export type GroupEnv = AuthContext & DBContext;
