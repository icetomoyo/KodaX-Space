// KodaX user-level config IPC handlers — v0.1.6 cleanup
//
// kodax.getDefaults — 读 ~/.kodax/config.json 的标量默认值给 renderer 做 session preselect。
// 每次都走一次 SDK loadConfig；SDK 内部是否复读 mtime 未验证（最坏情况是 Space 启动期 snapshot），
// 用户改核心 config.json 后看不到默认值变化时可重启 Space 兜底；集成配置走独立 reader。
//
// 安全：返回值只有标量字段；customProviders 详情已被 main loader 过滤 (只剩 count)。

import { registerChannel } from './register.js';
import { loadKodaxUserDefaults } from '../kodax/user-config.js';

export function registerKodaxChannels(): void {
  registerChannel('kodax.getDefaults', async () => {
    return loadKodaxUserDefaults();
  });
}
