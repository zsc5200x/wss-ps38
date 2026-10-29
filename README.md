# 平博与皇冠赛事看板

项目通过 Chrome DevTools Protocol（CDP）复用用户已登录的普通 Chrome 标签页，采集平博 WSS 赔率与皇冠足球赛事，提供实时看板、历史查询及人工赛事绑定。

账号密码、安全密码和 TOTP 由用户在站点页面手动输入。项目不自动填写或提交登录表单，不提供下注提交逻辑。“我的赛事”目前仅保留页面入口，未接入收藏或自动添加比赛。

已有数据的项目请先阅读 [运行数据迁移与回退](docs/operations.md#迁移运行数据)，不要用示例配置覆盖现有 `config.json`。

## 日常使用

以下命令均在项目根目录运行：

```bash
./start.sh
./stop.sh
```

默认统一入口为 `http://127.0.0.1:8787`。只启动看板及皇冠后端可使用 `./dashboard.sh`；只启动皇冠后端可使用 `./crown.sh`。停止脚本不会关闭 Chrome。

完整启动顺序为：检查配置与 Python 环境 → 确认/启动 Chrome CDP → 启动平博采集 → 启动皇冠服务并按已配置账号补开普通标签页 → 启动主看板 → 启动实时快照。已有进程会核对项目归属；HTTP 服务只有通过接口健康检查才会报告就绪。进程就绪不等于数据新鲜，仍需看页面上的最后成功更新时间。

平博和皇冠默认使用同一个 CDP 地址。皇冠没有配置账号时，启动脚本会跳过补开标签页；在皇冠设置中保存地址和账号、打开登录页，再由用户手动完成登录。已经登录时复用当前会话；旧保存会话被拒绝时，系统会尝试同步当前皇冠标签中的会话。

## 第一次准备

仓库保留两套已使用的 Python 环境，不在本次规范整理中升级依赖：

| 环境 | 当前基线 | 完整依赖快照 |
| --- | --- | --- |
| 平博、合并与主看板 | macOS / Python 3.9 | `requirements/pinnacle-macos-py39.lock` |
| 皇冠运行时 | macOS / Python 3.14 | `requirements/crown-macos-py314.lock` |

已有 `.venv` 与 `crown/.venv` 时无需重新创建。新环境在安装对应 Python 后运行：

```bash
python3.9 -m venv .venv
.venv/bin/python -m pip install -r requirements/pinnacle-macos-py39.lock
python3.14 -m venv crown/.venv
crown/.venv/bin/python -m pip install -r requirements/crown-macos-py314.lock
```

锁文件记录当前 macOS 环境的完整版本，不是带下载哈希的跨平台锁；切换 Python 或系统时先在独立环境验证。`requirements.txt` 与 `crown/requirements.txt` 仍保留直接依赖入口。程序通过 CDP 连接已安装的 Chrome，正常共享浏览器流程无需执行 `playwright install`。前端检查需要 Node.js；旧采集文件压缩需要 `zstd`。

只有全新安装、没有本机配置和数据时，才复制示例配置：

```bash
test -f config.json || cp config.example.json config.json
mkdir -p var/capture var/exports var/db var/crown var/run var/logs var/backups
```

示例将运行数据统一放在 `var/`。首次启动前应将已有的赛事元数据 CSV 放到配置的 `events_file` 路径；`start.sh` 会创建采集文件，但不会编造赛事元数据。如果已有根目录数据，使用迁移工具处理，不要手工复制正在使用的数据库。

## 统一配置

配置入口为 `project_config.py`，优先级：**非空环境变量 > `PS3838_CONFIG` 选定 JSON > 内置默认值**。未指定时读取项目根目录 `config.json`；该默认文件可以不存在。显式指定的文件不存在、JSON 损坏或端口非法时直接中止，不会悄悄启动默认环境。

```bash
PS3838_CONFIG=config.local.json ./start.sh
DASHBOARD_PORT=8788 CROWN_PORT=8888 ./start.sh
.venv/bin/python project_config.py shell
```

相对配置路径和相对数据路径均以项目根目录为基准，不随调用命令的当前目录变化。`shell` 子命令仅输出固定白名单、经过 shell 引号转义的启动变量，不导出任意配置字段。

| 配置项 | 环境变量 | 默认或行为 |
| --- | --- | --- |
| `cdp_url` | `CAPTURE_CDP_URL`，其次 `CDP_URL` | `http://127.0.0.1:9222` |
| `crown_cdp_url` | `CROWN_CDP_URL` | 留空则继承平博 CDP |
| `dashboard_host / dashboard_port` | `DASHBOARD_HOST / DASHBOARD_PORT` | `127.0.0.1:8787` |
| `crown_host / crown_port` | `CROWN_HOST / CROWN_PORT` | `127.0.0.1:8887` |
| `capture_path` | `CAPTURE_OUTPUT`，其次 `CAPTURE_PATH` | 原始采集路径 |
| `events_file / live_snapshot_file` | `EVENTS_FILE / LIVE_SNAPSHOT_FILE` | 赛事元数据与实时快照 |
| `dashboard_db_path / merge_db_path` | `DASHBOARD_DB_PATH / MERGE_DB_PATH` | 历史库与人工映射库 |
| `run_dir / log_dir / backup_dir` | `RUN_DIR / LOG_DIR / BACKUP_DIR` | PID、日志与备份目录 |
| `crown_data_dir` | `CROWN_DATA_DIR` | 皇冠账号、加密会话与缓存目录 |

旧配置 `fixture_merge_db_path`、`events_path`、`output`、`latest_output`、`normalized_output` 仍可读取；新配置使用规范字段。内置默认值继续兼容原根目录数据、`.run/`、`logs/` 和 `crown/data/`，复制新示例不会自动迁移旧数据。

## 页面和数据边界

- **主页**：按皇冠名称显示已确认关联且未结束的赛事，对照对应的皇冠与平博盘口，使用香港盘赔率。
- **平博数据**：平博原始采集状态、赛事、盘口和历史。
- **皇冠数据**：只展示皇冠赛事、盘口与会话状态，不混入平博盘口。
- **我的赛事**：空页面入口，留待后续自行接入赛事。
- **赛事合并**：先绑定联赛，再在确认的联赛范围内绑定比赛；评分只排序候选，不自动建立映射。
- **系统设置**：浏览器、页面显示和相关状态设置。

平台 ID 属于各自编号空间，不能直接相等匹配。人工联赛和赛事映射保存在 `merge_db_path` 指定的 SQLite 中，不改写两家原始赛事。匹配逻辑默认将平博 `Asia/Shanghai` 与皇冠 `America/New_York` 转换到具体时刻比较，再以北京时间显示。站点时区不同可设置 `PS3838_EVENT_TIMEZONE`、`CROWN_EVENT_TIMEZONE` 和 `MERGE_DISPLAY_TIMEZONE`。

皇冠列表与附加盘有不同刷新节奏；前端读到缓存时会显示最后成功时间。数据时间不变化时应检查来源状态与日志，不能把“服务已启动”视为采集成功。

## 项目结构

```text
capture.py / live_snapshot.py  平博采集与快照入口
dashboard_server.py            主看板 HTTP 入口
fixture_merge.py               旧导入路径兼容入口
project_config.py             配置、路径与服务地址
src/core/                     常量、时间等公共基础
src/providers/pinnacle/        平博数据解析
src/services/                 赔率状态、可见性、来源新鲜度与赛事匹配
src/storage/                  历史 SQLite 与联赛/赛事映射存储
crown/                        皇冠 HTTP、会话与采集运行时
dashboard/static/modules/     页面路由、平博、合并、设置等前端模块
scripts/runtime.sh            启停、健康检查、进程归属与启动互斥
scripts/check.py               统一静态检查与隔离测试
scripts/migrate_runtime.py     可回退的本机运行数据迁移
requirements/                 两套现有环境的完整依赖版本快照
tests/                        主模块、配置、启动与前端回归测试
docs/operations.md            运维、迁移、回退和排障
var/                          新布局运行数据，不提交 Git
```

本次按职责拆分现有代码，保留原入口和兼容导入。后续业务代码放在对应 provider/service/storage 或前端页面模块，不继续堆入 HTTP 入口。保持单个根 Git 仓库，`crown/` 是普通子目录。

## 修改后检查

```bash
./check.sh
./check.sh --static-only
```

完整检查执行 Python 静态解析、JavaScript 语法与前端测试、Shell 语法、Git 差异格式，以及分别使用两套虚拟环境的单元测试。测试配置指向临时目录，不使用真实账号库、历史库或采集文件，不会启动/停止在线服务。

如 Python 路径不同：

```bash
PYTHON_BIN=/usr/local/bin/python3.9 CROWN_PYTHON_BIN=/usr/local/bin/python3.14 ./check.sh
```

## 常见问题

**皇冠提示重复登录 / `session_conflict`**：表示系统保存的会话被上游 `doubleLogin` 拒绝，不能据此断定当前标签未登录或必然有其他设备登录。先保持已登录皇冠标签打开，观察自动会话同步与最后成功时间；持续失败时点击“检查会话”，必要时在原标签手动重新登录。仅在有实际证据时再检查其他设备会话。

**已启动但赔率不更新**：先核对 CDP 是否可用、对应标签是否登录、来源最后成功时间是否推进，再查看配置 `log_dir` 中的 `capture.log`、`dashboard.log`、`crown.log`。看板保留旧缓存是为了可见性，不代表旧缓存仍是当前报价。

**显式配置报错**：修复 `PS3838_CONFIG` 路径或 JSON 后再启动。启动和停止脚本都会在配置错误时中止，避免操作错误环境。

更多命令见 [运维指南](docs/operations.md)，皇冠接口与手动登录流程见 [皇冠说明](crown/README.md)。
