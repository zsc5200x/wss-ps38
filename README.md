# ps3838 WebSocket 赔率采集工具

这个项目通过 Chrome DevTools Protocol（CDP）连接已经打开的平博页面，监听页面收到的 WebSocket 赔率消息，并将原始消息和最新赔率快照保存为本地文件。

项目只负责读取和整理页面推送的数据，不会自动登录、点击盘口或提交下注。

## 目录中的主要文件

- `capture.py`：监听目标页面的 WebSocket，并追加保存到 `capture.jsonl`。
- `live_snapshot.py`：回放并持续读取 `capture.jsonl`，生成 `latest_odds_live.csv`。
- `export_latest.py`：导出配置中的目标比赛（未配置时使用脚本内默认目标）。
- `normalize_latest.py`：把导出的赔率转换成 decimal 和香港盘字段。
- `events_list.csv`：赛事元数据映射输入。
- `start.sh` / `stop.sh`：统一启动和停止采集、快照、主看板与皇冠服务。
- `dashboard_server.py`：本地实时赔率看板服务，增量读取采集文件并提供查询接口。
- `crown_proxy.py`：把皇冠页面和 `/api/crown/*` 同源代理到本机 `8887` 服务。
- `crown.sh`：幂等启动皇冠运行时的辅助脚本。
- `dashboard.sh`：启动统一看板，同时确保皇冠服务可用，不要求 Chrome CDP 在线。
- `crown/`：皇冠登录、Playwright 会话、赛事采集和独立页面运行时。
- `crown/static/`：拆分后的皇冠页面、样式和前端交互脚本。
- `dashboard/static/`：统一看板前端页面、样式和交互脚本。
- `odds_history.sqlite3`：看板自动创建的 SQLite 历史赔率数据库。
- `backfill_history.py`：把已有或轮转后的 `capture-*.jsonl` 历史采集数据回填到 SQLite。
- `metadata_sync.py`：通过已登录平博页面接口补齐缺失赛事名称、联赛、开赛时间和事件 ID 关联。
- `maintenance.py`：SQLite 一致性备份、备份保留策略和旧采集文件安全压缩。
- `maintenance.sh` / `install_maintenance.sh`：手动运行和安装 macOS 每日维护任务。
- `config.example.json`：项目配置项示例。复制为 `config.json` 后，可以统一配置 CDP 地址、输入输出路径、目标域名、快照间隔和采集文件轮转。
- `project_config.py` / `odds_utils.py`：共享配置和赔率换算逻辑。

## 第一次准备

项目建议使用 Python 3.9 或更新版本。当前仓库已经包含 `.venv` 时，可以直接安装依赖：

```bash
cd /Users/zsc5200x/ps3838-wss
.venv/bin/python -m pip install -r requirements.txt
```

如果需要使用自定义配置，先复制示例文件：

```bash
cp config.example.json config.json
```

`config.json` 已被 `.gitignore` 忽略，适合保存本机路径和目标比赛配置。

如果还没有虚拟环境：

```bash
cd /Users/zsc5200x/ps3838-wss
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

项目通过 CDP 连接现有 Chrome，不需要执行 `playwright install`。如果后续改为让 Playwright 自己启动浏览器，再单独安装浏览器运行时。

## 完整启动

### 1. 启动项目专用 Chrome

macOS 可以使用单独的浏览器配置目录：

```bash
./start.sh
```

`start.sh` 发现 CDP 不可用时，会自动启动项目专用 Chrome，并打开 `config.json` 中的 `start_url`。默认网址是：

```text
https://www.ps3838.com/zh-cn/sports/soccer
```

如果你已经手动启动了带 CDP 的 Chrome，脚本也会检查目标页面；页面不存在时会自动打开该网址。

在新打开的 Chrome 中登录平博。页面域名需要是 `ps3838.com` 或 `ps38ag.com`。

确认 CDP 可用：

```bash
curl http://127.0.0.1:9222/json/version
```

### 2. 启动采集和快照

`start.sh` 会检查 Python、Playwright、赛事文件和 CDP，然后后台启动：

- `capture.py`
- `live_snapshot.py`
- 皇冠服务（`crown/app.py`，本机 `8887`）
- `dashboard_server.py`

运行日志在 `logs/`，PID 文件在 `.run/`。统一看板地址默认是 `http://127.0.0.1:8787`，平博和皇冠都从该地址进入；皇冠页由主看板通过同源代理嵌入，不需要再单独打开 `8887`。

