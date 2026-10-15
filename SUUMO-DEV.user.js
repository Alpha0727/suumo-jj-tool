// ==UserScript==
// @name         SUUMO JJ 一括申告 DEV
// @namespace    jp.re.autofill.suumo.dev
// @version      7.51.0
// @description  開発・検証専用版。一般配布版とは独立して更新。実際のSUUMO送信機能あり。
// @match        https://suumo.jp/*
// @match        https://cloud.ielove.jp/*
// @updateURL    https://raw.githubusercontent.com/Alpha0727/suumo-jj-tool/dev/SUUMO-DEV.user.js
// @downloadURL  https://raw.githubusercontent.com/Alpha0727/suumo-jj-tool/dev/SUUMO-DEV.user.js
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

  const PROFILE = {
    company: GM_getValue("profile_company", "株式会社エールーム"),
    manager1: GM_getValue("profile_manager1", "東"),
    tel: normalizePhone(GM_getValue("profile_tel", "0362401146")),
    email: GM_getValue("profile_email", "a-ueno@arooms.jp"),
    mgmt_company: GM_getValue("mgmt_company", ""),
    mgmt_tel: String(GM_getValue("mgmt_tel", "")).normalize("NFKC").replace(/\D/g, ""),
    manager2: GM_getValue("manager2", ""),
    room: GM_getValue("room", "")
  };

  const DATE_OFFSETS = {
    apply: Number(GM_getValue("date_offset_apply", -7)),
    contract: Number(GM_getValue("date_offset_contract", 7)),
    confirm: Number(GM_getValue("date_offset_confirm", 0))
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
  const SCRIPT_VERSION = "7.51.0";
  const SCRIPT_URL = "https://raw.githubusercontent.com/Alpha0727/suumo-jj-tool/dev/SUUMO-DEV.user.js";
  const VERSION_URL = "https://api.github.com/repos/Alpha0727/suumo-jj-tool/contents/latest-dev.json?ref=dev";
  const VERSION_RAW_URL = "https://raw.githubusercontent.com/Alpha0727/suumo-jj-tool/dev/latest-dev.json";

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
      ["#textSinkokuDate", DATE_OFFSETS.apply],
      ["#textSeiyakuDate", DATE_OFFSETS.contract],
      ["#textSinkokuKaisyaKakuninDate", DATE_OFFSETS.confirm]
    ];
    return fields.reduce(
      (count, [selector, offset]) =>
        count + (setReadonlyDate(selector, getDateForSuumo(offset)) ? 1 : 0),
      0
    );
  }

  async function selectReportType() {
    const select = document.querySelector("#js-selectGosinkoku");
    if (!select) return false;
    setNative(select, "1");
    await sleep(200);
    const radio = document.querySelector("#tashaKanri");
    if (!radio) return false;
    radio.checked = true;
    try { radio.dispatchEvent(new Event("input", { bubbles: true })); } catch {}
    try { radio.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
    try { radio.dispatchEvent(new Event("click", { bubbles: true })); } catch {}
    await sleep(250);
    return true;
  }

  async function autofill(showToast = true) {
    await sleep(100);

    let filledCount = 0;

    for (const [key, selector] of Object.entries(FIELDS)) {
      const override = activeIeloveProfile();
      const value = override && Object.prototype.hasOwnProperty.call(override, key) ? override[key] : PROFILE[key];
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

      await sleep(100);
      if (!isBatchActive() || !isInputPage()) return false;
      const currentProfile = activeIeloveProfile();
      if (getIeloveExecution() && !currentIeloveExecutionItem()) throw new Error("物件ごとの申告情報と掲載URLが一致しません");
      if (currentProfile && validateIeloveProfile(currentProfile)) throw new Error("必要項目が不足：" + validateIeloveProfile(currentProfile));
      const count = await autofill(false);
      if (currentProfile && ieloveFormMismatch(currentProfile)) throw new Error("入力結果が一致しません：" + ieloveFormMismatch(currentProfile));

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
        await sleep(500);
        formPreparationRunning = false;
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

  function setBatch(urls, index = 0, source = "regular") {
    if (source !== "ielove") GM_deleteValue(IELOVE_BATCH_EXECUTION_KEY);
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

      setBatch(uniqueUrls, 0);
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
      setBatch(urls, 0);
      overlay.remove();
      location.href = urls[0];
    };
  }

  let nextListingStarted = false;

  function goToNextListing() {
    if (nextListingStarted || !isBatchActive()) return;
    if (currentIeloveExecutionItem() && currentIeloveExecutionItem().status !== "complete") return;
    nextListingStarted = true;

    const urls = getBatchUrls();
    let index = getBatchIndex();
    index++;

    if (index >= urls.length) {
      const total = urls.length;
      const execution = getIeloveExecution();
      if (execution) {
        execution.finishedAt = Date.now();
        GM_setValue(IELOVE_BATCH_EXECUTION_KEY, execution);
      }

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

    const context = currentIeloveExecutionItem();
    if (getIeloveExecution() && !context) {
      setBatchError(true);
      setFormReady(false);
      updateBatchPanel();
      toast("物件と申告データの対応を確認できません。処理を停止しました。", 6000);
      return;
    }
    if (context && (validateIeloveProfile(context.profile) || ieloveFormMismatch(context.profile))) {
      setBatchError(true);
      setFormReady(false);
      updateBatchPanel();
      toast("物件ごとの管理会社情報が一致しません。送信を停止しました。", 6000);
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
    if (!isBatchActive() || confirmSendStarted) return;
    if (blockUncertainIeloveResend()) return;
    const stage = getBatchStage();
    if (stage !== STAGES.SUBMITTING_CONFIRM && stage !== STAGES.SUBMITTING_FINAL) return;
    setSubmitting(true);
    setBatchStage(STAGES.SUBMITTING_FINAL);
    setConfirmReady(false);
    updateBatchPanel();
    toast("確認画面を確認しました。\n送信します…", 1800);
    await sleep(350);

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

    await sleep(250);
    if (!isBatchActive() || !isConfirmPage() || confirmSendStarted) return;
    confirmSendStarted = true;
    saveIeloveExecutionStatus("sending");
    sendLink.click();
  }

  async function handleCompletePage() {
    if (!isBatchActive()) return;
    const stage = getBatchStage();
    if (stage !== STAGES.SUBMITTING_FINAL && stage !== STAGES.COMPLETE) return;
    setBatchStage(STAGES.COMPLETE);
    saveIeloveExecutionStatus("complete");
    setSubmitting(true);
    setConfirmReady(false);
    updateBatchPanel();
    toast("申告の送信が完了しました ✓", 1800);
    await sleep(500);
    goToNextListing();
  }

  function retryCurrentListing() {
    if (currentIeloveExecutionItem()?.status === "sending") {
      toast("送信結果が未確認です。再実行すると二重送信になる可能性があります。", 6500);
      return;
    }
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
    if (currentIeloveExecutionItem()?.status === "sending") {
      toast("送信結果が未確認のため、この掲載はスキップできません。確認後に中止してください。", 6500);
      return;
    }
    if (isSubmitting()) {
      toast("送信処理中はスキップできません");
      return;
    }

    const urls = getBatchUrls();
    let index = getBatchIndex();

    const ok = confirm("この物件は送信せずにスキップしますか？");
    if (!ok) return;

    setConfirmReady(false);
    saveIeloveExecutionStatus("skipped");
    index++;

    if (index >= urls.length) {
      const execution = getIeloveExecution();
      if (execution) {
        execution.finishedAt = Date.now();
        GM_setValue(IELOVE_BATCH_EXECUTION_KEY, execution);
      }
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
    if (currentIeloveExecutionItem()?.status === "complete") {
      goToNextListing();
      return;
    }

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

  const AUTO_ACTION_MS = 1000;
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
          if (sendLink && !blockUncertainIeloveResend()) {
            confirmSendStarted = true;
            saveIeloveExecutionStatus("sending");
            sendLink.click();
          }
        }
        return;
      }

      if (isCompletePage()) {
        if (stage === STAGES.SUBMITTING_FINAL || stage === STAGES.COMPLETE) {
          setBatchStage(STAGES.COMPLETE);
          saveIeloveExecutionStatus("complete");
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
    const ieloveItem = currentIeloveExecutionItem();
    const plannedProfile = ieloveItem?.profile || PROFILE;
    const plannedFields = [
      ["管理会社", plannedProfile.mgmt_company],
      ["担当", plannedProfile.manager2],
      ["TEL", plannedProfile.mgmt_tel],
      ["号室", plannedProfile.room]
    ];
    const plannedInputHtml = plannedFields.map(([label, value]) =>
      '<span style="display:inline-block;margin-right:7px;max-width:100%;overflow-wrap:anywhere;"><span style="color:#64748b;">' +
      escapeHtml(label) + '：</span>' + escapeHtml(String(value || "未設定")) + '</span>'
    ).join("");
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

    const uncertainSend = currentIeloveExecutionItem()?.status === "sending" && !isCompletePage();
    if (uncertainSend) {
      statusText = "⚠ 最終送信を開始済みですが、完了を確認できていません。二重送信防止のため停止しています。";
      statusBackground = "#fff1f0";
    }
    const canSubmit = isInputPage() && !submitting && formReady && !uncertainSend;
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
    } else if (batchError && !uncertainSend) {
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
      ${ieloveItem ? `<div style="font-size:13px;font-weight:bold;margin-bottom:5px;">${escapeHtml(ieloveItem.name)} ／ ${escapeHtml(ieloveItem.profile.room)}</div>` : ""}
      <div style="font-size:11px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:10px;">${escapeHtml(current)}</div>
      <div style="font-size:11px;line-height:1.5;padding:6px 8px;margin-bottom:9px;background:#f5f7fa;border-radius:6px;color:#25364a;"><span style="font-weight:bold;color:#526575;">自動入力予定　</span>${plannedInputHtml}</div>
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
      ${location.hostname === "cloud.ielove.jp" ? '<div id="tm-ielove-batch-heading" style="display:none;margin-bottom:12px;padding:10px;background:#EEF3F6;border:1px solid #D6E0E6;border-radius:8px;"><strong id="tm-ielove-batch-name"></strong><span id="tm-ielove-batch-progress" style="float:right"></span><div id="tm-ielove-batch-meta" style="font-size:12px;margin-top:6px"></div></div>' : ''}
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
          ["申込日", "tm-date-apply", DATE_OFFSETS.apply],
          ["成約日", "tm-date-contract", DATE_OFFSETS.contract],
          ["確認日", "tm-date-confirm", DATE_OFFSETS.confirm]
        ].map(([label, id, value]) => `
          <div style="display:grid;grid-template-columns:58px 38px 32px 48px 32px 18px;align-items:center;gap:5px;margin:6px 0;">
            <span>${label}</span><span>今日</span>
            <button type="button" class="tm-date-minus" data-target="${id}" style="height:29px;cursor:pointer;">−</button>
            <input id="${id}" type="number" value="${value}" min="-365" max="365" style="width:48px;height:29px;box-sizing:border-box;text-align:center;">
            <button type="button" class="tm-date-plus" data-target="${id}" style="height:29px;cursor:pointer;">＋</button>
            <span>日</span>
          </div>
        `).join("")}
        </div>
      </details>
      </div>
      <div id="tm-setting-footer" style="flex-shrink:0;margin:12px -14px -14px;padding:10px 14px 14px;background:#fff;border-top:1px solid #D6E0E6;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${location.hostname === "cloud.ielove.jp"
            ? '<button id="tm-ielove-batch-get" type="button" style="flex:1;min-width:135px;padding:8px 13px;border:0;border-radius:7px;background:#205375;color:#fff;font-weight:bold;cursor:pointer;">一括取得</button>'
            : '<button id="tm-settings-batch" type="button" style="padding:8px 13px;border:0;border-radius:7px;background:#e66b00;color:#fff;font-weight:bold;cursor:pointer;">一括処理</button><button id="tm-settings-autofill" type="button" style="padding:8px 13px;border:0;border-radius:7px;background:#205375;color:#fff;font-weight:bold;cursor:pointer;">自動入力</button>'}
          ${location.hostname === "cloud.ielove.jp" ? '<button id="tm-ielove-prev" type="button" style="display:none;padding:8px;border:1px solid #B9C7CF;border-radius:7px;background:#fff;cursor:pointer">← 前へ</button><button id="tm-ielove-next" type="button" style="display:none;padding:8px;border:0;border-radius:7px;background:#205375;color:#fff;cursor:pointer">次へ →</button><button id="tm-ielove-back" type="button" style="display:none;padding:8px;border:1px solid #B9C7CF;border-radius:7px;background:#fff;cursor:pointer">通常画面</button>' : ''}
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

    panel.querySelectorAll(".tm-date-minus, .tm-date-plus").forEach(button => {
      button.onclick = () => {
        const input = document.getElementById(button.dataset.target);
        if (!input) return;
        input.value = String(Number(input.value || 0) + (button.classList.contains("tm-date-plus") ? 1 : -1));
      };
    });

    const batchButton = document.getElementById("tm-settings-batch");
    if (batchButton) batchButton.onclick = () => {
      panel.remove();
      openCompanySelection();
    };

    const autofillButton = document.getElementById("tm-settings-autofill");
    if (autofillButton) autofillButton.onclick = async () => {
      if (document.querySelector("#js-selectGosinkoku")) await selectReportType();
      await autofill();
    };

    const ieloveGetButton = document.getElementById("tm-ielove-batch-get");
    if (ieloveGetButton) ieloveGetButton.onclick = () => startIeloveBatchGet(ieloveGetButton);
    if (ieloveGetButton) {
      const draft = GM_getValue(IELOVE_BATCH_DRAFT_KEY, null);
      if (draft && Array.isArray(draft.records) && draft.records.length) activateIeloveBatchEditor(draft);
    }

    document.getElementById("tm-save-setting").onclick = () => {
      if (location.hostname === "cloud.ielove.jp" && document.getElementById("tm-ielove-batch-heading")?.style.display !== "none") {
        persistIeloveBatchEditor();
        toast("この物件の編集内容を保存しました ✓");
        return;
      }
      if (updateHalfWidthWarning()) {
        toast("入力内容に修正が必要です。\n「まとめて修正」を押してから保存してください。", 4500);
        return;
      }

      const profileCompany = document.getElementById("tm-profile-company").value.trim();
      const profileManager1 = document.getElementById("tm-profile-manager1").value.trim();
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

  // いえらぶ一覧の表示中物件を収集する。チェック状態と他ページは対象外。
  const IELOVE_BATCH_DRAFT_KEY = "ielove_batch_draft_v1";

  async function startIeloveBatchGet(button) {
    if (location.hostname !== "cloud.ielove.jp") return;
    const rows = Array.from(document.querySelectorAll('tr[id^="row_"]'))
      .filter(row => /^row_\d+$/.test(row.id) && row.getClientRects().length > 0);
    if (!rows.length) {
      toast("物件一覧が見つかりません。いえらぶの物件一覧画面で実行してください。", 5000);
      return;
    }
    button.disabled = true;
    button.textContent = "取得中 0/" + rows.length;
    const records = [];
    try {
      for (const row of rows) {
        const id = row.id.slice(4);
        const text = selector => row.querySelector(selector)?.textContent?.trim() || "";
        const detailLink = row.querySelector('a[href*="/rent/index/detail/id/"]');
        const detailUrl = new URL(detailLink?.getAttribute("href") || "/rent/index/detail/id/" + id + "/", location.origin).href;
        const paragraphs = Array.from(row.querySelectorAll("p")).map(p => p.textContent.trim());
        const address = text("#address_" + id) || paragraphs.find(p => /(?:都|道|府|県).*(?:市|区|町|村)/.test(p)) || "";
        const specs = row.textContent.replace(/\s+/g, " ");
        const response = await fetch(detailUrl, { credentials: "same-origin" });
        if (!response.ok) throw new Error(id + ": 詳細取得 HTTP " + response.status);
        const doc = new DOMParser().parseFromString(await response.text(), "text/html");
        const floorHeader = Array.from(doc.querySelectorAll("th")).find(th => th.textContent.replace(/\s/g, "").includes("所在階/階建"));
        const floorText = floorHeader?.nextElementSibling?.textContent?.trim() || "";
        records.push({
          id, name: text("#realEstateName1_" + id), room: text("#spareDetail_" + id).replace(/（非公開）|\(非公開\)/g, "").trim(),
          address, specs, floor: floorText,
          rent: text("#price_" + id), fee: text("#kanrihi_" + id),
          managementCompany: text("#motozukeName_" + id),
          manager: text("#motozukeStaffName_" + id),
          phone: text("#motozukePhoneNum_" + id),
          detailUrl
        });
        button.textContent = "取得中 " + records.length + "/" + rows.length;
      }
      GM_setValue(IELOVE_BATCH_DRAFT_KEY, { records, index: 0, savedAt: Date.now() });
      toast(records.length + "件の物件情報を取得・保存しました ✓", 5000);
      showIeloveBatchDraft(records);
    } catch (error) {
      toast("取得を中断しました：" + String(error.message || error), 6000);
      console.error("[SUUMO JJ DEV] いえらぶ一括取得:", error);
    } finally {
      button.disabled = false;
      button.textContent = "一括取得";
    }
  }


  const IELOVE_EDIT_FIELDS = [["managementCompany","tm-mgmt-company"],["phone","tm-mgmt-tel"],["manager","tm-manager2"],["room","tm-room"]];
  let ieloveNormalSnapshot = null;
  function persistIeloveBatchEditor() {
    const draft = GM_getValue(IELOVE_BATCH_DRAFT_KEY, null);
    if (!draft || !Array.isArray(draft.records) || !draft.records.length) return null;
    const index = Math.max(0, Math.min(Number(draft.index) || 0, draft.records.length - 1));
    for (const [field,id] of IELOVE_EDIT_FIELDS) {
      const input = document.getElementById(id);
      if (input) draft.records[index][field] = input.value;
    }
    draft.savedAt = Date.now();
    GM_setValue(IELOVE_BATCH_DRAFT_KEY, draft);
    return draft;
  }
  function renderIeloveBatchEditor(draft) {
    const index = Math.max(0, Math.min(Number(draft.index) || 0, draft.records.length - 1));
    const item = draft.records[index];
    document.getElementById("tm-ielove-batch-name").textContent = item.name || "物件名未取得";
    document.getElementById("tm-ielove-batch-progress").textContent = (index+1) + " / " + draft.records.length + "件";
    document.getElementById("tm-ielove-batch-meta").textContent = [item.room,item.address,item.floor,item.specs,item.rent].filter(Boolean).join(" ／ ");
    for (const [field,id] of IELOVE_EDIT_FIELDS) document.getElementById(id).value = field === "room" ? String(item[field] || "").replace(/（非公開）|\(非公開\)/g, "").trim() : (item[field] || "");
    document.getElementById("tm-ielove-prev").disabled = index === 0;
    document.getElementById("tm-ielove-next").textContent = index === draft.records.length - 1 ? "SUUMOへ進む →" : "次へ →";
  }
  function activateIeloveBatchEditor(draft) {
    if (!document.getElementById("tm-ielove-batch-heading") || !draft || !draft.records?.length) return;
    if (!ieloveNormalSnapshot) ieloveNormalSnapshot = Object.fromEntries(IELOVE_EDIT_FIELDS.map(([field,id]) => [field,document.getElementById(id).value]));
    document.getElementById("tm-ielove-batch-heading").style.display = "block";
    document.getElementById("tm-ielove-batch-get").style.display = "none";
    for (const id of ["tm-ielove-prev","tm-ielove-next","tm-ielove-back"]) document.getElementById(id).style.display = "";
    document.getElementById("tm-ielove-prev").onclick = () => navigateIeloveBatch(-1);
    document.getElementById("tm-ielove-next").onclick = () => navigateIeloveBatch(1);
    document.getElementById("tm-ielove-back").onclick = exitIeloveBatchEditor;
    renderIeloveBatchEditor(draft);
  }

  const IELOVE_SUUMO_HANDOFF_KEY = "ielove_suumo_handoff_v1";
  function buildIeloveSuumoSearch(record) {
    const address = String(record.address || "").normalize("NFKC");
    const specs = String(record.specs || "").normalize("NFKC");
    const floor = String(record.floor || "").normalize("NFKC");
    const rent = String(record.rent || "").normalize("NFKC");
    const addressMatch = address.match(/^(.+?[0-9]+)(?:丁目|[-－ー].*)/);
    const shortAddress = addressMatch ? addressMatch[1] : address.replace(/丁目.*$/, "").trim();
    const built = specs.match(/(\d{4})年\s*(\d{1,2})月/);
    const floorNumber = floor.match(/(\d+)階/);
    const area = specs.match(/(\d+(?:\.\d+)?)\s*(?:㎡|m2|m²)/i);
    let manYen = null;
    const yen = rent.replace(/,/g, "");
    const man = yen.match(/(\d+(?:\.\d+)?)\s*万/);
    const extra = yen.match(/万\s*(\d+)\s*円/);
    if (man) manYen = Number(man[1]) + (extra ? Number(extra[1])/10000 : 0);
    else {
      const direct = yen.match(/(\d+)\s*円/);
      if (direct) manYen = Number(direct[1])/10000;
    }
    if (!shortAddress || !built || !floorNumber || !area || !Number.isFinite(manYen)) {
      return { error: [!shortAddress && "住所", !built && "築年月", !floorNumber && "所在階", !area && "面積", !Number.isFinite(manYen) && "賃料"].filter(Boolean).join("・"), record };
    }
    const keyword = [shortAddress, built[1]+"年"+Number(built[2])+"月",floorNumber[1]+"階",area[1]+"m",Number(manYen.toFixed(4))+"万円"].join(" ");
    const url = new URL("https://suumo.jp/jj/chintai/ichiran/FR301FC011/");
    url.searchParams.set("ar","030");
    url.searchParams.set("bs","040");
    url.searchParams.set("fw",keyword);
    url.searchParams.set("pc","100");
    return { url:url.href, keyword };
  }

  function handoffIeloveBatchToSuumo(draft) {
    const results = draft.records.map(buildIeloveSuumoSearch);
    const failed = results.map((result,i) => result.error ? i+1 : null).filter(Boolean);
    if (failed.length) {
      toast("SUUMO検索条件不足：" + results.map((x,i) => x.error ? (i+1)+"件目 "+x.error : "").filter(Boolean).join("／"), 9000);
      return;
    }
    const handoff = { records:draft.records, searches:results, index:0, createdAt:Date.now() };
    GM_deleteValue("ielove_suumo_choices_v1");
    GM_setValue(IELOVE_SUUMO_HANDOFF_KEY, handoff);
    const tab = window.open(results[0].url, "_blank");
    if (!tab) toast("SUUMOタブを開けませんでした。ポップアップ許可を確認してください。", 6000);
  }

  function navigateIeloveBatch(step) {
    const draft = persistIeloveBatchEditor();
    if (!draft) return;
    const index = Number(draft.index) || 0;
    if (step > 0 && index >= draft.records.length-1) {
      handoffIeloveBatchToSuumo(draft);
      return;
    }
    draft.index = Math.max(0, Math.min(index+step, draft.records.length-1));
    GM_setValue(IELOVE_BATCH_DRAFT_KEY, draft);
    renderIeloveBatchEditor(draft);
  }
  function exitIeloveBatchEditor() {
    persistIeloveBatchEditor();
    document.getElementById("tm-ielove-batch-heading").style.display = "none";
    document.getElementById("tm-ielove-batch-get").style.display = "";
    for (const id of ["tm-ielove-prev","tm-ielove-next","tm-ielove-back"]) document.getElementById(id).style.display = "none";
    if (ieloveNormalSnapshot) {
      for (const [field,id] of IELOVE_EDIT_FIELDS) document.getElementById(id).value = ieloveNormalSnapshot[field] || "";
      ieloveNormalSnapshot = null;
    }
  }
  function showIeloveBatchDraft(records) {
    activateIeloveBatchEditor(GM_getValue(IELOVE_BATCH_DRAFT_KEY, null));
  }

  // いえらぶから引き継いだ検索結果専用。従来の単独指摘UIには影響させない。
  const IELOVE_SUUMO_CHOICES_KEY = "ielove_suumo_choices_v1";
  const IELOVE_SUUMO_GLOBAL_EXCLUDES = "ielove_suumo_excluded_company_ids_v1";

  function getIeloveHandoff() {
    const data = GM_getValue(IELOVE_SUUMO_HANDOFF_KEY, null);
    return data && Array.isArray(data.records) && Array.isArray(data.searches) &&
      data.records.length === data.searches.length ? data : null;
  }

  function isIeloveSuumoSearchPage() {
    return location.hostname === "suumo.jp" && location.pathname.includes("/jj/chintai/ichiran/");
  }

  function ieloveCompanyKey(card, name) {
    const link = card.querySelector('a[href^="/chintai/kaisha/"]');
    const href = link?.getAttribute("href") || "";
    return href.replace(/[?#].*$/, "").replace(/\/$/, "") || "name:" + name;
  }

  function getIeloveSearchCompanies() {
    const map = new Map();
    for (const card of document.querySelectorAll(".property-body")) {
      const link = card.querySelector('a[href^="/chintai/kaisha/"]');
      const name = link?.textContent?.trim();
      if (!name) continue;
      const key = ieloveCompanyKey(card, name);
      const clip = card.querySelector('input[id="clipkey"]');
      let propertyId = clip?.value?.trim() || "";
      if (!propertyId) {
        const rel = card.querySelector("a.js-singleShiryoSeikyu[rel]")?.getAttribute("rel") || "";
        propertyId = rel.match(/(?:^|_)(\d{8,})$/)?.[1] || "";
      }
      if (!map.has(key)) map.set(key, { key, name, urls: [] });
      if (propertyId) {
        const url = "https://suumo.jp/chintai/bc_" + propertyId + "/";
        const entry = map.get(key);
        if (!entry.urls.includes(url)) entry.urls.push(url);
      }
    }
    return [...map.values()];
  }

  function openIeloveSuumoSelection() {
    const handoff = getIeloveHandoff();
    if (!handoff || !isIeloveSuumoSearchPage() || isBatchActive()) return;
    const index = Math.max(0, Math.min(Number(handoff.index) || 0, handoff.records.length - 1));
    const url = new URL(location.href);
    const expected = new URL(handoff.searches[index].url);
    if (url.searchParams.get("fw") !== expected.searchParams.get("fw")) return;
    document.getElementById("tm-ielove-suumo-selection")?.remove();
    const choices = GM_getValue(IELOVE_SUUMO_CHOICES_KEY, {});
    const exclusions = new Set(GM_getValue(IELOVE_SUUMO_GLOBAL_EXCLUDES, []));
    const companies = getIeloveSearchCompanies();
    const modes = { ...(choices[index] || {}) };
    const overlay = document.createElement("div");
    overlay.id = "tm-ielove-suumo-selection";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:sans-serif";
    const shell = document.createElement("div");
    shell.style.cssText = "width:800px;max-width:94vw;max-height:90vh;background:#fff;border-radius:14px;box-shadow:0 12px 35px #0005;display:flex;flex-direction:column;overflow:hidden;color:#222";
    const head = document.createElement("div");
    head.style.cssText = "padding:16px 18px;border-bottom:1px solid #ddd";
    const title = document.createElement("div");
    title.style.cssText = "font-size:21px;font-weight:bold";
    title.textContent = "SUUMO 一括指摘対象の選択";
    const subtitle = document.createElement("div");
    subtitle.style.cssText = "font-size:13px;color:#666;margin-top:6px";
    const record = handoff.records[index];
    subtitle.textContent = (index + 1) + " / " + handoff.records.length + "件　" + (record.name || "物件名未取得") + "　" + (record.room || "");
    head.append(title,subtitle);
    const list = document.createElement("div");
    list.style.cssText = "overflow-y:auto;flex:1;padding:6px 15px";
    const styles = {
      report:"background:#1677ff;color:white;border-color:#1677ff",
      once:"background:#fa8c16;color:white;border-color:#fa8c16",
      permanent:"background:#d9363e;color:white;border-color:#d9363e"
    };
    const updateButtons = () => {
      list.querySelectorAll("[data-company-key]").forEach(row => {
        const key = row.dataset.companyKey;
        const effective = exclusions.has(key) ? "permanent" : (modes[key] || "report");
        row.querySelectorAll("button[data-choice]").forEach(button => {
          const mode = button.dataset.choice;
          button.style.cssText = "flex:1;min-width:0;padding:10px 3px;border:2px solid #ddd;border-radius:8px;background:#fff;color:#333;font-weight:bold;cursor:pointer;font-size:12px";
          if (mode === effective) button.style.cssText += ";" + styles[mode];
          button.textContent = (mode === effective ? "✓ " : "") + ({report:"指摘する",once:"今回だけ除外",permanent:"今後も除外"}[mode]);
        });
      });
    };
    for (const company of companies) {
      const row = document.createElement("div");
      row.dataset.companyKey = company.key;
      row.style.cssText = "padding:12px 0;border-bottom:1px solid #e5e5e5";
      const label = document.createElement("div");
      label.style.cssText = "font-size:15px;font-weight:bold;margin-bottom:8px";
      label.textContent = company.name + "（掲載 " + company.urls.length + "件）";
      const buttons = document.createElement("div");
      buttons.style.cssText = "display:flex;gap:7px";
      for (const mode of ["report","once","permanent"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.choice = mode;
        button.onclick = () => {
          if (mode === "permanent") exclusions.add(company.key);
          else exclusions.delete(company.key);
          if (mode !== "permanent") modes[company.key] = mode;
          GM_setValue(IELOVE_SUUMO_GLOBAL_EXCLUDES, [...exclusions]);
          updateButtons();
        };
        buttons.appendChild(button);
      }
      row.append(label,buttons);
      list.appendChild(row);
    }
    if (!companies.length) {
      const empty = document.createElement("p");
      empty.textContent = "掲載会社が見つかりませんでした。検索結果を確認してください。";
      list.appendChild(empty);
    }
    const foot = document.createElement("div");
    foot.style.cssText = "padding:14px 18px;border-top:1px solid #ddd;background:#fafafa;display:flex;gap:8px;flex-wrap:wrap";
    const makeButton = (label, primary, fn) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.cssText = "padding:10px 14px;border:1px solid #ccd3da;border-radius:8px;cursor:pointer;font-weight:bold;" +
        (primary ? "background:#205375;color:#fff;border:0" : "background:#fff");
      button.onclick = fn;
      foot.appendChild(button);
      return button;
    };
    const save = () => {
      const latest = GM_getValue(IELOVE_SUUMO_CHOICES_KEY, {});
      latest[index] = { ...modes, __companies:companies };
      GM_setValue(IELOVE_SUUMO_CHOICES_KEY, latest);
    };
    makeButton("← 前へ", false, () => {
      save();
      if (index > 0) navigateIeloveSuumo(-1);
    }).disabled = index === 0;
    makeButton(index === handoff.records.length - 1 ? "選択を終えて一括指摘へ" : "次へ →", true, () => {
      save();
      if (index < handoff.records.length - 1) navigateIeloveSuumo(1);
      else startIeloveSuumoReporting();
    });
    makeButton("閉じる",false, () => { save(); overlay.remove(); });
    updateButtons();
    shell.append(head,list,foot);
    overlay.appendChild(shell);
    document.body.appendChild(overlay);
  }

  function navigateIeloveSuumo(delta) {
    const handoff = getIeloveHandoff();
    if (!handoff) return;
    handoff.index = Math.max(0, Math.min((Number(handoff.index)||0)+delta, handoff.records.length - 1));
    GM_setValue(IELOVE_SUUMO_HANDOFF_KEY, handoff);
    location.href = handoff.searches[handoff.index].url;
  }


  const IELOVE_BATCH_EXECUTION_KEY = "ielove_suumo_execution_v1";
  function getIeloveExecution() {
    const state = GM_getValue(IELOVE_BATCH_EXECUTION_KEY, null);
    return state && Array.isArray(state.items) && state.items.length ? state : null;
  }
  function currentIeloveExecutionItem() {
    const state = getIeloveExecution();
    if (!state || !isBatchActive()) return null;
    const index = getBatchIndex();
    const item = state.items[index];
    const expected = getBatchUrls()[index];
    return item && item.url === expected ? item : null;
  }
  function activeIeloveProfile() {
    const item = currentIeloveExecutionItem();
    return item ? item.profile : null;
  }
  function validateIeloveProfile(profile) {
    if (!profile) return "対象物件の管理情報が見つかりません";
    const required = [["mgmt_company","管理会社名"],["mgmt_tel","管理会社TEL"],["manager2","管理会社担当者"],["room","号室"]];
    return required.filter(([key]) => !String(profile[key] || "").trim()).map(([,label]) => label).join("・");
  }
  function saveIeloveExecutionStatus(status) {
    const state = getIeloveExecution();
    if (!state || !isBatchActive()) return;
    const index = getBatchIndex();
    if (!state.items[index] || state.items[index].url !== getBatchUrls()[index]) return;
    state.items[index].status = status;
    state.items[index].updatedAt = Date.now();
    GM_setValue(IELOVE_BATCH_EXECUTION_KEY, state);
  }
  function ieloveFormMismatch(profile) {
    const mismatched = [];
    for (const [key,label] of [["mgmt_company","管理会社名"],["mgmt_tel","管理会社TEL"],["manager2","管理会社担当者"],["room","号室"]]) {
      const el = document.querySelector(FIELDS[key]);
      const actual = String(el?.value || "").trim();
      const expected = String(profile?.[key] || "").trim();
      if (!el || (key === "mgmt_tel" ? normalizePhone(actual) !== normalizePhone(expected) : actual !== expected)) mismatched.push(label);
    }
    return mismatched.join("・");
  }

  function blockUncertainIeloveResend() {
    const item = currentIeloveExecutionItem();
    if (!item || item.status !== "sending") return false;
    cancelAutoAction(false);
    setSubmitting(false);
    setBatchError(true);
    setFormReady(false);
    updateBatchPanel();
    toast("最終送信を開始済みです。送信結果を確認できるまで再送信しないでください。", 7500);
    return true;
  }

  function startIeloveSuumoReporting() {
    const handoff = getIeloveHandoff();
    if (!handoff || isBatchActive()) return;
    const saved = GM_getValue(IELOVE_SUUMO_CHOICES_KEY, {});
    const globalExclusions = new Set(GM_getValue(IELOVE_SUUMO_GLOBAL_EXCLUDES, []));
    const pending = [];
    const incomplete = [];
    const missingProfiles = [];
    for (let i = 0; i < handoff.records.length; i++) {
      const selection = saved[i];
      if (!selection || !Array.isArray(selection.__companies)) {
        incomplete.push(i + 1);
        continue;
      }
      const record = handoff.records[i];
      const profile = {
        mgmt_company: String(record.managementCompany || "").trim(),
        mgmt_tel: String(record.phone || "").normalize("NFKC").replace(/\D/g, ""),
        manager2: String(record.manager || "").trim(),
        room: String(record.room || "").replace(/（非公開）|\(非公開\)/g, "").trim()
      };
      const urls = [];
      for (const company of selection.__companies) {
        if (globalExclusions.has(company.key) || selection[company.key] === "once") continue;
        if (Array.isArray(company.urls)) urls.push(...company.urls);
      }
      if (urls.length && validateIeloveProfile(profile)) missingProfiles.push((i + 1) + "件目：" + validateIeloveProfile(profile));
      for (const url of [...new Set(urls)]) pending.push({ url, propertyIndex:i, name:record.name || "", profile, status:"pending" });
    }
    if (incomplete.length) {
      alert("まだ確認していない物件があります：" + incomplete.join("、") + "件目");
      return;
    }
    if (missingProfiles.length) {
      alert("物件ごとの申告情報が不足しています。いえらぶで修正してください。\n\n" + missingProfiles.join("\n"));
      return;
    }
    const unique = new Map();
    const conflicts = [];
    for (const item of pending) {
      const previous = unique.get(item.url);
      if (!previous) { unique.set(item.url, item); continue; }
      if (JSON.stringify(previous.profile) !== JSON.stringify(item.profile)) {
        conflicts.push(previous.propertyIndex + 1 + "件目と" + (item.propertyIndex + 1) + "件目");
      }
    }
    if (conflicts.length) {
      alert("同じSUUMO掲載に異なる物件情報が紐付いています。誤送信防止のため停止しました。\n" + [...new Set(conflicts)].join("\n"));
      return;
    }
    const items = [...unique.values()];
    if (!items.length) {
      alert("指摘対象がありません。選択内容を確認してください。");
      return;
    }
    if (!confirm(handoff.records.length + "物件から" + items.length + "掲載を指摘対象として選択しました。\n\n実際にSUUMOへ申告処理を開始しますか？")) return;
    GM_setValue(IELOVE_BATCH_EXECUTION_KEY, { items, startedAt:Date.now(), finishedAt:null });
    GM_deleteValue(IELOVE_SUUMO_HANDOFF_KEY);
    setBatch(items.map(item => item.url), 0, "ielove");
    location.href = items[0].url;
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

  async function init() {
    while (!document.body) await sleep(50);


    // いえらぶCLOUDでは設定ボタンだけ表示。
    // ここで保存した値は同じTampermonkeyスクリプトの保存領域を使うため、
    // SUUMO側の申告フォームでもそのまま利用できる。
    if (location.hostname === "cloud.ielove.jp") {
      addIeloveSettingsButton();
      return;
    }

    if (location.hostname !== "suumo.jp") return;

    addMainButtons();

    if (!isBatchActive() && isIeloveSuumoSearchPage() && getIeloveHandoff()) {
      await sleep(700);
      openIeloveSuumoSelection();
    }

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
