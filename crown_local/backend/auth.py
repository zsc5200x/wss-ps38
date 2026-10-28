"""Account-isolated browser login with encrypted persistence supplied by Store.

All Playwright objects live on one worker thread. Passwords are typed into the
site's own form so site scripts create their own device and version parameters.
No captured credentials or fingerprint headers are replayed.
"""
from dataclasses import dataclass, field
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import queue
import re
import sys
import threading
import time
from urllib.parse import parse_qs, parse_qsl, urlencode, urljoin, urlsplit

from .providers import KINDS, MAX_RESPONSE_BYTES, parse_login_response, parse_member_login_domain
from .storage import SessionChangedError
from .totp import TOTP_INTERVAL, generate_code


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _origin(url):
    parts = urlsplit(url)
    return parts.scheme.lower(), (parts.hostname or "").lower(), parts.port or (443 if parts.scheme == "https" else 80)


# These values are the member site's own login handoff context, retained only
# inside the encrypted account session. Never expose them in account responses.
_MEMBER_RESUME_KEYS = frozenset({
    "cu", "cuipv6", "ipv6", "uid", "pay_type", "username", "passwd_safe", "mid", "ltype",
    "currency", "odd_f", "domain", "blackBoxStatus", "odd_f_type", "timetype",
    "sw_2fa", "editdate", "four_pwd", "abox4pwd_notshow", "msg", "langx", "iovationCnt",
})
_MEMBER_QUERY_MAX_LENGTH = 16384
_SESSION_BASELINE_UNSET = object()


class _SessionSaveError(RuntimeError):
    """A fixed internal category; original storage exceptions stay private."""


class _SessionChanged(RuntimeError):
    """A newer saved browser session won the persistence race."""


@dataclass
class _Job:
    account_id: str
    account: dict
    context: object
    page: object
    deadline: float
    status: str = "logging_in"
    uid: str = field(default="", repr=False)
    evidence: object = None
    next_screenshot: float = 0
    login_attempted: bool = False
    restore: bool = False
    form_pending: bool = False
    member_origin: str = ""
    member_authenticated: bool = False
    session_storage: dict = field(default_factory=dict, repr=False)
    resume_url: str = ""
    background: bool = False
    session_saved: bool = False
    session_baseline: object = field(default_factory=lambda: _SESSION_BASELINE_UNSET, repr=False)
    session_conflict: bool = False
    login_saved: bool = False
    login_recorded: bool = False
    member_protocol: dict = field(default_factory=dict, repr=False)
    member_resume_query: dict = field(default_factory=dict, repr=False)
    member_ui_verified: bool = False
    ui_verified_at: float = 0
    totp_submitted_counter: int = -1
    totp_attempts: int = 0
    transient_failures: int = 0
    retry_at: float = 0
    stage: str = "open_page"
    navigation_url: str = field(default="", repr=False)