如果存在 `config.json`，启动脚本和 Python 程序会使用其中的路径配置；也可以使用 `PS3838_CONFIG=/path/to/config.json` 指定其他配置文件。

如果项目目录中的脚本没有执行权限，可以先运行：

```bash
chmod +x start.sh stop.sh
```

修改代码后可以运行基础检查：

```bash
.venv/bin/python -m py_compile *.py tests/*.py
.venv/bin/python -m unittest discover -s tests -v
bash -n start.sh stop.sh
```

启动后回到 Chrome 刷新平博赔率页面，等待 WebSocket 消息进入 `capture.jsonl`。

采集器默认每 5 秒通过已登录页面请求一次足球赛事清单，用于校准当前滚球、早盘赛事和有效盘口。该请求同时提取体育项目 ID、联赛 ID、比赛 ID、主客队和开赛时间；实时赔率变化仍由 WSS 推送，并通过比赛 ID 关联到赛事。请求间隔可通过 `config.json` 中的 `presence_interval_seconds` 调整，最小为 5 秒。

### 3. 停止

```bash
cd /Users/zsc5200x/ps3838-wss
./stop.sh
```

停止脚本会停止采集、快照、统一看板和皇冠进程，但不会关闭 Chrome。

## 实时看板

只启动统一看板、不要求 CDP 在线；脚本会同时确保皇冠服务可用：

```bash
cd /Users/zsc5200x/ps3838-wss
./dashboard.sh
```

打开：

```text
http://127.0.0.1:8787
```

看板会先用现有的 `latest_odds_live.csv` 初始化，再增量读取 `capture.jsonl` 中最近 8 MB 和后续新增消息。它不会在启动时全量回放整个采集文件。

页面包括：

- 顶部统一切换“主页 / 平博数据 / 皇冠数据”；
- 平博采集实时状态和数据延迟；
- 赛事搜索、元数据状态筛选和排序；
- 当前赛事全部盘口；
- 小数赔率、香港盘和赔率涨跌；
- 最近赔率变化流；
- 每条盘口的短期走势图；
- 基于 SQLite 的持久历史赔率查询；
- 可按具体盘口切换近 1 小时、6 小时、24 小时、7 天和 30 天走势。
- “缺失”元数据筛选，以及“检查缺失 / 一键补全”批量入口；
- 皇冠登录、会话检查、赛事列表和盘口详情，嵌入同一看板页面展示；
- 皇冠最近一次成功快照会原子写入 `crown/data/events-cache.json`，服务重启或上游短时失败时继续展示缓存并标明上次更新时间；缓存不包含账号、密码、Cookie 或会话凭据。

看板只把初始赔率基线和实际价格变化写入 SQLite，不会重复保存每条没有变化的报价。数据库使用 WAL 模式和后台批量写入，因此不会阻塞实时采集。

历史查询接口：

```text
GET /api/history?event_id=100&hours=24&limit=5000&stage=0&market=1&option=0&line=
```

其中 `event_id` 必填，`stage`、`market`、`option` 和 `line` 用于定位具体盘口，`hours` 最大为 8760，`limit` 最大为 10000。历史数据库路径可以通过 `config.json` 中的 `dashboard_db_path` 修改。

元数据维护接口：

```text
GET  /api/metadata/status
POST /api/metadata/sync   {"apply": false}  # 只检查
POST /api/metadata/sync   {"apply": true}   # 补全并写入
```

页面中的“一键补全”会在后台启动 `metadata_sync.py --apply --concurrency 2`，进度显示在赛事雷达下方。任务完成后看板会自动从 SQLite 重新加载元数据，不需要重启。任务日志写入 `logs/metadata_sync.log`。

命令行补全方式：

```bash
.venv/bin/python metadata_sync.py --limit 5          # 小范围检查
.venv/bin/python metadata_sync.py --limit 5 --apply  # 小范围写入
.venv/bin/python metadata_sync.py --apply             # 补全全部缺失项
```

同步工具会校验接口返回的赛事 ID 必须与请求 ID 一致，并自动重试限流响应；不会把默认赛事数据错误写给其他事件。SQLite 写入层同时保护完整元数据，旧快照中的占位数据不能覆盖已补齐记录。

如果看板启动失败，查看 `logs/dashboard.log`。停止看板可以执行 `./stop.sh`，或者根据 `.run/dashboard.pid` 停止对应进程。

## 历史数据回填

