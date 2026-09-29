// ==UserScript==
// @name         SUUMO JJ 一括申告
// @namespace    jp.re.autofill.suumo
// @version      7.18
// @description  SUUMO一括申告＋いえらぶCLOUD設定入力。GitHub自動更新・2秒自動送信・折り畳み日付設定対応。
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
    formReady: "suumo_batch_form_ready"
  };

  const EXCLUDED_COMPANIES_KEY = "suumo_permanent_excluded_companies";
  const SCRIPT_VERSION = "7.18";
  const SCRIPT_URL = "https://raw.githubusercontent.com/Alpha0727/suumo-jj-tool/main/SUUMO.user.js";
  const VERSION_URL = "https://api.github.com/repos/Alpha0727/suumo-jj-tool/contents/latest.json?ref=main";

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
    const alertMark = document.getElementById("tm-update-alert");
    const button = document.getElementById("tm-update-button");
    if (!alertMark || !button) return;

    GM_xmlhttpRequest({
      method: "GET",
      url: VERSION_URL + "?t=" + Date.now(),
      headers: { "Cache-Control": "no-cache" },
      onload: response => {
        try {
          if (response.status < 200 || response.status >= 300) throw new Error("version check failed");
          const apiData = JSON.parse(response.responseText || "{}");
          const encoded = String(apiData.content || "").replace(/\\s/g, "");
          if (!encoded) throw new Error("version metadata missing");
          const binary = atob(encoded);
          const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
          const info = JSON.parse(new TextDecoder("utf-8").decode(bytes));
          const latest = String(info.version || "").trim();
          if (!latest || compareVersions(latest, SCRIPT_VERSION) <= 0) return;

          const notes = String(info.notes || "").trim();
          const installUrl = String(info.install_url || SCRIPT_URL).trim();
          alertMark.style.display = "inline-flex";
          alertMark.title = `現在：Ver.${SCRIPT_VERSION}\n最新版：Ver.${latest}${notes ? "\n\n" + notes : ""}`;
          button.style.display = "inline-block";
          button.title = `Ver.${latest} にアップデート`;
          button.dataset.latestVersion = latest;
          button.dataset.installUrl = installUrl;
        } catch (error) {
          console.warn("[SUUMO JJ] version check skipped:", error);
        }
      },
      onerror: error => console.warn("[SUUMO JJ] version check failed:", error)
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

  async function prepareReportForm() {
    // フォーム準備が完了するまでは送信ボタンを押せない状態にする。
    setFormReady(false);
    setConfirmReady(false);
    updateBatchPanel();

    toast("申告フォームを準備しています…");
    await sleep(500);

    const selected = await selectReportType();
    if (!selected) {
      setBatchError(true);
      setFormReady(false);
      updateBatchPanel();
      toast("申告内容の選択欄が見つかりませんでした", 4000);
      return;
    }

    await sleep(300);
    const count = await autofill(false);

    // 「申告フォームを準備しました ○項目入力」と出せる段階で初めて操作可能にする。
    setBatchError(false);
    setFormReady(true);
    setConfirmReady(false);
    updateBatchPanel();

    toast(`申告フォームを準備しました\n${count}項目入力`, 3000);
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

  function setBatch(urls, index = 0) {
    GM_setValue(BATCH_KEYS.urls, urls);
    GM_setValue(BATCH_KEYS.index, index);
    GM_setValue(BATCH_KEYS.active, true);
    setSubmitting(false);
    setConfirmReady(false);
    setBatchError(false);
    setFormReady(false);
  }

  function clearBatch() {
    GM_setValue(BATCH_KEYS.active, false);
    GM_setValue(BATCH_KEYS.index, 0);
    GM_setValue(BATCH_KEYS.urls, []);
    setSubmitting(false);
    setConfirmReady(false);
    setBatchError(false);
    setFormReady(false);
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

  function goToNextListing() {
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
      updateBatchPanel();
      return;
    }

    setConfirmReady(false);
    setSubmitting(true);
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
    if (!isBatchActive() || !isSubmitting()) return;
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
    sendLink.click();
  }

  async function handleCompletePage() {
    if (!isBatchActive() || !isSubmitting()) return;
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
  let autoActionTimer = null;
  let autoActionFrame = null;
  let autoActionPhase = null;
  let autoActionDeadline = 0;
  let autoActionCancelledPhase = null;

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
        position: "fixed", right: "16px", top: "16px", width: "340px",
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
      position: "fixed", right: "16px", bottom: "70px", width: "390px",
      maxWidth: "calc(100vw - 32px)", background: "#fff", border: "1px solid #ccc",
      borderRadius: "12px", padding: "14px", zIndex: "2147483647",
      boxShadow: "0 5px 18px rgba(0,0,0,.25)"
    });

    panel.innerHTML = `
      <div style="font-weight:bold;font-size:17px;margin-bottom:10px;">入力設定</div>
      <details id="tm-basic-settings" style="background:#f5f5f5;border-radius:8px;margin-bottom:12px;">
        <summary style="padding:10px;font-weight:bold;cursor:pointer;user-select:none;">基本設定</summary>
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

      <details id="tm-date-settings" style="background:#f5f5f5;border-radius:8px;margin-bottom:12px;">
        <summary style="padding:10px;font-weight:bold;cursor:pointer;user-select:none;">日付設定</summary>
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
      <button id="tm-save-setting" style="padding:8px 15px;cursor:pointer;">保存</button>
      <button id="tm-close-setting" style="padding:8px 15px;margin-left:6px;cursor:pointer;">閉じる</button>
      <div id="tm-version-row" style="margin-top:12px;min-height:26px;display:flex;align-items:center;justify-content:flex-end;gap:7px;font-size:11px;color:#b5b5b5;">
        <span id="tm-version-status">Ver.${SCRIPT_VERSION}</span>
        <span id="tm-update-alert" style="display:none;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#f0a000;color:#fff;font-weight:bold;font-size:12px;cursor:help;">!</span>
        <button id="tm-update-button" type="button" style="display:none;padding:5px 9px;border:0;border-radius:6px;background:#2f7cf6;color:#fff;font-size:11px;font-weight:bold;cursor:pointer;">アップデート</button>
      </div>`;

    document.body.appendChild(panel);

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

    document.getElementById("tm-save-setting").onclick = () => {
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
    document.getElementById("tm-update-button").onclick = event => {
      const latest = event.currentTarget.dataset.latestVersion || String(Date.now());
      const installUrl = event.currentTarget.dataset.installUrl || SCRIPT_URL;
      const separator = installUrl.includes("?") ? "&" : "?";
      window.open(installUrl + separator + "install=" + encodeURIComponent(latest) + "&t=" + Date.now(), "_blank", "noopener,noreferrer");
    };
    updateHalfWidthWarning();
    checkScriptUpdate();
  }

  function addMainButtons() {
    if (document.getElementById("tm-main-buttons")) return;

    const box = document.createElement("div");
    box.id = "tm-main-buttons";
    Object.assign(box.style, {
      position: "fixed", right: "16px", bottom: "16px",
      zIndex: "2147483646", display: "flex", gap: "7px"
    });

    const batch = document.createElement("button");
    batch.textContent = "一括処理";
    Object.assign(batch.style, {
      padding: "10px 14px", border: "none", borderRadius: "10px",
      background: "#e66b00", color: "#fff", fontWeight: "bold", cursor: "pointer"
    });
    batch.onclick = openCompanySelection;

    const settings = document.createElement("button");
    settings.textContent = "設定";
    Object.assign(settings.style, {
      padding: "10px 14px", border: "none", borderRadius: "10px",
      background: "#666", color: "#fff", cursor: "pointer"
    });
    settings.onclick = openSettings;

    const fill = document.createElement("button");
    fill.textContent = "一括入力";
    Object.assign(fill.style, {
      padding: "10px 14px", border: "none", borderRadius: "10px",
      background: "#2f7cf6", color: "#fff", fontWeight: "bold", cursor: "pointer"
    });
    fill.onclick = async () => {
      if (document.querySelector("#js-selectGosinkoku")) await selectReportType();
      await autofill();
    };

    box.appendChild(batch);
    box.appendChild(settings);
    box.appendChild(fill);
    document.body.appendChild(box);
  }


  function addIeloveSettingsButton() {
    if (document.getElementById("tm-ielove-settings")) return;

    const settings = document.createElement("button");
    settings.id = "tm-ielove-settings";
    settings.textContent = "設定";

    Object.assign(settings.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "2147483646",
      padding: "11px 18px",
      border: "none",
      borderRadius: "10px",
      background: "#666",
      color: "#fff",
      fontSize: "14px",
      fontWeight: "bold",
      cursor: "pointer",
      boxShadow: "0 3px 12px rgba(0,0,0,.22)"
    });

    settings.onclick = openSettings;
    document.body.appendChild(settings);
  }

  // Chromeがバックグラウンドタブを間引いた・休止した場合の復帰処理。
  // 復帰時に保存済みの実行期限を確認し、期限超過ならその場で続きを実行する。
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      updateBatchPanel();
      recoverAutoActionIfDue();
    }
  });
  window.addEventListener("focus", () => {
    updateBatchPanel();
    recoverAutoActionIfDue();
  });
  window.addEventListener("pageshow", () => {
    updateBatchPanel();
    recoverAutoActionIfDue();
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

    if (!isBatchActive()) return;
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
