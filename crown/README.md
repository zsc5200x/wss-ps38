# 皇冠足球赔率终端

本项目只负责皇冠（Crown）会员站足球赛事的本地只读采集与展示。

## 功能范围

- 皇冠账号管理：只保存登录地址和账号，不接收密码、安全密码或 TOTP。
- 手动浏览器登录：在平博同一个 Chrome 窗口中打开第二个普通标签页，由用户手动登录和完成二次验证。
- 会话管理：保存、检查、重新登录、清除会话和删除账号。
- 赛事轮询：登录成功后读取今日足球与滚球足球，默认每 6 秒轮询一次。
- 失败退避：上游超时或暂时不可用时按 10、20、40、60 秒退避，页面保留最近一次成功数据。
- 持久缓存：最近一次成功快照原子写入 `data/events-cache.json`，重启时先显示缓存并标明上次更新时间；缓存不含凭据。
- 重复登录诊断：上游返回 `doubleLogin` 时明确显示 `session_conflict`，不再误报为赛事目录不完整。
- 盘口展示：主盘、让球、大小球、独赢和附加盘；附加盘由 `game_more` 按需和后台批次加载。
- 统一状态：嵌入主看板时通过 `postMessage` 同步在线状态、缓存状态、赛事数和更新时间。
- 本地页面：前端每 3 秒读取轻量赛事快照，登录状态和会话操作独立展示。

## 目录

```text
app.py                         HTTP 服务、静态页面和 API 路由
crown_runtime.py               皇冠账号运行时、赛事轮询、持久缓存和盘口标准化
crown_local/backend/           皇冠会话监听、会员站、赔率和存储
static/index.html              皇冠页面结构
static/app.css                 皇冠页面样式
static/app.js                  皇冠页面交互、轮询和嵌入状态同步
event_filters.py               皇冠赛事名称过滤
data/crown.sqlite3             皇冠账号、会话和运行数据（不要提交或删除）
data/events-cache.json         最近一次成功赛事快照（不入库、不含凭据）
test_crown_api.py              皇冠页面、静态资源和路由测试
test_crown_cache.py            持久缓存与损坏文件回退测试
test_crown_session_errors.py   重复登录和上游错误映射测试
test_crown_odds_display.py     皇冠赔率和附加盘测试
```

`data/crown.sqlite3` 是本地账号和会话数据，属于运行数据，不应放入 Git。

## 启动

项目要求 Python 3.11 或更高版本。

通过项目根目录的 `./start.sh` 或 `./crown.sh` 启动时，皇冠会连接平博正在使用的 Chrome CDP（默认 `http://127.0.0.1:9222`）。两者使用同一个 Chrome 默认配置和窗口，皇冠只新增第二个普通标签页，不创建无痕窗口。项目不会自动填写或提交登录表单；只会监听该皇冠标签页的站点请求，并把 Cookie 和站点存储严格限制在皇冠来源后再加密保存，不会把平博 Cookie 写入皇冠会话。直接运行 `app.py` 且未设置 `CROWN_CDP_URL` 时，才会回退为皇冠独立浏览器。

```bash
cd /Users/zsc5200x/ps3838-wss/crown
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python app.py
```

如手动指定共享浏览器：

```bash
CROWN_CDP_URL=http://127.0.0.1:9222 .venv/bin/python app.py
```

启动后访问：

- 统一入口：<http://127.0.0.1:8787/#crown>（推荐，由主看板同源代理）
- 皇冠独立页面：<http://127.0.0.1:8887/crown>
- 根路径：<http://127.0.0.1:8887/>，会 302 跳转到 `/crown`

如果登录时需要可见浏览器，请确保本机已安装 Google Chrome 或 Playwright Chromium。

## 使用流程

1. 打开 `/crown`，点击“连接皇冠会话”或进入设置。
2. 填写皇冠登录地址和账号，点击“保存账号并打开皇冠标签页”。
3. 在平博同一个 Chrome 窗口新增的皇冠普通标签页中手动输入账号、密码，并按页面要求完成验证码或二次验证。本项目和网页端都不会接收或保存这些密码类信息。
4. 登录成功后，页面会自动读取滚球和今日赛事；也可点击“检查会话”确认当前会话。
5. 点击赛事可查看主盘和附加盘。附加盘加载完成前会显示加载状态，失败时保留上一次成功的报价。

## 轮询和刷新

- 后端 `crown_refresh_loop()` 默认每 6 秒调用一次皇冠列表接口。
- 上游失败时使用指数式退避：10 秒、20 秒、40 秒、60 秒，之后保持 60 秒。
- 前端每 3 秒请求一次 `/api/crown/events?compact=1`，只读取轻量快照，不直接访问皇冠上游。
- 登录成功不等于盘口权限已确认；如果站点返回无权限或会话失效，页面会显示对应状态并保留旧数据。
- 如果显示“皇冠提示重复登录”或 API 返回 `session_conflict`，请先在皇冠站点退出其他设备上的会话，再点击“重新登录”。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/crown` | 皇冠赛事页面 |
| GET | `/crown/static/app.css` | 皇冠页面样式 |
| GET | `/crown/static/app.js` | 皇冠页面交互脚本 |
| GET | `/api/crown/events` | 完整皇冠赛事快照 |
| GET | `/api/crown/events?compact=1` | 前端轻量赛事快照 |
| GET | `/api/crown/accounts` | 皇冠账号列表 |
| POST | `/api/crown/accounts` | 保存皇冠地址和账号，并打开普通登录标签页 |
| GET | `/api/crown/session` | 当前会话和运行诊断（不含赛事） |
| POST | `/api/crown/session/check` | 检查当前皇冠会话并刷新数据 |
| POST | `/api/crown/events/<GID>/details` | 加载指定赛事的附加盘 |
| POST | `/api/crown/accounts/<id>/<action>` | 登录、检查、重新登录、取消、清除或删除 |
| DELETE | `/api/crown/accounts/<id>` | 删除皇冠账号 |

未定义的旧接口会返回 404。

## 数据与安全

- 浏览器会话由 `crown_local/backend/storage.py` 加密保存；密码、安全密码和 TOTP 不接收、不落盘。
- 共享 Chrome 上下文的 Cookie 在保存前按皇冠来源过滤，平博 Cookie 不会进入皇冠会话记录。
- 页面和 API 只监听 `127.0.0.1`，不要将端口直接暴露到公网。
- 不要把 `data/`、Cookie、会话密钥或账号密码提交到 Git。
- 本项目只执行只读赛事和赔率查询，不提供下注提交逻辑。

## 验证

```bash
.venv/bin/python -m py_compile app.py crown_runtime.py crown_local/backend/*.py
.venv/bin/python -m unittest discover -v
git diff --check
```
