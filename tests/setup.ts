import { useMemoryDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';

// 每个测试文件使用独立内存库
useMemoryDb();
migrate();