看板原来只从启动后收到的新消息开始写入 SQLite。项目现在提供了 `backfill_history.py`，可以把已有的 `capture-*.jsonl` 轮转文件和当前的 `capture.jsonl` 导入历史数据库。轮转文件支持未压缩 JSONL、`.jsonl.gz` 和 `.jsonl.zst`；使用 `.jsonl.zst` 时需要系统已安装 `zstd` 命令。

回填可以在看板运行时执行。工具会自动发现采集文件，按修改时间排序，并使用 SQLite 唯一约束防止重复写入：

```bash
cd /Users/zsc5200x/ps3838-wss
.venv/bin/python -u backfill_history.py --batch-size 1000
```

回填进度会按批写入 `.run/backfill_history.state.json`。中途停止后，直接执行同一命令即可从断点继续；默认不会重复插入已经处理的数据。

`live_snapshot.py` 启动时也会按时间顺序回放轮转采集文件。文件很多或未压缩时首次启动会更久，但元数据更新只扫描对应赛事，不会像旧版本那样反复遍历全部盘口。压缩轮转文件可以显著减少磁盘占用，例如：

```bash
zstd -3 -T0 -o capture-20261028-053537.jsonl.zst capture-20261028-053537.jsonl
zstd -t capture-20261028-053537.jsonl.zst
```

确认压缩文件校验通过后，可以删除已经完整回填并验证过的未压缩文件。不要删除尚未回填、尚未校验或仍被其他程序使用的采集文件。

常用参数：

```bash
# 只处理本次最多 5000 行，适合先做小范围验证
.venv/bin/python -u backfill_history.py --max-lines 5000

# 忽略断点并从头扫描；数据库唯一约束仍会防止重复数据
.venv/bin/python -u backfill_history.py --reset-checkpoint

# 临时指定另一个 SQLite 数据库
.venv/bin/python -u backfill_history.py --db /path/to/odds_history.sqlite3
```

回填时不要同时启动多个回填进程。一个回填进程会持续写入 WAL，运行期间应留意磁盘空间：

```bash
df -h .
ls -lh odds_history.sqlite3*
```

回填完成后，重启看板，让页面显示的数据库点数和进程内缓存刷新：

```bash
./stop.sh
./start.sh
```

`./stop.sh` 会同时停止采集、快照、统一看板和皇冠服务，再由 `./start.sh` 重新启动。只重启看板时，可以先停止看板进程，再执行 `./dashboard.sh`；该脚本会同时确保皇冠服务在线。SQLite 文件、WAL 和 SHM 文件应一起备份，不要在写入过程中直接复制正在使用的数据库。推荐在停止看板后执行备份：

```bash
./stop.sh
cp odds_history.sqlite3 "odds_history-$(date +%Y%m%d-%H%M%S).sqlite3"
./start.sh
```

如果需要确认回填结果，可以执行：

```bash
sqlite3 odds_history.sqlite3 "PRAGMA integrity_check;"
sqlite3 odds_history.sqlite3 "SELECT COUNT(*) FROM events; SELECT COUNT(*) FROM odds_history;"
sqlite3 odds_history.sqlite3 "SELECT MIN(captured_at), MAX(captured_at) FROM odds_history;"
```

## 手动启动方式

如果不使用 `start.sh`，可以分两个终端运行：

```bash
cd /Users/zsc5200x/ps3838-wss
.venv/bin/python -u capture.py
```

```bash
cd /Users/zsc5200x/ps3838-wss
.venv/bin/python -u live_snapshot.py
```

建议先启动 `capture.py`，再启动 `live_snapshot.py`。后者会先回放已有采集文件，然后继续读取新增内容。

## 导出和标准化

导出脚本中配置的 10 场比赛：

```bash
.venv/bin/python export_latest.py
```

输出 `latest_odds_10_matches.csv`。

标准化赔率格式：

```bash
.venv/bin/python normalize_latest.py
```

输出 `latest_odds_normalized.csv`。

只回放已有的 `capture.jsonl` 并生成一次实时快照，不继续监听新增数据：

```bash
.venv/bin/python live_snapshot.py --once
```

## 输出文件

- `capture.jsonl`：原始 WebSocket 接收帧，文件会持续增长。
- `latest_odds_live.csv`：按比赛、阶段、盘口、选项和盘口线保留的最新快照。
- `latest_odds_10_matches.csv`：固定 10 场比赛的导出结果。
- `latest_odds_normalized.csv`：标准化后的赔率结果。
- `odds_history.sqlite3`：看板持久保存的赛事元数据和赔率变化点。

