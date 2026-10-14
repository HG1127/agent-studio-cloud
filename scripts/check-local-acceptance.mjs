import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const directory = process.env.LOCAL_ACCEPTANCE_REPORTS;
if (!directory || !path.isAbsolute(directory)) throw new Error('缺少本次独立报告目录');
const workflow = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const match = workflow.match(/node <<'NODE'\r?\n([\s\S]*?)\r?\n\s*NODE\s*\r?\n/);
if (!match) throw new Error('当前CI实际数量守卫不存在');
vm.runInNewContext(match[1], {
  require: (name) => {
    if (name !== 'node:fs') throw new Error('非预期守卫依赖');
    return { readFileSync: (file, encoding) => {
      if (!['integration-results.json', 'workflow-results.json'].includes(file)) throw new Error('非本次验收报告');
      return fs.readFileSync(path.join(directory, file), encoding);
    } };
  },
  console,
}, { timeout: 1000 });
