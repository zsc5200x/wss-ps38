# 皇冠足球赔率终端

本项目只负责皇冠（Crown）会员站足球赛事的本地只读采集与展示。

## 功能范围

- 皇冠账号管理：登录地址、账号、密码和可选的 TOTP 动态码。
- 浏览器登录：通过 Playwright 打开皇冠会员站，完成登录和必要的二次验证。
- 会话管理：保存、检查、重新登录、清除会话和删除账号。
- 赛事轮询：登录成功后读取今日足球与滚球足球，默认每 6 秒轮询一次。
- 失败退避：上游超时或暂时不可用时按 10、20、40、60 秒退避，页面保留最近一次成功数据。
- 盘口展示：主盘、让球、大小球、独赢和附加盘；附加盘由 `game_more` 按需和后台批次加载。
- 本地页面：前端每 3 秒读取轻量赛事快照，登录状态和会话操作独立展示。

## 目录

```text
app.py                         HTTP 服务、页面和 API 路由
crown_runtime.py               皇冠账号运行时、赛事轮询和盘口标准化
crown_local/backend/           皇冠登录、会员站、赔率、存储和 TOTP
event_filters.py               皇冠赛事名称过滤
data/crown.sqlite3             皇冠账号、会话和运行数据（不要提交或删除）
test_crown_api.py              皇冠页面与路由测试
test_crown_odds_display.py     皇冠赔率和附加盘测试
```

`data/crown.sqlite3` 是本地账号和会话数据，属于运行数据，不应放入 Git。

## 启动

项目要求 Python 3.11 或更高版本。

```bash
cd /Users/zsc5200x/ps3838-wss/crown
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python app.py
```

启动后访问：

- 统一入口：<http://127.0.0.1:8787/#crown>（推荐，由主看板同源代理）
- 皇冠独立页面：<http://127.0.0.1:8887/crown>
- 根路径：<http://127.0.0.1:8887/>，会 302 跳转到 `/crown`

如果登录时需要可见浏览器，请确保本机已安装 Google Chrome 或 Playwright Chromium。

## 使用流程

1. 打开 `/crown`，点击“连接皇冠会话”或进入设置。
2. 填写皇冠登录地址、账号和密码；如账号启用了动态码，填写 TOTP 密钥。
3. 保存后项目会启动登录任务。若站点要求人工完成验证码或二次验证，按页面提示在浏览器中完成。
4. 登录成功后，页面会自动读取滚球和今日赛事；也可点击“检查会话”确认当前会话。
5. 点击赛事可查看主盘和附加盘。附加盘加载完成前会显示加载状态，失败时保留上一次成功的报价。

## 轮询和刷新

- 后端 `crown_refresh_loop()` 默认每 6 秒调用一次皇冠列表接口。
- 上游失败时使用指数式退避：10 秒、20 秒、40 秒、60 秒，之后保持 60 秒。
- 前端每 3 秒请求一次 `/api/crown/events?compact=1`，只读取轻量快照，不直接访问皇冠上游。
- 登录成功不等于盘口权限已确认；如果站点返回无权限或会话失效，页面会显示对应状态并保留旧数据。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/crown` | 皇冠赛事页面 |
| GET | `/api/crown/events` | 完整皇冠赛事快照 |
| GET | `/api/crown/events?compact=1` | 前端轻量赛事快照 |
| GET | `/api/crown/accounts` | 皇冠账号列表 |
| POST | `/api/crown/accounts` | 新增皇冠账号并启动登录 |
| GET | `/api/crown/session` | 当前会话和运行诊断（不含赛事） |
| POST | `/api/crown/session/check` | 检查当前皇冠会话并刷新数据 |
| POST | `/api/crown/events/<GID>/details` | 加载指定赛事的附加盘 |
| POST | `/api/crown/accounts/<id>/otp` | 提交动态验证码 |
| POST | `/api/crown/accounts/<id>/<action>` | 登录、检查、重新登录、取消、清除或删除 |
| DELETE | `/api/crown/accounts/<id>` | 删除皇冠账号 |

未定义的旧接口会返回 404。

## 数据与安全

- 账号密码、会话和 TOTP 密钥由 `crown_local/backend/storage.py` 管理，并以本地加密形式保存。
- 页面和 API 只监听 `127.0.0.1`，不要将端口直接暴露到公网。
- 不要把 `data/`、Cookie、会话密钥或账号密码提交到 Git。
- 本项目只执行只读赛事和赔率查询，不提供下注提交逻辑。

## 验证

```bash
.venv/bin/python -m py_compile app.py crown_runtime.py crown_local/backend/*.py
.venv/bin/python -m unittest discover -v
git diff --check
```
