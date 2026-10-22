import { loadConfig } from './config.js';
import { openDatabase } from './models/monitorModel.js';

const db = openDatabase(loadConfig().databasePath);
console.log(`Applied migrations through version ${db.pragma('user_version', { simple: true })}`);
db.close();
