import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
cpSync('src', 'dist/src', { recursive: true });
cpSync('migrations', 'dist/migrations', { recursive: true });
console.log('Built dist/src and dist/migrations');