class AuthService:
    def __init__(self, store):
        self.store = store
        self._commands = queue.Queue(maxsize=64)
        self._screenshots = {}
        self._lock = threading.Lock()
        self._jobs = {}
        self._stop = threading.Event()
        self._browser = None
        self._background_browser = None
        self._playwright = None
        self._destinations = {}
        self._thread = threading.Thread(target=self._run, name="account-login", daemon=True)
        self._thread.start()

    def _account(self, account_id):
        account = self.store.get_account(account_id)
        if not account:
            raise ValueError("账号不存在。")
        if account.get("kind") not in KINDS:
            raise ValueError("不支持的账号类型。")
        return account

    def _enqueue(self, action, account_id, payload=None):
        with self._lock:
            account = self._account(account_id)
            if action in {"start", "test", "otp"} and not account.get("enabled", True):
                raise ValueError("账号已停用，请先启用。")
            if self._stop.is_set():
                raise ValueError("登录服务已关闭。")
            if action in {"start", "test"}:
                background = action == "test" and bool((payload or {}).get("background"))
                if (account_id in self._jobs or account.get("status") in {"logging_in", "checking", "awaiting_otp", "awaiting_manual"}
                        or account_id in getattr(self, "_pending_checks", set())):
                    raise ValueError("该账号已有登录任务，请先完成或停止。")
                expected = {"expected_revision": account["revision"]} if account.get("revision") is not None else {}
                if background:
                    if not hasattr(self, "_pending_checks"):
                        self._pending_checks = set()
                    self._pending_checks.add(account_id)
                else:
                    self.store.set_state(account_id, "checking" if action == "test" else "logging_in",
                                         "已排队检查会话。" if action == "test" else "登录任务已排队。", **expected)
            try:
                self._commands.put_nowait((action, account_id, payload))
            except queue.Full:
                if action in {"start", "test"}:
                    getattr(self, "_pending_checks", set()).discard(account_id)
                    self._set(account_id, account["status"], account.get("last_error", ""))
                raise ValueError("登录任务繁忙，请稍后重试。") from None
        return self.store.get_account(account_id)

    def start(self, account_id):
        self._account(account_id)
        self._enqueue("start", account_id)
        return self.store.get_account(account_id)

    def submit_otp(self, account_id, code):
        code = str(code).strip()
        if not code.isascii() or not code.isdigit() or not 4 <= len(code) <= 10:
            raise ValueError("请输入 4 至 10 位数字动态码。")
        account = self._account(account_id)
        if account.get("status") != "awaiting_otp":
            raise ValueError("该账号当前没有等待动态验证码的登录任务。")
        return self._enqueue("otp", account_id, code)

    def test(self, account_id, background=False):
        return self._enqueue("test", account_id, {"background": bool(background)})

    def cancel(self, account_id):
        return self._enqueue("cancel", account_id)

    def screenshot(self, account_id):
        self._account(account_id)
        job = self._jobs.get(account_id)
        if job and not self._is_current(job):
            return None
        with self._lock:
            return self._screenshots.get(account_id)

    def browser_open(self, account_id):
        # HTTP handlers only read worker metadata, never Playwright objects.
        job = self._jobs.get(account_id)
        return bool(job and self._is_current(job))

    def close(self):
        self._stop.set()
        # Browser navigation is bounded; never operate Playwright on this thread.
        if threading.current_thread() is not self._thread:
            self._thread.join(timeout=5)

    def _set(self, account_id, status, message, **fields):
        job = self._jobs.get(account_id)
        if job:
            if not self._is_current(job):
                return
            if job.account.get("revision") is not None:
                fields["expected_revision"] = job.account["revision"]
        self.store.set_state(account_id, status, message, **fields)

    def _is_current(self, job):
        try:
            account = self.store.get_account(job.account_id)
        except (KeyError, ValueError):
            return False
        if not account.get("enabled", True):
            return False
        if account.get("revision") != job.account.get("revision"):
            return False
        return all(account.get(key) == job.account.get(key) for key in
                   ("kind", "base_url", "login_path", "username", "login_layer", "source_id"))

    def _session_baseline_current(self, job):
        baseline = getattr(job, "session_baseline", _SESSION_BASELINE_UNSET)
        if baseline is _SESSION_BASELINE_UNSET:
            return True
        try:
            current = self.store.load_session(job.account_id)
        except Exception:
            return False
        if baseline is None or current is None:
            return baseline is current
        expected = dict(baseline)
        expected.setdefault("base_url", job.account.get("base_url", ""))
        current = dict(current)
        current.setdefault("base_url", job.account.get("base_url", ""))
        return current == expected

    def _end_stale_session_job(self, job):
        """Stop a stale browser check without overwriting a newer saved session."""
        try:
            account = self.store.get_account(job.account_id)
            if (account.get("status") in {"checking", "logging_in"}
                    and self.store.load_session(job.account_id)):
                self._set(job.account_id, "session_received",
                          "保存会话已被另一个任务更新；本次旧页面检查已停止。", last_checked=_now())
        except Exception:
            pass
        self._dispose(job.account_id)

    def _log(self, account_id, action, status, message):
        try:
            account = self.store.get_account(account_id)
            self.store.add_log(account.get("kind", ""), account_id, action, status, message)
        except Exception:
            pass  # A deleted account must not terminate other browser sessions.

    def _launch(self, background=False):
        browser = self._background_browser if background else self._browser
        if browser and browser.is_connected():
            return browser
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise RuntimeError("缺少 Playwright，请安装项目依赖和 Chromium 后重试。") from None
        if self._playwright is None:
            self._playwright = sync_playwright().start()
        headless_setting = os.environ.get("HD_REPORT_HEADLESS", "").strip().lower()
        headless = headless_setting not in {"0", "false", "no"} if headless_setting else sys.platform != "darwin"
        options = {"headless": True if background else headless, "timeout": 30000}
        executable = os.environ.get("HD_REPORT_BROWSER_EXECUTABLE", "")
        if executable:
            options["executable_path"] = executable
        elif not Path(self._playwright.chromium.executable_path).exists() and Path("/usr/bin/chromium").exists():
            options["executable_path"] = "/usr/bin/chromium"
        try:
            browser = self._playwright.chromium.launch(**options)
            if background:
                self._background_browser = browser
            else:
                self._browser = browser
            return browser
        except Exception:
            raise RuntimeError("浏览器启动失败，请运行 python -m playwright install chromium，或检查浏览器配置。") from None

    def _run(self):
        try:
            while not self._stop.is_set():
                try:
                    action, account_id, payload = self._commands.get(timeout=0.08)
                except queue.Empty:
                    action = None
                if action:
                    try:
                        if action == "cancel":
                            self._set(account_id, "idle", "已停止本次登录；已保存的会话保持不变。")
                            self._dispose(account_id)
                        elif action == "otp":
                            self._otp(account_id, payload)
                        else:
                            self._begin(account_id, restore=action == "test",
                                        background=bool((payload or {}).get("background")))
                    except Exception as exc:
                        # Never log exception text: browser errors may embed URLs,
                        # post bodies, inline DOM content, or sensitive identifiers.
                        self._diagnostic(account_id, "command", exc)
                        self._fail(account_id, "登录操作未完成，请检查浏览器、域名和页面提示。")
                    finally:
                        getattr(self, "_pending_checks", set()).discard(account_id)
                        payload = None
                self._tick()
        finally:
            for account_id in list(self._jobs):
                self._dispose(account_id)
            for browser in (self._browser, self._background_browser):
                if not browser:
                    continue
                try:
                    browser.close()
                except Exception:
                    pass
            if self._playwright:
                try:
                    self._playwright.stop()
                except Exception:
                    pass

    def _begin(self, account_id, restore=False, background=False):
        account = self._account(account_id)
        if not account.get("enabled", True):
            return
        if len(self._jobs) >= 8 and account_id not in self._jobs:
            raise RuntimeError("同时打开的登录浏览器已达 8 个，请先停止其他任务。")
        self._dispose(account_id)
        if not background:
            self._set(account_id, "checking" if restore else "logging_in", "正在检查会话。" if restore else "正在打开正常登录页面。")
        existing_session = self.store.load_session(account_id)
        stored = existing_session if restore else None
        if restore and not stored:
            self._set(account_id, "idle", "尚无已保存会话，请先登录。")
            return
        base_url = account["base_url"].rstrip("/") + "/"
        login_url = urljoin(base_url, account.get("login_path") or "/")
        if _origin(base_url) != _origin(login_url):
            raise RuntimeError("登录路径必须属于账号配置的同一来源。")
        if stored and stored.get("auth_origin") != list(_origin(base_url)):
            self._set(account_id, "expired", "域名已变化，旧会话不能移交新来源，请重新登录。")
            return
        check_account = {**account, "status": "checking"} if not background else account
        if stored and account["kind"] == "crown_odds" and self._check_saved_member(check_account, stored):
            return
        browser = self._launch(background=background)
        context_args = {"viewport": {"width": 1100, "height": 800}, "ignore_https_errors": False}
        if stored:
            context_args["storage_state"] = stored.get("storage_state", {"cookies": [], "origins": []})
        context = browser.new_context(**context_args)
        context.set_default_timeout(2500)
        context.set_default_navigation_timeout(8000 if background else 30000)
        context.route("**/*", lambda route: self._guard_destination(route, self._jobs.get(account_id)))
        page = context.new_page()
        job = _Job(account_id, account, context, page, time.monotonic() + (35 if background else 300),
                   status="checking" if restore else "logging_in", uid=(stored or {}).get("uid", ""), restore=restore,
                   background=background, session_saved=bool(existing_session), session_baseline=existing_session)
        self._jobs[account_id] = job
        if stored:
            self._restore_member(job, stored)
            if (account["kind"] == "crown_odds"
                    and ((stored.get("member_origin") and not job.member_origin)
                         or not job.resume_url or not self._member_query_origin(job, job.resume_url)
                         or not self._member_query(job, job.member_resume_query))):
                self._set(account_id, "session_received", "旧会话缺少完整恢复信息，已保留原会话；请重新登录一次以补齐。", last_checked=_now())
                self._dispose(account_id)
                return
            login_url = self._member_resume_url(job) or login_url
        job.navigation_url = login_url
        # Login responses may be issued by frames or popups, so observe context.
        page.on("framenavigated", lambda frame: self._observe_member_navigation(job, frame))
        context.on("request", lambda request: self._observe_member_request(job, request))
        context.on("response", lambda response: self._response(job, response))
        for attempt in range(3):
            try:
                page.goto(login_url, wait_until="domcontentloaded")
                page.wait_for_timeout(400)
                break
            except Exception as exc:
                self._diagnostic(account_id, "open_page", exc)
                if not self._transient_exception(exc) or attempt == 2:
                    raise
                page.wait_for_timeout(150 * (attempt + 1))
        if not self._trusted_page(job, page.url):
            if background:
                self._fail(account_id, "后台会话检查尚未确认页面来源；已保留会话，稍后重试。")
                return
            self._set(account_id, "awaiting_manual", "页面跳转到了其他来源；未填入凭据，请确认并修改账号域名。")
            job.status = "awaiting_manual"
            return
        if restore:
            job.stage = "check_page"
            try:
                self._check_page(job)
            except Exception as exc:
                if not self._defer_transient(job, exc):
                    raise
            return
        job.stage = "login_form"
        try:
            self._fill_login(job)
        except Exception as exc:
            if not self._defer_transient(job, exc):
                raise

    def _check_saved_member(self, account, stored):
        """Verify a complete member snapshot without replaying its login handoff."""
        from .crown_member import CrownMemberClient, MemberNeedsBrowser, MemberExpired, MemberUnavailable
        try:
            client = CrownMemberClient(account, stored)
            client.heartbeat()
            updates = client.session_updates()
            status, message = "authenticated", "水位会员在线检查通过，会话已复用；盘口权限需单独验证。"
        except MemberNeedsBrowser:
            return False
        except MemberExpired:
            updates = None
            status, message = "expired", "会员在线接口确认当前会话失效；原会话保留，请重新登录。"
        except MemberUnavailable:
            updates = None
            status, message = "session_received", "水位在线检查暂时失败，已保留会话，稍后重试。"
        # The helper and main service use separate Store instances/processes.
        # Compare the snapshot and apply its result in one database transaction.
        self.store.apply_session_check(
            account["id"], stored, status, message, updates=updates,
            expected_revision=account.get("revision"), expected_status=account.get("status"),
            last_checked=_now())
        return True

    @staticmethod
    def _trusted_page(job, url):
        return (_origin(url) == _origin(job.account["base_url"])
                or (job.account["kind"] == "crown_odds" and job.member_origin
                    and _origin(url) == _origin(job.member_origin)))

    @staticmethod
    def _member_query(job, values, uid=None):
        """Accept one bounded, account-bound bootstrap query from a saved page."""
        uid = job.uid if uid is None else uid
        if not uid or not isinstance(values, dict) or len(values) > len(_MEMBER_RESUME_KEYS):
            return {}
        if values.get("uid") != uid:
            return {}
        accepted = {}
        for key, value in values.items():
            if (key not in _MEMBER_RESUME_KEYS or not isinstance(value, str)
                    or len(value) > 2048 or any(ord(char) < 32 or ord(char) == 127 for char in value)):
                return {}
            if key == "passwd_safe" and value != job.account.get("username"):
                return {}
            accepted[key] = value
        if len(urlencode(accepted)) > _MEMBER_QUERY_MAX_LENGTH:
            return {}
        return accepted

    def _capture_member_resume(self, job, url):
        """Retain the normal login bootstrap before its scripts clear the URL."""
        evidence_uid = (getattr(job.evidence, "uid", "")
                        if getattr(job.evidence, "status", "") == "session_received" else "")
        uid = job.uid or evidence_uid
        if (not self._member_query_origin(job, url)
                or not (job.member_authenticated or evidence_uid) or not uid):
            return
        try:
            parts = urlsplit(url)
            if len(parts.query) > _MEMBER_QUERY_MAX_LENGTH:
                return
            pairs = parse_qsl(parts.query, keep_blank_values=True, max_num_fields=64)
            query = {}
            for key, value in pairs:
                if key not in _MEMBER_RESUME_KEYS:
                    continue
                # This observed parameter is an account identifier only when it
                # exactly matches the configured username. Never retain a secret.
                if key == "passwd_safe" and value != job.account.get("username"):
                    continue
                if key in query:
                    return
                query[key] = value
            accepted = self._member_query(job, query, uid=uid)
            if accepted:
                job.member_resume_query = accepted
                job.resume_url = parts._replace(query="", fragment="").geturl()
            elif query.get("uid") and query["uid"] != uid:
                # Never apply one session's bootstrap to a subsequently changed UID.
                job.member_resume_query = {}
        except (TypeError, ValueError):
            return

    def _observe_member_navigation(self, job, frame):
        try:
            if (self._jobs.get(job.account_id) is job and self._is_current(job)
                    and job.account["kind"] == "crown_odds" and frame == job.page.main_frame):
                self._capture_member_resume(job, frame.url)
        except Exception:
            # A replaced frame or malformed location cannot change saved state.
            return

    @staticmethod
    def _member_query_origin(job, url):
        """Only the account's verified member origin may receive bootstrap state."""
        try:
            parts = urlsplit(url)
            return (bool(parts.scheme in {"http", "https"} and parts.hostname)
                    and not parts.username and not parts.password
                    and _origin(url) == _origin(job.member_origin or job.account["base_url"]))
        except (TypeError, ValueError):
            return False

    def _member_resume_url(self, job):
        """Construct a private navigation target; the persisted URL stays clean."""
        resume = job.resume_url
        if not resume or not self._trusted_page(job, resume):
            return ""
        parts = urlsplit(resume)
        if parts.username or parts.password:
            return ""
        query = self._member_query(job, job.member_resume_query)
        if query and self._member_query_origin(job, resume):
            return parts._replace(query=urlencode(query), fragment="").geturl()
        return parts._replace(query="", fragment="").geturl()

    def _restore_member(self, job, stored):
        if job.account["kind"] != "crown_odds":
            return
        job.member_resume_query = {}
        job.member_origin = ""
        job.resume_url = ""
        # Only records saved by this account at its unchanged entry origin may
        # supply a member destination. Recheck DNS before opening that page.
        from .storage import normalize_base_url, validate_target_url
        candidate = stored.get("member_origin", "")
        if candidate:
            try:
                candidate = normalize_base_url(candidate)
            except ValueError:
                candidate = ""
            if candidate and validate_target_url(candidate):
                job.member_origin = candidate
        job.member_authenticated = bool(job.uid and stored.get("member_authenticated", True))
        protocol = stored.get("member_protocol", {})
        job.member_protocol = {}
        if isinstance(protocol, dict):
            origin = protocol.get("origin", "")
            ver = self._protocol_value(protocol.get("ver"), r"[A-Za-z0-9._-]+", 96)
            langx = self._protocol_value(protocol.get("langx"), r"[A-Za-z]{2,3}(?:[-_][A-Za-z]{2,4})?", 16)
            try:
                parts = urlsplit(origin)
                canonical = f"{parts.scheme}://{parts.netloc}" if not parts.path and not parts.query and not parts.fragment else ""
                if (canonical and not parts.username and not parts.password
                        and self._trusted_page(job, canonical) and ver and langx):
                    job.member_protocol = {"origin": canonical, "ver": ver, "langx": langx}
            except Exception:
                job.member_protocol = {}
        job.member_ui_verified = bool(stored.get("member_ui_verified", False))
        resume = stored.get("resume_url", "")
        if resume and self._trusted_page(job, resume):
            parts = urlsplit(resume)
            if not parts.username and not parts.password:
                job.resume_url = parts._replace(query="", fragment="").geturl()
                if self._member_query_origin(job, job.resume_url):
                    job.member_resume_query = self._member_query(job, stored.get("member_resume_query", {}))
        sessions = stored.get("session_storage", {})
        if isinstance(sessions, dict):
            job.session_storage = {origin: deepcopy(values) for origin, values in sessions.items()
                                   if self._trusted_page(job, origin) and isinstance(values, dict)}
        if job.session_storage:
            data = json.dumps(job.session_storage, ensure_ascii=True)
            job.context.add_init_script("""(() => {
                const states = """ + data + """;
                const values = states[location.origin];
                if (values) for (const [key, value] of Object.entries(values)) {
                    if (typeof value === 'string' && sessionStorage.getItem(key) === null) {
                        sessionStorage.setItem(key, value);
                    }
                }
            })();""")

    def _guard_destination(self, route, job=None):
        """Do not let configured sites reach localhost/private network services."""
        try:
            from .storage import validate_target_url
            target = _origin(route.request.url)
            cached = self._destinations.get(target)
            if cached is None or time.monotonic() - cached[0] > 30:
                allowed = validate_target_url(route.request.url)
                self._destinations[target] = (time.monotonic(), allowed)
            else:
                allowed = cached[1]
            if allowed:
                if not job or not self._capture_member_request(job, route):
                    route.continue_()
            else:
                route.abort("blockedbyclient")
        except Exception:
            route.abort("blockedbyclient")

    def _capture_member_request(self, job, route):
        """Buffer the site's own member auth response before its JS navigates.

        A response event can arrive too late to read Chromium's response body
        after a cross-origin navigation. Send the intercepted request once,
        observe its result, then deliver that same result to the page.
        """
        request = route.request
        data = request.post_data or ""
        if (job.account["kind"] != "crown_odds" or not self._is_current(job)
                or _origin(request.url) != _origin(job.account["base_url"])
                or request.method != "POST" or urlsplit(request.url).path != "/transform_nl.php"
                or parse_qs(data, keep_blank_values=True).get("p") not in
                (["chk_login"], ["check_login_domain"])):
            return False
        upstream = route.fetch(max_redirects=0, timeout=30000)
        try:
            body = upstream.body()
            if len(body) <= MAX_RESPONSE_BYTES:
                self._accept_member_response(job, request.url, upstream.status,
                                             body.decode("utf-8", errors="replace"), data)
            # APIRequestContext decodes compression. Remove transport headers
            # when delivering those bytes so the browser does not decode twice.
            headers = {key: value for key, value in upstream.headers.items()
                       if key.lower() not in {"content-encoding", "content-length", "transfer-encoding"}}
            route.fulfill(status=upstream.status, headers=headers, body=body)
        finally:
            upstream.dispose()
        return True

    @staticmethod
    def _protocol_value(value, pattern, limit):
        value = str(value or "").strip()
        return value if len(value) <= limit and re.fullmatch(pattern, value, flags=re.ASCII) else ""

    def _observe_member_request(self, job, request):
        """Remember only the site's ordinary authenticated mem_online request."""
        try:
            if (job.account.get("kind") != "crown_odds" or not self._is_current(job)
                    or request.method != "POST" or urlsplit(request.url).path != "/transform.php"):
                return
            source = _origin(request.url)
            if not (source == _origin(job.account["base_url"])
                    or (job.member_origin and source == _origin(job.member_origin))):
                return
            body = parse_qs(request.post_data or "", keep_blank_values=True, strict_parsing=False)
            if body.get("p") != ["mem_online"]:
                return
            uid_values = body.get("uid", []) + body.get("UID", [])
            if len(uid_values) != 1:
                return
            uid = uid_values[0]
            evidence_uid = (getattr(job.evidence, "uid", "")
                            if getattr(job.evidence, "status", "") == "session_received" else "")
            if not uid or uid not in {job.uid, evidence_uid}:
                return
            query = parse_qs(urlsplit(request.url).query, keep_blank_values=True)
            ver_candidates = query.get("ver", []) + body.get("ver", [])
            lang_candidates = query.get("langx", []) + body.get("langx", [])
            if (not ver_candidates or not lang_candidates
                    or any(not self._protocol_value(value, r"[A-Za-z0-9._-]+", 96) for value in ver_candidates)
                    or any(not self._protocol_value(value, r"[A-Za-z]{2,3}(?:[-_][A-Za-z]{2,4})?", 16) for value in lang_candidates)):
                return
            ver_values = {self._protocol_value(value, r"[A-Za-z0-9._-]+", 96) for value in ver_candidates}
            lang_values = {self._protocol_value(value, r"[A-Za-z]{2,3}(?:[-_][A-Za-z]{2,4})?", 16) for value in lang_candidates}
            ver_values.discard("")
            lang_values.discard("")
            if len(ver_values) != 1 or len(lang_values) != 1:
                return
            hostname = f"[{source[1]}]" if ":" in source[1] else source[1]
            default_port = 443 if source[0] == "https" else 80
            job.member_protocol = {"origin": f"{source[0]}://{hostname}" +
                                   (f":{source[2]}" if source[2] != default_port else ""),
                                   "ver": next(iter(ver_values)), "langx": next(iter(lang_values))}
        except Exception as exc:
            self._diagnostic(job.account_id, "member_request", exc)




    def _accept_member_response(self, job, url, status, body, data):
        if self._jobs.get(job.account_id) is not job or not self._is_current(job):
            return
        if parse_qs(data, keep_blank_values=True).get("p") == ["check_login_domain"]:
            candidate = parse_member_login_domain(url, status, body, data)
            from .storage import validate_target_url
            if candidate and validate_target_url(candidate):
                job.member_origin = candidate
        else:
            evidence = parse_login_response("crown_odds", url, status, body, data)
            if evidence:
                job.evidence = evidence

    @staticmethod
    def _visible_locator(frame, selectors):
        for selector in selectors:
            try:
                locator = frame.locator(selector)
                for index in range(min(locator.count(), 6)):
                    item = locator.nth(index)
                    if item.is_visible() and item.is_enabled():
                        return item
            except Exception:
                continue
        return None

    def _fill_login(self, job):
        if not self._is_current(job):
            return
        job.form_pending = False
        credentials = self.store.get_credentials(job.account_id)
        password = credentials.get("password", "")
        if not password:
            raise RuntimeError("尚未保存登录密码，请先编辑账号。")
        username_selectors = [
            'input[name="username"]', '#username', 'input[name="user"]', '#user',
            'input[name="usr"]', '#usr',
            'input[name="account"]', '#account', 'input[autocomplete="username"]',
            'input[name="loginName"]', '#loginName', 'input[name="loginname"]',
        ]
        password_selectors = [
            'input[name="password"]', 'input[name="pwd"]', '#password', '#pwd',
            'input[type="password"]:not([name="safe"]):not([name="pwd_safe"])',
        ]
        for frame in job.page.frames:
            if _origin(frame.url) != _origin(job.account["base_url"]):
                continue
            # Layer selection may replace the form or reveal another panel.
            # Resolve the currently visible fields after the site's own switch.
            username = self._visible_locator(frame, username_selectors)
            if username is None and job.account["kind"] == "crown_odds":
                for label in ("登入账号", "登录账号", "用户名", "账号"):
                    try:
                        labeled = frame.get_by_label(label, exact=False)
                        for index in range(min(labeled.count(), 3)):
                            candidate = labeled.nth(index)
                            if candidate.is_visible() and candidate.is_enabled():
                                username = candidate
                                break
                    except Exception:
                        continue
                    if username is not None:
                        break
            if username is None and job.account["kind"] == "crown_odds":
                username = self._visible_locator(frame, [
                    'input[placeholder*="账号"]', 'input[placeholder*="用户名"]',
                    'input[aria-label*="账号"]', 'input[aria-label*="用户名"]',
                ])
                if username is None:
                    candidates = []
                    inputs = frame.locator(
                        'input:visible:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])'
                    )
                    for index in range(inputs.count()):
                        item = inputs.nth(index)
                        if not item.is_enabled():
                            continue
                        identity = " ".join((
                            item.get_attribute("name") or "",
                            item.get_attribute("id") or "",
                            item.get_attribute("placeholder") or "",
                            item.get_attribute("aria-label") or "",
                        )).lower()
                        if any(token in identity for token in ("captcha", "verify", "otp", "code", "safe")):
                            continue
                        candidates.append(item)
                    if len(candidates) == 1:
                        username = candidates[0]
            password_input = self._visible_locator(frame, password_selectors)
            if username is None or password_input is None:
                continue
            username.fill(job.account["username"])
            password_input.fill(password)
            if credentials.get("safe_password"):
                safe_input = self._visible_locator(frame, ['input[name="safe"]', '#safe', '#pwd_safe', 'input[name="pwd_safe"]', 'input[name="safe_password"]'])
                if safe_input is None:
                    self._manual(job, "已配置安全密码，但页面未找到对应输入框，请在本机浏览器确认。")
                    return
                safe_input.fill(credentials["safe_password"])
            # Do not submit over image/CAPTCHA challenges or hidden iframes. OTP
            # follows account authentication and is handled by its own form.
            captcha = self._visible_locator(frame, [
                'input[name*="captcha" i]', 'input[id*="captcha" i]',
                'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
                'input[name="checkCode"]', 'input[name="verifyCode"]',
            ])
            if captcha is not None:
                self._manual(job, "页面需要验证码，请在本机打开的浏览器完成；云端可查看截图。")
                return
            submit = self._visible_locator(frame, [
                'button[type="submit"]', 'input[type="submit"]', '#login_btn', '#btn_login', '#login', '#btnLogin',
                '[name="login"]', '#loginBtn', 'button:has-text("登录")',
                'button:has-text("登入")', 'button:has-text("Login")',
                '[role="button"]:text-is("登入")', '[role="button"]:text-is("登录")',
                '[role="button"]:text-is("Login")', ':text-is("登入")',
                'a:has-text("登录")', 'a:has-text("登入")',
            ])
            job.login_attempted = True
            if submit is not None:
                submit.click()
            else:
                password_input.press("Enter")
            self._log(job.account_id, "login", "logging_in", "已通过站点正常页面提交登录表单。")
            return
        job.form_pending = True
        job.status = "logging_in"
        self._set(job.account_id, "logging_in", "正在识别登录表单，暂未检测到验证步骤。")

    def _manual(self, job, message):
        job.status = "awaiting_manual"
        self._set(job.account_id, job.status, message)

    def _response(self, job, response):
        try:
            if self._jobs.get(job.account_id) is not job or not self._is_current(job) or _origin(response.url) != _origin(job.account["base_url"]):
                return
            request = response.request
            from .providers import is_login_response
            request_data = request.post_data or ""
            if request.method != "POST":
                return
            length = response.header_value("content-length")
            if length and length.isdigit() and int(length) > MAX_RESPONSE_BYTES:
                return
            if job.account["kind"] == "crown_odds":
                if (urlsplit(response.url).path == "/transform_nl.php"
                        and parse_qs(request_data).get("p") == ["check_login_domain"]):
                    self._accept_member_response(job, response.url, response.status,
                                                 response.text(), request_data)
                    return
            if not is_login_response(job.account["kind"], response.url, request_data):
                return
            evidence = parse_login_response(job.account["kind"], response.url,
                                            response.status, response.text(), request_data)
            if evidence:
                job.evidence = evidence
        except Exception:
            # Network failures are shown as timeouts/manual checks, never expose
            # response bodies or request values in exception/log output.
            return





    def _save(self, job):
        if not self._is_current(job):
            return
        if job.session_conflict or not self._session_baseline_current(job):
            raise _SessionChanged("saved session changed")
        for frame in job.page.frames:
            if not self._trusted_page(job, frame.url):
                continue
            try:
                job.session_storage[frame.evaluate("location.origin")] = frame.evaluate(
                    "() => Object.fromEntries(Object.entries(sessionStorage))")
            except Exception:
                pass  # A frame can be replaced while the site redirects.
        if self._trusted_page(job, job.page.url):
            if job.member_resume_query.get("uid") != job.uid:
                job.member_resume_query = {}
            self._capture_member_resume(job, job.page.url)
            if not job.member_resume_query:
                job.resume_url = urlsplit(job.page.url)._replace(query="", fragment="").geturl()
        expected = {"expected_revision": job.account["revision"]} if job.account.get("revision") is not None else {}
        try:
            storage_state = job.context.storage_state()
        except Exception:
            raise _SessionSaveError("browser snapshot failed") from None
        session = {
            "storage_state": storage_state,
            "uid": job.uid,
            "auth_origin": list(_origin(job.account["base_url"])),
            "member_origin": job.member_origin,
            "member_authenticated": job.member_authenticated,
            "resume_url": job.resume_url,
            "session_storage": job.session_storage,
            "member_protocol": job.member_protocol,
            "member_resume_query": job.member_resume_query,
            "member_ui_verified": job.member_ui_verified,
            "saved_at": _now(),
        }
        try:
            update_last_login = job.login_saved and not job.login_recorded
            save_options = {"update_last_login": update_last_login, **expected}
            baseline = getattr(job, "session_baseline", _SESSION_BASELINE_UNSET)
            if baseline is not _SESSION_BASELINE_UNSET:
                save_options["expected_session"] = baseline
            self.store.save_session(job.account_id, session, **save_options)
        except SessionChangedError as exc:
            raise _SessionChanged("saved session changed") from exc
        except Exception:
            raise _SessionSaveError("session save failed") from None
        # CAS must compare an immutable snapshot with the persisted record.
        # The job continues collecting sessionStorage/protocol fields while
        # the login page settles; sharing their dicts mutates our own baseline.
        job.session_baseline = deepcopy({**session, "base_url": job.account["base_url"]})
        job.session_saved = True
        if update_last_login:
            job.login_recorded = True

    def _persist_verified(self, job):
        if job.session_conflict:
            return False
        try:
            self._save(job)
            return True
        except _SessionChanged as exc:
            self._diagnostic(job.account_id, "save_session", exc)
            self._end_stale_session_job(job)
            return False
        except _SessionSaveError as exc:
            self._diagnostic(job.account_id, "save_session", exc)
            self._set(job.account_id, "error", "登录界面已验证，但会话保存失败；现有会话未覆盖。", last_checked=_now())
            self._dispose(job.account_id)
            return False

    def _otp(self, account_id, code):
        job = self._jobs.get(account_id)
        if not job or not self._is_current(job) or job.status != "awaiting_otp":
            raise RuntimeError("验证码会话已结束，请重新开始登录。")
        job.totp_attempts = 0
        job.totp_submitted_counter = int(time.time() // TOTP_INTERVAL)
        self._submit_otp_code(job, code)

    def _submit_otp_code(self, job, code, automatic=False):
        for frame in job.page.frames:
            if not self._trusted_page(job, frame.url):
                continue
            field = self._visible_locator(frame, [
                'input[name="otpCode"]', '#otpCode', 'input[autocomplete="one-time-code"]',
                'input[name="otp"]', '#otp', 'input[name="code"]', 'input[inputmode="numeric"]',
                'input[name*="authenticator" i]', 'input[id*="authenticator" i]',
                'input[name*="verifycode" i]', 'input[id*="verifycode" i]',
                'input[type="tel"]', 'input[type="number"]', 'input[maxlength="6"]',
            ])
            if field is None:
                continue
            field.fill(code)
            button = self._visible_locator(frame, [
                'button[type="submit"]', 'input[type="submit"]',
                'button:has-text("提交")', 'button:has-text("验证")', 'button:has-text("Submit")',
            ])
            if button is not None:
                button.click()
            else:
                field.press("Enter")
            job.deadline = time.monotonic() + 180
            message = ("已自动提交二次验证动态码，正在等待站点确认。" if automatic
                       else "动态码已提交，正在等待站点验证。")
            self._set(job.account_id, "awaiting_otp", message)
            return
        self._manual(job, "未找到动态码输入框，请在本机浏览器完成验证，或重新登录。")

    def _auto_submit_totp(self, job):
        """Submit at most one code per time step and stop after three attempts."""
        secret = self.store.get_credentials(job.account_id).get("totp_secret", "")
        if not secret:
            return False
        try:
            code, counter, remaining = generate_code(secret)
        except ValueError:
            self._set(job.account_id, "awaiting_otp",
                      "已保存的二次验证密钥无法使用，请编辑账号更新密钥，或手动输入验证码。")
            return True
        if counter == job.totp_submitted_counter:
            return True
        if remaining <= 5:
            self._set(job.account_id, "awaiting_otp", "正在等待下一个有效动态码周期。")
            return True
        if job.totp_attempts >= 3:
            self._set(job.account_id, "awaiting_otp",
                      "自动二次验证已尝试三次，请检查密钥或手动输入验证码。")
            return True
        job.totp_submitted_counter = counter
        job.totp_attempts += 1
        self._submit_otp_code(job, code, automatic=True)
        return True

    def _otp_challenge(self, frame):
        """Recognize an explicit authenticator prompt without mistaking CAPTCHA for OTP."""
        field = self._visible_locator(frame, [
            'input[autocomplete="one-time-code"]', 'input[name*="otp" i]', 'input[id*="otp" i]',
            'input[name*="authenticator" i]', 'input[id*="authenticator" i]',
            'input[name*="verifycode" i]', 'input[id*="verifycode" i]',
            'input[name="code"]', '#code', 'input[inputmode="numeric"]',
            'input[type="tel"]', 'input[type="number"]', 'input[maxlength="6"]',
        ])
        if field is None:
            return False
        try:
            text = frame.locator("body").inner_text(timeout=700)
        except Exception:
            return False
        return bool(re.search(
            r"身份验证器|身分驗證器|动态验证码|動態驗證碼|动态码|動態碼|"
            r"谷歌验证|谷歌驗證|Google\s*Authenticator|authenticator|"
            r"一次性密码|一次性密碼|one[- ]time(?: password| code)?|TOTP|"
            r"双重验证|雙重驗證|双因素验证|雙因素驗證|两步验证|兩步驗證|二次验证|二次驗證|2FA",
            text, re.IGNORECASE,
        ))

    def _check_page(self, job):
        """Confirm the signed-in UI on the entry or its verified member domain."""
        if not self._is_current(job):
            return
        if job.session_conflict:
            return
        if not self._session_baseline_current(job):
            self._end_stale_session_job(job)
            return
        if job.page.is_closed():
            return
        if not self._trusted_page(job, job.page.url):
            if job.background:
                self._fail(job.account_id, "后台检查无法确认当前页面来源；原会话保留。")
                return
            self._manual(job, "页面位于其他来源，尚未确认会话；请核对配置域名。")
            return
        trusted_frames = [frame for frame in job.page.frames if self._trusted_page(job, frame.url)]
        if any(self._otp_challenge(frame) for frame in trusted_frames):
            if job.status != "awaiting_otp":
                job.deadline = time.monotonic() + 600
            job.status = "awaiting_otp"
            if not self._auto_submit_totp(job):
                self._set(job.account_id, job.status, "网站要求输入身份验证器动态码，请填写本次有效验证码。")
            return

        otp_was_pending = job.status == "awaiting_otp"
        if otp_was_pending:
            job.totp_attempts = 0
            job.totp_submitted_counter = -1
            job.status = "logging_in"
            self._set(job.account_id, job.status, "已离开动态码验证页，正在确认登录结果。")

        for frame in trusted_frames:
            if self._dismiss_member_quick_password_prompt(frame):
                return
            password_field = self._visible_locator(frame, ['input[type="password"]'])
            if password_field is not None:
                if job.background:
                    job.restore = False
                    job.status = "expired"
                    self._set(job.account_id, "expired", "后台检查确认页面已返回登录表单；会话已失效。", last_checked=_now())
                    self._dispose(job.account_id)
                    return
                if otp_was_pending and not job.restore:
                    self._manual(job, "动态码页面已离开，但仍返回登录表单，尚未确认成功；请查看浏览器提示。")
                    return
                if job.restore and _origin(frame.url) == _origin(job.account["base_url"]):
                    job.restore = False
                    job.uid = ""
                    job.member_authenticated = False
                    job.member_ui_verified = False
                    job.member_protocol = {}
                    job.member_resume_query = {}
                    job.status = "logging_in"
                    self._set(job.account_id, "logging_in", "旧会话已回到登录页，正在尝试一次重新登录；验证码仍需你处理。", last_checked=_now())
                    self._fill_login(job)
                elif job.restore:
                    job.restore = False
                    job.uid = ""
                    job.member_authenticated = False
                    job.member_ui_verified = False
                    job.member_protocol = {}
                    job.member_resume_query = {}
                    job.session_storage = {}
                    job.status = "logging_in"
                    self._set(job.account_id, "logging_in", "会员会话已失效，正在返回登录入口重新登录。", last_checked=_now())
                    entry = urljoin(job.account["base_url"].rstrip("/") + "/", job.account.get("login_path") or "/")
                    job.page.goto(entry, wait_until="domcontentloaded")
                    if _origin(job.page.url) == _origin(job.account["base_url"]):
                        self._fill_login(job)
                return
            logout = self._visible_locator(frame, [
                'a:has-text("退出登录")', 'button:has-text("退出登录")',
                'a:has-text("登出")', 'button:has-text("登出")',
                'a:has-text("Logout")', 'button:has-text("Logout")',
                '[aria-label="Logout"]', '[title="登出"]', '[title="退出登录"]',
            ])
            member_signed_in = (job.member_authenticated and job.uid
                                and self._member_signed_in(frame))
            entry_page = _origin(frame.url) == _origin(job.account["base_url"])
            confirmed_logout = logout is not None and (entry_page or (job.member_authenticated and job.uid))
            if confirmed_logout or member_signed_in:
                job.status = "authenticated"
                job.member_ui_verified = True
                if not job.ui_verified_at:
                    job.ui_verified_at = time.monotonic()
                job.login_saved = not job.restore and not job.background
                if (job.background and not job.member_protocol
                        and time.monotonic() - job.ui_verified_at < 10
                        and time.monotonic() < job.deadline):
                    # Let the normal member page emit its own metadata-bearing request.
                    return
                if not self._persist_verified(job):
                    return
                self._set(job.account_id, "authenticated", "站点显示已登录界面，会话已保存；订单/盘口读取权限尚未验证。", last_checked=_now())
                self._dispose(job.account_id)
                return
        if job.restore:
            job.member_ui_verified = False
            job.ui_verified_at = 0
            job.status = "session_received"
            if not job.background:
                self._set(job.account_id, "session_received", "已载入保存会话，但页面不足以确认仍然有效；稍后可重新检查。", last_checked=_now())


    def _dismiss_member_quick_password_prompt(self, frame):
        try:
            prompt = frame.get_by_text(re.compile(r"[你您]要设置一个简易密码以便快速登入吗"), exact=False)
            if not prompt.is_visible():
                return False
            decline = self._visible_locator(frame, [
                'button:text-is("否")', 'input[type="button"][value="否"]',
                'a:text-is("否")', '[role="button"]:text-is("否")', 'div:text-is("否")',
            ])
            if decline is None:
                return False
            decline.click()
            return True
        except Exception:
            return False


    def _member_signed_in(self, frame):
        """The observed member header hides logout inside the account menu."""
        account = self._visible_locator(frame, [
            '#myAcc_page', '.btn_acc', '#user_info', '[aria-label="账户"]',
        ])
        history = self._visible_locator(frame, [
            '#header_todaywagers', '#header_historydata',
            'button:has-text("投注记录")', 'a:has-text("投注记录")',
            'button:has-text("投注紀錄")', 'a:has-text("投注紀錄")',
        ])
        if account is None or history is None:
            return False
        try:
            text = frame.locator("body").inner_text(timeout=700)
            return bool(re.search(r"(?:RMB|CNY|USD|HKD|余额|餘額)\s*[:：]?\s*[\d,]+(?:\.\d+)?", text))
        except Exception:
            return False  # A redirect may replace the header during detection.

    def _tick(self):
        for account_id, job in list(self._jobs.items()):
            try:
                if not self._is_current(job):
                    self._dispose(account_id)
                    continue
                if job.retry_at:
                    if time.monotonic() < job.retry_at:
                        continue
                    job.retry_at = 0
                    self._retry_stage(job)
                    if self._jobs.get(account_id) is not job:
                        continue
                if job.page.is_closed():
                    if job.background and job.session_saved:
                        self._set(account_id, "session_received", "后台检查页面已关闭；已保留原会话，稍后可重试。", last_checked=_now())
                    elif job.status not in {"authenticated", "session_received"}:
                        self._set(account_id, "idle", "浏览器已关闭，请重新开始登录。")
                    self._dispose(account_id)
                    continue
                # Pump Playwright's event loop; every browser object stays here.
                job.page.wait_for_timeout(30)
                if job.session_conflict:
                    continue
                if job.background and job.member_ui_verified and job.status == "authenticated":
                    if job.member_protocol or time.monotonic() - job.ui_verified_at >= 10:
                        # The page may have returned to login while metadata was pending.
                        job.stage = "check_page"
                        self._check_page(job)
                        if self._jobs.get(account_id) is not job:
                            continue
                if job.evidence:
                    evidence, job.evidence = job.evidence, None
                    job.status = evidence.status
                    if evidence.uid:
                        job.uid = evidence.uid
                        if evidence.status == "session_received":
                            job.member_authenticated = True
                    if evidence.status in {"authenticated", "session_received"}:
                        if evidence.status == "session_received":
                            # The login response precedes the member-domain
                            # handoff and final browser state. Keep the account
                            # busy and the old snapshot until the signed-in UI
                            # is confirmed, so monitoring cannot race the login.
                            job.status = "logging_in"
                            job.form_pending = False
                            job.next_screenshot = 0
                            self._set(account_id, "logging_in", "会员登录响应已成功，正在等待会员页面完成并保存完整会话。")
                            self._log(account_id, "login", "logging_in", "会员登录响应已成功，等待页面完成会话。")
                            continue
                        job.login_saved = not job.restore and not job.background
                        if not self._persist_verified(job):
                            continue
                        self._set(account_id, evidence.status, evidence.message, last_checked=_now())
                        self._log(account_id, "login", evidence.status, evidence.message)
                        if evidence.status == "authenticated":
                            self._dispose(account_id)
                            continue
                    else:
                        self._set(account_id, evidence.status, evidence.message)
                if time.monotonic() >= job.next_screenshot:
                    job.next_screenshot = time.monotonic() + 3
                    if job.status in {"logging_in", "awaiting_manual"} and job.form_pending:
                        self._fill_login(job)
                    if job.status in {"logging_in", "awaiting_manual", "awaiting_otp", "session_received", "checking"}:
                        job.stage = "check_page"
                        self._check_page(job)
                    if self._jobs.get(account_id) is not job:
                        continue
                    # Mask passwords, OTP and safety fields even if the site
                    # renders them as plain text inputs.
                    masks = []
                    for frame in job.page.frames:
                        masks.append(frame.locator('input[type="password"], input[autocomplete="one-time-code"], input[name="otpCode"], input[name="otp"], input[id*="otp" i], input[name*="authenticator" i], input[id*="authenticator" i], input[inputmode="numeric"], input[type="tel"], input[type="number"], input[maxlength="6"], input[name="code"], input[name="safe"], input[name="pwd_safe"], #pwd_safe'))
                    try:
                        png = job.page.screenshot(type="png", mask=masks, timeout=2500)
                        with self._lock:
                            self._screenshots[account_id] = png
                    except Exception:
                        pass  # A preview failure must not destroy a valid login.
                if time.monotonic() >= job.deadline:
                    if job.background:
                        self._fail(account_id, "后台检查超过时限；已保留原会话，稍后重试。")
                    elif job.status in {"authenticated", "session_received"}:
                        self._persist_verified(job)
                        self._dispose(account_id)
                    else:
                        self._fail(account_id, "登录等待超过 5 分钟，已停止任务；可重新登录。")
            except Exception as exc:
                if self._defer_transient(job, exc):
                    continue
                self._diagnostic(account_id, job.stage, exc)
                self._fail(account_id, "登录操作未完成；已有会话保留，必要时可重新检查或登录。")

    @staticmethod
    def _transient_exception(exc):
        name = type(exc).__name__.lower()
        message = str(exc).lower()
        return ("timeout" in name or "timeout" in message
                or "navigation interrupted" in message or "net::err_" in message
                or "frame was detached" in message or "execution context was destroyed" in message)

    def _defer_transient(self, job, exc):
        if (not self._transient_exception(exc) or job.transient_failures >= 3
                or time.monotonic() >= job.deadline):
            return False
        job.transient_failures += 1
        job.retry_at = time.monotonic() + 0.2 * job.transient_failures
        self._diagnostic(job.account_id, job.stage, exc, retry=job.transient_failures)
        return True

    def _diagnostic(self, account_id, stage, exc, retry=0):
        name = type(exc).__name__.lower()
        category = ("storage" if isinstance(exc, _SessionSaveError) else
                    "timeout" if "timeout" in name or "timeout" in str(exc).lower() else
                    "navigation_or_page")
        stage = stage if stage in {"open_page", "login_form", "check_page", "member_request", "save_session", "command"} else "browser"
        message = f"内部诊断：{stage}/{category}" + (f"，短暂重试第 {retry} 次。" if retry else "，已安全结束本次操作。")
        self._log(account_id, "auth_diagnostic", "retry" if retry else "warning", message)

    def _retry_stage(self, job):
        if not self._is_current(job) or job.page.is_closed():
            return
        if job.stage == "open_page":
            job.page.goto(job.navigation_url, wait_until="domcontentloaded", timeout=8000 if job.background else 30000)
        elif job.stage == "login_form" and not job.login_attempted:
            self._fill_login(job)
        else:
            self._check_page(job)

    def _fail(self, account_id, message):
        try:
            job = self._jobs.get(account_id)
            if job and not self._is_current(job):
                return
            saved = bool(job and job.session_saved)
            if not job:
                try:
                    saved = bool(self.store.load_session(account_id))
                except Exception:
                    saved = False
            if saved and (not job or job.status != "expired"):
                status = "session_received"
                safe_message = "本次检查未能确认当前登录；已保留原会话，稍后重试。"
            else:
                status, safe_message = "error", message
            self._set(account_id, status, safe_message, last_checked=_now())
            self._log(account_id, "login", status, safe_message)
        except Exception:
            pass
        finally:
            self._dispose(account_id)

    def _dispose(self, account_id):
        job = self._jobs.pop(account_id, None)
        with self._lock:
            self._screenshots.pop(account_id, None)
        if job:
            try:
                job.context.close()
            except Exception:
                pass
