import { Hono } from 'hono';
import { coreApp } from './core';
import { membershipApp } from './membership';
import { placeholdersApp } from './placeholders';
import { exportApp } from './export';
import type { GroupEnv } from './types';

const groupsApp = new Hono<GroupEnv>();

// Mount all sub-routers — order matters for route matching
groupsApp.route('/', coreApp);
groupsApp.route('/', membershipApp);
groupsApp.route('/', placeholdersApp);
groupsApp.route('/', exportApp);

export { groupsApp };
