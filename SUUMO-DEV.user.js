// ==UserScript==
// @name         SUUMO JJ 一括申告 上位版
// @namespace    jp.re.autofill.suumo.dev
// @version      8.0
// @description  いえらぶCLOUD連携・複数物件の一括指摘に対応する上位版。一般配布版とは独立して更新。
// @match        https://suumo.jp/*
// @match        https://cloud.ielove.jp/rent
// @match        https://cloud.ielove.jp/rent/*
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
  const BATCH_SKIP_LOG_KEY = "suumo_batch_skip_log_v1";
  const ISSUE_LOG_KEY = "suumo_advanced_issue_log_v1";
  const REPORT_RETRY_KEY = "suumo_advanced_report_retry_v1";
  const FINAL_SEND_GUARD_KEY = "suumo_advanced_final_send_guard_v1";
  // Web Locks + same-origin durable claim: never depend on a non-atomic GM read/write as a mutex.
  const SEND_LOCK_NAME = "suumo-jj-advanced-final-send";
  const SEND_CLAIM_STORAGE_KEY = "suumo_jj_advanced_final_send_claim_v1";
  const UNKNOWN_SEND_TIMEOUT_MS = 60000;
  const TAB_ITEM_CONTEXT_KEY = "suumo_advanced_tab_item_context_v1";
  const TAB_SENT_CONTEXT_KEY = "suumo_advanced_tab_sent_context_v1";
  const TAB_UNCERTAIN_SEND_KEY = "suumo_advanced_unresolved_send_tab_v1";
  const PAGE_HISTORY_STATE_KEY = "__suumoJjAdvancedPageContext";
  const PAGE_NAV_TICKET_KEY = "suumo_advanced_page_transition_v1";
  const PAGE_ACTIVE_ENTRY_KEY = "suumo_advanced_active_history_entry_v1";
  const PAGE_TICKET_MAX_AGE_MS = 90000;
  const RETRY_WAIT_MS = 500;
  const MAX_STAGE_ATTEMPTS = 3;

  const STAGES = Object.freeze({
    LISTING: "listing",
    INPUT_PREPARING: "input-preparing",
    INPUT_READY: "input-ready",
    INPUT_CONFIRM: "input-confirm",
    SUBMITTING_CONFIRM: "submitting-confirm",
    SUBMITTING_FINAL: "submitting-final",
    COMPLETE: "complete",
    SEND_UNCERTAIN: "send-uncertain"
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

  // The batch's shared index is NOT proof of which listing created this tab's page.
  // Only the matching listing URL may establish a tab-local item context.
  // It then survives listing -> form -> confirmation -> completion via sessionStorage.
  function readTabContext(key){
    try{return JSON.parse(sessionStorage.getItem(key)||"null");}catch(_){return null;}
  }
  function saveTabContext(key,value){
    try{
      sessionStorage.setItem(key,JSON.stringify(value));
      return true;
    }catch(_){return false;}
  }
  function forgetTabContexts(){
    try{
      sessionStorage.removeItem(TAB_ITEM_CONTEXT_KEY);
      sessionStorage.removeItem(TAB_SENT_CONTEXT_KEY);
      sessionStorage.removeItem(PAGE_NAV_TICKET_KEY);
      sessionStorage.removeItem(PAGE_ACTIVE_ENTRY_KEY);
    }catch(_){}
  }
  function currentBatchIdentity(){
    if(!isBatchOwnerTab() || !GM_getValue(BATCH_KEYS.active,false))return null;
    const index=Number(GM_getValue(BATCH_KEYS.index,0))||0;
    const urls=GM_getValue(BATCH_KEYS.urls,[]);
    const ownerToken=GM_getValue(BATCH_KEYS.ownerToken,"");
    const url=Array.isArray(urls)?urls[index]:null;
    return url&&ownerToken?{ownerToken,index,url}:null;
  }
  function matchesBatchIdentity(ctx){
    const now=currentBatchIdentity();
    return !!now&&!!ctx&&ctx.ownerToken===now.ownerToken&&
      ctx.index===now.index&&ctx.url===now.url&&!!ctx.id;
  }
  // Delayed navigation belongs to the batch, item and document that scheduled it.
  function captureBatchTask(){
    const identity=currentBatchIdentity(),item=readTabContext(TAB_ITEM_CONTEXT_KEY);
    return identity&&item?{...identity,itemId:item.id,pageUrl:location.href,entryId:pageStamp()?.entryId||""}:null;
  }
  function batchTaskStillCurrent(task){
    const identity=currentBatchIdentity(),item=readTabContext(TAB_ITEM_CONTEXT_KEY);
    return !!task&&!!identity&&task.ownerToken===identity.ownerToken&&
      task.index===identity.index&&task.url===identity.url&&task.itemId===item?.id&&
      task.pageUrl===location.href&&task.entryId===(pageStamp()?.entryId||"");
  }
  function currentPageKind(){
    if(/^\/chintai\/bc_/i.test(location.pathname))return "listing";
    if(location.pathname.includes("/jj/chintai/shiryou/FR400FG001/"))return "input";
    if(location.pathname.includes("/jj/chintai/shiryou/FR400FG002/"))return "confirm";
    if(location.pathname.includes("/jj/chintai/shiryou/FR400FG003/"))return "complete";
    // SUUMO may redirect a removed listing to a non-listing information page.
    if(getBatchStage()===STAGES.LISTING && isConfirmedListingEndedPage())return "expired";
    return "";
  }
  function pageStamp(){
    const h=history.state;
    return h&&typeof h==="object"&&!Array.isArray(h)?h[PAGE_HISTORY_STATE_KEY]||null:null;
  }
  function stampPageContext(ctx,kind,sendId=""){
    try{
      if(pageStamp())return false; // Never overwrite an existing history entry.
      const base=history.state&&typeof history.state==="object"&&!Array.isArray(history.state)?history.state:{};
      const entryId=createBatchOwnerToken();
      history.replaceState({...base,[PAGE_HISTORY_STATE_KEY]:{
        ownerToken:ctx.ownerToken,index:ctx.index,url:ctx.url,itemId:ctx.id,
        kind,sendId,entryId
      }},"",location.href);
      sessionStorage.setItem(PAGE_ACTIVE_ENTRY_KEY,entryId);
      return true;
    }catch(e){
      console.warn("[SUUMO JJ 上位版] 履歴識別情報の保存不可",e);
      return false;
    }
  }
  function queuePageTransition(kind,sendId=""){
    const ctx=readTabContext(TAB_ITEM_CONTEXT_KEY);
    if(!matchesBatchIdentity(ctx))return false;
    try{
      sessionStorage.setItem(PAGE_NAV_TICKET_KEY,JSON.stringify({
        ownerToken:ctx.ownerToken,index:ctx.index,url:ctx.url,itemId:ctx.id,
        kind,sendId,at:Date.now()
      }));
      return true;
    }catch(_){return false;}
  }
  function acceptPendingPageContext(kind){
    if(pageStamp())return false;
    const ctx=readTabContext(TAB_ITEM_CONTEXT_KEY);
    if(!matchesBatchIdentity(ctx))return false;
    let ticket=null;
    try{ticket=JSON.parse(sessionStorage.getItem(PAGE_NAV_TICKET_KEY)||"null");}catch(_){}
    if(!ticket)return false;
    const age=Date.now()-Number(ticket.at);
    // An unresolved POST may finish after the ordinary navigation-ticket TTL.
    // Its exact persisted send ID is still required below and by isCurrentTabSent().
    if(!Number.isFinite(age)||age<0||(kind!=="complete"&&age>PAGE_TICKET_MAX_AGE_MS))return false;
    if(ticket.kind!==kind && !(ticket.kind==="listing"&&kind==="expired"))return false;
    if(ticket.ownerToken!==ctx.ownerToken||ticket.index!==ctx.index||
       ticket.url!==ctx.url||ticket.itemId!==ctx.id)return false;
    if(kind==="complete"){
      const guard=GM_getValue(FINAL_SEND_GUARD_KEY,null);
      if(!ticket.sendId||ticket.sendId!==guard?.id||guard?.status!=="sending")return false;
    }
    const nav=performance.getEntriesByType?.("navigation")?.[0]?.type||"";
    if(nav==="back_forward")return false;
    if(!stampPageContext(ctx,kind,ticket.sendId||""))return false;
    try{sessionStorage.removeItem(PAGE_NAV_TICKET_KEY);}catch(_){}
    return true;
  }
  function isCurrentTabItem(){
    const ctx=readTabContext(TAB_ITEM_CONTEXT_KEY);
    if(!matchesBatchIdentity(ctx))return false;
    const kind=currentPageKind();
    if(!kind)return false;
    // Each history entry retains its own immutable item ID. Moving backward to an
    // old page cannot borrow the currently active item ID from sessionStorage.
    let stamp=pageStamp();
    if(!stamp){
      if(!acceptPendingPageContext(kind))return false;
      stamp=pageStamp();
    }
    let activeEntry="";
    try{activeEntry=sessionStorage.getItem(PAGE_ACTIVE_ENTRY_KEY)||"";}catch(_){}
    return !!activeEntry&&stamp?.entryId===activeEntry&&
      stamp?.ownerToken===ctx.ownerToken&&stamp?.index===ctx.index&&
      stamp?.url===ctx.url&&stamp?.itemId===ctx.id&&stamp?.kind===kind;
  }
  function primeCurrentTabItem(){
    const current=currentBatchIdentity();
    if(!current)return false;
    const fresh={...current,id:createBatchOwnerToken(),boundAt:Date.now()};
    if(!saveTabContext(TAB_ITEM_CONTEXT_KEY,fresh))return false;
    try{
      sessionStorage.removeItem(TAB_SENT_CONTEXT_KEY);
      sessionStorage.removeItem(PAGE_NAV_TICKET_KEY);
      sessionStorage.removeItem(PAGE_ACTIVE_ENTRY_KEY);
    }catch(_){}
    return true;
  }
  function bindListingToTab(){
    if(!isListingPage())return false;
    const current=currentBatchIdentity();
    if(!current)return false;
    const from=String(location.pathname.match(/\/chintai\/bc_(\d+)/i)?.[1]||"");
    const expected=String(current.url.match(/\/chintai\/bc_(\d+)/i)?.[1]||"");
    if(!from||from!==expected)return false;
    return isCurrentTabItem(); // Never adopt an untagged or stale listing without a ticket.
  }

  function isCurrentTabSent(){
    const ctx=readTabContext(TAB_SENT_CONTEXT_KEY),item=readTabContext(TAB_ITEM_CONTEXT_KEY);
    const guard=GM_getValue(FINAL_SEND_GUARD_KEY,null);
    return isCurrentTabItem()&&ctx?.itemId===item?.id&&
      ctx?.id&&ctx.id===guard?.id&&
      (pageStamp()?.kind!=="complete"||pageStamp()?.sendId===ctx.id)&&
      ctx.index===guard.index&&
      ctx.url===guard.url&&ctx.ownerToken===guard.ownerToken&&
      guard.status==="sending";
  }
  function rejectStaleTabPage(){
    // Never touch shared status or index from an older tab.
    toast("安全停止：この画面は現在処理中の掲載と対応していません。元の一括処理タブで確認してください。",9000);
    console.warn("[SUUMO JJ 上位版] 古い画面の実行を拒否",location.pathname);
    return false;
  }

  const EXCLUDED_COMPANIES_KEY = "suumo_permanent_excluded_companies";
  const SCRIPT_VERSION = "8.0";
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

  // The form's dynamic DOM can mutate very often. Coalesce checks rather than
  // scanning the document on every mutation, while retaining the safety timeout.
  function waitForReadyElement(selector, timeoutMs = 8000, predicate = null) {
    const ready = () => {
      const el = document.querySelector(selector);
      return el && (!predicate || predicate(el)) ? el : null;
    };
    const immediate = ready();
    if (immediate) return Promise.resolve(immediate);
    return new Promise(resolve => {
      let done = false;
      let observer;
      let timeoutTimer;
      let pendingCheckTimer = null;
      const finish = el => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(timeoutTimer);
        if (pendingCheckTimer !== null) clearTimeout(pendingCheckTimer);
        resolve(el);
      };
      const inspect = () => {
        pendingCheckTimer = null;
        if (done) return;
        const el = ready();
        if (el) finish(el);
      };
      observer = new MutationObserver(() => {
        // At most one DOM query per 30ms, even during intensive page updates.
        if (done || pendingCheckTimer !== null) return;
        pendingCheckTimer = setTimeout(inspect, 30);
      });
      // Attribute changes are needed only for the visibility/editability predicate.
      // The childList observer is retained for dynamically inserted form fields.
      observer.observe(document.documentElement, predicate
        ? {childList:true,subtree:true,attributes:true,attributeFilter:["style","class","disabled","hidden","readonly"]}
        : {childList:true,subtree:true});
      timeoutTimer = setTimeout(() => finish(null), timeoutMs);
      inspect(); // Close the gap between the initial check and observer setup.
    });
  }

  async function setValue(el, value) {
    if (!el || value == null || String(value).trim() === "" || !isVisibleEditable(el)) return false;
    try {
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
    const select = await waitForReadyElement("#js-selectGosinkoku", 8000);
    if (!select) return false;
    setNative(select, "1");
    const radio = await waitForReadyElement("#tashaKanri", 5000);
    if (!radio) return false;
    radio.checked = true;
    try { radio.dispatchEvent(new Event("input", { bubbles: true })); } catch {}
    try { radio.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
    try { radio.dispatchEvent(new Event("click", { bubbles: true })); } catch {}
    return !!(await waitForReadyElement(FIELDS.mgmt_company, 5000, isVisibleEditable));
  }

  // 日付入力で開いたカレンダーを閉じる（入力値や日付設定は変更しない）。
  function closeSuumoDateCalendar() {
    const active = document.activeElement;
    if (active && ["textSinkokuDate", "textSeiyakuDate", "textSinkokuKaisyaKakuninDate"].includes(active.id)) {
      active.blur();
    }
    try {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    } catch (_) {}
    for (const selector of ["#ui-datepicker-div", ".ui-datepicker", ".datepicker-dropdown", ".flatpickr-calendar.open"]) {
      document.querySelectorAll(selector).forEach(calendar => {
        if (calendar.classList.contains("flatpickr-calendar")) calendar.classList.remove("open");
        else calendar.style.display = "none";
      });
    }
  }

  async function autofill(showToast = true) {
    if (!requireProfileManager()) return 0;

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
    // カレンダーの表示処理が後から走る場合にも閉じる。
    closeSuumoDateCalendar();
    requestAnimationFrame(closeSuumoDateCalendar);

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
    if (!isBatchActive() || !isInputPage()) return false;
    return !!(await waitForReadyElement("#js-selectGosinkoku", timeoutMs));
  }

  async function prepareReportForm(forceRetry = false) {
    if (!isBatchActive() || !isInputPage()) return false;
    if(!isCurrentTabItem())return rejectStaleTabPage();
    if (!requireProfileManager()) return false;
    if (formPreparationRunning) return false;
    if (isFormReady()) return true;
    if (isBatchError() && !forceRetry) return false;

    const attempts = Number(GM_getValue(FORM_PREP_ATTEMPTS_KEY, 0)) || 0;
    if (attempts >= FORM_PREP_MAX_ATTEMPTS) {
      recordIssue({phase:"申告：フォーム準備",index:getBatchIndex()+1,kind:"フォーム取得・入力失敗",
        action:"3回試行後スキップ",attempts,
        detail:"フォーム準備の最大試行回数に到達",url:getBatchUrls()[getBatchIndex()]});
      advancePastSkippedListing("申告フォーム準備失敗");
      return false;
    }

    const preparationStarted = performance.now();
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

      if (!isBatchActive() || !isInputPage()) return false;
      const currentProfile = activeIeloveProfile();
      if (getIeloveExecution() && !currentIeloveExecutionItem()) throw new Error("物件ごとの申告情報と掲載URLが一致しません");
      if (currentProfile && validateIeloveProfile(currentProfile)) throw new Error("必要項目が不足：" + validateIeloveProfile(currentProfile));
      markAdvancedTiming("form-fill-start");
      const fillStarted = performance.now();
      const count = await autofill(false);
      console.info("[SUUMO JJ 上位版] 自動入力:", Math.round(performance.now() - fillStarted) + "ms");
      markAdvancedTiming("form-fill-complete", count + "項目");
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
        await sleep(RETRY_WAIT_MS);
        formPreparationRunning = false;
        return await prepareReportForm(true);
      }

      setBatchError(false);
      setFormReady(false);
      recordIssue({phase:"申告：フォーム準備",index:getBatchIndex()+1,kind:"フォーム取得・入力失敗",
        action:"3回試行後スキップ",attempts:used,
        detail:String(error?.message||error),url:getBatchUrls()[getBatchIndex()]});
      advancePastSkippedListing("申告フォーム準備失敗");
      return false;
    } finally {
      advancedMetric("report-form", preparationStarted, {ready:isFormReady()});
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

  function setBatch(urls, index = 0, source = "regular") {
    // A previous POST can still navigate this tab after a timeout.
    // Quarantine this browser tab even if the operator stopped the old batch.
    let sameTabHasUnresolvedPost=true;
    try{sameTabHasUnresolvedPost=sessionStorage.getItem(TAB_UNCERTAIN_SEND_KEY)==="1";}catch(_){}
    const unresolvedPost=GM_getValue(FINAL_SEND_GUARD_KEY,null);
    if(sameTabHasUnresolvedPost||unresolvedPost?.status==="sending"){
      toast("安全停止：結果未確認の送信があるため、新しい一括処理は開始しません。\n元の申告タブを保持し、SUUMOの受信状況を確認してください。",11000);
      return false;
    }
    if (!requireProfileManager()) return false;
    if (source !== "ielove") {
      GM_deleteValue(IELOVE_BATCH_EXECUTION_KEY);
      GM_setValue(ISSUE_LOG_KEY, []);
    }
    GM_deleteValue(REPORT_RETRY_KEY);
    GM_deleteValue(FINAL_SEND_GUARD_KEY);
    forgetTabContexts();
    try { sessionStorage.removeItem(FAST_REPORT_NAV_KEY); } catch (_) {}
    const ownerToken = createBatchOwnerToken();
    setTabOwnerToken(ownerToken);
    GM_setValue(BATCH_KEYS.ownerToken, ownerToken);
    GM_setValue(BATCH_KEYS.urls, urls);
    GM_setValue(BATCH_KEYS.index, index);
    GM_setValue(BATCH_KEYS.active, true);
    GM_setValue(BATCH_SKIP_LOG_KEY, []);
    setBatchStage(STAGES.LISTING);
    setSubmitting(false);
    setConfirmReady(false);
    setBatchError(false);
    setFormReady(false);
    GM_deleteValue(FORM_PREP_ATTEMPTS_KEY);
    if(!primeCurrentTabItem()||!queuePageTransition("listing")){
      clearBatch();
      toast("一括処理のタブ識別情報を保存できません。送信を開始しません。",8500);
      return false;
    }
    return true;
  }

  function clearBatch() {
    GM_setValue(BATCH_KEYS.active, false);
    GM_setValue(BATCH_KEYS.index, 0);
    GM_setValue(BATCH_KEYS.urls, []);
    GM_deleteValue(BATCH_KEYS.ownerToken);
    GM_deleteValue(BATCH_KEYS.stage);
    clearTabOwnerToken();
    forgetTabContexts();
    try { sessionStorage.removeItem(FAST_REPORT_NAV_KEY); } catch (_) {}
    setSubmitting(false);
    setConfirmReady(false);
    setBatchError(false);
    setFormReady(false);
    GM_deleteValue(FORM_PREP_ATTEMPTS_KEY);
    GM_deleteValue(REPORT_RETRY_KEY);
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


  // エラー診断だけを保存する。会社名・入力値・認証情報はログへ含めない。
  function issueList(){
    const rows=GM_getValue(ISSUE_LOG_KEY,[]);
    return Array.isArray(rows)?rows:[];
  }
  // Shared report only accepts generic diagnoses, never raw exception values/PII/tokens.
  function safeIssueDetail(value){
    const msg=String(value||"");
    const http=msg.match(/\bHTTP\s+(40[0-9]|42[0-9]|5[0-9]{2})\b/);
    if(http)return "SUUMOページ取得時にHTTP "+http[1]+"が発生しました";
    if(/掲載終了|掲載が終了/.test(msg))return "SUUMO上で掲載終了を確認しました";
    if(/(?:検索結果|賃貸).*0件|物件がありません/.test(msg))return "検索結果の掲載件数が0件でした";
    if(/住戸条件|一致する掲載/.test(msg))return "指定した住戸条件に一致する掲載がありません";
    if(/最終送信ボタン|送信ボタン/.test(msg))return "SUUMOの最終送信ボタンを取得できませんでした";
    if(/最終送信|送信後|送信結果|完了画面/.test(msg))return "送信結果を確認できませんでした（自動再送信なし）";
    if(/入力結果|管理会社情報|プロファイル|必要項目/.test(msg))return "フォーム入力値と必要項目の照合に失敗しました";
    if(/確認画面|内容確認/.test(msg))return "SUUMOの内容確認画面に進めませんでした";
    if(/申告フォーム|DOM待機|フォーム準備/.test(msg))return "申告フォームの読込・準備に失敗しました";
    if(/申告リンク|掲載リンク/.test(msg))return "掲載ページから申告リンクを取得できませんでした";
    if(/タイムアウト|timeout|AbortError/i.test(msg))return "画面・通信の待機時間を超過しました";
    if(/通信|network|fetch|接続|読み込|取得|HTML/i.test(msg))return "ページ・通信の取得に失敗しました";
    // Any unknown text could be a name, room, tenant or credential.
    return "詳細は共有用ログから省略しました（元の診断は端末のコンソールで確認）";
  }

  function publicListingUrl(value){
    const m=String(value||"").match(/^https:\/\/suumo\.jp\/chintai\/bc_(\d+)\/?/i);
    return m?"https://suumo.jp/chintai/bc_"+m[1]+"/":"";
  }
  function recordIssue({phase="申告",index=0,kind="処理エラー",action="スキップ",detail="",attempts=0,url=""}){
    const id=String(phase)+":"+String(index);
    const item={id,phase:String(phase),index:Number(index)||0,kind:String(kind),
      action:String(action),detail:safeIssueDetail(detail),attempts:Number(attempts)||0,
      url:publicListingUrl(url),at:new Date().toISOString(),version:SCRIPT_VERSION};
    const rows=issueList().filter(row=>row.id!==id);
    rows.push(item);
    GM_setValue(ISSUE_LOG_KEY,rows.slice(-300));
    console.warn("[SUUMO JJ 上位版] 問題記録",item);
  }
  function safeIssuePhase(value){
    const v=String(value||"");
    if(v==="検索"||v==="最終送信"||v==="申告")return v;
    return /^申告：(掲載確認|フォーム準備|内容確認へ移動|掲載リンク取得|最終送信ボタン取得)$/.test(v)?v:"申告";
  }
  function safeIssueCategory(value){
    const known=["検索結果0件","住戸条件一致0件・掲載会社0件","検索・会社情報取得失敗",
      "処理失敗","フォーム取得・入力失敗","送信結果不明","掲載終了",
      "送信安全機構の使用不可"];
    return known.includes(String(value))?String(value):"処理エラー";
  }
  function safeIssueAction(value){
    const known=["即時自動スキップ","再検索せず自動スキップ","最大3回試行後スキップ",
      "3回試行後スキップ","自動スキップ","要確認・自動再送信せず次へ",
      "自動送信停止・要確認","結果確認まで自動進行停止","スキップ","要確認"];
    return known.includes(String(value))?String(value):"要確認";
  }
  function validIssueDate(value){
    // Strict ISO UTC input only; never copy arbitrary suffixes from old logs.
    const v=String(value||"");
    if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v))return "日時不明";
    const parsed=new Date(v);
    return Number.isFinite(parsed.getTime())&&parsed.toISOString()===v?v:"日時不明";
  }
  function formatIssueReport(rows){
    return ["【SUUMO JJ 上位版 エラー報告】","バージョン："+SCRIPT_VERSION,
      "問題件数："+rows.length+"件","※詳細欄は固定の診断文のみ。任意の入力値や認証情報は含みません。",
      "※送信結果不明の掲載は自動再送信していません。",
      ...rows.flatMap((item,i)=>[
        "","━━━━━━━━━━━━━━━━","【問題 "+(i+1)+"】",
        "工程："+safeIssuePhase(item.phase),
        "対象："+(Math.max(0,Number(item.index)||0))+"件目",
        "種類："+(safeIssueCategory(item.kind)||"処理エラー"),
        "対応："+(safeIssueAction(item.action)||"要確認"),
        "試行回数："+(Math.max(0,Number(item.attempts)||0)),
        "発生日時："+(validIssueDate(item.at)),
        ...(publicListingUrl(item.url)?["掲載URL："+publicListingUrl(item.url)]:[]),
        "詳細："+safeIssueDetail(item.detail)
      ])].join("\n");
  }
  function openIssueResults(){
    document.getElementById("tm-advanced-issue-results")?.remove();
    const rows=issueList();
    if(!rows.length)return false;
    const overlay=document.createElement("div");
    overlay.id="tm-advanced-issue-results";
    overlay.style.cssText="position:fixed;inset:0;background:#0008;z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:sans-serif";
    const panel=document.createElement("section");
    panel.style.cssText="background:white;color:#202735;border-radius:14px;padding:22px;width:650px;max-width:93vw;max-height:85vh;overflow:auto;box-shadow:0 10px 40px #0005";
    const title=document.createElement("h2");
    title.textContent="処理結果：問題のあった掲載 "+rows.length+"件";
    title.style.cssText="font-size:19px;margin:0 0 10px";
    panel.appendChild(title);
    for(const [i,item] of rows.entries()){
      const row=document.createElement("div");
      row.style.cssText="border-top:1px solid #e1e5ec;padding:12px 0;font-size:13px;white-space:pre-line;overflow-wrap:anywhere";
      row.textContent=(i+1)+". "+safeIssuePhase(item.phase)+" "+Number(item.index)+"件目｜"+safeIssueCategory(item.kind)+
        "\n"+safeIssueAction(item.action)+"｜試行 "+(Math.max(0,Number(item.attempts)||0))+"回"+
        (publicListingUrl(item.url)?"\n"+publicListingUrl(item.url):"")+"\n"+safeIssueDetail(item.detail);
      panel.appendChild(row);
    }
    const actions=document.createElement("div");
    actions.style.cssText="display:flex;gap:8px;margin-top:15px";
    const copy=document.createElement("button");
    copy.textContent="エラー内容をコピー";
    copy.style.cssText="flex:1;padding:12px;color:white;background:#205375;border:0;border-radius:8px;font-weight:bold;cursor:pointer";
    copy.onclick=async()=>{
      const text=formatIssueReport(issueList());
      try{
        if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);
        else{
          const ta=document.createElement("textarea");ta.value=text;document.body.appendChild(ta);
          ta.select();const ok=document.execCommand("copy");ta.remove();
          if(!ok)throw new Error("コピー失敗");
        }
        copy.textContent="コピーしました ✓";
      }catch(error){copy.textContent="コピーできませんでした";console.warn("コピー失敗",error);}
    };
    const close=document.createElement("button");
    close.textContent="閉じる";
    close.style.cssText="padding:12px 17px;border:1px solid #bcc5cf;border-radius:8px;background:#fff;cursor:pointer";
    close.onclick=()=>overlay.remove();
    actions.append(copy,close);panel.appendChild(actions);overlay.appendChild(panel);
    document.body.appendChild(overlay);
    return true;
  }
  function showBatchIssueResults(){
    openIssueResults(); // 成功だけの処理では結果ウィンドウを出さない。
  }
  function clearReportRetry(phase){
    const state=GM_getValue(REPORT_RETRY_KEY,null);
    if(phase && state?.phase===phase)GM_deleteValue(REPORT_RETRY_KEY);
    // Phase is required. Clear all retries only after the listing is definitively complete,
    // skipped, or a brand-new batch starts.
  }
  // 送信前だけ自動再試行する。確認結果が不明なPOSTは絶対に再送信しない。
  function scheduleReportRetry(phase,message){
    if(!isBatchActive()||!isCurrentTabItem()||nextListingStarted)return false;
    const index=getBatchIndex(),url=getBatchUrls()[index],item=currentIeloveExecutionItem();
    if(!url||(getIeloveExecution()&&!item)||item?.status==="sending"||currentUncertainSend())return false;
    const prev=GM_getValue(REPORT_RETRY_KEY,null);
    const same=prev?.index===index&&prev?.url===url&&prev?.phase===phase;
    const attempts=(same?Number(prev.attempts)||0:0)+1;
    if(attempts>=MAX_STAGE_ATTEMPTS){
      recordIssue({phase:"申告："+phase,index:index+1,kind:"処理失敗",
        action:"3回試行後スキップ",detail:message,attempts,url});
      GM_deleteValue(REPORT_RETRY_KEY);
      setSubmitting(false);setBatchError(false);setFormReady(false);
      return advancePastSkippedListing("処理失敗："+phase);
    }
    GM_setValue(REPORT_RETRY_KEY,{index,url,phase,attempts});
    setSubmitting(false);setConfirmReady(false);setBatchError(false);setFormReady(false);
    setBatchStage(STAGES.LISTING);
    toast(phase+"の処理失敗（"+attempts+"/3回目）\n0.5秒後に再試行します",2500);
    const task=captureBatchTask();
    setTimeout(()=>{
      if(!batchTaskStillCurrent(task))return;
      if(!queuePageTransition("listing"))return;
      location.href=url;
    },RETRY_WAIT_MS);
    return true;
  }
  function currentUncertainSend(){
    if(!isBatchActive())return false;
    const record=GM_getValue(FINAL_SEND_GUARD_KEY,null),index=getBatchIndex();
    return record?.status==="sending"&&record.index===index&&record.url===getBatchUrls()[index];
  }
  // A timed-out POST is not a failed POST. Never send a second listing in this
  // tab while a delayed completion from the first could still arrive.
  function advanceUncertainSubmission(detail){
    if(!isCurrentTabSent()||getBatchStage()===STAGES.SEND_UNCERTAIN)return false;
    const item=currentIeloveExecutionItem();
    if((item?.status!=="sending"&&!currentUncertainSend())||nextListingStarted)return false;
    recordIssue({phase:"最終送信",index:getBatchIndex()+1,kind:"送信結果不明",
      action:"結果確認まで自動進行停止",detail,attempts:1,url:getBatchUrls()[getBatchIndex()]});
    // Do not let a later batch reuse this same tab while the old POST may finish.
    try{sessionStorage.setItem(TAB_UNCERTAIN_SEND_KEY,"1");}catch(_){}
    setBatchStage(STAGES.SEND_UNCERTAIN);
    setSubmitting(false);
    setConfirmReady(false);
    setBatchError(true);
    cancelAutoAction(false);
    saveIeloveExecutionStatus("uncertain");
    updateBatchPanel();
    toast("安全停止：最終送信の結果が確認できません。\n前の物件の完了画面を次の物件と誤認しないため、一括処理を停止しています。\n二重送信を避け、SUUMOの受信状況を確認してください。",11000);
    return true;
  }

  // Ver.8.0: only skip the visual LISTING document when its actual link proves
  // a same-origin, listing-specific GET form URL. Never synthesize a form URL.
  // The first displayed listing is used as a capability probe; unsupported SUUMO
  // link layouts keep the exact legacy navigation path without an extra fetch.
  const FAST_REPORT_NAV_KEY = "suumo_advanced_fast_report_navigation_v8";
  function directReportInputUrlFromListingDoc(doc, listingUrl) {
    try {
      const listing = new URL(listingUrl, location.origin);
      const match = listing.pathname.match(/^\/chintai\/bc_(\d+)\/?$/i);
      if (listing.origin !== location.origin || !match) return null;
      const link = doc.querySelector("#js-bknToiawaseFr");
      if (!link || String(link.tagName).toUpperCase() !== "A" ||
          link.hasAttribute("onclick") || link.hasAttribute("target")) return null;
      const raw = String(link.getAttribute("href") || "").trim();
      if (!raw || raw.startsWith("#") || /^javascript:/i.test(raw)) return null;
      const input = new URL(raw, listing.href);
      if (input.origin !== listing.origin ||
          input.pathname !== "/jj/chintai/shiryou/FR400FG001/" ||
          input.username || input.password || input.hash) return null;
      // The link must explicitly identify the listing; a generic form GET might
      // depend on the current browser history or SUUMO's page JavaScript.
      const idPattern = new RegExp("(^|\\D)" + match[1] + "(\\D|$)");
      if (![...input.searchParams.values()].some(v => idPattern.test(v))) return null;
      return input.href;
    } catch (_) {
      return null;
    }
  }
  async function navigateNextListingWithoutDisplay(task, listingUrl) {
    if (!batchTaskStillCurrent(task)) return;
    let supported = false;
    try { supported = sessionStorage.getItem(FAST_REPORT_NAV_KEY) === "1"; } catch (_) {}
    if (supported) {
      const target = new URL(listingUrl, location.origin);
      if (target.origin === location.origin && /^\/chintai\/bc_\d+\/?$/i.test(target.pathname)) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        try {
          // GET only. Do not simulate page button clicks, POST, or SUUMO JS.
          const response = await fetch(target.href, {
            method: "GET", credentials: "same-origin", redirect: "follow",
            signal: controller.signal
          });
          const mime = String(response.headers?.get("content-type") || "");
          const actual = new URL(response.url || target.href, location.origin);
          if (response.ok && actual.href === target.href &&
              (!mime || /text\/html/i.test(mime))) {
            const html = await response.text();
            if (batchTaskStillCurrent(task) && html.length >= 1000) {
              const doc = new DOMParser().parseFromString(html, "text/html");
              const inputUrl = directReportInputUrlFromListingDoc(doc, target.href);
              if (inputUrl && batchTaskStillCurrent(task) &&
                  !currentUncertainSend() && !GM_getValue(FINAL_SEND_GUARD_KEY,null)?.status) {
                if (queuePageTransition("input")) {
                  console.info("[SUUMO JJ 上位版] 軽量遷移：掲載画面の表示を省略");
                  location.assign(inputUrl);
                  return;
                }
              }
            }
          }
        } catch (error) {
          console.debug("[SUUMO JJ 上位版] 軽量遷移は使用不可。通常の掲載画面へ戻します", error?.name || "error");
        } finally {
          clearTimeout(timer);
        }
      }
    }
    // Any ambiguity, timeout, unusual URL, stale state, or DOM change: fall back.
    if (batchTaskStillCurrent(task) && queuePageTransition("listing")) {
      location.href = listingUrl;
    }
  }

  let nextListingStarted = false;

  function goToNextListing() {
    if (nextListingStarted || !isBatchActive() || !isCurrentTabItem()) return;
    if (currentIeloveExecutionItem() && currentIeloveExecutionItem().status !== "complete") return;
    nextListingStarted = true;
    clearSendClaimForCurrent();
    GM_deleteValue(FINAL_SEND_GUARD_KEY);

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

      showBatchIssueResults();
      return;
    }

    GM_setValue(BATCH_KEYS.index, index);
    if(!primeCurrentTabItem()||!queuePageTransition("listing")){
      toast("次の掲載に進むためのタブ識別情報を保存できません。自動進行を停止しました。",8500);
      return;
    }
    setBatchStage(STAGES.LISTING);
    setSubmitting(false);
    setConfirmReady(false);
    setFormReady(false);
    GM_deleteValue(REPORT_RETRY_KEY);
    const task=captureBatchTask();
    setTimeout(() => { void navigateNextListingWithoutDisplay(task, urls[index]); }, 150);
  }

  // 入力完了後は独自の二段階確認を挟まず、SUUMO本来の内容確認画面へ進む。
  // 物件ID・管理情報の一致、送信状態、フォーム準備完了は引き続き検証する。
  async function submitCurrentAndContinue() {
    if (!isBatchActive() || !isInputPage() || !isFormReady() || isBatchError()) return;
    if(!isCurrentTabItem())return rejectStaleTabPage();
    if (getBatchStage() !== STAGES.INPUT_READY && getBatchStage() !== STAGES.INPUT_CONFIRM) return;
    if (blockUncertainIeloveResend()) return;

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
    // INPUT_CONFIRM は旧版から復帰したケースのみ許容し、確認UIは表示しない。
    setConfirmReady(false);
    setSubmitting(true);
    setBatchStage(STAGES.SUBMITTING_CONFIRM);
    updateBatchPanel();
    toast("内容確認画面へ進みます…");

    const confirmLink = document.querySelector(
      'a.js-clickToForm[rel="/jj/chintai/shiryou/FR400FG002/"]'
    );

    if (!confirmLink) {
      scheduleReportRetry("内容確認へ移動","内容確認ボタンがありません");
      return;
    }

    clearReportRetry("内容確認へ移動");
    if(!queuePageTransition("confirm"))return rejectStaleTabPage();
    confirmLink.click();
  }

  function captureSubmissionTarget(){
    if(!isBatchActive()||!isConfirmPage()||!isCurrentTabItem())return null;
    const index=getBatchIndex(),urls=getBatchUrls(),ownerToken=String(GM_getValue(BATCH_KEYS.ownerToken,"")||"");
    const pageContext=readTabContext(TAB_ITEM_CONTEXT_KEY);
    if(!urls[index]||!ownerToken||getTabOwnerToken()!==ownerToken)return null;
    const item=currentIeloveExecutionItem();
    if(getIeloveExecution()&&(!item||item.url!==urls[index]||item.status==="sending"))return null;
    return {index,url:urls[index],ownerToken,pageUrl:location.href,
      itemId:pageContext.id,
      profileSnapshot:item?JSON.stringify(item.profile||{}):null};
  }
  function sameSubmissionTarget(target){
    if(!target||!isBatchActive()||!isConfirmPage()||!isCurrentTabItem()||
       readTabContext(TAB_ITEM_CONTEXT_KEY)?.id!==target.itemId||
       location.href!==target.pageUrl||
       getBatchIndex()!==target.index||getBatchUrls()[target.index]!==target.url||
       GM_getValue(BATCH_KEYS.ownerToken,"")!==target.ownerToken||
       getTabOwnerToken()!==target.ownerToken||getBatchStage()!==STAGES.SUBMITTING_FINAL||
       currentUncertainSend())return false;
    const item=currentIeloveExecutionItem();
    if(getIeloveExecution()&&(!item||item.url!==target.url||
       JSON.stringify(item.profile||{})!==target.profileSnapshot||item.status==="sending"))return false;
    return true;
  }
  function readSendClaim(){
    return JSON.parse(localStorage.getItem(SEND_CLAIM_STORAGE_KEY)||"null");
  }
  function clearSendClaimForCurrent(){
    try{
      const claim=readSendClaim(),index=getBatchIndex();
      if(claim?.ownerToken===GM_getValue(BATCH_KEYS.ownerToken,"") &&
         claim?.index===index&&claim?.url===getBatchUrls()[index]){
        localStorage.removeItem(SEND_CLAIM_STORAGE_KEY);
      }
    }catch(error){console.warn("[SUUMO JJ 上位版] 送信履歴の整理に失敗",error);}
  }
  function reportSendLockUnavailable(){
    setBatchError(true);
    // Do not move to the next listing or automatically retry a potentially active send.
    toast("安全確認：複数タブの送信排他を使用できません。送信を停止しました。",8500);
    recordIssue({phase:"最終送信",index:getBatchIndex()+1,
      kind:"送信安全機構の使用不可",action:"自動送信停止・要確認",
      detail:"送信の重複防止に必要なブラウザ機能を使用できません",attempts:1,
      url:getBatchUrls()[getBatchIndex()]});
  }
  async function handleConfirmPage() {
    if (!isBatchActive() || confirmSendStarted || currentUncertainSend() ||
        blockUncertainIeloveResend()) return;
    if(!isCurrentTabItem())return rejectStaleTabPage();
    const stage=getBatchStage();
    if(stage!==STAGES.SUBMITTING_CONFIRM&&stage!==STAGES.SUBMITTING_FINAL)return;
    const preTarget=captureSubmissionTarget();
    if(!preTarget)return;
    setSubmitting(true);
    setBatchStage(STAGES.SUBMITTING_FINAL);
    setConfirmReady(false);
    updateBatchPanel();
    toast("確認画面を確認しました。\n送信します…",1800);
    const sendLink=await waitForReadyElement(
      'a.js-clickToForm[rel="/jj/chintai/shiryou/FR400FG003/"]',6000,
      el=>el.isConnected&&!el.hasAttribute("disabled")
    );
    if(!sendLink){
      scheduleReportRetry("最終送信ボタン取得","SUUMOの確認画面で最終送信ボタンが見つかりません");
      return;
    }
    await sleep(250); // Keep the existing pre-send safety interval.
    if(!sameSubmissionTarget(preTarget)||confirmSendStarted||!sendLink.isConnected)return;
    // When Web Locks is absent, fail closed instead of depending on a shared GM flag.
    try{
      if(!navigator.locks?.request||typeof localStorage?.getItem!=="function"){
        reportSendLockUnavailable();
        return;
      }
      await navigator.locks.request(SEND_LOCK_NAME,{mode:"exclusive",ifAvailable:true},async lock=>{
        if(!lock){
          toast("別のタブが送信処理中のため、このタブでは送信しません",6000);
          return;
        }
        // Re-check inside the cross-tab critical section after all awaits.
        if(!sameSubmissionTarget(preTarget)||confirmSendStarted||!sendLink.isConnected)return;
        const claim=readSendClaim();
        if(claim?.ownerToken===preTarget.ownerToken){
          toast("同じ一括処理の送信履歴があるため、重複送信を停止しました",8500);
          return;
        }
        const marker={id:createBatchOwnerToken(),itemId:preTarget.itemId,
          ownerToken:preTarget.ownerToken,index:preTarget.index,
          url:preTarget.url,at:Date.now()};
        // Persist the claim before the click. Lock serializes two tabs on same origin.
        localStorage.setItem(SEND_CLAIM_STORAGE_KEY,JSON.stringify(marker));
        if(!saveTabContext(TAB_SENT_CONTEXT_KEY,marker)){
          // No click is ever issued if the tab-local send identity cannot be persisted.
          reportSendLockUnavailable();
          return;
        }
        // Quarantine from the first click, including the interval before timeout.
        sessionStorage.setItem(TAB_UNCERTAIN_SEND_KEY,"1");
        confirmSendStarted=true;
        GM_setValue(FINAL_SEND_GUARD_KEY,{...marker,status:"sending",startedAt:marker.at});
        saveIeloveExecutionStatus("sending");
        markAdvancedTiming("final-send-clicked");
        startBackgroundWatchdog();
        if(!queuePageTransition("complete",marker.id)){
          reportSendLockUnavailable();
          return;
        }
        sendLink.click();
      });
    }catch(error){
      console.error("[SUUMO JJ 上位版] 排他送信を停止",error);
      // A partial failure after claiming may mean a send was issued; never retry.
      reportSendLockUnavailable();
    }
  }

  async function handleCompletePage() {
    if (!isBatchActive()) return;
    if(!isCurrentTabSent())return rejectStaleTabPage();
    // A completion URL with an explicit HTTP error is not a confirmed POST result.
    const responseStatus=Number(performance.getEntriesByType?.("navigation")?.[0]?.responseStatus);
    if(Number.isFinite(responseStatus)&&responseStatus>=400){
      advanceUncertainSubmission("完了画面の取得 HTTP "+responseStatus+"：送信結果を確認できませんでした");
      return;
    }
    const stage = getBatchStage();
    if (stage !== STAGES.SUBMITTING_FINAL && stage !== STAGES.COMPLETE &&
        stage !== STAGES.SEND_UNCERTAIN) return;
    // A late completion is safe to associate only with the SAME active item
    // and same persisted POST ID; isCurrentTabSent() checks both.
    if(stage===STAGES.SEND_UNCERTAIN){
      const id="最終送信:"+(getBatchIndex()+1),url=getBatchUrls()[getBatchIndex()];
      GM_setValue(ISSUE_LOG_KEY,issueList().filter(row=>
        !(row.id===id && row.kind==="送信結果不明" && row.url===publicListingUrl(url))));
    }
    // The completion passed the same-item, same-POST verification.
    try{sessionStorage.removeItem(TAB_UNCERTAIN_SEND_KEY);}catch(_){}
    setBatchStage(STAGES.COMPLETE);
    markAdvancedTiming("complete-page");
    saveIeloveExecutionStatus("complete");
    clearSendClaimForCurrent();
    GM_deleteValue(FINAL_SEND_GUARD_KEY);
    GM_deleteValue(REPORT_RETRY_KEY);
    setSubmitting(true);
    setConfirmReady(false);
    updateBatchPanel();
    // 正常完了の通知は省略する。
    await sleep(100);
    goToNextListing();
  }

  function retryCurrentListing() {
    if(!isCurrentTabItem())return rejectStaleTabPage();
    if (currentIeloveExecutionItem()?.status === "sending"||currentUncertainSend()) {
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

    if(!queuePageTransition("listing"))return rejectStaleTabPage();
    const task=captureBatchTask();
    setTimeout(() => {
      if(batchTaskStillCurrent(task))location.href = currentUrl;
    }, 500);
  }

  // 送信せず次へ。手動スキップと掲載終了時の自動スキップで共通化する。
  function advancePastSkippedListing(reason,uncertain=false) {
    if(nextListingStarted || !isBatchActive() || !isCurrentTabItem() ||
       (uncertain&&!isCurrentTabSent()) || (isSubmitting()&&!uncertain))return false;
    const urls=getBatchUrls(), index=getBatchIndex();
    if(!urls[index])return false;
    const item=currentIeloveExecutionItem();
    if(getIeloveExecution()&&!item)return false;
    if(uncertain && item?.status!=="sending"&&!currentUncertainSend())return false;
    if(item&&item.status==="sending"&&!uncertain)return false;
    nextListingStarted=true;
    cancelAutoAction(false);
    setConfirmReady(false);
    if(reason==="SUUMO掲載終了"){
      recordIssue({phase:"申告：掲載確認",index:index+1,kind:"掲載終了",
        action:"自動スキップ",attempts:1,detail:"SUUMOが掲載終了を明示",
        url:urls[index]});
    }
    const history=GM_getValue(BATCH_SKIP_LOG_KEY, []);
    const log=Array.isArray(history)?history:[];
    log.push({index:index+1,url:urls[index],reason:String(reason||"スキップ"),at:Date.now()});
    GM_setValue(BATCH_SKIP_LOG_KEY,log);
    saveIeloveExecutionStatus(uncertain?"uncertain":"skipped");
    if(uncertain){
      clearSendClaimForCurrent();
      GM_deleteValue(FINAL_SEND_GUARD_KEY);
    }
    const execution=getIeloveExecution();
    if(execution?.items[index]?.url===urls[index]){
      execution.items[index].skipReason=String(reason||"スキップ");
      GM_setValue(IELOVE_BATCH_EXECUTION_KEY,execution);
    }
    console.info("[SUUMO JJ 上位版] 掲載をスキップ",log[log.length-1]);
    const next=index+1;
    if(next>=urls.length){
      if(execution){
        execution.finishedAt=Date.now();
        GM_setValue(IELOVE_BATCH_EXECUTION_KEY,execution);
      }
      clearBatch();
      document.getElementById("tm-batch-status")?.remove();
      showBatchIssueResults();
      return true;
    }
    GM_setValue(BATCH_KEYS.index,next);
    if(!primeCurrentTabItem()||!queuePageTransition("listing")){
      toast("次の掲載の識別情報を保存できないため自動進行を停止しました。",8500);
      return false;
    }
    setBatchStage(STAGES.LISTING);
    setSubmitting(false);
    setBatchError(false);
    setFormReady(false);
    GM_deleteValue(FORM_PREP_ATTEMPTS_KEY);
    GM_deleteValue(REPORT_RETRY_KEY);
    toast("掲載 "+(index+1)+"件目をスキップ（"+reason+"）\n次の掲載へ進みます",1600);
    location.href=urls[next];
    return true;
  }

  function skipBatchItem() {
    if(currentIeloveExecutionItem()?.status==="sending"||currentUncertainSend()){
      toast("送信結果が未確認のため、この掲載はスキップできません。確認後に中止してください。",6500);
      return;
    }
    if(isSubmitting()){toast("送信処理中はスキップできません");return;}
    if(!confirm("この物件は送信せずにスキップしますか？"))return;
    advancePastSkippedListing("手動スキップ");
  }

  // SUUMOの掲載終了ページを文言まで確認し、単なるリンク読込失敗と区別する。
  function isConfirmedListingEndedPage(doc=document) {
    const body=doc.body;
    if(!body || body.querySelector("#js-bknToiawaseFr"))return false;
    const text=String(body.innerText||body.textContent||"").normalize("NFKC").replace(/\s+/g,"");
    return /お探しの情報は[、,]?当サイトへの掲載が終了したためご覧いただけません/.test(text) ||
      /(?:この|該当の)(?:物件|お部屋|掲載情報)は?(?:すでに)?掲載(?:が)?終了(?:しました|しています)/.test(text);
  }

  function autoSkipEndedListingIfConfirmed() {
    if(!isBatchActive()||!isCurrentTabItem()||getBatchStage()!==STAGES.LISTING||isSubmitting()||
       isFormReady()||!isConfirmedListingEndedPage())return false;
    const urls=getBatchUrls(), index=getBatchIndex(), expected=urls[index];
    if(!expected)return false;
    const item=currentIeloveExecutionItem();
    if(getIeloveExecution()&&!item)return false;
    if(item && item.status!=="pending")return false;
    const expectedId=(expected.match(/\/chintai\/bc_(\d+)/i)||[])[1];
    const displayedId=(location.pathname.match(/\/chintai\/bc_(\d+)/i)||[])[1];
    // 異なる掲載IDへ手動で移動した場合、別の掲載を誤ってスキップしない。
    if(!expectedId||(displayedId&&displayedId!==expectedId))return false;
    return advancePastSkippedListing("SUUMO掲載終了");
  }


  function stopBatch() {
    if(!isBatchActive()||!isCurrentTabItem())return rejectStaleTabPage();
    const ok = confirm(currentUncertainSend()
      ? "送信結果が未確認です。送信履歴を保持して自動処理を停止しますか？"
      : "一括処理を中止しますか？\n\n進捗はリセットされます。");
    if (!ok) return;
    if(!isBatchActive()||!isCurrentTabItem())return rejectStaleTabPage();
    if(currentUncertainSend()){
      advanceUncertainSubmission("中止操作時に送信結果を確認できませんでした");
      cancelAutoAction(false);
      updateBatchPanel();
      toast("送信結果が未確認のため、送信履歴を保持して停止しています。再送信せず受信状況を確認してください。",11000);
      return;
    }
    clearBatch();
    document.getElementById("tm-batch-status")?.remove();
    toast("一括処理を中止しました");
  }

  async function handleListingPage() {
    if (!isBatchActive()) return;
    if(!bindListingToTab())return rejectStaleTabPage();
    if (currentIeloveExecutionItem()?.status === "complete") {
      goToNextListing();
      return;
    }
    if(autoSkipEndedListingIfConfirmed())return;

    const urls = getBatchUrls();
    const index = getBatchIndex();
    setSubmitting(false);
    setConfirmReady(false);
    setBatchError(false);
    setFormReady(false);
    GM_deleteValue(FORM_PREP_ATTEMPTS_KEY);
    updateBatchPanel();
    toast(`掲載ページ ${index + 1}/${urls.length}\n申告フォームを開きます…`);

    markAdvancedTiming("listing-page-ready");
    const link = await waitForReadyElement("#js-bknToiawaseFr", 8000);
    if(autoSkipEndedListingIfConfirmed())return;
    if (link && isBatchActive() && isListingPage() && isCurrentTabItem()) {
      // Use only a real, listing-bound GET link as evidence for next item's
      // optional background fetch. Never infer or manufacture a form URL.
      try {
        sessionStorage.setItem(FAST_REPORT_NAV_KEY,
          directReportInputUrlFromListingDoc(document, urls[index]) ? "1" : "0");
      } catch (_) {}
      if(!queuePageTransition("input"))return rejectStaleTabPage();
      markAdvancedTiming("listing-report-link-clicked");
      link.click();
      return;
    }

    scheduleReportRetry("掲載リンク取得","申告リンクが見つかりません（8秒待機後）");
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

  const AUTO_ACTION_MS = 300;
  const AUTO_ACTION_SINGLE_PHASE = 'single-submit-v7549';
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

    const phase = AUTO_ACTION_SINGLE_PHASE;
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
    if(isListingPage()){if(!bindListingToTab())return;}
    else if(!isCurrentTabItem())return;
    watchdogBusy = true;
    try {
      const stage = getBatchStage();
      if((currentIeloveExecutionItem()?.status==="sending"||currentUncertainSend()) && !isCompletePage()){
        if(!isConfirmPage())advanceUncertainSubmission("送信後に完了ページ以外の画面へ遷移しました");
        else startBackgroundWatchdog();
        return;
      }

      if (isInputPage()) {
        if (stage === STAGES.INPUT_READY || stage === STAGES.INPUT_CONFIRM) {
          if (stage === STAGES.INPUT_CONFIRM) setBatchStage(STAGES.INPUT_READY);
          setFormReady(true);
          setConfirmReady(false);
          updateBatchPanel();
          recoverAutoActionIfDue();
        }
        return;
      }

      if (isConfirmPage()) {
        if ((stage === STAGES.SUBMITTING_CONFIRM || stage === STAGES.SUBMITTING_FINAL) && !confirmSendStarted) {
          // 復帰時も通常ルートを使い、SUUMO画面確認・最終送信前250msを維持する。
          await handleConfirmPage();
        }
        return;
      }

      if (isCompletePage()) {
        if (stage === STAGES.SUBMITTING_FINAL || stage === STAGES.COMPLETE) {
          await handleCompletePage();
        }
      }
    } finally {
      watchdogBusy = false;
    }
  }

  let sendWatchdogTimer=null;
  function startBackgroundWatchdog() {
    if(sendWatchdogTimer){clearTimeout(sendWatchdogTimer);sendWatchdogTimer=null;}
    if(!isBatchActive()||isCompletePage()||!isCurrentTabSent()||!currentUncertainSend())return;
    const record=GM_getValue(FINAL_SEND_GUARD_KEY,null);
    if(!record||!Number.isFinite(Number(record.startedAt)))return;
    const owner=String(GM_getValue(BATCH_KEYS.ownerToken,"")||"");
    const remaining=Math.max(0,UNKNOWN_SEND_TIMEOUT_MS-(Date.now()-Number(record.startedAt)));
    sendWatchdogTimer=setTimeout(()=>{
      sendWatchdogTimer=null;
      if(!isBatchActive()||isCompletePage()||!isCurrentTabSent()||!currentUncertainSend()||
         getBatchIndex()!==record.index||getBatchUrls()[record.index]!==record.url||
         GM_getValue(BATCH_KEYS.ownerToken,"")!==owner)return;
      // Deadline means UNKNOWN, not failed and not permission to retry.
      advanceUncertainSubmission("最終送信後60秒以内に完了画面を確認できませんでした");
    },remaining);
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
    let statusText = "入力内容を照合済みです。SUUMOの内容確認画面へ自動進行します。";
    let statusBackground = "#fff6d8";

    if (batchError) {
      statusText = "⚠ 処理が正常に完了しませんでした。\nこの物件を再実行できます。";
      statusBackground = "#fff1f0";
    } else if (isInputPage() && !formReady) {
      statusText = "申告フォームを準備しています…\n完了するまでお待ちください。";
      statusBackground = "#f2f2f2";
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

    const uncertainSend = getBatchStage()===STAGES.SEND_UNCERTAIN || (!isCompletePage() && (
      currentUncertainSend() || currentIeloveExecutionItem()?.status==="sending"
    ));
    if (uncertainSend) {
      statusText = "⚠ 最終送信を開始済みですが、完了を確認できていません。二重送信防止のため停止しています。";
      statusBackground = "#fff1f0";
    }
    const canSubmit = isInputPage() && !submitting && !batchError && formReady && !uncertainSend;
    let mainButton = "";

    if (canSubmit) {
      mainButton = `
        <button id="tm-submit-next" style="width:100%;padding:11px;border:0;border-radius:9px;background:#9fc2fb;color:#fff;font-size:14px;font-weight:bold;cursor:pointer;margin-bottom:7px;">
          SUUMO内容確認へ進む（自動）
        </button>`;
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

    const nextPanelMarkup = `
      <div style="font-size:18px;font-weight:bold;margin-bottom:8px;">SUUMO 一括処理</div>
      <div style="font-size:27px;font-weight:bold;margin-bottom:6px;">${Math.min(index + 1, urls.length)} / ${urls.length}</div>
      ${ieloveItem ? `<div style="font-size:13px;font-weight:bold;margin-bottom:5px;">${escapeHtml(ieloveItem.name)} ／ ${escapeHtml(ieloveItem.profile.room)}</div>` : ""}
      <div style="font-size:11px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:10px;">${escapeHtml(current)}</div>
      <div style="font-size:11px;line-height:1.5;padding:6px 8px;margin-bottom:9px;background:#f5f7fa;border-radius:6px;color:#25364a;"><span style="font-weight:bold;color:#526575;">自動入力予定　</span>${plannedInputHtml}</div>
      <div style="font-size:13px;background:${statusBackground};padding:10px;border-radius:7px;margin-bottom:11px;line-height:1.6;white-space:pre-line;">${escapeHtml(statusText)}</div>
      ${mainButton}
      <div style="display:flex;gap:7px;">
        <button id="tm-skip-item" ${submitting||uncertainSend ? "disabled" : ""} style="flex:1;padding:8px;cursor:${submitting||uncertainSend ? "default" : "pointer"};">スキップ</button>
        <button id="tm-stop-batch" style="flex:1;padding:8px;cursor:pointer;">中止</button>
      </div>`;
    // Preserve event handlers, the live countdown, and user focus when only
    // periodic status reconciliation calls this function with unchanged data.
    // Never skip batch checks above; only avoid reconstructing identical DOM.
    if (panel.__suumoLastMarkup !== nextPanelMarkup ||
        !panel.querySelector("#tm-stop-batch")) {
      panel.innerHTML = nextPanelMarkup;
      panel.__suumoLastMarkup = nextPanelMarkup;
    }

    const submit = document.getElementById("tm-submit-next");
    if (submit) {
      const phase = AUTO_ACTION_SINGLE_PHASE;
      const strongColor = "#2f7cf6";
      const lightColor = "#9fc2fb";

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

     const skip = document.getElementById("tm-skip-item");
    if (skip && !submitting && !uncertainSend) {
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

  function closeSettingsPanel() {
    const panel = document.getElementById("tm-setting-panel");
    if (!panel) return;
    if (location.hostname === "cloud.ielove.jp" &&
        panel.querySelector("#tm-ielove-batch-heading")?.style.display !== "none") {
      // 入力は保存するが、一括添削モードと一時的な表示状態を初期化。
      exitIeloveBatchEditor();
    }
    ieloveNormalSnapshot = null;
    panel.remove();
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
          ${location.hostname === "cloud.ielove.jp"
            ? '<button id="tm-ielove-batch-get" type="button" style="flex:1;min-width:135px;padding:8px 13px;border:0;border-radius:7px;background:#205375;color:#fff;font-weight:bold;cursor:pointer;">一括取得</button>'
            : '<button id="tm-settings-batch" type="button" style="padding:8px 13px;border:0;border-radius:7px;background:#e66b00;color:#fff;font-weight:bold;cursor:pointer;">一括処理</button><button id="tm-settings-autofill" type="button" style="padding:8px 13px;border:0;border-radius:7px;background:#205375;color:#fff;font-weight:bold;cursor:pointer;">自動入力</button>'}
          ${location.hostname === "cloud.ielove.jp" ? '<button id="tm-ielove-prev" type="button" style="display:none;padding:8px;border:1px solid #B9C7CF;border-radius:7px;background:#fff;cursor:pointer">← 前へ</button><button id="tm-ielove-next" type="button" style="display:none;padding:8px;border:0;border-radius:7px;background:#205375;color:#fff;cursor:pointer">次へ →</button><button id="tm-ielove-back" type="button" style="display:none;padding:8px;border:1px solid #B9C7CF;border-radius:7px;background:#fff;cursor:pointer">通常画面</button>' : ''}
          <button id="tm-save-setting" style="padding:8px 15px;border:0;border-radius:7px;background:#112B3C;color:#fff;font-weight:bold;cursor:pointer;">保存</button>
          <button id="tm-close-setting" style="padding:8px 15px;border:1px solid #B9C7CF;border-radius:7px;background:#F7F9FA;color:#334155;cursor:pointer;">閉じる</button>
        </div>

      </div>`;

    document.body.appendChild(panel);

    // いえらぶ通常画面では3ボタンを幅いっぱいに均等配置する。
    if (location.hostname === "cloud.ielove.jp") {
      const footerRow = panel.querySelector("#tm-setting-footer > div");
      if (footerRow) {
        footerRow.style.flexWrap = "nowrap";
        footerRow.style.width = "100%";
        for (const id of ["tm-ielove-batch-get", "tm-save-setting", "tm-close-setting"]) {
          const button = panel.querySelector("#" + id);
          if (!button) continue;
          button.style.flex = "1 1 0";
          button.style.minWidth = "0";
          button.style.padding = "9px 5px";
          button.style.whiteSpace = "nowrap";
        }
      }
    }

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

    panel.updateIeloveWarning = updateHalfWidthWarning;
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

    const batchButton = document.getElementById("tm-settings-batch");
    if (batchButton) batchButton.onclick = () => {
      panel.remove();
      if (isIeloveSelectionReady()) openIeloveSuumoSelection();
      else openCompanySelection();
    };

    const autofillButton = document.getElementById("tm-settings-autofill");
    if (autofillButton) autofillButton.onclick = async () => {
      if (document.querySelector("#js-selectGosinkoku")) await selectReportType();
      await autofill();
    };

    const ieloveGetButton = document.getElementById("tm-ielove-batch-get");
    if (ieloveGetButton) ieloveGetButton.onclick = () => startIeloveBatchGet(ieloveGetButton);
    // 開き直した時は必ず通常画面。一括添削の下書きは保存しておくが自動復元しない。
    // 一括取得ボタンで新しい作業を開始できる。


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

    document.getElementById("tm-close-setting").onclick = closeSettingsPanel;
    document.getElementById("tm-close-setting-top").onclick = closeSettingsPanel;
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
    const acquisitionStarted = performance.now();
    markAdvancedTiming("ielove-acquisition-start");
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
      advancedMetric("ielove-acquisition", acquisitionStarted, {completed:records.length, total:rows.length});
      markAdvancedTiming("ielove-acquisition-end");
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
    document.getElementById("tm-ielove-batch-name").textContent = (item.name || "物件名未取得") + (item.room ? " ／ " + String(item.room).replace(/（非公開）|\(非公開\)/g, "").trim() : "");
    document.getElementById("tm-ielove-batch-progress").textContent = (index+1) + " / " + draft.records.length + "件";
    document.getElementById("tm-ielove-batch-meta").style.display = "none";
    for (const [field,id] of IELOVE_EDIT_FIELDS) document.getElementById(id).value = field === "room" ? String(item[field] || "").replace(/（非公開）|\(非公開\)/g, "").trim() : (item[field] || "");
    document.getElementById("tm-setting-panel")?.updateIeloveWarning?.();
    document.getElementById("tm-ielove-prev").disabled = index === 0;
    document.getElementById("tm-ielove-next").textContent = index === draft.records.length - 1 ? "指摘 →" : "次へ →";
  }
  function activateIeloveBatchEditor(draft) {
    if (!document.getElementById("tm-ielove-batch-heading") || !draft || !draft.records?.length) return;
    if (!ieloveNormalSnapshot) ieloveNormalSnapshot = Object.fromEntries(IELOVE_EDIT_FIELDS.map(([field,id]) => [field,document.getElementById(id).value]));
    document.getElementById("tm-ielove-batch-heading").style.display = "block";
    document.getElementById("tm-ielove-batch-get").style.display = "none";
    const footerRow = document.querySelector("#tm-setting-footer > div");
    if (footerRow) {
      if (!footerRow.dataset.ieloveOriginalStyle) footerRow.dataset.ieloveOriginalStyle = footerRow.getAttribute("style") || " ";
      footerRow.style.flexWrap = "nowrap";
      footerRow.style.gap = "4px";
      for (const button of footerRow.querySelectorAll("button")) {
        if (!button.hasAttribute("data-ielove-original-style")) button.setAttribute("data-ielove-original-style", button.getAttribute("style") || "");
        button.style.padding = "8px 5px";
        button.style.fontSize = "12px";
        button.style.whiteSpace = "nowrap";
        button.style.flex = "1 1 0";
        button.style.minWidth = "0";
      }
    }
    document.getElementById("tm-ielove-prev").textContent = "前へ";
    document.getElementById("tm-ielove-back").textContent = "通常";
    for (const id of ["tm-ielove-prev","tm-ielove-next","tm-ielove-back"]) document.getElementById(id).style.display = "";
    document.getElementById("tm-ielove-prev").onclick = () => navigateIeloveBatch(-1);
    document.getElementById("tm-ielove-next").onclick = () => navigateIeloveBatch(1);
    document.getElementById("tm-ielove-back").onclick = exitIeloveBatchEditor;
    // 編集内容はキー入力時点で保存。切り替え後の入力欄は即時反映する。
    for (const [field,id] of IELOVE_EDIT_FIELDS) {
      const input = document.getElementById(id);
      if (!input || input.dataset.ieloveInstantBound === "1") continue;
      input.dataset.ieloveInstantBound = "1";
      input.addEventListener("input", () => {
        if (document.getElementById("tm-ielove-batch-heading")?.style.display === "none") return;
        if (field === "room") {
          const active = GM_getValue(IELOVE_BATCH_DRAFT_KEY, null);
          const item = active?.records?.[active.index || 0];
          if (item) document.getElementById("tm-ielove-batch-name").textContent =
            (item.name || "物件名未取得") + " ／ " + input.value.replace(/（非公開）|\\(非公開\\)/g, "").trim();
        }
        persistIeloveBatchEditor();
      });
    }
    renderIeloveBatchEditor(draft);
  }

  const IELOVE_SUUMO_HANDOFF_KEY = "ielove_suumo_handoff_v1";
  function buildIeloveSuumoSearch(record) {
    const address = String(record.address || "").normalize("NFKC");
    const specs = String(record.specs || "").normalize("NFKC");
    const floor = String(record.floor || "").normalize("NFKC");
    const rent = String(record.rent || "").normalize("NFKC");
    const chome = address.match(/^(.+?\d+)丁目/);
    // 丁目がある場合は従来どおり丁目番号まで残す。
    // 丁目がない住所は番地の先頭から落とす（千住宮元町12-11 → 千住宮元町）。
    const shortAddress = (chome ? chome[1] : address.replace(/\s*\d+(?:[-－ー]\d+)*(?:番地?.*|号.*)?\s*$/, "")).trim();
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
    // 新しく開始した上位版一括取得の検索タブだけを識別する。
    const createdAt = Date.now();
    const token = String(createdAt);
    results.forEach(result => {
      const url = new URL(result.url);
      url.searchParams.set("suumo_jj_batch", token);
      result.url = url.href;
    });
    const handoff = { records:draft.records, searches:results, index:0, createdAt, token };
    GM_deleteValue("ielove_suumo_choices_v1");
    GM_setValue(ISSUE_LOG_KEY, []);
    GM_setValue(IELOVE_SUUMO_HANDOFF_KEY, handoff);
    markAdvancedTiming("search-navigation-start");
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
    // まず表示を同期的に切り替え、次に保存する。クリック直後に新物件を表示。
    renderIeloveBatchEditor(draft);
    GM_setValue(IELOVE_BATCH_DRAFT_KEY, draft);
  }
  function exitIeloveBatchEditor() {
    persistIeloveBatchEditor();
    document.getElementById("tm-ielove-batch-heading").style.display = "none";
    const footerRow = document.querySelector("#tm-setting-footer > div");
    if (footerRow) {
      if (footerRow.dataset.ieloveOriginalStyle) {
        footerRow.setAttribute("style", footerRow.dataset.ieloveOriginalStyle.trim());
        delete footerRow.dataset.ieloveOriginalStyle;
      }
      for (const button of footerRow.querySelectorAll("button")) {
        if (button.hasAttribute("data-ielove-original-style")) {
          button.setAttribute("style", button.getAttribute("data-ielove-original-style"));
          button.removeAttribute("data-ielove-original-style");
        }
      }
    }
    document.getElementById("tm-ielove-batch-get").style.display = "";
    for (const id of ["tm-ielove-prev","tm-ielove-next","tm-ielove-back"]) document.getElementById(id).style.display = "none";
    if (ieloveNormalSnapshot) {
      for (const [field,id] of IELOVE_EDIT_FIELDS) document.getElementById(id).value = ieloveNormalSnapshot[field] || "";
      ieloveNormalSnapshot = null;
    }
    document.getElementById("tm-setting-panel")?.updateIeloveWarning?.();
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

  function isAuthorizedIeloveBatchSearch(handoff = getIeloveHandoff()) {
    if (!handoff?.token || !isIeloveSuumoSearchPage()) return false;
    const url = new URL(location.href);
    // iimonの虫眼鏡や一般の検索結果から自動起動しない。
    if (url.searchParams.has("iimon")) return false;
    return url.searchParams.get("suumo_jj_batch") === String(handoff.token);
  }

  function isIeloveSelectionReady() {
    if (!isAuthorizedIeloveBatchSearch() || isBatchActive()) return false;
    const handoff = getIeloveHandoff();
    const choices = GM_getValue(IELOVE_SUUMO_CHOICES_KEY, {});
    return handoff.records.every((_, i) => Array.isArray(choices[i]?.__companies) && choices[i].__fastRoomFilterVersion === IELOVE_FAST_ROOM_FILTER_VERSION && choices[i].__searchUrl === handoff.searches[i].url);
  }

  function showIeloveSelectionLaunchButton() {
    if (!isIeloveSelectionReady() || document.getElementById("tm-ielove-ready-button")) return;
    const button = document.createElement("button");
    button.id = "tm-ielove-ready-button";
    button.type = "button";
    button.textContent = "一括で指摘に進む";
    button.style.cssText = "position:fixed;left:145px;bottom:16px;z-index:2147483646;height:36px;padding:0 17px;border:0;border-radius:10px;background:#205375;color:white;font-size:13px;font-weight:bold;cursor:pointer;box-shadow:0 3px 12px rgba(17,43,60,.28)";
    button.onclick = () => openIeloveSuumoSelection();
    document.body.appendChild(button);
  }

  function ieloveCompanyKey(card, name) {
    const link = card.querySelector('a[href^="/chintai/kaisha/"]');
    const href = link?.getAttribute("href") || "";
    return href.replace(/[?#].*$/, "").replace(/\/$/, "") || "name:" + name;
  }

  // SUUMOのカード内リンク・IDの表記差に対応しつつ、IDを確定できない掲載は送信対象にしない。
  function getIeloveSearchCompanies() {
    const map = new Map();
    const cards = document.querySelectorAll(".property-body");
    for (const card of cards) {
      const link = card.querySelector('a[href*="/chintai/kaisha/"]');
      const name = (link?.textContent || link?.getAttribute("title") || "").trim();
      if (!name || !link) continue;
      const href = link.getAttribute("href") || "";
      const key = href.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/\/$/, "") || "name:" + name;
      const clip = card.querySelector('input[id="clipkey"],input[name="clipkey"]');
      const candidates = [clip?.value, ...[...card.querySelectorAll('a[href*="/chintai/bc_"],a.js-singleShiryoSeikyu[rel]')].map(a => a.getAttribute("href") || a.getAttribute("rel") || "")];
      const ids = new Set();
      for (const raw of candidates) {
        const value = String(raw || "").trim();
        const match = value.match(/\/chintai\/bc_(\d+)\/?/i) || value.match(/(?:^|_)(\d{8,})$/);
        if (match) ids.add(match[1]);
        else if (/^\d{8,}$/.test(value)) ids.add(value);
      }
      if (!map.has(key)) map.set(key, {key,name,urls:[]});
      const item = map.get(key);
      for (const id of ids) {
        const url = "https://suumo.jp/chintai/bc_" + id + "/";
        if (!item.urls.includes(url)) item.urls.push(url);
      }
    }
    return [...map.values()];
  }

  function getIeloveCollectionDiagnostics() {
    const cards = [...document.querySelectorAll(".property-body")];
    const links = cards.filter(card => card.querySelector('a[href*="/chintai/kaisha/"]')).length;
    const groups = getIeloveSearchCompanies();
    const listings = groups.reduce((n,g) => n + g.urls.length,0);
    return {cards:cards.length, cardsWithCompanyLink:links, companies:groups.length, listings};
  }

  // 工程ごとの時間を保存し、SUUMO画面をまたいでも計測する。
  const ADVANCED_TIMING_KEY = "suumo_advanced_timing_v1";
  const ADVANCED_TIMING_LOG_KEY = "suumo_advanced_timing_log_v1";
  function markAdvancedTiming(stage, details = "") {
    const now = Date.now();
    const prev = GM_getValue(ADVANCED_TIMING_KEY, null);
    if (prev && prev.startedAt && now >= prev.startedAt) {
      const history = GM_getValue(ADVANCED_TIMING_LOG_KEY, []);
      const record = { from:prev.stage, to:stage, ms:now-prev.startedAt, at:now, details };
      const records = Array.isArray(history) ? history.slice(-99) : [];
      records.push(record);
      GM_setValue(ADVANCED_TIMING_LOG_KEY, records);
      console.info("[SUUMO JJ 上位版] 工程:", record.from, "→", stage, record.ms + "ms", details);
    }
    GM_setValue(ADVANCED_TIMING_KEY, { stage, startedAt:now });
  }

  function advancedMetric(stage, started, details = {}) {
    const record = {stage, ms:performance.now()-started, ...details};
    console.debug("[SUUMO JJ 上位版] 性能", record);
    return record;
  }

  // 物件カードが存在せず、SUUMOが明示的に「0件」と表示する場合のみ空結果とする。
  // 通信エラー・読み取り失敗・曖昧な空HTMLはスキップしない。
  function isConfirmedNoResultMessage(doc = document) {
    if(doc===document && document.readyState!=="complete")return false;
    if(doc.querySelector(".property-body,#js-bukkenList .js-property"))return false;
    const body=doc.body?.cloneNode(true);
    body?.querySelectorAll("script,style,template,noscript").forEach(el=>el.remove());
    const text=String(doc===document?(doc.body?.innerText||""):(body?.textContent||""))
      .normalize("NFKC").replace(/\s+/g," ");
    return /条件に(?:あう|合う|一致する)物件がありません/.test(text) ||
      /該当する(?:物件|お部屋|検索結果).*(?:ありません|見つかりません)/.test(text) ||
      /検索条件に一致する(?:物件|お部屋).*(?:ありません|見つかりません)/.test(text) ||
      /(?:賃貸)?(?:物件)?検索結果\s*[:：]?\s*0\s*件/.test(text) ||
      /賃貸(?:物件)?\s*[:：]?\s*0\s*件/.test(text) ||
      /検索結果が\s*(?:0\s*件|ありません|見つかりません)/.test(text) ||
      /(?:物件|お部屋)(?:が|は)\s*見つかりません(?:でした)?/.test(text) ||
      /該当する物件はありません/.test(text) ||
      /(?:見つかった物件|ヒット件数)\s*[:：]?\s*0\s*件/.test(text);
  }


  // 築年月・丁目はSUUMOキーワード検索で建物を絞る。一覧で階数・面積・賃料を照合し、詳細ページは開かない。
  const IELOVE_FAST_ROOM_FILTER_VERSION = 'keyword-built-room-v1';
  let ieloveCollecting = false;
  function parseSuumoRoomTarget(searchUrl) {
    const url = new URL(searchUrl, location.origin);
    const fw = String(url.searchParams.get("fw") || "").normalize("NFKC").replace(/\s+/g, " ").trim();
    const built = fw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
    const floor = fw.match(/(\d+)\s*階/);
    const area = fw.match(/(\d+(?:\.\d+)?)\s*(?:㎡|m(?:2)?)(?![A-Za-z0-9])/i);
    const rent = fw.match(/(\d+(?:\.\d+)?)\s*万円/);
    if (!built || !floor || !area || !rent || Number(built[2]) < 1 || Number(built[2]) > 12) {
      throw new Error("SUUMO検索条件（住所・築年月・階数・面積・賃料）を読み取れません");
    }
    const address = fw.slice(0, built.index).replace(/\s+/g, "").replace(/(\d+)丁目$/, "$1");
    if (!address) throw new Error("検索住所が空欄です");
    return {
      address, floor:Number(floor[1]), area:Number(area[1]), rentYen:Math.round(Number(rent[1])*10000),
      searchBuilt:Number(built[1])+"年"+Number(built[2])+"月"
    };
  }

  // 住所は検索後も一覧で照合（末尾の3丁目と3は同じ丁目として扱う）。
  function readSuumoRoomCard(card) {
    const norm = value => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
    const compact = value => norm(value).replace(/\s+/g, "").replace(/(\d+)丁目$/, "$1");
    const title=norm(card.querySelector(".property_inner-title")?.textContent);
    const floor=title.match(/(\d+)\s*階/);
    const rent=norm(card.querySelector(".detailbox-property-point")?.textContent).match(/([\d.]+)\s*万円/);
    const cells=card.querySelectorAll(".detailbox-property tr > td");
    const area=norm(cells[2]?.textContent).match(/([\d.]+)\s*(?:㎡|m\s*2)/i);
    const companyLink=card.querySelector('a[href*="/chintai/kaisha/"]');
    const linkedCompany=companyLink?.textContent || companyLink?.getAttribute("title") || "";
    const note=linkedCompany ? null : card.querySelector(".detailnote-box-item");
    const plainCompany=note ? [...note.querySelectorAll("div")].filter(div=>
      !div.closest(".ui-text--bold") && !div.classList.contains("ui-text--bold")
    ).map(div=>norm(div.textContent)).find(text=>
      text && !/お電話の際|SUUMOを見た|0120[\s-]*\d+|^\d{2,5}[-\s]\d+/.test(text)
    ) || "" : "";
    const companyName=norm(linkedCompany || plainCompany);
    const companyHref=companyLink?.getAttribute("href") || "";
    const companyKey=companyHref.replace(/^https?:\/\/[^/]+/i,"").replace(/[?#].*$/,"").replace(/\/$/,"") || (companyName ? "name:"+companyName : "");
    // 掲載IDは物件カード固有のチェック欄または物件名リンクから確定する。
    // ページ内の関連物件など別のURLはID不一致の判定に混ぜない。
    const fromHref = href => (String(href || "").match(/\/chintai\/bc_(\d+)\/?/i) || [])[1] || "";
    const checkedId=norm(card.querySelector('input[name="bc"]')?.value);
    const clipId=norm(card.querySelector('input[id="clipkey"],input[name="clipkey"]')?.value);
    const titleAnchor=card.querySelector('.property_inner-title a[href*="/chintai/bc_"]');
    const titleId=fromHref(titleAnchor?.getAttribute("href"));
    let id=checkedId || titleId || clipId;
    const verified=[checkedId,titleId,clipId].filter(v=>/^\d{8,}$/.test(v));
    const idAmbiguous=verified.some(v=>v!==id) || (id && !/^\d{8,}$/.test(id));
    if(!/^\d{8,}$/.test(id))id="";
    const titleHref=id ? "/chintai/bc_"+id+"/" : "";
    return {
      id, idAmbiguous, titleHref, companyKey, companyName,
      address:compact(cells[4]?.textContent),
      floor:floor ? Number(floor[1]) : null,
      area:area ? Number(area[1]) : null,
      rentYen:rent ? Math.round(Number(rent[1])*10000) : null
    };
  }


  function showIeloveRoomScanProgress(message) {
    let el=document.getElementById("tm-ielove-room-scan-progress");
    if(!el){
      el=document.createElement("div");
      el.id="tm-ielove-room-scan-progress";
      el.style.cssText="position:fixed;right:14px;bottom:14px;z-index:2147483645;background:#fff;border:2px solid #205375;color:#25364a;border-radius:10px;padding:11px 13px;font:13px/1.55 Meiryo,sans-serif;box-shadow:0 4px 16px #0003;max-width:330px;white-space:pre-line";
      document.body.appendChild(el);
    }
    el.textContent=message;
  }

  async function scanIeloveSuumoPages(searchUrl, propertyIndex, forceFetchFirst=false) {
    const scanStarted=performance.now();
    const target=parseSuumoRoomTarget(searchUrl);
    const base=new URL(searchUrl,location.origin);
    if(base.origin!==location.origin || !base.pathname.startsWith("/jj/chintai/ichiran/")) throw new Error("検索URLが不正です");
    const current=new URL(location.href);
    const owner=getIeloveHandoff();
    const assertCurrent=()=>{
      const latest=getIeloveHandoff();
      let reason="";
      if(!latest)reason="引き継ぎ情報が消去または不正になった";
      else if(!isAuthorizedIeloveBatchSearch(latest))reason="検索タブのURL・起動識別子が一致しない";
      else if(latest.token!==owner?.token)reason="別の一括検索が開始された";
      else if(latest.index!==owner?.index)reason="対象物件番号が変更された";
      else if(latest.searches[propertyIndex]?.url!==searchUrl)reason="検索条件が途中で変更された";
      else if(isAnyBatchActive())reason="申告処理へ移行していた";
      if(reason){
        const error=new Error("取得中に対象物件または実行状態が変わったため停止しました");
        error.scanStateChanged=true;
        error.scanStateReason=reason;
        throw error;
      }
    };
    assertCurrent();
    const baseParams=new URLSearchParams(base.search);
    const perPage=Math.min(100,Math.max(1,Number(baseParams.get("pc"))||30));
    const maxPages=80;
    const all=new Map();
    let previousIds="", previousHasNext=false, pageCount=0, pagesFinished=false;
    const seenPages=new Set();
    const metrics={requests:0,retries:0,networkMs:0,parseMs:0,matchMs:0,waitMs:0};
    // 直列取得を維持。応答・解析時間も240msの開始間隔に含め、二重待機をなくす。
    let lastRequestStarted=performance.now();
    async function getPage(url) {
      const targetUrl=new URL(url,location.origin);
      if(targetUrl.origin!==location.origin || !targetUrl.pathname.startsWith("/jj/chintai/ichiran/")){
        throw Object.assign(new Error("SUUMOの許可対象外URLです"),{scanNoRetry:true});
      }
      assertCurrent();
      const wait=Math.max(0,240-(performance.now()-lastRequestStarted));
      if(wait){await sleep(wait);metrics.waitMs+=wait;}
      assertCurrent();
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),12000);
      const started=performance.now();
      lastRequestStarted=started;
      metrics.requests++;
      try{
        const response=await fetch(targetUrl.href,{credentials:"same-origin",signal:controller.signal});
        if(!response.ok){
          const error=new Error("HTTP "+response.status+"：検索ページの取得失敗");
          if(![408,429,500,502,503,504].includes(response.status))error.scanNoRetry=true;
          const after=response.headers.get("retry-after");
          if(after){
            const ms=/^\d+$/.test(after)?Number(after)*1000:Date.parse(after)-Date.now();
            // SUUMOが明示的に500msより長い待機を要求する場合は、連続再試行しない。
            if(Number.isFinite(ms)&&ms>RETRY_WAIT_MS)error.scanNoRetry=true;
          }
          throw error;
        }
        const type=response.headers.get("content-type")||"";
        if(type&&!type.includes("html")){
          throw Object.assign(new Error("HTML形式以外の応答です"),{scanNoRetry:true});
        }
        const html=await response.text();
        assertCurrent();
        if(html.length<1000){
          throw Object.assign(new Error("ページ内容が不完全です"),{scanNoRetry:true});
        }
        return html;
      } finally{
        clearTimeout(timer);
        metrics.networkMs+=performance.now()-started;
      }
    }

    const comparable=url=>{
      const copy=new URL(url);
      copy.searchParams.delete("pn");copy.searchParams.delete("iimon");
      copy.searchParams.sort();return copy.href;
    };
    const sameSearch=comparable(current)===comparable(base);
    // pn=1 は現在表示中のページを使い、pn=2以降は同じ検索条件で巡回する。
    for(let page=1;page<=maxPages;page++){
      assertCurrent();
      const pageUrl=new URL(base.href);
      pageUrl.searchParams.delete("iimon");
      pageUrl.searchParams.set("pn",String(page));
      const reuse=!forceFetchFirst&&page===1&&(!current.searchParams.has("pn")||current.searchParams.get("pn")==="1")&&sameSearch;
      const html=reuse?null:await getPage(pageUrl.href);
      const parseStarted=performance.now();
      const doc=reuse?document:new DOMParser().parseFromString(html,"text/html");
      metrics.parseMs+=performance.now()-parseStarted;
      const matchStarted=performance.now();
      let cards=[...(doc.querySelector("#js-bukkenList")?.querySelectorAll(".js-property")||[])];
      if(page===1&&!cards.length&&doc===document&&document.readyState!=="complete"){
        await new Promise(resolve=>{
          const done=()=>{document.removeEventListener("readystatechange",onReady);clearTimeout(timer);resolve();};
          const onReady=()=>{if(document.readyState==="complete")done();};
          const timer=setTimeout(done,8000);
          document.addEventListener("readystatechange",onReady);
          if(document.readyState==="complete")done();
        });
        assertCurrent();
        cards=[...(doc.querySelector("#js-bukkenList")?.querySelectorAll(".js-property")||[])];
      }
      if(page===1&&!cards.length) {
        if(isConfirmedNoResultMessage(doc)){
          recordIssue({phase:"検索",index:propertyIndex+1,kind:"検索結果0件",
            action:"即時自動スキップ",attempts:1,detail:"SUUMOが検索結果0件を明示"});
          advancedMetric("search-total",scanStarted,metrics);
          return [];
        }
        throw new Error("検索結果のカードが見つかりません");
      }
      if(!cards.length){
        if(previousHasNext)throw new Error("次ページへのリンクがあるのに、検索結果を取得できません");
        if(!isConfirmedNoResultMessage(doc))throw new Error("最終ページの0件表示を確認できません");
        pagesFinished=true;break;
      }
      const currentRows=cards.map(readSuumoRoomCard);
      const finger=currentRows.map(x=>x.id||x.titleHref).join("|");
      if(!finger)throw new Error("検索ページを読み取れません");
      if(page>1 && seenPages.has(finger) && finger!==previousIds)throw new Error("検索ページが循環したため停止しました");
      seenPages.add(finger);
      if(page>1 && finger===previousIds){
        if(previousHasNext)throw new Error("次ページへ進めず検索ページが重複しました");
        pagesFinished=true;break;
      }
      previousIds=finger;
      const nextLink=[...doc.querySelectorAll("a[href]")].some(link=>{
        try{
          const u=new URL(link.getAttribute("href"),base.href);
          return u.origin===base.origin&&u.pathname===base.pathname&&Number(u.searchParams.get("pn"))===page+1;
        }catch(_){return false;}
      });
      previousHasNext=nextLink;
      for(const row of currentRows){
        if(row.address!==target.address||row.floor!==target.floor||row.area!==target.area||row.rentYen!==target.rentYen)continue;
        if(!row.id||row.idAmbiguous||!row.companyName||!row.companyKey||!row.titleHref){
          const missing=[
            !row.id&&"物件ID",
            row.idAmbiguous&&"物件IDの不一致",
            !row.companyName&&"会社名",
            !row.companyKey&&"会社識別子",
            !row.titleHref&&"物件詳細URL"
          ].filter(Boolean);
          throw new Error("物件ID "+(row.id||"不明")+"："+missing.join("・")+"を取得できません（検索"+page+"ページ目）。");
        }
        if(all.has(row.id)){
          const existing=all.get(row.id);
          if(existing.companyKey!==row.companyKey)throw new Error("同じ掲載IDに異なる会社が見つかりました");
          continue;
        }
        all.set(row.id,row);
      }
      metrics.matchMs+=performance.now()-matchStarted;
      pageCount++;
      showIeloveRoomScanProgress((propertyIndex+1)+"件目：検索ページ "+pageCount+" / 住戸条件一致 "+all.size+"件\n築年月 "+target.searchBuilt+" はSUUMO検索キーワードで絞り込み済み（個別検証なし）");
      if(!nextLink&&cards.length<perPage){pagesFinished=true;break;}
      if(page===maxPages)throw new Error("検索結果が80ページを超えたため全件取得を停止しました");
    }
    if(!pagesFinished)throw new Error("検索ページの最終ページを確認できません");
    // 詳細ページ照合を廃止：一覧の住戸条件に一致したカードを会社単位にまとめる。
    assertCurrent();
    const groupingStarted=performance.now();
    const groups=new Map();
    for(const item of all.values()){
      if(!groups.has(item.companyKey))groups.set(item.companyKey,{key:item.companyKey,name:item.companyName,urls:[]});
      groups.get(item.companyKey).urls.push("https://suumo.jp/chintai/bc_"+item.id+"/");
    }
    advancedMetric("company-grouping",groupingStarted,{matched:all.size});
    advancedMetric("search-total",scanStarted,{...metrics,pageCount});
    console.info("[SUUMO JJ 上位版] キーワード築年月＋住戸3条件の照合完了",{
      propertyIndex,pageCount,matched:all.size,companies:groups.size,searchBuilt:target.searchBuilt
    });
    return [...groups.values()];
  }

  async function collectIeloveSuumoResults() {
    if (ieloveCollecting || isBatchActive() || !isAuthorizedIeloveBatchSearch()) return;
    const handoff = getIeloveHandoff();
    if (!handoff) return;
    const index = Math.max(0, Math.min(Number(handoff.index) || 0, handoff.records.length - 1));
    if (new URL(location.href).searchParams.get("fw") !== new URL(handoff.searches[index].url).searchParams.get("fw")) return;
    const selections = GM_getValue(IELOVE_SUUMO_CHOICES_KEY, {});
    if (Array.isArray(selections[index]?.__companies) && selections[index].__fastRoomFilterVersion === IELOVE_FAST_ROOM_FILTER_VERSION && selections[index].__searchUrl === handoff.searches[index].url) {
      if (index < handoff.records.length - 1) navigateIeloveSuumo(1);
      else openIeloveSuumoSelection();
      return;
    }
    ieloveCollecting = true;
    try{
      markAdvancedTiming("search-collect-start",String(index+1));
      let companies=null,lastError=null,attempts=0;
      for(let attempt=1;attempt<=MAX_STAGE_ATTEMPTS;attempt++){
        attempts=attempt;
        try{
          companies=await scanIeloveSuumoPages(handoff.searches[index].url,index,attempt>1);
          break;
        }catch(error){
          lastError=error;
          const message=String(error?.message||error);
          // 対象切替・申告バッチ開始など、状態が変わった場合には安全停止。
          if(error?.scanStateChanged || /取得中に対象物件または実行状態が変わった/.test(message)){
            // Never auto-skip or retry a stale search. It may belong to a different batch.
            console.warn("[SUUMO JJ 上位版] 検索を安全停止:",error?.scanStateReason||"状態不一致");
            toast("検索の対象・実行状態が途中で切り替わりました。誤取得を防ぐため停止しました。"
              +"\n原因候補："+(error?.scanStateReason||"状態不一致")
              +"\n複数タブと上位版の重複起動を確認してください。",12000);
            return;
          }
          console.warn("[SUUMO JJ 上位版] 検索取得失敗",attempt+"/"+MAX_STAGE_ATTEMPTS,message);
          if(attempt===MAX_STAGE_ATTEMPTS||error?.scanNoRetry)break;
          showIeloveRoomScanProgress((index+1)+"件目：検索処理を再試行 "+(attempt+1)+"/3");
          await sleep(RETRY_WAIT_MS);
        }
      }
      const active=getIeloveHandoff();
      if(!isAuthorizedIeloveBatchSearch(active)||active.token!==handoff.token||
         active.index!==handoff.index||active.searches[index]?.url!==handoff.searches[index].url||
         isAnyBatchActive())return;
      const allAttemptsFailed=companies===null;
      if(companies===null){
        recordIssue({phase:"検索",index:index+1,kind:"検索・会社情報取得失敗",
          action:"最大3回試行後スキップ",attempts,
          detail:String(lastError?.message||lastError||"検索結果を読み取れません")});
        companies=[];
      }else if(!companies.length && !issueList().some(x=>x.phase==="検索"&&x.index===index+1)){
        recordIssue({phase:"検索",index:index+1,kind:"住戸条件一致0件・掲載会社0件",
          action:"再検索せず自動スキップ",attempts,
          detail:"全検索ページを確認しましたが住所・階数・面積・賃料に一致する掲載がありません"});
      }
      const latest=GM_getValue(IELOVE_SUUMO_CHOICES_KEY,{});
      latest[index]={__companies:companies,__collected:true,__emptyResult:!companies.length,
        __collectionError:allAttemptsFailed,
        __fastRoomFilterVersion:IELOVE_FAST_ROOM_FILTER_VERSION,
        __searchUrl:handoff.searches[index].url};
      GM_setValue(IELOVE_SUUMO_CHOICES_KEY,latest);
      markAdvancedTiming("search-collect-complete",String(index+1)+"物件 / "+companies.length+"社");
      document.getElementById("tm-ielove-room-scan-progress")?.remove();
      if(index<handoff.records.length-1)navigateIeloveSuumo(1);
      else openIeloveSuumoSelection();
    } finally {
      ieloveCollecting=false;
    }
  }

  function showIeloveCollectionError(index) {
    document.getElementById("tm-ielove-suumo-selection")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "tm-ielove-suumo-selection";
    overlay.style.cssText = "position:fixed;inset:0;background:#0007;z-index:2147483647;display:flex;align-items:center;justify-content:center";
    const box = document.createElement("div");
    box.style.cssText = "width:460px;max-width:92vw;background:white;border-radius:12px;padding:24px;color:#222;font-family:sans-serif";
    const title = document.createElement("h3");
    title.textContent = (index + 1) + "件目の検索結果を確認できませんでした";
    const message = document.createElement("p");
    const stats = getIeloveCollectionDiagnostics();
    message.textContent = "検索画面の物件カード " + stats.cards + "件、会社リンク付き " + stats.cardsWithCompanyLink + "件、取得会社 " + stats.companies + "社、掲載URL " + stats.listings + "件。結果を正しく取得できていないため停止しました。検索結果を確認してください。";
    const retry = document.createElement("button");
    retry.textContent = "再取得する";
    retry.style.cssText = "padding:12px 22px;background:#205375;color:white;border:0;border-radius:8px;cursor:pointer";
    retry.onclick = () => { overlay.remove(); collectIeloveSuumoResults(); };
    box.append(title,message,retry);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  function openIeloveSuumoSelection() {
    const handoff = getIeloveHandoff();
    if (!handoff || isBatchActive() || !isIeloveSelectionReady()) return;
    const selectionStarted = performance.now();
    markAdvancedTiming("all-properties-complete");
    const choices = GM_getValue(IELOVE_SUUMO_CHOICES_KEY, {});
    if (handoff.records.some((_,i) => !Array.isArray(choices[i]?.__companies))) return;
    if(!handoff.records.some((_,i)=>choices[i].__companies.length)){
      openIssueResults();
      return;
    }
    document.getElementById("tm-ielove-suumo-selection")?.remove();
    const exclusions = new Set(GM_getValue(IELOVE_SUUMO_GLOBAL_EXCLUDES, []));
    const modes = {};
    handoff.records.forEach((_,i) => { modes[i] = {...choices[i]}; });
    const overlay = document.createElement("div");
    overlay.id = "tm-ielove-suumo-selection";
    overlay.style.cssText = "position:fixed;inset:0;background:#0007;z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:sans-serif";
    const shell = document.createElement("div");
    shell.style.cssText = "width:850px;max-width:95vw;height:86vh;max-height:900px;background:#fff;border-radius:14px;box-shadow:0 12px 35px #0005;display:flex;flex-direction:column;overflow:hidden;color:#222";
    const head = document.createElement("div");
    head.style.cssText = "padding:17px 20px;border-bottom:1px solid #ddd;flex-shrink:0";
    const title = document.createElement("div");
    title.textContent = "SUUMO 一括指摘対象の選択";
    title.style.cssText = "font-weight:bold;font-size:21px";
    const subtitle = document.createElement("div");
    subtitle.textContent = handoff.records.length + "物件の掲載会社をまとめて選択（築年月は検索キーワードで絞り込み）";
    subtitle.style.cssText = "font-size:13px;color:#666;margin-top:5px";
    head.append(title,subtitle);
    const list = document.createElement("div");
    list.style.cssText = "overflow-y:auto;flex:1;min-height:0;padding:12px 18px";
    const choiceStyles = {report:"background:#1677ff;color:#fff;border-color:#1677ff",once:"background:#fa8c16;color:#fff;border-color:#fa8c16",permanent:"background:#d9363e;color:#fff;border-color:#d9363e"};
    const save = () => {
      const latest = GM_getValue(IELOVE_SUUMO_CHOICES_KEY, {});
      handoff.records.forEach((_,i) => { latest[i] = {...modes[i],__companies:choices[i].__companies}; });
      GM_setValue(IELOVE_SUUMO_CHOICES_KEY, latest);
      GM_setValue(IELOVE_SUUMO_GLOBAL_EXCLUDES, [...exclusions]);
    };
    const update = () => {
      list.querySelectorAll("[data-company-key]").forEach(row => {
        const key = row.dataset.companyKey;
        const index = Number(row.dataset.propertyIndex);
        const effective = exclusions.has(key) ? "permanent" : (modes[index][key] || "report");
        row.querySelectorAll("button[data-choice]").forEach(button => {
          const mode = button.dataset.choice;
          button.style.cssText = "flex:1;min-width:0;padding:10px 3px;border:2px solid #ddd;border-radius:8px;background:white;color:#333;font-weight:bold;cursor:pointer;font-size:12px";
          if (mode === effective) button.style.cssText += ";" + choiceStyles[mode];
          button.textContent = (effective === mode ? "✓ " : "") + ({report:"指摘する",once:"今回だけ除外",permanent:"今後も除外"}[mode]);
        });
      });
    };
    handoff.records.forEach((record,index) => {
      if(!choices[index].__companies.length)return; // 0件物件は対象選択から除外
      const section = document.createElement("section");
      section.style.cssText = "padding:14px;margin-bottom:12px;border:1px solid #dce3e8;border-radius:12px;background:#fff";
      const heading = document.createElement("div");
      heading.textContent = (index + 1) + ". " + (record.name || "物件名未取得") + " ／ " + (record.room || "");
      heading.style.cssText = "font-weight:bold;font-size:16px;margin-bottom:10px";
      section.appendChild(heading);
      const companies = choices[index].__companies;
      if (!companies.length) {
        const empty = document.createElement("div");
        empty.textContent = choices[index].__collectionError?
          "検索／会社情報取得に失敗・指摘対象0件（エラー記録済み）":
          "掲載会社なし・指摘対象0件（自動スキップ）";
        empty.style.cssText = "color:#777;font-size:13px;padding:6px 0";
        section.appendChild(empty);
      }
      companies.forEach(company => {
        const row = document.createElement("div");
        row.dataset.companyKey = company.key;
        row.dataset.propertyIndex = index;
        row.style.cssText = "padding:9px 0;border-top:1px solid #eee";
        const label = document.createElement("div");
        label.textContent = company.name + "（掲載 " + company.urls.length + "件）";
        label.style.cssText = "font-size:14px;font-weight:bold;margin-bottom:6px";
        const buttons = document.createElement("div");
        buttons.style.cssText = "display:flex;gap:7px";
        for (const mode of ["report","once","permanent"]) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.choice = mode;
          button.onclick = () => {
            if (mode === "permanent") exclusions.add(company.key);
            else { exclusions.delete(company.key); modes[index][company.key] = mode; }
            save();
            update();
          };
          buttons.appendChild(button);
        }
        row.append(label,buttons);
        section.appendChild(row);
      });
      list.appendChild(section);
    });
    const footer = document.createElement("div");
    footer.style.cssText = "padding:14px 18px;background:#fafafa;border-top:1px solid #ddd;display:flex;gap:10px;flex-shrink:0";
    const start = document.createElement("button");
    start.textContent = "選択を終えて一括指摘へ";
    start.style.cssText = "flex:2;padding:13px 12px;background:#205375;color:white;border:0;border-radius:8px;font-weight:bold;cursor:pointer";
    start.onclick = () => { save(); startIeloveSuumoReporting(); };
    const close = document.createElement("button");
    close.textContent = "閉じる";
    close.style.cssText = "flex:1;padding:13px 12px;background:white;border:1px solid #ccd3da;border-radius:8px;font-weight:bold;cursor:pointer";
    close.onclick = () => { save(); overlay.remove(); };
    footer.append(start,close);
    shell.append(head,list,footer);
    overlay.appendChild(shell);
    document.body.appendChild(overlay);
    update();
    advancedMetric("company-selection-dom", selectionStarted);
    requestAnimationFrame(() => markAdvancedTiming("company-selection-visible"));
  }

  function navigateIeloveSuumo(delta) {
    const handoff = getIeloveHandoff();
    if (!handoff) return;
    handoff.index = Math.max(0, Math.min((Number(handoff.index)||0)+delta, handoff.records.length - 1));
    GM_setValue(IELOVE_SUUMO_HANDOFF_KEY, handoff);
    markAdvancedTiming("search-navigation-start");
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
    if((!item||item.status!=="sending")&&!currentUncertainSend())return false;
    if(isCompletePage()||confirmSendStarted)return true;
    cancelAutoAction(false);
    return advanceUncertainSubmission("最終送信を開始しましたが、完了画面を確認できません");
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
      if (!selection || !Array.isArray(selection.__companies) || (selection.__fastRoomFilterVersion !== IELOVE_FAST_ROOM_FILTER_VERSION || selection.__searchUrl !== handoff.searches[i].url)) {
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
      if(!openIssueResults())alert("指摘対象がありません。選択内容を確認してください。");
      return;
    }
    if (!confirm(handoff.records.length + "物件から" + items.length + "掲載を指摘対象として選択しました。\n\n実際にSUUMOへ申告処理を開始しますか？")) return;
    GM_setValue(IELOVE_BATCH_EXECUTION_KEY, { items, startedAt:Date.now(), finishedAt:null });
    GM_deleteValue(IELOVE_SUUMO_HANDOFF_KEY);
    if (!setBatch(items.map(item => item.url), 0, "ielove")) return;
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
        closeSettingsPanel();
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
        closeSettingsPanel();
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
      if (!/^\/rent(?:\/|$)/.test(location.pathname)) return;
      addIeloveSettingsButton();
      requireProfileManager();
      return;
    }

    if (location.hostname !== "suumo.jp") return;

    addMainButtons();
    if (!requireProfileManager()) return;

    if (!isBatchActive() && isAuthorizedIeloveBatchSearch()) {
      await collectIeloveSuumoResults();
    }

    if (!isBatchActive()) return;
    if(isListingPage()){
      if(!bindListingToTab())return rejectStaleTabPage();
    }else if(!isCurrentTabItem())return rejectStaleTabPage();
    startBackgroundWatchdog();
    if((currentIeloveExecutionItem()?.status==="sending"||currentUncertainSend())&&!isCompletePage()){
      if(!isConfirmPage())advanceUncertainSubmission("送信後に完了ページ以外の画面へ遷移しました");
      else startBackgroundWatchdog();
      return;
    }
    updateBatchPanel();

    if (isListingPage()) {
      await handleListingPage();
      return;
    }

    // 掲載終了時にSUUMOがエラーページへ転送した場合も明示文言があれば次へ。
    // リンク取得失敗や未知のページでは自動スキップしない。
    if(getBatchStage()===STAGES.LISTING && autoSkipEndedListingIfConfirmed())return;

    if (isInputPage()) {
      if (isSubmitting()) {
        scheduleReportRetry("内容確認画面へ移動","SUUMOの確認画面へ進まず入力画面に戻りました");
        return;
      }

      const stage = getBatchStage();
      if (stage === STAGES.INPUT_READY || stage === STAGES.INPUT_CONFIRM) {
        if (stage === STAGES.INPUT_CONFIRM) setBatchStage(STAGES.INPUT_READY);
        setFormReady(true);
        setConfirmReady(false);
        updateBatchPanel();
        recoverAutoActionIfDue();
        return;
      }

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
