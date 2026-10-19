// ==UserScript==
// @name         SUUMO JJ 一括申告
// @namespace    jp.re.autofill.suumo
// @version      7.51
// @description  SUUMO一括申告＋いえらぶCLOUD設定入力。GitHub自動更新・2秒自動送信・折り畳み日付設定・住戸条件照合（築年月）対応。
// @match        https://suumo.jp/*
// @match        https://cloud.ielove.jp/*
// @updateURL    https://raw.githubusercontent.com/Alpha0727/suumo-jj-tool/main/SUUMO.user.js
// @downloadURL  https://raw.githubusercontent.com/Alpha0727/suumo-jj-tool/main/SUUMO.user.js
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      api.github.com
// ==/UserScript==

(function () {
  'use strict';

  // 今回の更新で1回だけ担当者名を未設定に戻し、入力・保存を必須にする。
  const MANAGER_INITIALIZATION_KEY = "manager1_required_initialized_20261015";
  if (!GM_getValue(MANAGER_INITIALIZATION_KEY, false)) {
    GM_deleteValue("profile_manager1");
    GM_setValue(MANAGER_INITIALIZATION_KEY, true);
  }

  const PROFILE = {
    company: GM_getValue("profile_company", "株式会社エールーム"),
    manager1: GM_getValue("profile_manager1", ""),
    tel: normalizePhone(GM_getValue("profile_tel", "0362401146")),
    email: GM_getValue("profile_email", "a-ueno@arooms.jp"),
    mgmt_company: GM_getValue("mgmt_company", ""),
    mgmt_tel: String(GM_getValue("mgmt_tel", "")).normalize("NFKC").replace(/\D/g, ""),
    manager2: GM_getValue("manager2", ""),
    room: GM_getValue("room", "")
  };

  // このアップデート時に1回だけ、日付設定を新しい既定値に切り替える。
  const DATE_DEFAULTS_MIGRATION_KEY = "date_defaults_migrated_20261015";
  if (!GM_getValue(DATE_DEFAULTS_MIGRATION_KEY, false)) {
    GM_setValue("date_offset_apply", 0);
    GM_setValue("date_offset_contract", 0);
    GM_setValue("date_offset_confirm", 0);
    GM_setValue("date_skip_apply", true);
    GM_setValue("date_skip_contract", true);
    GM_setValue("date_skip_confirm", false);
    GM_setValue(DATE_DEFAULTS_MIGRATION_KEY, true);
  }
  const DATE_OFFSETS = {
    apply: Number(GM_getValue("date_offset_apply", 0)),
    contract: Number(GM_getValue("date_offset_contract", 0)),
    confirm: Number(GM_getValue("date_offset_confirm", 0))
  };
  const DATE_SKIP = {
    apply: !!GM_getValue("date_skip_apply", true),
    contract: !!GM_getValue("date_skip_contract", true),
    confirm: !!GM_getValue("date_skip_confirm", false)
  };

  const BATCH_KEYS = {
    urls: "suumo_batch_urls",
    index: "suumo_batch_index",
    active: "suumo_batch_active",
    submitting: "suumo_batch_submitting",
    confirmReady: "suumo_batch_confirm_ready",
    error: "suumo_batch_error",
    formReady: "suumo_batch_form_ready",
    ownerToken: "suumo_batch_owner_token",
    stage: "suumo_batch_stage"
  };

  const TAB_OWNER_TOKEN_KEY = "suumo_batch_tab_owner_token";

  const STAGES = Object.freeze({
    LISTING: "listing",
    INPUT_PREPARING: "input-preparing",
    INPUT_READY: "input-ready",
    INPUT_CONFIRM: "input-confirm",
    SUBMITTING_CONFIRM: "submitting-confirm",
    SUBMITTING_FINAL: "submitting-final",
    COMPLETE: "complete"
  });

  function getBatchStage() {
    return String(GM_getValue(BATCH_KEYS.stage, STAGES.LISTING) || STAGES.LISTING);
  }

  function setBatchStage(stage) {
    GM_setValue(BATCH_KEYS.stage, stage);
  }


  function createBatchOwnerToken() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2);
  }

  function getTabOwnerToken() {
    try {
      return sessionStorage.getItem(TAB_OWNER_TOKEN_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function setTabOwnerToken(token) {
    try {
      sessionStorage.setItem(TAB_OWNER_TOKEN_KEY, token);
    } catch (_) {}
  }

  function clearTabOwnerToken() {
    try {
      sessionStorage.removeItem(TAB_OWNER_TOKEN_KEY);
    } catch (_) {}
  }

  function isBatchOwnerTab() {
    const ownerToken = String(GM_getValue(BATCH_KEYS.ownerToken, "") || "");
    const tabToken = getTabOwnerToken();
    return !!ownerToken && !!tabToken && ownerToken === tabToken;
  }

  const EXCLUDED_COMPANIES_KEY = "suumo_permanent_excluded_companies";
  const SCRIPT_VERSION = "7.51";
  const SCRIPT_URL = "https://raw.githubusercontent.com/Alpha0727/suumo-jj-tool/main/SUUMO.user.js";
  const VERSION_URL = "https://api.github.com/repos/Alpha0727/suumo-jj-tool/contents/latest.json?ref=main";
  const VERSION_RAW_URL = "https://raw.githubusercontent.com/Alpha0727/suumo-jj-tool/main/latest.json";

  function compareVersions(a, b) {
    const aa = String(a).split(".").map(Number);
    const bb = String(b).split(".").map(Number);
    const len = Math.max(aa.length, bb.length);
    for (let i = 0; i < len; i++) {
      const av = aa[i] || 0;
      const bv = bb[i] || 0;
      if (av !== bv) return av > bv ? 1 : -1;
    }
    return 0;
  }

  function checkScriptUpdate() {
    const status = document.getElementById("tm-version-status");
    const alertMark = document.getElementById("tm-update-alert");
    const button = document.getElementById("tm-update-button");
    if (!status || !alertMark || !button) return;

    status.title = "更新確認中…";
    alertMark.style.display = "none";
    button.style.display = "none";

    const applyInfo = info => {
      const latest = String(info.version || "").trim();
      status.title = latest
        ? `更新確認：成功\n現在：Ver.${SCRIPT_VERSION}\n最新版：Ver.${latest}`
        : "更新確認：解析失敗";

      if (!latest || compareVersions(latest, SCRIPT_VERSION) <= 0) return;

      const notes = String(info.notes || "").trim();
      const installUrl = String(info.install_url || SCRIPT_URL).trim();

      alertMark.style.display = "inline-flex";
      alertMark.title =
        `現在：Ver.${SCRIPT_VERSION}\n最新版：Ver.${latest}` +
        (notes ? "\n\n" + notes : "");

      button.style.display = "inline-block";
      button.title = `Ver.${latest} にアップデート`;
      button.dataset.latestVersion = latest;
      button.dataset.installUrl = installUrl;
    };

    const checkRaw = () => {
      GM_xmlhttpRequest({
        method: "GET",
        url: VERSION_RAW_URL + "?t=" + Date.now(),
        headers: { "Cache-Control": "no-cache" },
        onload: response => {
          try {
            if (response.status < 200 || response.status >= 300) {
              throw new Error("raw version check failed");
            }
            applyInfo(JSON.parse(response.responseText || "{}"));
          } catch (error) {
            status.title = "更新確認：失敗\n" + String(error?.message || error);
            console.warn("[SUUMO JJ] raw version check failed:", error);
          }
        },
        onerror: error => {
          status.title = "更新確認：通信失敗";
          console.warn("[SUUMO JJ] raw version check failed:", error);
        }
      });
    };

    GM_xmlhttpRequest({
      method: "GET",
      url: VERSION_URL + "&t=" + Date.now(),
      headers: { "Cache-Control": "no-cache" },
      onload: response => {
        try {
          if (response.status < 200 || response.status >= 300) {
            throw new Error("api version check failed");
          }

          const apiData = JSON.parse(response.responseText || "{}");
          const encoded = Array.from(String(apiData.content || ""))
            .filter(ch => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".includes(ch))
            .join("");

          if (!encoded) throw new Error("version metadata missing");

          const binary = atob(encoded);
          const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
          const info = JSON.parse(new TextDecoder("utf-8").decode(bytes));
          applyInfo(info);
        } catch (error) {
          console.warn("[SUUMO JJ] API version check failed; trying raw:", error);
          checkRaw();
        }
      },
      onerror: error => {
        console.warn("[SUUMO JJ] API version check failed; trying raw:", error);
        checkRaw();
      }
    });
  }

  // SUUMO申告フォームの実HTMLから確認済みの固定入力欄。
  // ラベル文字の推測ではなく、各入力欄をIDで直接指定する。
  const FIELDS = {
    company:      "#textSinkokuKaisya",
    manager1:     "#textSinkokusyaName",
    tel:          "#renrakusakiTelNo",
    email:        "#textSinkokuMail",
    mgmt_company: "#js-textKanriKaisya",
    mgmt_tel:     "#js-textKanriKaisyaTel",
    manager2:     "#js-textKanriKaisyaTantouName",
    room:         "#js-textMansitu"
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function qsAll(selector, root = document) {
    try { return Array.from(root.querySelectorAll(selector)); }
    catch { return []; }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function toast(message, duration = 2500) {
    document.getElementById("tm-toast")?.remove();

    const t = document.createElement("div");
    t.id = "tm-toast";
    t.textContent = message;

    Object.assign(t.style, {
      position: "fixed",
      left: "50%",
      top: "24px",
      transform: "translateX(-50%)",
      minWidth: "420px",
      maxWidth: "760px",
      boxSizing: "border-box",
      background: "rgba(20,20,20,.94)",
      color: "#fff",
      padding: "18px 28px",
      borderRadius: "14px",
      border: "2px solid rgba(255,255,255,.22)",
      zIndex: "2147483647",
      fontSize: "20px",
      fontWeight: "bold",
      lineHeight: "1.55",
      textAlign: "center",
      boxShadow: "0 8px 28px rgba(0,0,0,.35)",
      whiteSpace: "pre-line",
      pointerEvents: "none"
    });

    document.body.appendChild(t);
    setTimeout(() => t.remove(), duration);
  }

  function isVisibleEditable(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const visible = style.visibility !== "hidden" && style.display !== "none" && el.getClientRects().length > 0;
    const type = (el.type || "").toLowerCase();
    return visible && type !== "hidden" && !el.disabled && !el.readOnly;
  }

  function fireEvents(el, value) {
    try { el.dispatchEvent(new Event("focus", { bubbles: true })); } catch {}
    try { el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: value })); } catch {}
    try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event("blur", { bubbles: true })); } catch {}
  }

  function setNative(el, value) {
    if (!el) return false;
    const tag = el.tagName;

    if (tag === "SELECT") {
      const option = Array.from(el.options).find(o => o.value == value || (o.text || "").includes(value));
      const finalValue = option ? option.value : value;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      if (setter) setter.call(el, finalValue); else el.value = finalValue;
      fireEvents(el, finalValue);
      return el.value == finalValue;
    }

    if (tag === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(el, value); else el.value = value;
      fireEvents(el, value);
      return el.value == value;
    }

    if (tag === "INPUT") {
      let finalValue = value;
      if (el.type === "tel" && !String(value).includes("-")) {
        const digits = String(value).replace(/\D/g, "");
        if (digits.length === 11) finalValue = `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
        else if (digits.length === 10) finalValue = `${digits.slice(0,2)}-${digits.slice(2,6)}-${digits.slice(6)}`;
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(el, finalValue); else el.value = finalValue;
      fireEvents(el, finalValue);
      return el.value == finalValue;
    }
    return false;
  }

  async function setValue(el, value) {
    if (!el || value == null || String(value).trim() === "" || !isVisibleEditable(el)) return false;
    try {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      if (setNative(el, value)) return true;
      await sleep(80);
      return setNative(el, value);
    } catch { return false; }
  }

  function getDateForSuumo(offsetDays = 0) {
    const date = new Date();
    date.setDate(date.getDate() + Number(offsetDays || 0));
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    return `${yyyy}/${mm}/${dd} (${weekdays[date.getDay()]})`;
  }

  function setReadonlyDate(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return false;
    try {
      const wasReadonly = el.readOnly;
      el.readOnly = false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(el, value); else el.value = value;
      fireEvents(el, value);
      el.readOnly = wasReadonly;
      return el.value === value;
    } catch { return false; }
  }

  function fillTodayDates() {
    const fields = [
      ["#textSinkokuDate", "apply"],
      ["#textSeiyakuDate", "contract"],
      ["#textSinkokuKaisyaKakuninDate", "confirm"]
    ];
    return fields.reduce((count, [selector, key]) => {
      // 記入しない設定の項目は、以前の入力値があっても空欄へ戻す。
      const value = DATE_SKIP[key] ? "" : getDateForSuumo(DATE_OFFSETS[key]);
      return count + (setReadonlyDate(selector, value) ? 1 : 0);
    }, 0);
  }

  async function selectReportType() {
    const select = document.querySelector("#js-selectGosinkoku");
    if (!select) return false;
    setNative(select, "1");
    await sleep(400);
    const radio = document.querySelector("#tashaKanri");
    if (!radio) return false;
    radio.checked = true;
    try { radio.dispatchEvent(new Event("input", { bubbles: true })); } catch {}
    try { radio.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
    try { radio.dispatchEvent(new Event("click", { bubbles: true })); } catch {}
    await sleep(500);
    return true;
  }

  async function autofill(showToast = true) {
    if (!requireProfileManager()) return 0;
    await sleep(300);

    let filledCount = 0;

    for (const [key, selector] of Object.entries(FIELDS)) {
      const value = PROFILE[key];
      if (value == null || String(value).trim() === "") continue;

      const el = document.querySelector(selector);
      if (!el || !isVisibleEditable(el)) continue;

      if (await setValue(el, value)) {
        filledCount++;
      }
    }

    filledCount += fillTodayDates();

    if (showToast) {
      toast(
        filledCount
          ? `入力 ${filledCount} 箇所を更新しました`
          : "対象欄が見つかりませんでした"
      );
    }

    return filledCount;
  }

  async function waitForReportFormDom(timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isBatchActive() || !isInputPage()) return false;
      if (document.querySelector("#js-selectGosinkoku")) return true;
      await sleep(250);
    }
    return false;
  }

  async function prepareReportForm(forceRetry = false) {
    if (!isBatchActive() || !isInputPage()) return false;
    if (!requireProfileManager()) return false;
    if (formPreparationRunning) return false;
    if (isFormReady()) return true;
    if (isBatchError() && !forceRetry) return false;

    const attempts = Number(GM_getValue(FORM_PREP_ATTEMPTS_KEY, 0)) || 0;
    if (attempts >= FORM_PREP_MAX_ATTEMPTS) {
      setBatchError(true);
      setFormReady(false);
      updateBatchPanel();
      return false;
    }

    formPreparationRunning = true;
    setBatchStage(STAGES.INPUT_PREPARING);
    GM_setValue(FORM_PREP_ATTEMPTS_KEY, attempts + 1);

    try {
      setFormReady(false);
      setConfirmReady(false);
      setBatchError(false);
      updateBatchPanel();

      toast(attempts > 0 ? `申告フォームを再確認しています…（${attempts + 1}/${FORM_PREP_MAX_ATTEMPTS}）` : "申告フォームを準備しています…");

      const domReady = await waitForReportFormDom();
      if (!domReady) throw new Error("申告フォームのDOM待機がタイムアウトしました");

      const selected = await selectReportType();
      if (!selected) throw new Error("申告内容の選択欄を準備できませんでした");

      await sleep(300);
      if (!isBatchActive() || !isInputPage()) return false;
      const count = await autofill(false);

      setBatchError(false);
      setFormReady(true);
      setConfirmReady(false);
      setBatchStage(STAGES.INPUT_READY);
      GM_deleteValue(FORM_PREP_ATTEMPTS_KEY);
      updateBatchPanel();
      toast(`申告フォームを準備しました\n${count}項目入力`, 3000);
      return true;
    } catch (error) {
      console.warn("[SUUMO JJ] form preparation failed:", error);
      const used = Number(GM_getValue(FORM_PREP_ATTEMPTS_KEY, 0)) || 0;

      if (used < FORM_PREP_MAX_ATTEMPTS && isBatchActive() && isInputPage()) {
        toast(`フォーム準備を再試行します（${used}/${FORM_PREP_MAX_ATTEMPTS}）`, 1800);
        await sleep(1000);
        return await prepareReportForm(true);
      }

      setBatchError(true);
      setFormReady(false);
      updateBatchPanel();
      toast("申告フォームを準備できませんでした。\n「この物件を再実行」または「スキップ」を選んでください。", 6000);
      return false;
    } finally {
      formPreparationRunning = false;
    }
  }

  const BatchState = {
    get(key, fallback) {
      return GM_getValue(BATCH_KEYS[key], fallback);
    },
    set(key, value) {
      GM_setValue(BATCH_KEYS[key], value);
    }
  };

  function getBatchUrls() {
    const urls = GM_getValue(BATCH_KEYS.urls, []);
    return Array.isArray(urls) ? urls : [];
  }

  function getBatchIndex() {
    return Number(GM_getValue(BATCH_KEYS.index, 0)) || 0;
  }

  function isBatchActive() {
    return !!GM_getValue(BATCH_KEYS.active, false) && isBatchOwnerTab();
  }

  function isAnyBatchActive() {
    return !!GM_getValue(BATCH_KEYS.active, false);
  }

  function isSubmitting() {
    return !!GM_getValue(BATCH_KEYS.submitting, false);
  }

  function setSubmitting(value) {
    GM_setValue(BATCH_KEYS.submitting, !!value);
  }

  function isConfirmReady() {
    return !!GM_getValue(BATCH_KEYS.confirmReady, false);
  }

  function setConfirmReady(value) {
    GM_setValue(BATCH_KEYS.confirmReady, !!value);
  }

  function isBatchError() {
    return !!GM_getValue(BATCH_KEYS.error, false);
  }

  function setBatchError(value) {
    GM_setValue(BATCH_KEYS.error, !!value);
  }

  function isFormReady() {
    return !!GM_getValue(BATCH_KEYS.formReady, false);
  }

  function setFormReady(value) {
    GM_setValue(BATCH_KEYS.formReady, !!value);
  }


  function requireProfileManager() {
    if (String(PROFILE.manager1 || "").trim()) return true;
    toast("担当者名が未設定です。基本設定から入力・保存してください。", 6000);
    if (!document.getElementById("tm-setting-panel")) openSettings();
    const input = document.getElementById("tm-profile-manager1");
    const details = input?.closest("details");
    if (details) details.open = true;
    if (input) {
      input.style.border = "2px solid #e03131";
      input.focus();
    }
    return false;
  }

  function setBatch(urls, index = 0) {
    if (!requireProfileManager()) return false;
    const ownerToken = createBatchOwnerToken();
    setTabOwnerToken(ownerToken);
    GM_setValue(BATCH_KEYS.ownerToken, ownerToken);
    GM_setValue(BATCH_KEYS.urls, urls);
    GM_setValue(BATCH_KEYS.index, index);
    GM_setValue(BATCH_KEYS.active, true);
    setBatchStage(STAGES.LISTING);
    setBatchStage(STAGES.LISTING);
    setBatchStage(STAGES.LISTING);
    setSubmitting(false);
    setConfirmReady(false);
    setBatchError(false);
    setFormReady(false);
    GM_deleteValue(FORM_PREP_ATTEMPTS_KEY);
    return true;
  }

  function clearBatch() {
    GM_setValue(BATCH_KEYS.active, false);
    GM_setValue(BATCH_KEYS.index, 0);
    GM_setValue(BATCH_KEYS.urls, []);
    GM_deleteValue(BATCH_KEYS.ownerToken);
    GM_deleteValue(BATCH_KEYS.stage);
    clearTabOwnerToken();
    setSubmitting(false);
    setConfirmReady(false);
    setBatchError(false);
    setFormReady(false);
    GM_deleteValue(FORM_PREP_ATTEMPTS_KEY);
  }

  function getPermanentExcludedCompanies() {
    const data = GM_getValue(EXCLUDED_COMPANIES_KEY, []);
    return Array.isArray(data) ? data : [];
  }

  function savePermanentExcludedCompanies(companies) {
    const clean = [...new Set(companies.map(v => String(v).trim()).filter(Boolean))];
    GM_setValue(EXCLUDED_COMPANIES_KEY, clean);
  }

  // 検索一覧で有効化された住戸条件フィルターだけを、会社別一括申告にも適用する。
  let roomFilterSelection = null;
  let roomFilterAvailable = false;
  let roomFilterActivateBasic = null;

  function getCompaniesFromSearchResults() {
    const cards = qsAll(".property-body");
    const companyMap = new Map();

    for (const card of cards) {
      const clip = card.querySelector('input[id="clipkey"]');
      let propertyId = clip?.value?.trim() || "";

      if (!propertyId) {
        const inquiry = card.querySelector("a.js-singleShiryoSeikyu[rel]");
        const rel = inquiry?.getAttribute("rel") || "";
        const match = rel.match(/(?:^|_)(\d{8,})$/);
        if (match) propertyId = match[1];
      }

      // CSSで非表示にしただけではDOMには掲載が残るため、IDでも必ず照合する。
      if (roomFilterSelection && !roomFilterSelection.has(propertyId)) continue;

      const companyLink = card.querySelector('a[href^="/chintai/kaisha/"]');
      const company = companyLink?.textContent?.trim() || "";
      if (!propertyId || !company) continue;

      const url = `https://suumo.jp/chintai/bc_${propertyId}/`;
      if (!companyMap.has(company)) companyMap.set(company, { company, items: [] });
      const group = companyMap.get(company);
      if (!group.items.some(item => item.propertyId === propertyId)) group.items.push({ propertyId, url });
    }
    return Array.from(companyMap.values());
  }

  function parseUrls(text) {
    const matches = String(text).split(/\s+/).map(s => s.trim()).filter(Boolean)
      .filter(s => /^https:\/\/suumo\.jp\/chintai\/bc_[^/\s]+\/?/i.test(s))
      .map(s => s.endsWith("/") ? s : s + "/");
    return [...new Set(matches)];
  }

  function openCompanySelection() {
    // 検索条件が読み取れている場合、未絞り込みのまま一括申告しないよう確認する。
    if (roomFilterAvailable && roomFilterSelection === null) {
      const ok = confirm("住戸条件フィルターが未適用です。\n4条件一致の掲載だけを選択対象にしますか？\n\nOK：4条件を適用して会社選択へ\nキャンセル：処理を中止");
      if (!ok) return;
      roomFilterActivateBasic?.();
    }
    if (roomFilterSelection && roomFilterSelection.size === 0) {
      alert("現在の絞り込みでは対象掲載が0件です。\n住戸条件を確認してください。");
      return;
    }
    document.getElementById("tm-company-dialog")?.remove();
    const companies = getCompaniesFromSearchResults();

    if (!companies.length) {
      openManualBatchDialog();
      return;
    }

    const permanent = new Set(getPermanentExcludedCompanies());
    const overlay = document.createElement("div");
    overlay.id = "tm-company-dialog";

    Object.assign(overlay.style, {
      position: "fixed", inset: "0", background: "rgba(0,0,0,.48)",
      zIndex: "2147483647", display: "flex", alignItems: "center",
      justifyContent: "center", fontFamily: "sans-serif"
    });

    const rows = companies.map((item, index) => {
      const isExcluded = permanent.has(item.company);
      return `
        <div class="tm-company-row" data-index="${index}" style="padding:14px 12px;border-bottom:1px solid #e5e5e5;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="font-weight:bold;font-size:15px;line-height:1.4;">${escapeHtml(item.company)}</div>
            <div style="flex-shrink:0;font-size:11px;color:#777;background:#f3f3f3;padding:3px 7px;border-radius:10px;">
              掲載 ${item.items.length}件
            </div>
          </div>

          <div class="tm-choice-group" data-index="${index}" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;">
            <label class="tm-choice" data-mode="report" style="display:flex;justify-content:center;align-items:center;min-height:42px;padding:6px 5px;box-sizing:border-box;border:2px solid #d5d5d5;border-radius:8px;background:#fff;color:#333;font-size:13px;font-weight:bold;cursor:pointer;user-select:none;text-align:center;">
              <input type="radio" name="tm-company-${index}" value="report" ${!isExcluded ? "checked" : ""} style="display:none;">
              <span class="tm-choice-text">指摘する</span>
            </label>

            <label class="tm-choice" data-mode="once" style="display:flex;justify-content:center;align-items:center;min-height:42px;padding:6px 5px;box-sizing:border-box;border:2px solid #d5d5d5;border-radius:8px;background:#fff;color:#333;font-size:13px;font-weight:bold;cursor:pointer;user-select:none;text-align:center;">
              <input type="radio" name="tm-company-${index}" value="once" style="display:none;">
              <span class="tm-choice-text">今回だけ除外</span>
            </label>

            <label class="tm-choice" data-mode="permanent" style="display:flex;justify-content:center;align-items:center;min-height:42px;padding:6px 5px;box-sizing:border-box;border:2px solid #d5d5d5;border-radius:8px;background:#fff;color:#333;font-size:13px;font-weight:bold;cursor:pointer;user-select:none;text-align:center;">
              <input type="radio" name="tm-company-${index}" value="permanent" ${isExcluded ? "checked" : ""} style="display:none;">
              <span class="tm-choice-text">今後も除外</span>
            </label>
          </div>
        </div>`;
    }).join("");

    overlay.innerHTML = `
      <div style="width:800px;max-width:94vw;max-height:90vh;background:#fff;border-radius:14px;box-shadow:0 12px 35px rgba(0,0,0,.3);overflow:hidden;display:flex;flex-direction:column;">
        <div style="padding:16px 18px 12px;border-bottom:1px solid #ddd;">
          <div style="font-size:21px;font-weight:bold;">SUUMO 一括処理</div>
          <div style="font-size:12px;color:#666;margin-top:5px;">掲載会社ごとに処理方法を選択してください。</div>
        </div>
        <div style="overflow:auto;flex:1;padding:0 12px;">${rows}</div>
        <div style="padding:14px 18px;border-top:1px solid #ddd;background:#fafafa;">
          <div id="tm-company-summary" style="padding:10px;background:#fff;border:1px solid #ddd;border-radius:8px;margin-bottom:11px;font-size:13px;line-height:1.8;"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="tm-start-company-batch" style="flex:1;min-width:220px;padding:11px;border:0;border-radius:8px;background:#e66b00;color:#fff;font-size:14px;font-weight:bold;cursor:pointer;">一括処理開始</button>
            <button id="tm-manual-mode" style="padding:10px 14px;cursor:pointer;">URL入力</button>
            <button id="tm-close-company" style="padding:10px 14px;cursor:pointer;">閉じる</button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    function getSelections() {
      return companies.map((company, index) => {
        const selected = overlay.querySelector(`input[name="tm-company-${index}"]:checked`);
        return { company, mode: selected?.value || "report" };
      });
    }

    function updateChoiceStyles() {
      overlay.querySelectorAll(".tm-choice-group").forEach(group => {
        const checked = group.querySelector('input[type="radio"]:checked');
        const currentMode = checked?.value || "report";

        group.querySelectorAll(".tm-choice").forEach(label => {
          const mode = label.dataset.mode;
          const text = label.querySelector(".tm-choice-text");
          const baseText = mode === "report" ? "指摘する" : mode === "once" ? "今回だけ除外" : "今後も除外";

          if (mode !== currentMode) {
            label.style.background = "#fff";
            label.style.color = "#444";
            label.style.borderColor = "#d5d5d5";
            text.textContent = baseText;
            return;
          }

          const color = mode === "report" ? "#1677ff" : mode === "once" ? "#fa8c16" : "#d9363e";
          label.style.background = color;
          label.style.color = "#fff";
          label.style.borderColor = color;
          text.textContent = `✓ ${baseText}`;
        });
      });
    }

    function updateSummary() {
      const selections = getSelections();
      let reportCompanies = 0, onceCompanies = 0, permanentCompanies = 0, reportListings = 0;

      for (const item of selections) {
        if (item.mode === "report") {
          reportCompanies++;
          reportListings += item.company.items.length;
        } else if (item.mode === "once") onceCompanies++;
        else if (item.mode === "permanent") permanentCompanies++;
      }

      document.getElementById("tm-company-summary").innerHTML = `
        <span style="display:inline-block;margin-right:14px;"><strong style="color:#1677ff;">指摘する</strong>：${reportCompanies}社 / ${reportListings}件</span>
        <span style="display:inline-block;margin-right:14px;"><strong style="color:#d46b08;">今回だけ除外</strong>：${onceCompanies}社</span>
        <span style="display:inline-block;"><strong style="color:#cf1322;">今後も除外</strong>：${permanentCompanies}社</span>`;

      const start = document.getElementById("tm-start-company-batch");
      start.disabled = reportListings <= 0;
      start.style.background = reportListings > 0 ? "#e66b00" : "#aaa";
      start.style.cursor = reportListings > 0 ? "pointer" : "default";
      start.textContent = reportListings > 0 ? `選択した ${reportListings}件を一括処理開始` : "指摘対象がありません";
    }

    overlay.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener("change", () => {
        updateChoiceStyles();
        updateSummary();
      });
    });

    updateChoiceStyles();
    updateSummary();

    document.getElementById("tm-close-company").onclick = () => overlay.remove();
    document.getElementById("tm-manual-mode").onclick = () => {
      overlay.remove();
      openManualBatchDialog();
    };

    document.getElementById("tm-start-company-batch").onclick = () => {
      const selections = getSelections();
      const newPermanent = new Set(getPermanentExcludedCompanies());

      for (const item of selections) {
        const companyName = item.company.company;
        if (item.mode === "permanent") newPermanent.add(companyName);
        else newPermanent.delete(companyName);
      }
      savePermanentExcludedCompanies([...newPermanent]);

      const urls = [];
      for (const item of selections) {
        if (item.mode !== "report") continue;
        for (const listing of item.company.items) urls.push(listing.url);
      }
      const uniqueUrls = [...new Set(urls)];

      if (!uniqueUrls.length) {
        alert("「指摘する」が選択されている掲載がありません。\n\n除外設定は保存しました。");
        overlay.remove();
        return;
      }

      const ok = confirm(`${uniqueUrls.length}件を一括処理します。\n\n青色の「✓ 指摘する」の掲載のみ処理します。\n\n開始しますか？`);
      if (!ok) return;

      if (!setBatch(uniqueUrls, 0)) return;
      overlay.remove();
      location.href = uniqueUrls[0];
    };
  }

  function openManualBatchDialog() {
    document.getElementById("tm-batch-dialog")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "tm-batch-dialog";

    Object.assign(overlay.style, {
      position: "fixed", inset: "0", background: "rgba(0,0,0,.45)",
      zIndex: "2147483647", display: "flex", alignItems: "center", justifyContent: "center"
    });

    const existing = getBatchUrls();
    overlay.innerHTML = `
      <div style="width:600px;max-width:90vw;background:#fff;padding:18px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-family:sans-serif;">
        <div style="font-size:20px;font-weight:bold;margin-bottom:6px;">URLから一括処理</div>
        <textarea id="tm-batch-urls" style="width:100%;height:250px;box-sizing:border-box;resize:vertical;padding:10px;font-size:13px;">${escapeHtml(existing.join("\n"))}</textarea>
        <div id="tm-url-count" style="margin-top:6px;margin-bottom:12px;font-size:13px;font-weight:bold;">対象：0件</div>
        <div style="display:flex;gap:8px;">
          <button id="tm-start-batch" style="flex:1;padding:10px;border:0;border-radius:8px;background:#2f7cf6;color:#fff;font-weight:bold;cursor:pointer;">一括処理開始</button>
          <button id="tm-close-batch" style="padding:10px 18px;cursor:pointer;">閉じる</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    const textarea = document.getElementById("tm-batch-urls");
    const count = document.getElementById("tm-url-count");

    function updateCount() {
      count.textContent = `対象：${parseUrls(textarea.value).length}件`;
    }

    textarea.addEventListener("input", updateCount);
    updateCount();
    document.getElementById("tm-close-batch").onclick = () => overlay.remove();

    document.getElementById("tm-start-batch").onclick = () => {
      const urls = parseUrls(textarea.value);
      if (!urls.length) {
        alert("SUUMOの掲載URLが見つかりません。");
        return;
      }
      const ok = confirm(`${urls.length}件の一括処理を開始しますか？`);
      if (!ok) return;
      if (!setBatch(urls, 0)) return;
      overlay.remove();
      location.href = urls[0];
    };
  }

  let nextListingStarted = false;

  function goToNextListing() {
    if (nextListingStarted || !isBatchActive()) return;
    nextListingStarted = true;

    const urls = getBatchUrls();
    let index = getBatchIndex();
    index++;

    if (index >= urls.length) {
      const total = urls.length;

      clearBatch();

      // 完了したら右上の進捗パネルを即座に消す。
      document.getElementById("tm-batch-status")?.remove();

      // ブラウザ標準alertではなく、上中央の大きい通知で完了を知らせる。
      toast(`✓ 一括処理が完了しました\n送信完了：${total}件`, 6000);
      return;
    }

    GM_setValue(BATCH_KEYS.index, index);
    setBatchStage(STAGES.LISTING);
    setSubmitting(false);
    setConfirmReady(false);
    setFormReady(false);
    toast(`送信完了！\n次の物件へ進みます（${index + 1}/${urls.length}）`, 2000);
    setTimeout(() => { location.href = urls[index]; }, 1000);
  }

  // 1回目：パネルを確認モードへ
  // 2回目：SUUMOの内容確認画面へ進む
  async function submitCurrentAndContinue() {
    if (!isBatchActive()) return;

    if (isSubmitting()) {
      toast("現在送信処理中です");
      return;
    }

    if (!isConfirmReady()) {
      autoActionCancelledPhase = null;
      setConfirmReady(true);
      setBatchStage(STAGES.INPUT_CONFIRM);
      updateBatchPanel();
      return;
    }

    setConfirmReady(false);
    setSubmitting(true);
    setBatchStage(STAGES.SUBMITTING_CONFIRM);
    updateBatchPanel();
    toast("内容確認画面へ進みます…");

    const confirmLink = document.querySelector(
      'a.js-clickToForm[rel="/jj/chintai/shiryou/FR400FG002/"]'
    );

    if (!confirmLink) {
      setSubmitting(false);
      setConfirmReady(false);
      setBatchError(true);
      updateBatchPanel();
      toast("「内容確認」ボタンが見つかりません。\n入力エラーがないか確認してください。", 5000);
      return;
    }

    confirmLink.click();
  }

  async function handleConfirmPage() {
    if (!isBatchActive()) return;
    const stage = getBatchStage();
    if (stage !== STAGES.SUBMITTING_CONFIRM && stage !== STAGES.SUBMITTING_FINAL) return;
    setSubmitting(true);
    setBatchStage(STAGES.SUBMITTING_FINAL);
    setConfirmReady(false);
    updateBatchPanel();
    toast("確認画面を確認しました。\n送信します…", 1800);
    await sleep(700);

    let sendLink = null;
    for (let i = 0; i < 30; i++) {
      sendLink = document.querySelector(
        'a.js-clickToForm[rel="/jj/chintai/shiryou/FR400FG003/"]'
      );
      if (sendLink) break;
      await sleep(200);
    }

    if (!sendLink) {
      setSubmitting(false);
      setBatchError(true);
      updateBatchPanel();
      toast("最終送信ボタンが見つかりませんでした。\n確認画面を手動で確認してください。", 6000);
      return;
    }

    await sleep(500);
    if (!isBatchActive() || !isConfirmPage() || confirmSendStarted) return;
    confirmSendStarted = true;
    sendLink.click();
  }

  async function handleCompletePage() {
    if (!isBatchActive()) return;
    const stage = getBatchStage();
    if (stage !== STAGES.SUBMITTING_FINAL && stage !== STAGES.COMPLETE) return;
    setBatchStage(STAGES.COMPLETE);
    setSubmitting(true);
    setConfirmReady(false);
    updateBatchPanel();
    toast("申告の送信が完了しました ✓", 1800);
    await sleep(1200);
    goToNextListing();
  }

  function retryCurrentListing() {
    cancelAutoAction(false);
    autoActionCancelledPhase = null;

    if (!isBatchActive()) {
      toast("一括処理が開始されていません");
      return;
    }

    const urls = getBatchUrls();
    const index = getBatchIndex();
    const currentUrl = urls[index];

    if (!currentUrl) {
      toast("現在の物件URLが見つかりません", 5000);
      return;
    }

    // 現在の番号はそのまま。送信・確認状態だけ解除して同じ物件からやり直す。
    setSubmitting(false);
    setConfirmReady(false);
    setBatchError(false);
    setFormReady(false);
    GM_deleteValue(FORM_PREP_ATTEMPTS_KEY);

    toast(`この物件を再実行します\n${index + 1} / ${urls.length}`, 1800);

    setTimeout(() => {
      location.href = currentUrl;
    }, 500);
  }

  function skipBatchItem() {
    if (isSubmitting()) {
      toast("送信処理中はスキップできません");
      return;
    }

    const urls = getBatchUrls();
    let index = getBatchIndex();

    const ok = confirm("この物件は送信せずにスキップしますか？");
    if (!ok) return;

    setConfirmReady(false);
    index++;

    if (index >= urls.length) {
      clearBatch();
      document.getElementById("tm-batch-status")?.remove();
      toast("✓ 一括処理が終了しました", 5000);
      return;
    }

    GM_setValue(BATCH_KEYS.index, index);
    setBatchStage(STAGES.LISTING);
    location.href = urls[index];
  }

  function stopBatch() {
    const ok = confirm("一括処理を中止しますか？\n\n進捗はリセットされます。");
    if (!ok) return;
    clearBatch();
    document.getElementById("tm-batch-status")?.remove();
    toast("一括処理を中止しました");
  }

  async function handleListingPage() {
    if (!isBatchActive()) return;

    const urls = getBatchUrls();
    const index = getBatchIndex();
    setSubmitting(false);
    setConfirmReady(false);
    setBatchError(false);
    setFormReady(false);
    GM_deleteValue(FORM_PREP_ATTEMPTS_KEY);
    updateBatchPanel();
    toast(`掲載ページ ${index + 1}/${urls.length}\n申告フォームを開きます…`);

    for (let i = 0; i < 40; i++) {
      const link = document.querySelector("#js-bknToiawaseFr");
      if (link) {
        await sleep(500);
        link.click();
        return;
      }
      await sleep(200);
    }

    toast("申告リンクが見つかりませんでした。\n手動で申告リンクを押してください。", 6000);
  }

  function isListingPage() {
    return /^\/chintai\/bc_/i.test(location.pathname);
  }

  function isInputPage() {
    return location.pathname.includes("/jj/chintai/shiryou/FR400FG001/");
  }

  function isConfirmPage() {
    return location.pathname.includes("/jj/chintai/shiryou/FR400FG002/");
  }

  function isCompletePage() {
    return location.pathname.includes("/jj/chintai/shiryou/FR400FG003/");
  }

  const AUTO_ACTION_MS = 2000;
  const AUTO_ACTION_PHASE_KEY = "suumo_auto_action_phase";
  const AUTO_ACTION_DEADLINE_KEY = "suumo_auto_action_deadline";
  const FORM_PREP_ATTEMPTS_KEY = "suumo_form_prep_attempts";
  const FORM_PREP_MAX_ATTEMPTS = 3;
  let autoActionTimer = null;
  let autoActionFrame = null;
  let autoActionPhase = null;
  let autoActionDeadline = 0;
  let autoActionCancelledPhase = null;
  let watchdogBusy = false;
  let formPreparationRunning = false;
  let confirmSendStarted = false;

  function cancelAutoAction(rememberPhase = false) {
    if (autoActionTimer) clearTimeout(autoActionTimer);
    if (autoActionFrame) cancelAnimationFrame(autoActionFrame);
    autoActionTimer = null;
    autoActionFrame = null;

    if (rememberPhase && autoActionPhase) {
      autoActionCancelledPhase = autoActionPhase;
    }

    autoActionPhase = null;
    autoActionDeadline = 0;
    GM_deleteValue(AUTO_ACTION_PHASE_KEY);
    GM_deleteValue(AUTO_ACTION_DEADLINE_KEY);
  }

  function recoverAutoActionIfDue() {
    if (!isBatchActive() || !isInputPage() || isSubmitting() || !isFormReady()) return;
    const button = document.getElementById("tm-submit-next");
    if (!button) return;

    const phase = isConfirmReady() ? "confirm-send" : "first-send";
    const savedPhase = GM_getValue(AUTO_ACTION_PHASE_KEY, "");
    const savedDeadline = Number(GM_getValue(AUTO_ACTION_DEADLINE_KEY, 0));

    if (savedPhase === phase && savedDeadline && Date.now() >= savedDeadline) {
      autoActionCancelledPhase = null;
      cancelAutoAction(false);
      submitCurrentAndContinue();
    }
  }

  async function reconcileBatchState() {
    if (watchdogBusy || !isBatchActive()) return;
    watchdogBusy = true;
    try {
      const stage = getBatchStage();

      if (isInputPage()) {
        if (stage === STAGES.INPUT_READY || stage === STAGES.INPUT_CONFIRM) {
          setFormReady(true);
          setConfirmReady(stage === STAGES.INPUT_CONFIRM);
          updateBatchPanel();
          recoverAutoActionIfDue();
        }
        return;
      }

      if (isConfirmPage()) {
        if ((stage === STAGES.SUBMITTING_CONFIRM || stage === STAGES.SUBMITTING_FINAL) && !confirmSendStarted) {
          setSubmitting(true);
          setBatchStage(STAGES.SUBMITTING_FINAL);
          const sendLink = document.querySelector(
            'a.js-clickToForm[rel="/jj/chintai/shiryou/FR400FG003/"]'
          );
          if (sendLink) {
            confirmSendStarted = true;
            sendLink.click();
          }
        }
        return;
      }

      if (isCompletePage()) {
        if (stage === STAGES.SUBMITTING_FINAL || stage === STAGES.COMPLETE) {
          setBatchStage(STAGES.COMPLETE);
          goToNextListing();
        }
      }
    } finally {
      watchdogBusy = false;
    }
  }

  function startBackgroundWatchdog() {
    // 7.38: 常時setInterval監視は廃止。
    // ブラウザから実行機会が戻ったイベント時だけ状態を照合する。
  }

  function startAutoAction(button, phase, strongColor, lightColor) {
    if (!button) return;

    // 「戻る」で止めた同じ段階では、自動進行を勝手に再開しない。
    if (autoActionCancelledPhase === phase) {
      button.style.background = lightColor;
      return;
    }

    // 同じ段階ですでにカウント中なら、描画だけ現在時刻に合わせる。
    if (autoActionPhase !== phase || !autoActionDeadline) {
      if (autoActionTimer) clearTimeout(autoActionTimer);
      if (autoActionFrame) cancelAnimationFrame(autoActionFrame);
      autoActionTimer = null;
      autoActionFrame = null;

      const savedPhase = GM_getValue(AUTO_ACTION_PHASE_KEY, "");
      const savedDeadline = Number(GM_getValue(AUTO_ACTION_DEADLINE_KEY, 0));
      autoActionPhase = phase;
      autoActionDeadline = (savedPhase === phase && savedDeadline)
        ? savedDeadline
        : Date.now() + AUTO_ACTION_MS;
      GM_setValue(AUTO_ACTION_PHASE_KEY, phase);
      GM_setValue(AUTO_ACTION_DEADLINE_KEY, autoActionDeadline);

      // 実行判定はCSSアニメーションではなく実時間。
      // バックグラウンドタブでも、タイマーが実行可能になった時点で経過時間を確認する。
      const runWhenDue = () => {
        if (autoActionPhase !== phase) return;
        const remaining = autoActionDeadline - Date.now();

        if (remaining > 0) {
          autoActionTimer = setTimeout(runWhenDue, Math.min(remaining, 250));
          return;
        }

        cancelAutoAction(false);
        if (document.getElementById("tm-submit-next")) {
          submitCurrentAndContinue();
        }
      };

      autoActionTimer = setTimeout(runWhenDue, AUTO_ACTION_MS);
    }

    const paint = () => {
      if (autoActionPhase !== phase || !button.isConnected) return;

      const remaining = Math.max(0, autoActionDeadline - Date.now());
      const progress = Math.min(100, Math.max(0, 100 * (1 - remaining / AUTO_ACTION_MS)));

      button.style.background =
        `linear-gradient(to right, ${strongColor} 0%, ${strongColor} ${progress}%, ${lightColor} ${progress}%, ${lightColor} 100%)`;

      if (remaining > 0) {
        autoActionFrame = requestAnimationFrame(paint);
      }
    };

    paint();
  }

  function updateBatchPanel() {
    // 物件詳細ページでは右上の進捗パネルを表示しない。
    // 自動で申告画面へ遷移する間、元ページにパネルが残るのを防ぐ。
    if (isListingPage()) {
      document.getElementById("tm-batch-status")?.remove();
      return;
    }

    const old = document.getElementById("tm-batch-status");

    if (!isBatchActive()) {
      old?.remove();
      return;
    }

    const urls = getBatchUrls();
    const index = getBatchIndex();
    const submitting = isSubmitting();
    const confirmReady = isConfirmReady();
    const batchError = isBatchError();
    const formReady = isFormReady();

    let panel = old;
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "tm-batch-status";
      Object.assign(panel.style, {
        position: "fixed", left: "14px", right: "auto", top: "16px", width: "340px",
        background: "#fff", border: "2px solid #2f7cf6", borderRadius: "14px",
        padding: "14px", zIndex: "2147483647", boxShadow: "0 5px 18px rgba(0,0,0,.25)",
        fontFamily: "sans-serif"
      });
      document.body.appendChild(panel);
    }

    const current = urls[index] || "";
    let statusText = "入力内容を確認してください。";
    let statusBackground = "#fff6d8";

    if (batchError) {
      statusText = "⚠ 処理が正常に完了しませんでした。\nこの物件を再実行できます。";
      statusBackground = "#fff1f0";
    } else if (isInputPage() && !formReady) {
      statusText = "申告フォームを準備しています…\n完了するまでお待ちください。";
      statusBackground = "#f2f2f2";
    } else if (confirmReady) {
      statusText = "⚠ この内容で送信しますか？\n入力内容を最終確認してください。";
      statusBackground = "#fff1e6";
    } else if (isConfirmPage()) {
      statusText = "SUUMOの内容確認画面です。送信処理中…";
      statusBackground = "#eaf3ff";
    } else if (isCompletePage()) {
      statusText = "送信完了。次の物件へ移動します…";
      statusBackground = "#eaf8ed";
    } else if (submitting) {
      statusText = "SUUMOへ送信処理中です…";
      statusBackground = "#eaf3ff";
    }

    const canSubmit = isInputPage() && !submitting && formReady;
    let mainButton = "";

    if (canSubmit) {
      if (confirmReady) {
        mainButton = `
          <button id="tm-submit-next" style="width:100%;padding:13px;border:0;border-radius:9px;background:#f6b867;color:#fff;font-size:15px;font-weight:bold;cursor:pointer;margin-bottom:7px;">
            ✓ 確認しました → 送信する
          </button>
          <button id="tm-cancel-confirm" style="width:100%;padding:9px;border:1px solid #aaa;border-radius:8px;background:#fff;color:#333;font-size:13px;cursor:pointer;margin-bottom:7px;">
            ← 戻る
          </button>`;
      } else {
        mainButton = `
          <button id="tm-submit-next" style="width:100%;padding:11px;border:0;border-radius:9px;background:#9fc2fb;color:#fff;font-size:14px;font-weight:bold;cursor:pointer;margin-bottom:7px;">
            この申告を送信 → 次の物件
          </button>`;
      }
    } else if (batchError) {
      mainButton = `
        <button id="tm-retry-current" style="width:100%;padding:11px;border:0;border-radius:9px;background:#d9363e;color:#fff;font-size:14px;font-weight:bold;cursor:pointer;margin-bottom:7px;">
          ↻ この物件を再実行
        </button>`;
    } else {
      mainButton = `
        <button disabled style="width:100%;padding:11px;border:0;border-radius:9px;background:#aaa;color:#fff;font-size:14px;font-weight:bold;margin-bottom:7px;">
          ${submitting ? "送信処理中…" : (isInputPage() && !formReady ? "申告フォーム準備中…" : "入力画面で操作できます")}
        </button>`;
    }

    panel.innerHTML = `
      <div style="font-size:18px;font-weight:bold;margin-bottom:8px;">SUUMO 一括処理</div>
      <div style="font-size:27px;font-weight:bold;margin-bottom:6px;">${Math.min(index + 1, urls.length)} / ${urls.length}</div>
      <div style="font-size:11px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:10px;">${escapeHtml(current)}</div>
      <div style="font-size:13px;background:${statusBackground};padding:10px;border-radius:7px;margin-bottom:11px;line-height:1.6;white-space:pre-line;">${escapeHtml(statusText)}</div>
      ${mainButton}
      <div style="display:flex;gap:7px;">
        <button id="tm-skip-item" ${submitting ? "disabled" : ""} style="flex:1;padding:8px;cursor:${submitting ? "default" : "pointer"};">スキップ</button>
        <button id="tm-stop-batch" style="flex:1;padding:8px;cursor:pointer;">中止</button>
      </div>`;

    const submit = document.getElementById("tm-submit-next");
    if (submit) {
      const phase = confirmReady ? "confirm-send" : "first-send";
      const strongColor = confirmReady ? "#e67e00" : "#2f7cf6";
      const lightColor = confirmReady ? "#f6b867" : "#9fc2fb";

      submit.onclick = () => {
        autoActionCancelledPhase = null;
        cancelAutoAction(false);
        submitCurrentAndContinue();
      };

      startAutoAction(submit, phase, strongColor, lightColor);
    } else {
      cancelAutoAction(false);
      autoActionCancelledPhase = null;
    }

    const retryCurrent = document.getElementById("tm-retry-current");
    if (retryCurrent) retryCurrent.onclick = retryCurrentListing;

    const cancelConfirm = document.getElementById("tm-cancel-confirm");
    if (cancelConfirm) {
      cancelConfirm.onclick = () => {
        cancelAutoAction(true);
        setConfirmReady(false);
        updateBatchPanel();
      };
    }

    const skip = document.getElementById("tm-skip-item");
    if (skip && !submitting) {
      skip.onclick = () => {
        cancelAutoAction(false);
        autoActionCancelledPhase = null;
        setConfirmReady(false);
        skipBatchItem();
      };
    }

    document.getElementById("tm-stop-batch").onclick = () => {
      cancelAutoAction(false);
      autoActionCancelledPhase = null;
      stopBatch();
    };
  }

  function normalizePhone(value) {
    return String(value || "").normalize("NFKC").replace(/\D/g, "");
  }

  function containsHalfWidth(value) {
    return /[\x20-\x7E\uFF61-\uFF9F]/.test(String(value || ""));
  }

  function toFullWidth(value) {
    return String(value || "")
      .replace(/ /g, "　")
      .replace(/[\x21-\x7E]/g, char => String.fromCharCode(char.charCodeAt(0) + 0xFEE0))
      .replace(/[\uFF61-\uFF9F]+/g, text => text.normalize("NFKC"));
  }

  function openSettings() {
    document.getElementById("tm-setting-panel")?.remove();

    const panel = document.createElement("div");
    panel.id = "tm-setting-panel";
    Object.assign(panel.style, {
      position: "fixed", left: "14px", right: "auto", bottom: "144px", width: "390px",
      maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 158px)",
      background: "#fff", border: "2px solid #112B3C",
      borderRadius: "12px", padding: "14px", zIndex: "2147483647",
      boxShadow: "0 7px 22px rgba(17,43,60,.24)",
      boxSizing: "border-box", display: "flex", flexDirection: "column", overflow: "hidden"
    });

    panel.innerHTML = `
      <div id="tm-setting-drag-handle" style="margin:-14px -14px 12px;padding:11px 12px;background:#112B3C;color:#fff;border-radius:9px 9px 0 0;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:move;user-select:none;touch-action:none;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <div style="font-weight:bold;font-size:17px;white-space:nowrap;">指摘設定</div>
          <span id="tm-version-status" style="font-size:11px;color:#DDE7EC;white-space:nowrap;">Ver.${SCRIPT_VERSION}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <span id="tm-update-alert" style="display:none;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#f0a000;color:#fff;font-weight:bold;font-size:12px;cursor:help;">!</span>
          <button id="tm-update-button" type="button" style="display:none;padding:5px 9px;border:0;border-radius:6px;background:#F4F7F8;color:#112B3C;font-size:11px;font-weight:bold;cursor:pointer;">アップデート</button>
          <button id="tm-close-setting-top" type="button" style="border:none;background:transparent;color:#fff;font-size:20px;line-height:1;cursor:pointer;padding:0 2px;">×</button>
        </div>
      </div>
      <div id="tm-setting-scroll" style="flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding-right:2px;">
      <details id="tm-basic-settings" style="background:#EEF3F6;border:1px solid #D6E0E6;border-radius:8px;margin-bottom:12px;">
        <summary style="padding:10px;font-weight:bold;cursor:pointer;user-select:none;color:#112B3C;">基本設定</summary>
        <div style="padding:0 10px 10px;">
          <div style="margin-bottom:8px;"><div>会社名</div><input id="tm-profile-company" style="width:100%;box-sizing:border-box;padding:6px;" value="${escapeHtml(PROFILE.company)}"></div>
          <div style="margin-bottom:8px;"><div>担当者名</div><input id="tm-profile-manager1" style="width:100%;box-sizing:border-box;padding:6px;" value="${escapeHtml(PROFILE.manager1)}"></div>
          <div style="margin-bottom:8px;"><div>電話番号</div><input id="tm-profile-tel" style="width:100%;box-sizing:border-box;padding:6px;" value="${escapeHtml(PROFILE.tel)}"></div>
          <div><div>メールアドレス</div><input id="tm-profile-email" style="width:100%;box-sizing:border-box;padding:6px;" value="${escapeHtml(PROFILE.email)}"></div>
        </div>
      </details>
      <div style="margin-bottom:8px;"><div>管理会社名</div><input id="tm-mgmt-company" style="width:100%;box-sizing:border-box;padding:6px;" value="${escapeHtml(PROFILE.mgmt_company)}"></div>
      <div style="margin-bottom:8px;"><div>管理会社TEL</div><input id="tm-mgmt-tel" style="width:100%;box-sizing:border-box;padding:6px;" value="${escapeHtml(PROFILE.mgmt_tel)}"></div>
      <div style="margin-bottom:8px;"><div>管理会社担当者</div><input id="tm-manager2" style="width:100%;box-sizing:border-box;padding:6px;" value="${escapeHtml(PROFILE.manager2)}"></div>
      <div style="margin-bottom:12px;"><div>号室</div><input id="tm-room" style="width:100%;box-sizing:border-box;padding:6px;" value="${escapeHtml(PROFILE.room)}"></div>

      <div id="tm-halfwidth-warning" style="display:none;margin-bottom:12px;padding:11px;background:#fff1f0;border:1px solid #ff7875;border-radius:8px;color:#a8071a;font-size:13px;line-height:1.6;">
        <div style="font-weight:bold;font-size:14px;margin-bottom:5px;">⚠ 入力内容を確認してください</div>
        <div id="tm-halfwidth-detail" style="margin-bottom:8px;"></div>
        <div style="margin-bottom:9px;">管理会社名・管理会社担当者は全角に、管理会社TELは半角数字のみにしてください。</div>
        <button id="tm-convert-fullwidth" type="button" style="padding:8px 11px;border:0;border-radius:7px;background:#d9363e;color:#fff;font-weight:bold;cursor:pointer;">まとめて修正</button>
      </div>

      <details id="tm-date-settings" style="background:#EEF3F6;border:1px solid #D6E0E6;border-radius:8px;margin-bottom:12px;">
        <summary style="padding:10px;font-weight:bold;cursor:pointer;user-select:none;color:#112B3C;">日付設定</summary>
        <div style="padding:0 10px 10px;">
          ${[
          ["申込日", "tm-date-apply", DATE_OFFSETS.apply, DATE_SKIP.apply],
          ["成約日", "tm-date-contract", DATE_OFFSETS.contract, DATE_SKIP.contract],
          ["確認日", "tm-date-confirm", DATE_OFFSETS.confirm, DATE_SKIP.confirm]
        ].map(([label, id, value, skip]) => `
          <div style="display:flex;align-items:center;gap:5px;margin:6px 0;min-width:0;">
            <span style="width:40px;flex-shrink:0;font-size:12px;">${label}</span>
            <label style="display:flex;align-items:center;gap:2px;font-size:11px;white-space:nowrap;cursor:pointer;flex-shrink:0;">
              <input type="checkbox" class="tm-date-skip" data-target="${id}" ${skip ? "checked" : ""} style="margin:0;">記入しない
            </label>
            <span style="font-size:11px;white-space:nowrap;color:#526675;">今日</span>
            <button type="button" class="tm-date-minus" data-target="${id}" ${skip ? "disabled" : ""} style="height:27px;min-width:23px;cursor:pointer;">−</button>
            <input id="${id}" type="number" value="${value}" min="-365" max="365" ${skip ? "disabled" : ""} style="width:38px;min-width:0;height:27px;box-sizing:border-box;text-align:center;">
            <button type="button" class="tm-date-plus" data-target="${id}" ${skip ? "disabled" : ""} style="height:27px;min-width:23px;cursor:pointer;">＋</button>
            <span style="font-size:11px;">日</span>
          </div>
        `).join("")}
        </div>
      </details>
      </div>
      <div id="tm-setting-footer" style="flex-shrink:0;margin:12px -14px -14px;padding:10px 14px 14px;background:#fff;border-top:1px solid #D6E0E6;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button id="tm-settings-batch" type="button" style="padding:8px 13px;border:0;border-radius:7px;background:#e66b00;color:#fff;font-weight:bold;cursor:pointer;">一括処理</button>
          <button id="tm-settings-autofill" type="button" style="padding:8px 13px;border:0;border-radius:7px;background:#205375;color:#fff;font-weight:bold;cursor:pointer;">自動入力</button>
          <button id="tm-save-setting" style="padding:8px 15px;border:0;border-radius:7px;background:#112B3C;color:#fff;font-weight:bold;cursor:pointer;">保存</button>
          <button id="tm-close-setting" style="padding:8px 15px;border:1px solid #B9C7CF;border-radius:7px;background:#F7F9FA;color:#334155;cursor:pointer;">閉じる</button>
        </div>

      </div>`;

    document.body.appendChild(panel);

    // 画面サイズ・ブラウザ拡大率が変わっても、
    // パネルが画面外へ飛び出さないよう補正する。
    const fitSettingPanelToViewport = () => {
      panel.style.maxHeight = "calc(100vh - 20px)";

      const rect = panel.getBoundingClientRect();
      const gap = 10;

      // 初期位置（bottom基準）の間は、下の起動ボタンを避けた高さに制限
      if (panel.style.bottom !== "auto") {
        panel.style.maxHeight = "calc(100vh - 158px)";
        return;
      }

      const maxLeft = Math.max(gap, window.innerWidth - rect.width - gap);
      const maxTop = Math.max(gap, window.innerHeight - rect.height - gap);

      panel.style.left =
        Math.min(Math.max(rect.left, gap), maxLeft) + "px";

      panel.style.top =
        Math.min(Math.max(rect.top, gap), maxTop) + "px";
    };

    window.addEventListener(
      "resize",
      fitSettingPanelToViewport
    );

    fitSettingPanelToViewport();

    // =========================================================
    // 指摘設定パネル：ドラッグ移動
    // ・ヘッダー帯を掴んだ時だけ移動
    // ・位置は保存しない
    // ・SUUMO / いえらぶ間で共有しない
    // ・リロードや再生成で初期位置へ戻る
    // =========================================================
    const dragHandle =
      document.getElementById("tm-setting-drag-handle");

    if (dragHandle) {
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;
      let activePointerId = null;

      const clamp = (value, min, max) =>
        Math.min(Math.max(value, min), max);

      dragHandle.addEventListener("pointerdown", event => {
        // × / アップデート等の操作はドラッグ扱いにしない
        if (
          event.target.closest(
            "button, a, input, select, textarea, #tm-update-alert"
          )
        ) {
          return;
        }

        if (event.button !== undefined && event.button !== 0) {
          return;
        }

        const rect = panel.getBoundingClientRect();

        dragging = true;
        activePointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        panel.style.left = rect.left + "px";
        panel.style.top = rect.top + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";

        try {
          dragHandle.setPointerCapture(event.pointerId);
        } catch {}

        event.preventDefault();
      });

      dragHandle.addEventListener("pointermove", event => {
        if (
          !dragging ||
          event.pointerId !== activePointerId
        ) {
          return;
        }

        const dx = event.clientX - startX;
        const dy = event.clientY - startY;

        const rect = panel.getBoundingClientRect();
        const maxLeft =
          Math.max(0, window.innerWidth - rect.width);
        const maxTop =
          Math.max(0, window.innerHeight - rect.height);

        panel.style.left =
          clamp(startLeft + dx, 0, maxLeft) + "px";

        panel.style.top =
          clamp(startTop + dy, 0, maxTop) + "px";
      });

      const finishDrag = event => {
        if (
          !dragging ||
          event.pointerId !== activePointerId
        ) {
          return;
        }

        dragging = false;

        try {
          dragHandle.releasePointerCapture(event.pointerId);
        } catch {}

        activePointerId = null;
      };

      dragHandle.addEventListener(
        "pointerup",
        finishDrag
      );

      dragHandle.addEventListener(
        "pointercancel",
        finishDrag
      );
    }

    const checkTargets = [
      { id: "tm-mgmt-company", label: "管理会社名", type: "fullwidth" },
      { id: "tm-manager2", label: "管理会社担当者", type: "fullwidth" },
      { id: "tm-mgmt-tel", label: "管理会社TEL", type: "phone" }
    ];

    function hasPhoneProblem(value) {
      const raw = String(value || "");
      if (!raw) return false;
      return raw !== normalizePhone(raw);
    }

    function updateHalfWidthWarning() {
      const problems = [];

      for (const target of checkTargets) {
        const input = document.getElementById(target.id);
        if (!input) continue;
        const value = input.value;

        const hasProblem = target.type === "phone"
          ? hasPhoneProblem(value)
          : (value && containsHalfWidth(value));

        if (hasProblem) {
          problems.push({ label: target.label, value });
          input.style.border = "2px solid #ff7875";
          input.style.background = "#fff7f6";
        } else {
          input.style.border = "";
          input.style.background = "";
        }
      }

      const warning = document.getElementById("tm-halfwidth-warning");
      const detail = document.getElementById("tm-halfwidth-detail");

      if (problems.length === 0) {
        warning.style.display = "none";
        detail.innerHTML = "";
        return false;
      }

      warning.style.display = "block";
      detail.innerHTML = problems.map(item =>
        `<div><strong>${escapeHtml(item.label)}</strong>：${escapeHtml(item.value)}</div>`
      ).join("");
      return true;
    }

    for (const target of checkTargets) {
      document.getElementById(target.id)?.addEventListener("input", updateHalfWidthWarning);
    }

    document.getElementById("tm-convert-fullwidth").onclick = () => {
      let converted = 0;

      for (const target of checkTargets) {
        const input = document.getElementById(target.id);
        if (!input) continue;

        if (target.type === "phone") {
          if (!hasPhoneProblem(input.value)) continue;
          input.value = normalizePhone(input.value);
          converted++;
          continue;
        }

        if (!containsHalfWidth(input.value)) continue;
        input.value = toFullWidth(input.value);
        converted++;
      }

      updateHalfWidthWarning();
      toast(`${converted}項目をまとめて修正しました ✓`);
    };

    panel.querySelectorAll(".tm-date-skip").forEach(checkbox => {
      checkbox.addEventListener("change", () => {
        const target = panel.querySelector("#" + checkbox.dataset.target);
        if (!target) return;
        target.disabled = checkbox.checked;
        panel.querySelectorAll(".tm-date-minus, .tm-date-plus").forEach(button => {
          if (button.dataset.target === checkbox.dataset.target) button.disabled = checkbox.checked;
        });
      });
    });

    panel.querySelectorAll(".tm-date-minus, .tm-date-plus").forEach(button => {
      button.onclick = () => {
        const input = document.getElementById(button.dataset.target);
        if (!input) return;
        input.value = String(Number(input.value || 0) + (button.classList.contains("tm-date-plus") ? 1 : -1));
      };
    });

    document.getElementById("tm-settings-batch").onclick = () => {
      panel.remove();
      openCompanySelection();
    };

    document.getElementById("tm-settings-autofill").onclick = async () => {
      if (document.querySelector("#js-selectGosinkoku")) await selectReportType();
      await autofill();
    };

    document.getElementById("tm-save-setting").onclick = () => {
      if (updateHalfWidthWarning()) {
        toast("入力内容に修正が必要です。\n「まとめて修正」を押してから保存してください。", 4500);
        return;
      }

      const profileCompany = document.getElementById("tm-profile-company").value.trim();
      const profileManager1 = document.getElementById("tm-profile-manager1").value.trim();
      if (!profileManager1) {
        const input = document.getElementById("tm-profile-manager1");
        input.style.border = "2px solid #e03131";
        input.focus();
        toast("基本設定の担当者名を入力して保存してください。", 5000);
        return;
      }
      const profileTel = normalizePhone(document.getElementById("tm-profile-tel").value);
      const profileEmail = document.getElementById("tm-profile-email").value.trim();

      const company = document.getElementById("tm-mgmt-company").value.trim();
      const telInput = document.getElementById("tm-mgmt-tel");
      const tel = normalizePhone(telInput.value);
      telInput.value = tel;
      const manager2 = document.getElementById("tm-manager2").value.trim();
      const room = document.getElementById("tm-room").value.trim();

      const applyOffset = Number(document.getElementById("tm-date-apply").value || 0);
      const contractOffset = Number(document.getElementById("tm-date-contract").value || 0);
      const confirmOffset = Number(document.getElementById("tm-date-confirm").value || 0);
      const applySkip = document.querySelector('input.tm-date-skip[data-target="tm-date-apply"]').checked;
      const contractSkip = document.querySelector('input.tm-date-skip[data-target="tm-date-contract"]').checked;
      const confirmSkip = document.querySelector('input.tm-date-skip[data-target="tm-date-confirm"]').checked;

      GM_setValue("profile_company", profileCompany);
      GM_setValue("profile_manager1", profileManager1);
      GM_setValue("profile_tel", profileTel);
      GM_setValue("profile_email", profileEmail);
      GM_setValue("profile_initialized", true);

      GM_setValue("mgmt_company", company);
      GM_setValue("mgmt_tel", tel);
      GM_setValue("manager2", manager2);
      GM_setValue("room", room);
      GM_setValue("date_offset_apply", applyOffset);
      GM_setValue("date_offset_contract", contractOffset);
      GM_setValue("date_offset_confirm", confirmOffset);
      GM_setValue("date_skip_apply", applySkip);
      GM_setValue("date_skip_contract", contractSkip);
      GM_setValue("date_skip_confirm", confirmSkip);

      PROFILE.company = profileCompany;
      PROFILE.manager1 = profileManager1;
      PROFILE.tel = profileTel;
      PROFILE.email = profileEmail;
      PROFILE.mgmt_company = company;
      PROFILE.mgmt_tel = tel;
      PROFILE.manager2 = manager2;
      PROFILE.room = room;
      DATE_OFFSETS.apply = applyOffset;
      DATE_OFFSETS.contract = contractOffset;
      DATE_OFFSETS.confirm = confirmOffset;
      DATE_SKIP.apply = applySkip;
      DATE_SKIP.contract = contractSkip;
      DATE_SKIP.confirm = confirmSkip;
      toast("設定を保存しました ✓");
    };

    document.getElementById("tm-close-setting").onclick = () => panel.remove();
    document.getElementById("tm-close-setting-top").onclick = () => panel.remove();
    document.getElementById("tm-update-button").onclick = event => {
      const latest = event.currentTarget.dataset.latestVersion || String(Date.now());
      const installUrl = event.currentTarget.dataset.installUrl || SCRIPT_URL;
      const separator = installUrl.includes("?") ? "&" : "?";
      const updateWindow = window.open(
        installUrl + separator + "install=" + encodeURIComponent(latest) + "&t=" + Date.now(),
        "_blank"
      );

      // 更新用タブが閉じられたら、元ページを1回だけ再読み込みする。
      // Tampermonkey側で更新完了後にタブを閉じた場合も、手動で閉じた場合も同じ動作。
      if (updateWindow) {
        const watchUpdateWindow = setInterval(() => {
          if (!updateWindow.closed) return;
          clearInterval(watchUpdateWindow);
          location.reload();
        }, 500);
      }
    };
    updateHalfWidthWarning();
    checkScriptUpdate();
  }

  function addMainButtons() {
    if (document.getElementById("tm-main-buttons")) return;

    const box = document.createElement("div");
    box.id = "tm-main-buttons";
    Object.assign(box.style, {
      position: "fixed",
      left: "14px",
      right: "auto",
      bottom: "16px",
      zIndex: "2147483646"
    });

    const settings = document.createElement("button");
    settings.textContent = "指摘設定";
    Object.assign(settings.style, {
      width: "120px",
      height: "36px",
      padding: "0 14px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      border: "none",
      borderRadius: "10px",
      background: "#112B3C",
      color: "#fff",
      fontSize: "14px",
      fontWeight: "bold",
      cursor: "pointer",
      boxShadow: "0 3px 12px rgba(17,43,60,.28)"
    });

    settings.onclick = () => {
      const panel = document.getElementById("tm-setting-panel");
      if (panel) {
        panel.remove();
        return;
      }
      openSettings();
    };

    box.appendChild(settings);
    document.body.appendChild(box);
  }

  function addIeloveSettingsButton() {
    if (document.getElementById("tm-ielove-settings")) return;

    const settings = document.createElement("button");
    settings.id = "tm-ielove-settings";
    settings.textContent = "指摘設定";

    Object.assign(settings.style, {
      position: "fixed",
      left: "14px",
      right: "auto",
      bottom: "100px",
      width: "120px",
      height: "36px",
      zIndex: "2147483646",
      padding: "0 14px",
      border: "none",
      borderRadius: "10px",
      background: "#112B3C",
      color: "#fff",
      fontSize: "14px",
      fontWeight: "bold",
      cursor: "pointer",
      boxShadow: "0 3px 12px rgba(17,43,60,.28)"
    });

    settings.onclick = () => {
      const panel = document.getElementById("tm-setting-panel");
      if (panel) {
        panel.remove();
        return;
      }
      openSettings();
    };
    document.body.appendChild(settings);
  }

  // Chromeがバックグラウンドタブを間引いた・休止した場合の復帰処理。
  // 復帰時に保存済みの実行期限を確認し、期限超過ならその場で続きを実行する。
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      updateBatchPanel();
      recoverAutoActionIfDue();
      reconcileBatchState();
    }
  });
  window.addEventListener("focus", () => {
    updateBatchPanel();
    recoverAutoActionIfDue();
    reconcileBatchState();
  });
  window.addEventListener("pageshow", () => {
    updateBatchPanel();
    recoverAutoActionIfDue();
    reconcileBatchState();
  });
  window.addEventListener("online", () => {
    reconcileBatchState();
  });

  window.addEventListener("keydown", async event => {
    if (event.altKey && event.key.toLowerCase() === "j") {
      event.preventDefault();
      if (document.querySelector("#js-selectGosinkoku")) await selectReportType();
      await autofill();
    }
  });

  // SUUMO Room Filter v0.3: 住所・階数・面積・賃料 ＋ クリック時に詳細から築年月照合
  // 通常の検索結果ページだけで動く。既存の一括送信ルートは変更しない。
  function initRoomFilter() {
      'use strict';
    
      const PANEL_ID = 'suumo-room-filter-integrated-v751';
      const HIDE_CLASS = 'suumo-room-filter-v751-hidden';
      if (document.getElementById(PANEL_ID)) return;
    
      const norm = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
      const cleaned = value => norm(value).replace(/\s+/g, '');
      const fromURL = new URLSearchParams(location.search);
      const fw = norm(fromURL.get('fw') || '');
      const floorM = fw.match(/(\d+)\s*階/);
      const areaM = fw.match(/(\d+(?:\.\d+)?)\s*(?:㎡|m(?:2)?)(?![A-Za-z0-9])/i);
      const rentM = fw.match(/(\d+(?:\.\d+)?)\s*万円/);
      const buildM = fw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
      const builtKey = (year, month) => `${Number(year)}-${String(Number(month)).padStart(2, '0')}`;
      const target = {
        address: buildM ? cleaned(fw.slice(0, buildM.index)) : '',
        floor: floorM ? Number(floorM[1]) : null,
        area: areaM ? Number(areaM[1]) : null,
        rentYen: rentM ? Math.round(Number(rentM[1]) * 10000) : null,
        built: buildM ? `${buildM[1]}年${Number(buildM[2])}月` : '',
        builtKey: buildM ? builtKey(buildM[1], buildM[2]) : ''
      };
      const validTarget = Boolean(target.address && target.floor !== null && target.area !== null && target.rentYen !== null);
      const validBuilt = Boolean(buildM && Number(buildM[2]) >= 1 && Number(buildM[2]) <= 12);
    
      function readCard(card) {
        const title = norm(card.querySelector('.property_inner-title')?.textContent);
        const floor = title.match(/(\d+)\s*階/);
        const rentTxt = norm(card.querySelector('.detailbox-property-point')?.textContent);
        const rent = rentTxt.match(/([\d.]+)\s*万円/);
        const cells = [...card.querySelectorAll('.detailbox-property tr > td')];
        const areaTxt = norm(cells[2]?.textContent);
        const area = areaTxt.match(/([\d.]+)\s*(?:㎡|m\s*2)/i);
        const id = card.querySelector('input[name="bc"]')?.value || '';
        const detailHref = card.querySelector('.property_inner-title a[href^="/chintai/"]')?.getAttribute('href') || '';
        return {
          id, title,
          floor: floor ? Number(floor[1]) : null,
          area: area ? Number(area[1]) : null,
          rentYen: rent ? Math.round(Number(rent[1]) * 10000) : null,
          address: cleaned(cells[4]?.textContent),
          detailHref,
          raw: {rent: rentTxt, area: areaTxt, address: norm(cells[4]?.textContent), cells: cells.length}
        };
      }
    
      // DOMParserで作った文書は未表示なので、innerTextではなくtextContentを使う。
      // 「築11年」のような相対表現を築年月に変換してはいけない。
      function readBuiltFromDetail(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const ym = /([12]\d{3})\s*年\s*(0?[1-9]|1[0-2])\s*月/;
        const candidates = [];
        for (const cell of doc.querySelectorAll('th,dt')) {
          if (cleaned(cell.textContent) !== '築年月') continue;
          const next = cell.nextElementSibling;
          if (next) candidates.push(next.textContent);
          // tableで label と value が別要素内にあるケースにも備える。
          if (cell.parentElement) candidates.push(cell.parentElement.textContent);
        }
        for (const candidate of candidates) {
          const match = norm(candidate).match(ym);
          if (match) return {key: builtKey(match[1], match[2]), text: `${match[1]}年${Number(match[2])}月`, source: 'label'};
        }
        const bodyText = norm(doc.body?.textContent);
        const match = bodyText.match(/築年月\s*[:：]?\s*([12]\d{3})\s*年\s*(0?[1-9]|1[0-2])\s*月/);
        if (match) return {key: builtKey(match[1], match[2]), text: `${match[1]}年${Number(match[2])}月`, source: 'text'};
        return null;
      }
    
      function start() {
        if (document.getElementById(PANEL_ID)) return;
        const list = document.querySelector('#js-bukkenList');
        const cards = [...(list?.querySelectorAll('.js-property') || [])];
        if (!cards.length) return;
    
        const records = cards.map(card => {
          const v = readCard(card);
          const checks = {
            address: v.address === target.address,
            floor: v.floor === target.floor,
            area: v.area === target.area,
            rent: v.rentYen === target.rentYen
          };
          return {
            card, v, checks,
            basicMatch: validTarget && Object.values(checks).every(Boolean),
            builtStatus: '未照合', builtText: '', builtReason: ''
          };
        });
        const basic = records.filter(r => r.basicMatch);
        const stat = name => records.filter(r => r.checks[name]).length;
        let mode = 'all';
        roomFilterAvailable = validTarget;
        roomFilterActivateBasic = () => { mode = 'basic'; render(); };
        let checking = false;
        let scanFinished = false;
        let checked = 0;
    
        const style = document.createElement('style');
        style.textContent = `.${HIDE_CLASS}{display:none!important}
          #${PANEL_ID}{position:fixed;right:14px;bottom:16px;z-index:2147483647;background:#fff;
          color:#1c2630;border:2px solid #208a64;border-radius:12px;box-shadow:0 5px 22px #0003;
          padding:12px 14px;width:365px;max-width:calc(100vw - 40px);font:13px/1.5 system-ui,Meiryo,sans-serif}
          #${PANEL_ID} .srf-btn{border:0;border-radius:7px;padding:7px 10px;background:#167755;
          color:white;font:inherit;cursor:pointer}
          #${PANEL_ID} .srf-alt{background:#556470}
          #${PANEL_ID} .srf-btn:disabled{opacity:.45;cursor:not-allowed}
          #${PANEL_ID} .srf-note{font-size:11px;color:#5e666a;margin-top:7px;overflow-wrap:anywhere}
          #${PANEL_ID} .srf-stats{background:#f2f6f3;border-radius:6px;padding:7px;margin-top:8px;font-size:12px;line-height:1.6}`;
        document.head.append(style);
    
        const panel = document.createElement('section');
        panel.id = PANEL_ID;
        const heading = document.createElement('div');
        heading.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:4px';
        const subtitle = document.createElement('div');
        subtitle.textContent = `${target.floor ?? '?'}階 / ${target.area ?? '?'}㎡ / ${target.rentYen !== null ? target.rentYen / 10000 : '?'}万円 / ${target.built || '築年月不明'}`;
        const stats = document.createElement('div');
        stats.className = 'srf-stats';
        const progress = document.createElement('div');
        progress.className = 'srf-note';
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px;margin-top:9px';
        const button = (label, alt=false) => {
          const b=document.createElement('button');
          b.type='button'; b.className='srf-btn'+(alt?' srf-alt':'');
          b.textContent=label; return b;
        };
        const fourBtn = button('4条件一致のみ');
        const dateBtn = button('築年月も照合');
        const strictBtn = button('築年月一致のみ');
        const unknownBtn = button('築年月未確認');
        const allBtn = button('全件に戻す', true);
        const copyBtn = button('診断結果をコピー', true);
        const note = document.createElement('div');
        note.className = 'srf-note';
        note.textContent = '築年月は候補の詳細ページから照合。取得できない物件は未確認扱いにします。号室は判定せず、指摘・送信もしません。';
    
        function statusCounts() {
          return {
            matched: basic.filter(r => r.builtStatus === '一致').length,
            mismatched: basic.filter(r => r.builtStatus === '不一致').length,
            unknown: basic.filter(r => r.builtStatus === '取得不可').length,
            unprocessed: basic.filter(r => r.builtStatus === '未照合').length
          };
        }
    
        function visible(row) {
          if (mode === 'all') return true;
          if (mode === 'basic') return row.basicMatch;
          if (mode === 'strict') return row.basicMatch && row.builtStatus === '一致';
          if (mode === 'unknown') return row.basicMatch && row.builtStatus === '取得不可';
          return true;
        }
    
        function render() {
          roomFilterSelection = mode === 'all' ? null : new Set(records.filter(visible).map(r => r.v.id));
          records.forEach(r => r.card.classList.toggle(HIDE_CLASS, !visible(r)));
          list.querySelectorAll('.property_group').forEach(group => {
            const groupCards = [...group.querySelectorAll('.js-property')];
            group.classList.toggle(HIDE_CLASS, !groupCards.some(c => !c.classList.contains(HIDE_CLASS)));
          });
          list.querySelectorAll('.summarize').forEach(el => el.classList.toggle(HIDE_CLASS, mode !== 'all'));
          const sc = statusCounts();
          const modes = {all:'全件表示中',basic:'4条件一致を表示中',strict:'築年月一致を表示中',unknown:'取得不可を表示中'};
          heading.textContent = `${modes[mode]}：${records.filter(visible).length}件（HTML内${records.length}件）`;
          stats.textContent = `4条件一致：${basic.length}件｜住所${stat('address')}・階数${stat('floor')}・面積${stat('area')}・賃料${stat('rent')} 件\n築年月：一致 ${sc.matched}件 / 不一致 ${sc.mismatched}件 / 取得不可 ${sc.unknown}件 / 未照合 ${sc.unprocessed}件`;
          stats.style.whiteSpace='pre-line';
          progress.textContent = checking ? `築年月を確認中：${checked} / ${basic.length}件（低速・順番にアクセス）` : scanFinished ? '築年月の照合が完了しました。取得不可は要手動確認。' : '築年月はまだ照合していません。';
          dateBtn.disabled = checking || scanFinished || !validTarget || !validBuilt || !basic.length;
          strictBtn.disabled = !scanFinished;
          unknownBtn.disabled = !scanFinished || !sc.unknown;
          fourBtn.disabled = !validTarget;
        }
    
        // ユーザーがボタンを押した時だけ詳細を確認。表示ページの同一オリジンURLに限定。
        async function checkBuilt(row) {
          const href = row.v.detailHref;
          if (!href || !row.v.id) return {status:'取得不可', reason:'詳細URL/物件IDがありません'};
          let url;
          try { url = new URL(href, location.origin); }
          catch {return {status:'取得不可',reason:'詳細URLが不正です'};}
          if (url.origin !== location.origin || !url.pathname.startsWith('/chintai/')) {
            return {status:'取得不可',reason:'同一オリジンのSUUMO物件詳細ではありません'};
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);
          try {
            const response = await fetch(url.href, {credentials:'same-origin', signal:controller.signal});
            if (!response.ok) return {status:'取得不可',reason:`HTTP ${response.status}`};
            const type = response.headers.get('content-type') || '';
            if (type && !type.includes('text/html')) return {status:'取得不可',reason:'HTML以外の応答'};
            const html = await response.text();
            const documentIdFound = html.includes(row.v.id);
            if (!documentIdFound) return {status:'取得不可',reason:'物件IDが詳細ページ内で確認できません'};
            const built = readBuiltFromDetail(html);
            if (!built) return {status:'取得不可',reason:'詳細ページから築年月を抽出できません'};
            return {
              status: built.key === target.builtKey ? '一致' : '不一致',
              builtText: built.text,
              reason: `取得元:${built.source}`
            };
          } catch (error) {
            return {status:'取得不可', reason: error?.name === 'AbortError' ? '12秒でタイムアウト' : String(error?.message || error)};
          } finally {clearTimeout(timer);}
        }
    
        fourBtn.addEventListener('click', () => { mode='basic'; render(); });
        strictBtn.addEventListener('click', () => { if (scanFinished) {mode='strict';render();} });
        unknownBtn.addEventListener('click', () => { if (scanFinished) {mode='unknown';render();} });
        allBtn.addEventListener('click', () => { mode='all';render(); });
        dateBtn.addEventListener('click', async () => {
          if (checking || scanFinished || !validTarget || !validBuilt) return;
          checking=true; checked=0; mode='basic'; render();
          // 連続アクセスを避けるため逐次確認。エラー時は未確認として扱い、誤って一致にしない。
          for (const row of basic) {
            const result = await checkBuilt(row);
            row.builtStatus = result.status;
            row.builtText = result.builtText || '';
            row.builtReason = result.reason || '';
            checked++;
            render();
            if (checked < basic.length) await new Promise(resolve => setTimeout(resolve, 400));
          }
          checking=false; scanFinished=true; render();
        });
        copyBtn.addEventListener('click', async () => {
          const sc=statusCounts();
          const report = {
            version:'0.3.0', page:location.pathname,
            hasIimonParameter:fromURL.has('iimon'),keyword:fw,target,validTarget,validBuilt,
            counts:{all:records.length, basic:basic.length, floor:stat('floor'),
              area:stat('area'),rent:stat('rent'),address:stat('address'),built:sc},
            results:basic.map(r => ({id:r.v.id,title:r.v.title,detail:r.v.detailHref,
              builtStatus:r.builtStatus,built:r.builtText,reason:r.builtReason}))
          };
          const data=JSON.stringify(report,null,2);
          try {await navigator.clipboard.writeText(data);copyBtn.textContent='コピーしました';}
          catch {
            const ta=document.createElement('textarea');ta.value=data;
            ta.style.cssText='position:fixed;top:5px;left:5px;z-index:2147483647';
            document.body.append(ta);ta.select();
            try {document.execCommand('copy');copyBtn.textContent='コピーしました';}
            catch {copyBtn.textContent='コピー失敗';}
            ta.remove();
          }
        });
        btnRow.append(fourBtn,dateBtn,strictBtn,unknownBtn,allBtn,copyBtn);
        panel.append(heading,subtitle,stats,progress,btnRow,note);
        document.body.append(panel);
        render();
      }
    
      start();
      if (!document.getElementById(PANEL_ID)) setTimeout(start, 1500);
  }

  async function init() {
    while (!document.body) await sleep(50);


    // いえらぶCLOUDでは設定ボタンだけ表示。
    // ここで保存した値は同じTampermonkeyスクリプトの保存領域を使うため、
    // SUUMO側の申告フォームでもそのまま利用できる。
    if (location.hostname === "cloud.ielove.jp") {
      addIeloveSettingsButton();
      requireProfileManager();
      return;
    }

    if (location.hostname !== "suumo.jp") return;

    if (/^\/jj\/chintai\/ichiran\//.test(location.pathname)) initRoomFilter();
    addMainButtons();
    if (!requireProfileManager()) return;

    if (!isBatchActive()) return;
    startBackgroundWatchdog();
    updateBatchPanel();

    if (isListingPage()) {
      await handleListingPage();
      return;
    }

    if (isInputPage()) {
      if (isSubmitting()) {
        setSubmitting(false);
        setConfirmReady(false);
        setBatchError(true);
        setFormReady(false);
        updateBatchPanel();
        toast("送信が完了せず入力画面へ戻りました。\n入力エラーを確認してください。", 6000);
        return;
      }

      const stage = getBatchStage();
      if (stage === STAGES.INPUT_READY || stage === STAGES.INPUT_CONFIRM) {
        setFormReady(true);
        setConfirmReady(stage === STAGES.INPUT_CONFIRM);
        updateBatchPanel();
        recoverAutoActionIfDue();
        return;
      }

      await sleep(700);
      await prepareReportForm();
      return;
    }

    if (isConfirmPage()) {
      await handleConfirmPage();
      return;
    }

    if (isCompletePage()) {
      await handleCompletePage();
      return;
    }
  }

  init();
})();