旧版协议诊断脚本和历史导出脚本保存在 `_archive_cleanup_20261028_040012/`，不属于当前默认启动链路。

原始采集文件可能很大，长期运行前应规划按日期或文件大小轮转，并定期备份或清理。

实时快照还会写入 `元数据状态`：`complete` 表示比赛、联赛和开赛时间齐全，`partial` 表示只补齐了一部分，`missing` 表示当前仍是占位赛事。

配置中的 `capture_rotation_mb` 大于 0 时，采集器会在写入前按大小把当前文件重命名为带时间戳的历史文件，然后继续写入新的 `capture.jsonl`。

## 自动备份和采集文件压缩

手动执行一次数据库备份和旧文件压缩：

```bash
cd /Users/zsc5200x/ps3838-wss
./maintenance.sh
```

只备份数据库，或只压缩旧采集文件：

```bash
./maintenance.sh --db-only
./maintenance.sh --capture-only
./maintenance.sh --dry-run
```

维护规则：

- 使用 SQLite Backup API 创建一致性备份，不直接复制正在写入的数据库文件；
- 备份保存到 `backups/`，默认保留最近 7 份；
- 只处理符合 `capture-YYYYMMDD-HHMMSS.jsonl` 的轮转文件，永远跳过当前 `capture.jsonl`；
- 只压缩超过 `capture_compress_after_hours` 且大于 `capture_compress_min_mb` 的文件；
- 压缩后校验 `zstd -t`、解压 SHA-256 和行数，全部一致才删除原文件；
- 任务使用文件锁，重复执行不会并发压缩同一批文件。

macOS 每日 04:15 自动执行：

```bash
./install_maintenance.sh
```

安装后可通过以下命令检查任务：

```bash
launchctl print "gui/$(id -u)/com.ps3838-wss.maintenance"
tail -f logs/maintenance.log
```

相关配置项：

```json
{
  "backup_dir": "backups",
  "backup_keep": 7,
  "capture_compress_after_hours": 24,
  "capture_compress_min_mb": 16
}
```

## 版本管理

根项目与皇冠子项目使用两个独立的 Git 仓库：

- 根仓库：管理启动脚本、主看板、测试、维护工具和文档；数据库、采集文件、日志、截图、虚拟环境及本机 `config.json` 均被忽略。
- `crown/`：已经有自己的 Git 仓库，继续在 `crown/` 内提交皇冠运行时改动。

这样父仓库不会把 `crown/` 误记录成嵌套仓库或 gitlink，也不会把会话数据库和运行数据提交进去。

## 常见问题

### `无法连接 Chrome CDP`

确认 Chrome 是用 `--remote-debugging-port=9222` 启动的，并检查：

```bash
curl http://127.0.0.1:9222/json/version
```

如果普通 Chrome 已经在运行，命令行参数可能不会生效。使用项目专用的 `--user-data-dir`，或者完全退出已有 Chrome 后再启动。

### `没有找到目标页面`

确认页面主机名以 `ps3838.com` 或 `ps38ag.com` 结尾，并且页面已经加载足球赔率内容。

### `缺少 capture.jsonl 或 events_list.csv`

`start.sh` 会创建空的 `capture.jsonl`，但 `events_list.csv` 必须存在。可以使用已有赛事清单，或者先生成/准备该文件。

### 输出中出现 `赛事 <event_id>`

这表示赔率更新先到达，而对应的赛事元数据暂时没有匹配到。实时快照会保留盘口，但比赛名称、联赛或开赛时间可能为空。可以点击看板中的“缺失”筛选查看，再使用“检查缺失”或“一键补全”；也可以运行 `metadata_sync.py --apply`。

### 皇冠提示重复登录（`session_conflict`）

这表示皇冠站点已经用同一账号在另一处登录，当前保存的会话被上游的 `doubleLogin` 拒绝。代码不会再把它误报成“赛事目录不完整”。请先在皇冠站点退出其他设备或浏览器上的会话，再回到看板点击“重新登录”；不要在多台设备间反复同时登录。

### 历史赔率页面为空

如果只是启动看板后的新数据，数据库会从升级后第一次启动看板时开始积累变化点。要导入已有的采集文件，先执行上面的历史数据回填命令，然后重启看板，确认页面显示 `SQLite · N 个变化点`。如果历史区域显示写入异常，检查项目目录是否有写权限，并查看 `logs/dashboard.log`。
