// ==UserScript==
// @name         いえらぶ スポット 周辺環境
// @namespace    ierabu-spot-environment
// @version      1.0
// @description  いえらぶCLOUDの絞り込み済み物件に周辺環境を安全に連続自動設定します。
// @match        https://cloud.ielove.jp/*
// @updateURL    https://raw.githubusercontent.com/Alpha0727/suumo-jj-tool/main/IERABU-SPOT.user.js
// @downloadURL  https://raw.githubusercontent.com/Alpha0727/suumo-jj-tool/main/IERABU-SPOT.user.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// ==/UserScript==

(function () {
    'use strict';

    const STATE_KEY = 'ierabu_env_auto_all_state';
    const LOG_KEY   = 'ierabu_env_auto_all_log';

    const SCRIPT_VERSION = '1.0';
    const SCRIPT_URL = 'https://raw.githubusercontent.com/Alpha0727/suumo-jj-tool/main/IERABU-SPOT.user.js';
    const VERSION_URL = 'https://raw.githubusercontent.com/Alpha0727/suumo-jj-tool/main/latest-spot.json';

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function compareVersions(a, b) {
        const aa = String(a).split('.').map(Number);
        const bb = String(b).split('.').map(Number);
        const len = Math.max(aa.length, bb.length);

        for (let i = 0; i < len; i++) {
            const av = aa[i] || 0;
            const bv = bb[i] || 0;
            if (av !== bv) return av > bv ? 1 : -1;
        }

        return 0;
    }

    function checkScriptUpdate() {
        const version = document.querySelector('#ierabu-spot-version');
        const button = document.querySelector('#ierabu-spot-update');

        if (!version || !button) return;

        version.textContent = `Ver.${SCRIPT_VERSION}`;
        version.title = '最新版を確認中…';
        button.disabled = true;
        button.textContent = 'アップデート';
        button.style.opacity = '0.55';

        GM_xmlhttpRequest({
            method: 'GET',
            url: VERSION_URL + '?t=' + Date.now(),
            headers: { 'Cache-Control': 'no-cache' },
            onload: response => {
                try {
                    if (response.status < 200 || response.status >= 300) {
                        throw new Error('version check failed');
                    }

                    const info = JSON.parse(response.responseText || '{}');
                    const latest = String(info.version || '').trim();
                    const notes = String(info.notes || '').trim();
                    const installUrl = String(info.install_url || SCRIPT_URL).trim();

                    if (!latest) throw new Error('version missing');

                    version.title =
                        `現在：Ver.${SCRIPT_VERSION}\n最新版：Ver.${latest}` +
                        (notes ? `\n\n${notes}` : '');

                    if (compareVersions(latest, SCRIPT_VERSION) > 0) {
                        version.textContent = `Ver.${SCRIPT_VERSION} !`;
                        version.style.color = '#d97706';

                        button.disabled = false;
                        button.style.opacity = '1';
                        button.style.background = '#2f7cf6';
                        button.style.color = '#fff';
                        button.dataset.latestVersion = latest;
                        button.dataset.installUrl = installUrl;
                        button.title = `Ver.${latest} にアップデート`;
                    } else {
                        version.style.color = '#777';
                        button.disabled = true;
                        button.style.opacity = '0.55';
                        button.title = `最新版です（Ver.${SCRIPT_VERSION}）`;
                    }
                } catch (error) {
                    version.title = '更新確認に失敗しました';
                    console.warn('[いえらぶ スポット] version check failed:', error);
                }
            },
            onerror: error => {
                version.title = '更新確認に失敗しました';
                console.warn('[いえらぶ スポット] version check failed:', error);
            }
        });
    }

    // =========================================================
    // 状態管理
    // =========================================================

    function getState() {
        try {
            return JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
        } catch (_) {
            return null;
        }
    }

    function setState(state) {
        sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    }

    function clearState() {
        sessionStorage.removeItem(STATE_KEY);
    }

    function getLogs() {
        try {
            return JSON.parse(sessionStorage.getItem(LOG_KEY) || '[]');
        } catch (_) {
            return [];
        }
    }

    function pushLog(message) {
        const logs = getLogs();
        const time = new Date().toLocaleTimeString();

        logs.push(`${time}　${message}`);

        while (logs.length > 200) logs.shift();

        sessionStorage.setItem(LOG_KEY, JSON.stringify(logs));
        console.log('[いえらぶ自動化]', message);

        renderLogs();
    }

    function clearLogs() {
        sessionStorage.removeItem(LOG_KEY);
        renderLogs();
    }

    // =========================================================
    // 共通
    // =========================================================

    async function waitFor(selector, timeout = 15000) {
        const start = Date.now();

        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector);
            if (el) return el;
            await sleep(300);
        }

        throw new Error(`見つかりません: ${selector}`);
    }

    async function waitUntil(fn, timeout = 20000, interval = 500) {
        const start = Date.now();

        while (Date.now() - start < timeout) {
            try {
                if (fn()) return true;
            } catch (_) {}

            await sleep(interval);
        }

        return false;
    }

    function stopWithError(message) {
        pushLog(`⛔ ${message}`);

        const state = getState();

        if (state) {
            state.active = false;
            state.stage = 'error';
            state.error = message;
            setState(state);
        }

        updateStatus();

        alert(
            'いえらぶ自動化を停止しました。\n\n' +
            message +
            '\n\n安全のため、以降の自動処理は実行していません。'
        );
    }

    function isEditPage() {
        return /\/rent\/manager\/edit\/id\/\d+/i.test(location.pathname);
    }

    function extractPropertyId(url) {
        const m = String(url).match(/\/rent\/manager\/edit\/id\/(\d+)/i);
        return m ? m[1] : '';
    }

    // =========================================================
    // 一覧から編集URL取得
    // =========================================================

    function collectEditUrls() {
        const links = [
            ...document.querySelectorAll('a[href*="/rent/manager/edit/id/"]')
        ];

        const urls = [];
        const seen = new Set();

        for (const a of links) {
            const href = a.href || a.getAttribute('href') || '';

            if (!/\/rent\/manager\/edit\/id\/\d+/i.test(href)) {
                continue;
            }

            const id = extractPropertyId(href);

            if (!id || seen.has(id)) continue;

            seen.add(id);
            urls.push(href);
        }

        return urls;
    }

    // =========================================================
    // パネル
    // =========================================================

    function createPanel() {
        if (document.querySelector('#ierabu-spot-toggle')) return;

        const toggle = document.createElement('button');
        toggle.id = 'ierabu-spot-toggle';
        toggle.textContent = 'スポット';

        Object.assign(toggle.style, {
            position: 'fixed',
            right: '16px',
            bottom: '64px',
            zIndex: '2147483646',
            padding: '11px 18px',
            border: 'none',
            borderRadius: '10px',
            background: '#2f7cf6',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 3px 12px rgba(0,0,0,.22)'
        });

        toggle.addEventListener('click', () => {
            const existing = document.querySelector('#ierabu-auto-panel');

            if (existing) {
                existing.remove();
                return;
            }

            openSpotPanel();
        });

        document.body.appendChild(toggle);
    }

    function openSpotPanel() {
        if (document.querySelector('#ierabu-auto-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'ierabu-auto-panel';

        Object.assign(panel.style, {
            position: 'fixed',
            right: '16px',
            bottom: '112px',
            width: '370px',
            maxWidth: 'calc(100vw - 32px)',
            background: '#fff',
            border: '2px solid #2f7cf6',
            borderRadius: '10px',
            padding: '12px',
            zIndex: '2147483646',
            boxShadow: '0 5px 18px rgba(0,0,0,.25)',
            fontSize: '13px'
        });

        panel.innerHTML = `
            <div style="
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:10px;
                margin-bottom:9px;
            ">
                <div style="
                    display:flex;
                    align-items:center;
                    gap:8px;
                    min-width:0;
                ">
                    <div style="
                        font-weight:bold;
                        font-size:15px;
                        white-space:nowrap;
                    ">スポット 周辺環境</div>

                    <span id="ierabu-spot-version" style="
                        font-size:11px;
                        color:#777;
                        white-space:nowrap;
                    ">Ver.${SCRIPT_VERSION}</span>
                </div>

                <div style="
                    display:flex;
                    align-items:center;
                    gap:6px;
                    flex-shrink:0;
                ">
                    <button id="ierabu-spot-update" type="button" disabled style="
                        padding:5px 9px;
                        border:0;
                        border-radius:6px;
                        background:#2f7cf6;
                        color:#fff;
                        font-size:11px;
                        font-weight:bold;
                        cursor:pointer;
                        opacity:.55;
                    ">アップデート</button>

                    <button id="ierabu-spot-close" type="button" style="
                        border:none;
                        background:transparent;
                        font-size:18px;
                        cursor:pointer;
                        padding:0 2px;
                    ">×</button>
                </div>
            </div>

            <div id="ierabu-status" style="
                margin-bottom:8px;
                padding:7px;
                background:#f2f4fb;
                border-radius:4px;
                line-height:1.5;
            ">待機中</div>

            <button id="ierabu-start-all" style="
                width:100%;
                padding:10px;
                cursor:pointer;
                margin-bottom:7px;
                font-weight:bold;
            ">
                絞り込み済み一覧を全件開始
            </button>

            <button id="ierabu-stop" style="
                width:100%;
                padding:7px;
                cursor:pointer;
                margin-bottom:7px;
            ">
                自動処理を停止
            </button>

            <button id="ierabu-reset" style="
                width:100%;
                padding:6px;
                cursor:pointer;
                margin-bottom:8px;
            ">
                状態をリセット
            </button>

            <div id="ierabu-auto-log" style="
                height:200px;
                overflow:auto;
                border:1px solid #ccc;
                padding:6px;
                background:#f7f7f7;
                font-size:11px;
            "></div>
        `;

        document.body.appendChild(panel);

        document
            .querySelector('#ierabu-start-all')
            .addEventListener('click', startAll);

        document
            .querySelector('#ierabu-stop')
            .addEventListener('click', () => {
                const state = getState();

                if (state) {
                    state.active = false;
                    state.stage = 'stopped';
                    setState(state);
                }

                pushLog('■ 手動停止しました');
                updateStatus();

                alert('自動処理を停止しました。');
            });

        document
            .querySelector('#ierabu-reset')
            .addEventListener('click', () => {
                clearState();
                clearLogs();
                updateStatus();

                alert('自動化の状態をリセットしました。');
            });

        document
            .querySelector('#ierabu-spot-close')
            .addEventListener('click', () => panel.remove());

        document
            .querySelector('#ierabu-spot-update')
            .addEventListener('click', event => {
                const button = event.currentTarget;
                if (button.disabled) return;

                const latest = button.dataset.latestVersion || String(Date.now());
                const installUrl = button.dataset.installUrl || SCRIPT_URL;
                const separator = installUrl.includes('?') ? '&' : '?';

                window.open(
                    installUrl +
                    separator +
                    'install=' + encodeURIComponent(latest) +
                    '&t=' + Date.now(),
                    '_blank'
                );
            });

        renderLogs();
        updateStatus();
        checkScriptUpdate();
    }

    function renderLogs() {
        const box = document.querySelector('#ierabu-auto-log');
        if (!box) return;

        const logs = getLogs();

        box.innerHTML = logs.length
            ? logs.map(x => `<div>${escapeHtml(x)}</div>`).join('')
            : '<div>待機中</div>';

        box.scrollTop = box.scrollHeight;
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function updateStatus() {
        const el = document.querySelector('#ierabu-status');
        if (!el) return;

        const state = getState();

        if (!state) {
            el.innerHTML = '待機中';
            return;
        }

        const total = state.queue?.length || 0;
        const completed = Math.min(state.index || 0, total);
        const current = Math.min((state.index || 0) + 1, total || 1);

        if (state.stage === 'completed') {
            el.innerHTML =
                `完了 ✅<br>` +
                `進捗：${total} / ${total}`;
            return;
        }

        if (!state.active) {
            el.innerHTML =
                `停止中<br>` +
                `進捗：${completed} / ${total}<br>` +
                `状態：${state.stage || '-'}`;
            return;
        }

        el.innerHTML =
            `処理中：${current} / ${total}<br>` +
            `完了：${completed}件<br>` +
            `段階：${state.stage || '-'}`;
    }

    // =========================================================
    // 全件開始
    // =========================================================

    function startAll() {
        if (isEditPage()) {
            alert(
                '全件処理は、絞り込み済みの物件一覧画面から開始してください。'
            );
            return;
        }

        const urls = collectEditUrls();

        if (urls.length === 0) {
            alert(
                'この画面から通常の「編集」リンクを取得できませんでした。\n\n' +
                '絞り込み済み物件一覧を開いてから開始してください。'
            );
            return;
        }

        const ok = confirm(
            `絞り込み済み一覧から ${urls.length}件 を検出しました。\n\n` +
            `この ${urls.length}件 を上から順番に自動処理します。\n\n` +
            `開始しますか？`
        );

        if (!ok) return;

        sessionStorage.setItem(LOG_KEY, JSON.stringify([]));

        const state = {
            active: true,
            stage: 'goEdit',
            queue: urls,
            index: 0,
            startedAt: Date.now()
        };

        setState(state);

        pushLog(`開始：一覧から ${urls.length}件 を検出`);
        pushLog('全件処理を開始します');

        updateStatus();
        goCurrentEdit();
    }

    function goCurrentEdit() {
        const state = getState();

        if (!state || !state.active) return;

        if (state.index >= state.queue.length) {
            finishAll();
            return;
        }

        const url = state.queue[state.index];
        const id = extractPropertyId(url);

        state.stage = 'goEdit';
        setState(state);

        pushLog(`▶ ${state.index + 1}/${state.queue.length} 物件ID ${id} を開きます`);
        updateStatus();

        location.href = url;
    }

    // =========================================================
    // 編集画面
    // =========================================================

    async function processCurrentEdit() {
        const state = getState();

        if (!state || !state.active) return;
        if (!isEditPage()) return;
        if (!['goEdit', 'editing'].includes(state.stage)) return;

        const expectedUrl = state.queue[state.index];
        const expectedId = extractPropertyId(expectedUrl);
        const currentId = extractPropertyId(location.href);

        if (expectedId && currentId && expectedId !== currentId) {
            stopWithError(
                `処理対象IDが一致しません。予定:${expectedId} / 現在:${currentId}`
            );
            return;
        }

        try {
            state.stage = 'editing';
            setState(state);
            updateStatus();

            pushLog('① 周辺環境を開きます');

            const environmentTab =
                await waitFor('#qtipEnvironment');

            environmentTab.click();
            await sleep(700);

            pushLog('② 10km以内を開きます');

            const tenKm =
                await waitFor('#spotBatchNavitimeSetup100');

            tenKm.click();

            const allCheck =
                await waitFor('#js-checkAllEnvironment', 15000);

            await waitFor('#addSpot', 15000);

            pushLog('③ 候補一覧を確認しました');

            if (!allCheck.checked) {
                allCheck.click();
                await sleep(500);
            }

            if (!allCheck.checked) {
                throw new Error(
                    '候補物件を全選択できませんでした'
                );
            }

            pushLog('④ 候補物件を全選択しました');

            const addSpot =
                document.querySelector('#addSpot');

            if (!addSpot) {
                throw new Error(
                    '「反映」ボタンが見つかりません'
                );
            }

            addSpot.click();
            pushLog('⑤ 周辺環境を反映しました');

            await sleep(1000);

            pushLog('⑥ 徒歩距離の反映を待っています…');

            const distanceSuccess =
                await waitUntil(() => {

                    const allDistances = [
                        ...document.querySelectorAll('.spotDistance')
                    ].filter(el => el.offsetParent !== null);

                    const configuredDistances =
                        allDistances.filter(el => {

                            let parent = el.parentElement;

                            for (let i = 0; i < 8 && parent; i++) {

                                const distanceCount =
                                    parent.querySelectorAll('.spotDistance').length;

                                const text =
                                    (parent.innerText || '')
                                        .replace(/\s+/g, '');

                                if (
                                    distanceCount === 1 &&
                                    text.includes('周辺環境が設定されていません')
                                ) {
                                    return false;
                                }

                                parent = parent.parentElement;
                            }

                            return true;
                        });

                    if (configuredDistances.length === 0) {
                        return false;
                    }

                    const empty =
                        configuredDistances.filter(el =>
                            !String(el.value).trim()
                        );

                    pushLog(
                        `設定済み ${configuredDistances.length}件 / 徒歩距離未反映 ${empty.length}件`
                    );

                    return empty.length === 0;

                }, 30000, 1000);

            if (!distanceSuccess) {
                throw new Error(
                    '設定済み周辺環境の徒歩距離がすべて反映されませんでした'
                );
            }

            pushLog('✅ 徒歩距離がすべて反映されました');

            const saveButton =
                document.querySelector('#submitButton');

            if (!saveButton) {
                throw new Error(
                    '1回目の保存ボタンが見つかりません'
                );
            }

            state.stage = 'afterFirstSave';
            setState(state);
            updateStatus();

            pushLog('⑦ 1回目の保存を実行します');

            saveButton.click();

        } catch (e) {
            stopWithError(e.message);
        }
    }

    // =========================================================
    // 1回目保存後
    // =========================================================

    async function handleAfterFirstSave() {
        const state = getState();

        if (!state || !state.active) return;
        if (state.stage !== 'afterFirstSave') return;

        await sleep(1200);

        const duplicateChecks =
            document.querySelectorAll('.unifyIds');

        const finalSave =
            document.querySelector('#unifySubmit');

        // =====================================================
        // 重複あり
        // =====================================================

        if (duplicateChecks.length > 0 || finalSave) {

            pushLog('⚠ 重複物件を検出しました');

            const clearButton =
                document.querySelector('a.all_check_false');

            if (!clearButton) {
                stopWithError(
                    '重複物件がありますが、「選択を解除」が見つかりません'
                );
                return;
            }

            // ★ 必須工程 ★
            pushLog('⑧ 重複物件の「選択を解除」を実行します');

            clearButton.click();
            await sleep(500);

            const cleared =
                await waitUntil(() => {

                    const checked =
                        document.querySelectorAll('.unifyIds:checked');

                    pushLog(`重複物件 選択中 ${checked.length}件`);

                    return checked.length === 0;

                }, 5000, 300);

            if (!cleared) {
                stopWithError(
                    '重複物件のチェックが残っています。最終保存は実行しません。'
                );
                return;
            }

            const remaining =
                document.querySelectorAll('.unifyIds:checked');

            if (remaining.length !== 0) {
                stopWithError(
                    `重複物件が ${remaining.length}件 選択されたままです`
                );
                return;
            }

            pushLog('✅ 重複物件の選択が0件になりました');

            const save =
                document.querySelector('#unifySubmit');

            if (!save) {
                stopWithError(
                    '最終保存ボタンが見つかりません'
                );
                return;
            }

            state.stage = 'finalSaving';
            setState(state);
            updateStatus();

            pushLog('⑨ 最終保存を実行します');

            save.click();
            return;
        }

        // =====================================================
        // 重複なし
        // =====================================================

        pushLog('✅ 重複物件なし');
        completeCurrentAndNext();
    }

    // =========================================================
    // 最終保存後
    // =========================================================

    function handleAfterFinalSave() {
        const state = getState();

        if (!state || !state.active) return;
        if (state.stage !== 'finalSaving') return;

        pushLog('✅ 最終保存後の画面へ移動しました');
        completeCurrentAndNext();
    }

    // =========================================================
    // 1件完了 → 次へ
    // =========================================================

    function completeCurrentAndNext() {
        const state = getState();

        if (!state || !state.active) return;

        const doneNumber = state.index + 1;

        pushLog(`✅ ${doneNumber}/${state.queue.length} 件目 完了`);

        state.index += 1;

        if (state.index >= state.queue.length) {
            setState(state);
            finishAll();
            return;
        }

        state.stage = 'goEdit';
        setState(state);
        updateStatus();

        const nextUrl = state.queue[state.index];
        const nextId = extractPropertyId(nextUrl);

        pushLog(`次の物件ID ${nextId} へ進みます`);

        setTimeout(() => {
            location.href = nextUrl;
        }, 800);
    }

    function finishAll() {
        const state = getState();
        const total = state?.queue?.length || 0;

        if (state) {
            state.active = false;
            state.stage = 'completed';
            setState(state);
        }

        pushLog(`🎉 全件完了：${total}件すべて処理しました`);
        updateStatus();

        alert(
            `スポットの全件処理が完了しました。\n\n` +
            `${total}件すべて処理済みです。`
        );
    }

    // =========================================================
    // 再開処理
    // =========================================================

    async function resumeAutomation() {
        const state = getState();

        updateStatus();

        if (!state || !state.active) return;

        if (state.stage === 'goEdit') {
            if (isEditPage()) {
                await processCurrentEdit();
            } else {
                setTimeout(goCurrentEdit, 500);
            }
            return;
        }

        if (state.stage === 'editing') {
            if (isEditPage()) {
                await processCurrentEdit();
            }
            return;
        }

        if (state.stage === 'afterFirstSave') {
            await handleAfterFirstSave();
            return;
        }

        if (state.stage === 'finalSaving') {
            handleAfterFinalSave();
            return;
        }
    }

    // =========================================================
    // 起動
    // =========================================================

    window.addEventListener('load', () => {
        createPanel();
        resumeAutomation();
    });

})();