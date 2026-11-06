// ==UserScript==
// @name         Legion - Кото-игры
// @namespace    https://github.com/AhaHaHAH44/Legion-Mini-Games
// @version      2.0.8
// @description  Multiplayer mini-games for Multidonate
// @author       Sectwi1l
// @homepageURL  https://github.com/AhaHaHAH44/Legion-Mini-Games
// @supportURL   https://github.com/AhaHaHAH44/Legion-Mini-Games/issues
// @updateURL    https://raw.githubusercontent.com/AhaHaHAH44/Legion-Mini-Games/main/Legion_Mini_Games.user.js
// @downloadURL  https://raw.githubusercontent.com/AhaHaHAH44/Legion-Mini-Games/main/Legion_Mini_Games.user.js
// @match        https://play.multidonate.ru/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      legion-server.onrender.com
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        serverUrl: 'https://legion-server.onrender.com',
        heartbeatInterval: 20000,
        playersRefreshInterval: 10000,
        invitationsRefreshInterval: 5000,
        matchRefreshInterval: 2000,
        rouletteRefreshInterval: 3000
    };

    const STORAGE = {
        playerId: 'legion_mini_player_id',
        nickname: 'legion_mini_nickname',
        publishedMatches: 'legion_mini_published_matches',
        doNotDisturb: 'legion_mini_do_not_disturb'
    };

    let playerId = localStorage.getItem(STORAGE.playerId);
    let nickname = localStorage.getItem(STORAGE.nickname);
    let doNotDisturb = localStorage.getItem(STORAGE.doNotDisturb) === 'true';

    if (!playerId) {
        playerId = crypto.randomUUID();
        localStorage.setItem(STORAGE.playerId, playerId);
    }

    // Получение никнейма из интерфейса Multidonate
    function getMultidonateNickname() {
        const element = document.querySelector('span.whn, span.who');
        const value = element?.textContent?.trim();
    
        return value ? value.slice(0, 32) : null;
    }

    // Ожидание появления никнейма после загрузки страницы
    async function waitForNickname(timeout = 20000) {
        const start = Date.now();

        while (Date.now() - start < timeout) {
            const value = getMultidonateNickname();

            if (value) return value;

            await new Promise(resolve => setTimeout(resolve, 300));
        }

        return null;
    }

    const shownInvitations = new Set();
    let activeInvitation = null;
    let activeMatchId = null;
    let displayedMatchId = null;
    let matchResultShown = false;
    let displayedModeMatchId = null;
    let displayedBetMatchId = null;
    let currentKnbMatch = null;
    let moveSubmitted = false;
    let ui;

    const ROULETTE_RESOURCES = {
        pebble: { id: 'pebble', name: 'Камушек', emoji: '🪨', points: 1 },
        limestone: { id: 'limestone', name: 'Известняк', emoji: '⚪', points: 2 },
        iron: { id: 'iron', name: 'Железо', emoji: '⛓️', points: 3 },
        coal: { id: 'coal', name: 'Уголь', emoji: '⬛', points: 3 },
        gold: { id: 'gold', name: 'Золото', emoji: '🟡', points: 5 },
        topaz: { id: 'topaz', name: 'Топаз', emoji: '💎', points: 8 }
    };

    let rouletteCooldownUntil = 0;
    let rouletteBalance = 0;
    let rouletteLastTieRoundShown = 0;
    let rouletteNegotiationShown = null;
    let rouletteResult = null;
    let rouletteSpinning = false;
    let rouletteInvite = null;
    let rouletteMatchId = null;
    let rouletteMatchShown = null;
    let rouletteWaitingShown = false;
    let rouletteHasSpun = false;
    let rouletteResultShown = false;
    let rouletteResultMatchId = null;
    let rouletteInviteIds = new Set();
    let rouletteTimers = [];
    let rouletteMatchRequestInFlight = false;

    const ROULETTE_COMPLETED_KEY = 'legion_mini_roulette_completed';
    const ROULETTE_PUBLISHED_KEY = 'legion_mini_roulette_published';

    function getStoredRouletteIds(key) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || '[]');
            return new Set(Array.isArray(value) ? value : []);
        } catch (_) {
            return new Set();
        }
    }

    const completedRouletteMatches = getStoredRouletteIds(ROULETTE_COMPLETED_KEY);
    const publishedRouletteMatches = getStoredRouletteIds(ROULETTE_PUBLISHED_KEY);

    function rememberRouletteMatch(key, set, matchId) {
        set.add(matchId);
        localStorage.setItem(key, JSON.stringify([...set].slice(-100)));
    }

    function request(method, path, data, callback) {
        GM_xmlhttpRequest({
            method,
            url: CONFIG.serverUrl + path,
            headers: data ? { 'Content-Type': 'application/json' } : {},
            data: data ? JSON.stringify(data) : undefined,
            timeout: 20000,

            onload(response) {
                let result;

                try {
                    result = JSON.parse(response.responseText);
                } catch (error) {
                    callback(error, null, response.status);
                    return;
                }

                callback(null, result, response.status);
            },

            onerror() {
                callback(new Error('Connection failed'), null, 0);
            },

            ontimeout() {
                callback(new Error('Request timeout'), null, 0);
            }
        });
    }

    function addStyles() {
        const style = document.createElement('style');

        style.textContent = `
            #legion-mini-widget {
                position: fixed;
                right: 20px;
                bottom: 20px;
                z-index: 999999;
                color: #f4eadb;
                font-family: Arial, sans-serif;
            }

            .legion-mini-launcher {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            }
            
            #legion-mini-leaderboard-button {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 44px;
                height: 43px;
                padding: 0;
                border: 1px solid #8c6748;
                border-radius: 14px;
                background: #34291f;
                color: #fff1df;
                cursor: pointer;
                font-size: 19px;
                box-shadow: 0 5px 18px #0006;
                transition: .18s;
            }
            
            #legion-mini-leaderboard-button:hover {
                background: #51402f;
                transform: translateY(-1px);
            }

            #legion-mini-shop-button {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 44px;
                height: 43px;
                padding: 0;
                border: 1px solid #8c6748;
                border-radius: 14px;
                background: #34291f;
                color: #fff1df;
                cursor: pointer;
                font-size: 19px;
                box-shadow: 0 5px 18px #0006;
                transition: .18s;
            }
            
            #legion-mini-shop-button:hover {
                background: #51402f;
                transform: translateY(-1px);
            }

            #legion-mini-toggle {
                border: 1px solid #8c6748;
                border-radius: 14px;
                padding: 12px 17px;
                background: #34291f;
                color: #fff1df;
                cursor: pointer;
                font-size: 13px;
                box-shadow: 0 5px 18px #0006;
                transition: .18s;
            }

            #legion-mini-toggle:hover,
            .legion-mini-button:hover {
                background: #51402f;
                transform: translateY(-1px);
            }

            #legion-mini-panel {
                display: none;
                width: 310px;
                max-width: calc(100vw - 40px);
                max-height: min(82vh, 760px);
                overflow-y: auto;
                overscroll-behavior: contain;
                margin-bottom: 10px;
                padding: 17px;
                border: 1px solid #806044;
                border-radius: 16px;
                background: linear-gradient(
                    145deg,
                    rgba(48,38,30,.98),
                    rgba(35,32,31,.98)
                );
                box-shadow: 0 8px 28px #0008;
                backdrop-filter: blur(12px);
            }

            #legion-mini-panel.open {
                display: block;
            }

            .legion-mini-heading {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 13px;
                color: #ffe0b8;
                font-size: 16px;
                font-weight: bold;
            }

            .legion-mini-subtitle {
                margin: -5px 0 13px;
                color: #b9a28b;
                font-size: 11px;
            }

            .legion-mini-status {
                margin-bottom: 13px;
                color: #e0b36d;
                font-size: 12px;
            }

            .legion-mini-status.online {
                color: #a6d39a;
            }

            .legion-mini-section-title {
                margin-bottom: 7px;
                color: #e8cba8;
                font-size: 12px;
                font-weight: bold;
            }

            #legion-mini-players {
                max-height: 230px;
                overflow-y: auto;
                overscroll-behavior: contain;
                transition: max-height .2s ease;
            }

            #legion-mini-players.collapsed {
                max-height: 0;
                overflow: hidden;
            }

            .legion-player-tools {
                display: flex;
                gap: 7px;
                margin: 7px 0;
            }

            .legion-player-search {
                box-sizing: border-box;
                width: 100%;
                min-width: 0;
                padding: 8px 10px;
                border: 1px solid #68513d;
                border-radius: 8px;
                outline: none;
                background: #2d251f;
                color: #fff0dc;
                font-size: 12px;
            }

            .legion-player-search::placeholder {
                color: #b9a28b;
            }

            .legion-player-toggle {
                flex-shrink: 0;
                padding: 7px 9px;
                border: 1px solid #806044;
                border-radius: 8px;
                background: #463729;
                color: #fff0dc;
                cursor: pointer;
                font-size: 11px;
            }

            .legion-mini-player {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 9px 0;
                border-top: 1px solid #554536;
                font-size: 13px;
            }

            .legion-mini-dot {
                width: 8px;
                height: 8px;
                flex-shrink: 0;
                border-radius: 50%;
                background: #91c985;
                box-shadow: 0 0 7px #91c98566;
            }

            .legion-mini-player-name {
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .legion-mini-player-resting {
                color: #b9a28b;
                font-size: 11px;
                white-space: nowrap;
            }

            .legion-mini-button {
                padding: 7px 10px;
                border: 1px solid #806044;
                border-radius: 9px;
                background: #463729;
                color: #fff0dc;
                cursor: pointer;
                font-size: 12px;
                transition: .18s;
            }

            .legion-mini-button:disabled {
                opacity: .5;
                cursor: default;
                transform: none;
            }

            .legion-mini-dnd {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                margin: 13px 0 12px;
                padding: 10px 11px;
                border: 1px solid #68513d;
                border-radius: 12px;
                background: #3b3026;
            }

            .legion-mini-dnd-copy {
                min-width: 0;
            }

            .legion-mini-dnd-title {
                color: #f2d6b4;
                font-size: 12px;
                font-weight: bold;
            }

            .legion-mini-dnd-hint {
                margin-top: 4px;
                color: #b9a28b;
                font-size: 10px;
                line-height: 1.35;
            }

            .legion-mini-dnd-button {
                flex-shrink: 0;
                padding: 8px 10px;
                border: 1px solid #806044;
                border-radius: 9px;
                background: #57432f;
                color: #fff0dc;
                cursor: pointer;
                font-size: 11px;
            }

            .legion-mini-dnd-button.active {
                border-color: #8e765d;
                background: #514b43;
                color: #e8d8c4;
            }

            .legion-mini-dnd-button:disabled {
                opacity: .55;
                cursor: wait;
            }

            .legion-mini-empty {
                padding: 13px 0;
                color: #b9a28b;
                font-size: 12px;
                text-align: center;
            }

            .legion-mini-self {
                margin-top: 12px;
                padding-top: 10px;
                border-top: 1px solid #554536;
                color: #b9a28b;
                font-size: 11px;
            }

            #legion-mini-modal {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 1000001;
                align-items: center;
                justify-content: center;
                padding: 18px;
                background: #100d0bcc;
                font-family: Arial, sans-serif;
                color: #f4eadb;
            }

            #legion-mini-modal.open {
                display: flex;
            }

            #legion-mini-modal.minimized {
                display: none;
            }

            #legion-mini-modal-card {
                width: min(400px, calc(100vw - 36px));
                max-height: calc(100vh - 36px);
                overflow: auto;
                padding: 18px 20px 22px;
                border: 1px solid #806044;
                border-radius: 18px;
                background: linear-gradient(145deg, #382d23, #292626);
                box-shadow: 0 12px 45px #000a;
                text-align: center;
            }

            #legion-mini-modal-top {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin-bottom: 13px;
            }

            #legion-mini-modal-title {
                font-size: 19px;
                font-weight: bold;
                color: #ffe0b8;
                text-align: left;
                flex: 1;
            }

            #legion-mini-minimize {
                width: 32px;
                height: 30px;
                flex-shrink: 0;
                border: 1px solid #806044;
                border-radius: 8px;
                background: #4a3a2b;
                color: #fff0dc;
                font-size: 18px;
                line-height: 1;
                cursor: pointer;
            }

            #legion-mini-restore {
            display: none;
            padding: 11px 15px;
            border: 1px solid #a17b50;
            border-radius: 12px;
            background: #34291f;
            color: #fff0dc;
            font: 13px Arial, sans-serif;
            box-shadow: 0 5px 18px #0008;
            cursor: pointer;
            white-space: nowrap;
            }

            #legion-mini-restore.open {
                display: block;
            }

            #legion-mini-modal-body {
                font-size: 14px;
                line-height: 1.65;
                white-space: pre-line;
                color: #f0e4d5;
            }

            .legion-mini-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 9px;
                justify-content: center;
                margin-top: 18px;
            }

            .legion-mini-actions button {
                padding: 10px 13px;
                border: 1px solid #806044;
                border-radius: 10px;
                background: #4a3a2b;
                color: #fff0dc;
                cursor: pointer;
                font-size: 13px;
                transition: .18s;
            }

            .legion-mini-actions button:hover {
                background: #604a35;
            }

            .legion-mini-actions .primary {
                background: #735638;
                border-color: #a17b50;
            }

            .legion-mini-actions .publish {
                background: #66512f;
                border-color: #a88a51;
            }

            .legion-mini-actions button:disabled {
                opacity: .5;
                cursor: default;
            }

            #legion-mini-modal-footer {
                margin-top: 15px;
                padding: 11px 12px;
                border: 1px solid #5e4b39;
                border-radius: 11px;
                background: #302920;
                color: #cdb99f;
                font-size: 11px;
                line-height: 1.55;
                text-align: left;
                white-space: pre-line;
            }

            #legion-mini-modal-footer:empty {
                display: none;
            }

            #legion-mini-toast {
                position: fixed;
                right: 20px;
                bottom: 78px;
                z-index: 1000002;
                max-width: 310px;
                padding: 11px 15px;
                border: 1px solid #806044;
                border-radius: 11px;
                background: #34291f;
                color: #fff0dc;
                font: 13px Arial, sans-serif;
                box-shadow: 0 5px 18px #0007;
                display: none;
            }

            #legion-mini-toast.open {
                display: block;
            }

            .legion-roulette {
                margin: 14px 0 12px;
                padding: 12px;
                border: 1px solid #806044;
                border-radius: 13px;
                background: linear-gradient(145deg, #403226, #302923);
            }

            .legion-roulette-title {
                margin-bottom: 6px;
                color: #ffe0b8;
                font-size: 14px;
                font-weight: bold;
            }

            .legion-roulette-hint {
                color: #b9a28b;
                font-size: 10px;
                line-height: 1.45;
            }

            .legion-roulette-reels {
                display: flex;
                justify-content: center;
                gap: 8px;
                margin: 13px 0;
            }

            .legion-roulette-reel {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 58px;
                height: 58px;
                flex: 0 0 58px;
                border: 1px solid #9a7954;
                border-radius: 12px;
                background: #241f1b;
                font-size: 29px;
                box-shadow: inset 0 0 12px #0006;
            }

            .legion-roulette-reel.spinning {
                animation: legion-roulette-shake .12s linear infinite alternate;
            }

            @keyframes legion-roulette-shake {
                from { transform: translateY(-2px); }
                to { transform: translateY(2px); }
            }

            .legion-roulette-result {
                min-height: 34px;
                margin: 8px 0;
                color: #f4dfc4;
                font-size: 12px;
                line-height: 1.5;
                text-align: center;
                overflow-wrap: anywhere;
            }

            .legion-roulette-controls {
                display: flex;
                flex-wrap: wrap;
                gap: 7px;
                margin: 9px 0;
            }

            .legion-roulette-controls button {
                flex: 1;
                min-width: 90px;
            }

            .legion-roulette-controls button:disabled {
                opacity: .45;
                cursor: not-allowed;
            }

            /* ========================================
               LEADERBOARD
            ======================================== */
            
            #legion-leaderboard-modal {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 1000003;
                align-items: center;
                justify-content: center;
                padding: 18px;
                background: #100d0bcc;
                font-family: Arial, sans-serif;
                color: #f4eadb;
            }
            
            #legion-leaderboard-modal.open {
                display: flex;
            }
            
            #legion-leaderboard-card {
                width: min(520px, calc(100vw - 36px));
                max-height: calc(100vh - 36px);
                overflow-y: auto;
                padding: 20px;
                border: 1px solid #806044;
                border-radius: 18px;
                background: linear-gradient(145deg, #382d23, #292626);
                box-shadow: 0 12px 45px #000a;
            }
            
            #legion-leaderboard-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin-bottom: 16px;
            }
            
            #legion-leaderboard-title {
                color: #ffe0b8;
                font-size: 19px;
                font-weight: bold;
            }
            
            #legion-leaderboard-close {
                width: 32px;
                height: 30px;
                border: 1px solid #806044;
                border-radius: 8px;
                background: #4a3a2b;
                color: #fff0dc;
                font-size: 18px;
                cursor: pointer;
            }
            
            #legion-leaderboard-content {
                font-size: 13px;
                line-height: 1.5;
            }
            
            .legion-leaderboard-section {
                margin-top: 16px;
            }
            
            .legion-leaderboard-section-title {
                margin-bottom: 9px;
                color: #e8cba8;
                font-size: 13px;
                font-weight: bold;
            }
            
            .legion-leaderboard-loading,
            .legion-leaderboard-empty {
                padding: 20px 8px;
                color: #b9a28b;
                text-align: center;
            }
            
            .legion-leaderboard-row {
                display: flex;
                align-items: center;
                gap: 9px;
                padding: 9px 10px;
                border-top: 1px solid #554536;
            }
            
            .legion-leaderboard-rank {
                width: 25px;
                flex-shrink: 0;
                color: #e8cba8;
                font-weight: bold;
            }
            
            .legion-leaderboard-name {
                flex: 1;
                min-width: 0;
                overflow-wrap: anywhere;
            }
            
            .legion-leaderboard-value {
                color: #f5d4a8;
                font-weight: bold;
                text-align: right;
            }
            
            .legion-leaderboard-self {
                background: #73563833;
                border-radius: 8px;
            }
            
            .legion-leaderboard-personal {
                padding: 12px;
                border: 1px solid #68513d;
                border-radius: 12px;
                background: #302920;
            }
            
            .legion-leaderboard-personal-row {
                display: flex;
                justify-content: space-between;
                gap: 12px;
                padding: 5px 0;
            }
            
            .legion-leaderboard-personal-row span:first-child {
                color: #cdb99f;
            }
            
            .legion-leaderboard-personal-row strong {
                color: #ffe0b8;
                text-align: right;
            }
            
            .legion-leaderboard-record {
                padding: 11px;
                border: 1px solid #68513d;
                border-radius: 11px;
                background: #302920;
                margin-top: 8px;
            }
            
            .legion-leaderboard-record-name {
                color: #ffe0b8;
                font-weight: bold;
            }
            
            .legion-leaderboard-record-details {
                margin-top: 5px;
                color: #cdb99f;
                font-size: 12px;
            }

            /* ========================================
               SHOP
            ======================================== */
            
            #legion-shop-modal {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 1000004;
                align-items: center;
                justify-content: center;
                padding: 18px;
                background: #100d0bcc;
                font-family: Arial, sans-serif;
                color: #f4eadb;
            }
            
            #legion-shop-modal.open {
                display: flex;
            }
            
            #legion-shop-card {
                width: min(520px, calc(100vw - 36px));
                max-height: calc(100vh - 36px);
                overflow-y: auto;
                padding: 20px;
                border: 1px solid #806044;
                border-radius: 18px;
                background: linear-gradient(145deg, #382d23, #292626);
                box-shadow: 0 12px 45px #000a;
            }
            
            #legion-shop-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin-bottom: 16px;
            }
            
            #legion-shop-title {
                color: #ffe0b8;
                font-size: 19px;
                font-weight: bold;
            }
            
            #legion-shop-close {
                width: 32px;
                height: 30px;
                border: 1px solid #806044;
                border-radius: 8px;
                background: #4a3a2b;
                color: #fff0dc;
                font-size: 18px;
                cursor: pointer;
            }
            
            #legion-shop-balance {
                margin-bottom: 16px;
                padding: 12px;
                border: 1px solid #68513d;
                border-radius: 11px;
                background: #302920;
                color: #ffe0b8;
                font-size: 14px;
                font-weight: bold;
            }
            
            #legion-shop-content {
                font-size: 13px;
                line-height: 1.5;
            }

            .legion-shop-item {
                margin-bottom: 10px;
                padding: 13px;
                border: 1px solid #68513d;
                border-radius: 12px;
                background: #302920;
            }
            
            .legion-shop-item-name {
                color: #ffe0b8;
                font-size: 15px;
                font-weight: bold;
            }
            
            .legion-shop-item-description {
                margin-top: 6px;
                color: #cdb99f;
                font-size: 12px;
            }
            
            .legion-shop-item-price {
                margin-top: 10px;
                color: #f5d4a8;
                font-weight: bold;
            }
            
            .legion-shop-item-status {
                margin-top: 6px;
                color: #b9a28b;
                font-size: 12px;
            }

            .legion-shop-buy {
                width: 100%;
                margin-top: 12px;
                padding: 10px;
                border: 1px solid #8c6748;
                border-radius: 9px;
                background: #51402f;
                color: #fff1df;
                font-size: 13px;
                font-weight: bold;
                cursor: pointer;
                transition: .18s;
            }
            
            .legion-shop-buy:hover:not(:disabled) {
                background: #735638;
            }
            
            .legion-shop-buy:disabled {
                opacity: .55;
                cursor: not-allowed;
            }
        `;

        document.head.appendChild(style);
    }

    function showToast(message) {
        const toast = document.getElementById('legion-mini-toast');

        if (!toast) return;

        toast.textContent = message;
        toast.classList.add('open');

        clearTimeout(toast.timer);

        toast.timer = setTimeout(
            () => toast.classList.remove('open'),
            4000
        );
    }

    function createInterface() {
        addStyles();

        const widget = document.createElement('div');
        widget.id = 'legion-mini-widget';

        widget.innerHTML = `
            <div id="legion-mini-panel">
                <div class="legion-mini-heading">
                    <span>Legion — Кото-игры</span>
                    <span>🐾</span>
                </div>

                <div class="legion-mini-subtitle">
                    Маленький игровой уголок для котиков
                </div>

                <div id="legion-mini-status" class="legion-mini-status">
                   🐾 Котик ищет дорогу в игровой клуб...
                </div>

                <div class="legion-mini-dnd">
                    <div class="legion-mini-dnd-copy">
                        <div class="legion-mini-dnd-title" id="legion-mini-dnd-title">
                            🐾 Готов к игре
                        </div>

                        <div class="legion-mini-dnd-hint" id="legion-mini-dnd-hint">
                            Можно получать игровые приглашения
                        </div>
                    </div>

                    <button id="legion-mini-dnd-toggle"
                            class="legion-mini-dnd-button"
                            type="button">
                        Не беспокоить
                    </button>
                </div>

                <div class="legion-mini-section-title">
                    🐱 Котики онлайн
                    <span id="legion-mini-count">(0)</span>
                </div>

                <div class="legion-player-tools">
                    <input id="legion-mini-player-search"
                           class="legion-player-search"
                           type="search"
                           placeholder="🔎 Поиск по нику..."
                           autocomplete="off">
                    <button id="legion-mini-player-toggle"
                            class="legion-player-toggle"
                            type="button">Показать</button>
                </div>

                <div id="legion-mini-players" class="collapsed">
                    <div class="legion-mini-empty">
                        🔎 Высматриваем котиков...
                    </div>
                </div>

                <div class="legion-mini-self"></div>
            </div>

            <div class="legion-mini-launcher">
            <button id="legion-mini-leaderboard-button"
                    type="button"
                    title="Зал славы котиков">
                🏆
            </button>
        
            <button id="legion-mini-shop-button"
                    type="button"
                    title="Магазин котиков">
                🛒
            </button>
        
            <button id="legion-mini-toggle">
                🐾 Кото-игры
            </button>
            </div>
        `;

        document.body.appendChild(widget);

        const modal = document.createElement('div');
        modal.id = 'legion-mini-modal';

        modal.innerHTML = `
            <div id="legion-mini-modal-card">
                <div id="legion-mini-modal-top">
                    <div id="legion-mini-modal-title"></div>

                    <button id="legion-mini-minimize"
                            type="button"
                            title="Свернуть игру">
                        —
                    </button>
                </div>

                <div id="legion-mini-modal-body"></div>

                <div id="legion-mini-modal-actions"
                     class="legion-mini-actions"></div>

                <div id="legion-mini-modal-footer"></div>
            </div>
        `;

        document.body.appendChild(modal);

        const leaderboardModal = document.createElement('div');
        leaderboardModal.id = 'legion-leaderboard-modal';
        
        leaderboardModal.innerHTML = `
            <div id="legion-leaderboard-card">
        
                <div id="legion-leaderboard-header">
                    <div id="legion-leaderboard-title">
                        🏆 Зал славы котиков
                    </div>
        
                    <button id="legion-leaderboard-close"
                            type="button"
                            title="Закрыть">
                        ×
                    </button>
                </div>
        
                <div id="legion-leaderboard-content">
                    <div class="legion-leaderboard-loading">
                        Загружаем достижения котиков...
                    </div>
                </div>
        
            </div>
        `;
        
        document.body.appendChild(leaderboardModal);

        const shopModal = document.createElement('div');
        shopModal.id = 'legion-shop-modal';
        
        shopModal.innerHTML = `
            <div id="legion-shop-card">
        
                <div id="legion-shop-header">
                    <div id="legion-shop-title">
                        🛒 Магазин котиков
                    </div>
        
                    <button id="legion-shop-close"
                            type="button"
                            title="Закрыть">
                        ×
                    </button>
                </div>
        
                <div id="legion-shop-balance">
                    💰 Баланс: загрузка...
                </div>
        
                <div id="legion-shop-content">
                    <div class="legion-leaderboard-loading">
                        Загружаем товары...
                    </div>
                </div>
        
            </div>
        `;
        
        document.body.appendChild(shopModal);

        const restoreButton = document.createElement('button');
        restoreButton.id = 'legion-mini-restore';
        restoreButton.type = 'button';
        restoreButton.textContent = '🐾 Вернуться к игре';

        widget.querySelector('.legion-mini-launcher')
        .insertBefore(
            restoreButton,
            widget.querySelector('#legion-mini-leaderboard-button')
        );

        const toast = document.createElement('div');
        toast.id = 'legion-mini-toast';

        document.body.appendChild(toast);

        widget.querySelector('#legion-mini-toggle')
            .addEventListener('click', () => {
                widget.querySelector('#legion-mini-panel')
                    .classList.toggle('open');
            });

        widget.querySelector('#legion-mini-leaderboard-button')
            .addEventListener('click', openLeaderboard);

        widget.querySelector('#legion-mini-shop-button')
            .addEventListener('click', openShop);

        widget.querySelector('#legion-mini-dnd-toggle')
            .addEventListener('click', toggleDoNotDisturb);

        const playersElement = widget.querySelector('#legion-mini-players');
        const playersToggle = widget.querySelector('#legion-mini-player-toggle');
        const playerSearch = widget.querySelector('#legion-mini-player-search');

        playersToggle.addEventListener('click', () => {
            const collapsed = playersElement.classList.toggle('collapsed');
            playersToggle.textContent = collapsed ? 'Показать' : 'Скрыть';
        });

        playerSearch.addEventListener('input', renderPlayersList);

        modal.querySelector('#legion-mini-minimize')
            .addEventListener('click', minimizeModal);

        restoreButton.addEventListener('click', restoreModal);

        leaderboardModal.querySelector('#legion-leaderboard-close')
            .addEventListener('click', closeLeaderboard);
        
        leaderboardModal.addEventListener('click', event => {
            if (event.target === leaderboardModal) {
                closeLeaderboard();
            }
        });

        shopModal.querySelector('#legion-shop-close')
            .addEventListener('click', closeShop);
        
        shopModal.addEventListener('click', event => {
            if (event.target === shopModal) {
                closeShop();
            }
        });

        widget.querySelector('.legion-mini-self').textContent =
            'Вы играете как: ' + nickname;

        return {
            widget,
            panel: widget.querySelector('#legion-mini-panel'),
            status: widget.querySelector('#legion-mini-status'),
            count: widget.querySelector('#legion-mini-count'),
            players: playersElement,
            playerSearch,
            playersToggle,
            dndTitle: widget.querySelector('#legion-mini-dnd-title'),
            dndHint: widget.querySelector('#legion-mini-dnd-hint'),
            dndButton: widget.querySelector('#legion-mini-dnd-toggle'),

            modal,
            restoreButton,

            leaderboardModal,
            leaderboardContent: leaderboardModal.querySelector(
                '#legion-leaderboard-content'
            ),

            shopModal,
            shopBalance: shopModal.querySelector('#legion-shop-balance'),
            shopContent: shopModal.querySelector('#legion-shop-content'),

            modalTitle: modal.querySelector('#legion-mini-modal-title'),
            modalBody: modal.querySelector('#legion-mini-modal-body'),
            modalActions: modal.querySelector('#legion-mini-modal-actions'),
            modalFooter: modal.querySelector('#legion-mini-modal-footer')
        };
    }

    function openModal(title, body, actions, footer = '') {
        ui.modal.classList.remove('minimized');
        ui.restoreButton.classList.remove('open');

        ui.modalTitle.textContent = title;
        ui.modalBody.textContent = body;
        ui.modalFooter.textContent = footer;

        ui.modalActions.replaceChildren();

        actions.forEach(action => {
            const button = document.createElement('button');

            button.textContent = action.label;

            if (action.className) {
                button.className = action.className;
            }

            button.disabled = !!action.disabled;
            button.addEventListener('click', action.onClick);

            ui.modalActions.appendChild(button);
        });

        ui.modal.classList.add('open');
    }

    function minimizeModal() {
        if (!ui.modal.classList.contains('open')) return;

        ui.modal.classList.add('minimized');
        ui.modal.classList.remove('open');

        ui.restoreButton.classList.add('open');
    }

    function restoreModal() {
        ui.modal.classList.remove('minimized');
        ui.modal.classList.add('open');

        ui.restoreButton.classList.remove('open');
    }

    function closeModal() {
        ui.modal.classList.remove('open', 'minimized');
        ui.restoreButton.classList.remove('open');
    }

    function updateDoNotDisturbUI() {
        if (!ui) return;

        ui.dndTitle.textContent = doNotDisturb
            ? '😴 Котик отдыхает'
            : '🐾 Готов к игре';

        ui.dndHint.textContent = doNotDisturb
            ? 'Входящие приглашения отключены. Самому играть можно!'
            : 'Можно получать игровые приглашения';

        ui.dndButton.textContent = doNotDisturb
            ? 'Проснуться'
            : 'Не беспокоить';

        ui.dndButton.classList.toggle('active', doNotDisturb);
    }

    function toggleDoNotDisturb() {
        const nextValue = !doNotDisturb;

        ui.dndButton.disabled = true;
        ui.dndButton.textContent = 'Секундочку...';

        request(
            'POST',
            '/api/players/' + encodeURIComponent(playerId) + '/do-not-disturb',
            { enabled: nextValue },
            (error, result) => {
                ui.dndButton.disabled = false;

                if (error || !result?.success) {
                    updateDoNotDisturbUI();
                    showToast(
                        result?.error || 'Не удалось изменить режим отдыха'
                    );
                    return;
                }

                doNotDisturb = result.doNotDisturb;

                localStorage.setItem(
                    STORAGE.doNotDisturb,
                    String(doNotDisturb)
                );

                updateDoNotDisturbUI();
                refreshPlayers();

                showToast(
                    doNotDisturb
                        ? '😴 Теперь котик отдыхает. Приглашения не потревожат его.'
                        : '🐾 Котик проснулся и снова готов к игре!'
                );
            }
        );
    }

    function heartbeat() {
        request(
            'POST',
            '/api/players/heartbeat',
            {
                id: playerId,
                nickname,
                doNotDisturb
            },
            (error, result) => {
                if (error || !result?.success) {
                    ui.status.textContent =
                        '😿 Игровой клуб пока не откликается';

                    ui.status.classList.remove('online');
                } else {
                   if (
                        typeof result.playerId === 'string' &&
                        result.playerId !== playerId
                    ) {
                        playerId = result.playerId;

                        localStorage.setItem(
                            STORAGE.playerId,
                            playerId
                        );
                    }
                    if (
                        typeof result.doNotDisturb === 'boolean' &&
                        result.doNotDisturb !== doNotDisturb
                    ) {
                        doNotDisturb = result.doNotDisturb;

                        localStorage.setItem(
                            STORAGE.doNotDisturb,
                            String(doNotDisturb)
                        );

                        updateDoNotDisturbUI();
                    }

                    ui.status.textContent =
                        '🐱 Котик на связи!';

                    ui.status.classList.add('online');
                    loadRouletteStatus();
                }
            }
        );
    }

    function sendInvitation(targetId, targetNickname, button) {
        button.disabled = true;
        button.textContent = '🐾 Отправляем послание...';

        request(
            'POST',
            '/api/invites',
            {
                fromId: playerId,
                toId: targetId
            },
            (error, result, status) => {
                if (error || !result?.success) {
                    button.disabled = false;
                    button.textContent = 'Позвать котика';

                    showToast(
                        status === 403
                            ? 'Этот котик сейчас отдыхает и не принимает приглашения 😴'
                            : status === 409
                                ? 'Котик уже играет или приглашение уже отправлено'
                                : result?.error || 'Не удалось отправить приглашение'
                    );

                    return;
                }

                button.textContent = '🐾 Послание доставлено!';

                showToast(
                    '🐾 Игровой вызов отправлен: ' + targetNickname
                );
            }
        );
    }

    let cachedPlayers = [];

    function renderPlayersList() {
        if (!ui) return;

        const query = (ui.playerSearch?.value || '').trim().toLocaleLowerCase();
        const players = cachedPlayers.filter(player =>
            String(player.nickname || '').toLocaleLowerCase().includes(query)
        );

        ui.players.replaceChildren();

        if (!players.length) {
            const empty = document.createElement('div');
            empty.className = 'legion-mini-empty';
            empty.textContent = query
                ? 'Никого не найдено.'
                : '🐾 Пока здесь тихо... Котиков не видно';
            ui.players.appendChild(empty);
            return;
        }

        players.forEach(player => {
            const item = document.createElement('div');
            item.className = 'legion-mini-player';

            const dot = document.createElement('span');
            dot.className = 'legion-mini-dot';

            const name = document.createElement('span');
            name.className = 'legion-mini-player-name';
            name.textContent =
                (player.nickname || 'Без имени') +
                (player.id === playerId ? ' (это вы)' : '');

            item.append(dot, name);

            if (player.id !== playerId && player.doNotDisturb) {
                const resting = document.createElement('span');
                resting.className = 'legion-mini-player-resting';
                resting.textContent = '😴 Отдыхает';
                item.appendChild(resting);
            } else if (player.id !== playerId) {
                const button = document.createElement('button');
                button.className = 'legion-mini-button';
                button.textContent = 'КНБ';
                button.title = 'Пригласить в Кото-КНБ';
                button.addEventListener('click', () => {
                    sendInvitation(player.id, player.nickname, button);
                });
                item.appendChild(button);

                const rouletteButton = document.createElement('button');
                rouletteButton.className = 'legion-mini-button';
                rouletteButton.textContent = '🎰';
                rouletteButton.title = 'Пригласить в Кото-рулетку';
                rouletteButton.addEventListener('click', () => {
                    sendRouletteInvitation(player.id, player.nickname, rouletteButton);
                });
                item.appendChild(rouletteButton);
            }

            ui.players.appendChild(item);
        });
    }

    function refreshPlayers() {
        request(
            'GET',
            '/api/players',
            null,
            (error, result) => {
                if (error || !result?.success) return;

                cachedPlayers = Array.isArray(result.players) ? result.players : [];
                ui.count.textContent = '(' + (result.count ?? cachedPlayers.length) + ')';
                renderPlayersList();
            }
        );
    }

    function refreshInvitations() {
        request(
            'GET',
            '/api/invites/' + encodeURIComponent(playerId),
            null,
            (error, result) => {
                if (error || !result?.success || activeInvitation) return;

                const invitation = result.invitations.find(item =>
                    !shownInvitations.has(item.id)
                );

                if (!invitation) return;

                shownInvitations.add(invitation.id);
                activeInvitation = invitation;

                openModal(
                    '🐾 Игровой вызов',
                    invitation.fromNickname +
                    ' зовёт вас сыграть в Кото-КНБ! Примете вызов?',
                    [
                        {
                            label: 'Принять вызов',
                            className: 'primary',
                            onClick: () => respondToInvitation(true)
                        },
                        {
                            label: 'Не сейчас',
                            onClick: () => respondToInvitation(false)
                        }
                    ]
                );
            }
        );
    }

    function respondToInvitation(accept) {
        if (!activeInvitation) return;

        const invitation = activeInvitation;

        request(
            'POST',
            '/api/invites/' +
            encodeURIComponent(invitation.id) +
            '/respond',
            {
                playerId,
                accept
            },
            (error, result) => {
                activeInvitation = null;
                closeModal();

                if (error || !result?.success) {
                    showToast(
                        result?.error ||
                        'Не удалось обработать приглашение'
                    );
                    return;
                }

                showToast(
                    accept
                        ? '😼 Вызов принят! К бою, котики!'
                        : '🐾 Котик пока не готов играть'
                );

                if (accept) checkMatch();
            }
        );
    }

    const moves = {
        rock: {
            label: 'Лапка',
            emoji: '🐾'
        },
        scissors: {
            label: 'Царапка',
            emoji: '😼'
        },
        paper: {
            label: 'Коробка',
            emoji: '📦'
        }
    };

    function showModeSelection(match) {
    currentKnbMatch = match;

    if (displayedModeMatchId === match.id) return;

    displayedModeMatchId = match.id;
    activeMatchId = match.id;

    const opponent = match.players.find(
        player => player.id !== playerId
    );

    openModal(
        '🐱 Кото-КНБ',
        'Ваш соперник: ' +
        (opponent?.nickname || 'котик') +
        '\n\nВыберите режим игры:',
        [
            {
                label: '🐾 Бесплатная игра',
                className: 'primary',
                onClick: () => selectGameMode('free')
            },
            {
                label: '💰 Игра на мяукоины',
                className: 'primary',
                onClick: () => selectGameMode('betting')
            }
        ],
        '🐾 Бесплатный режим не требует мяукоинов.\n' +
        '💰 В режиме ставок оба котика должны выбрать одинаковую сумму.\n' +
        'Минимальная ставка — 50 мяукоинов.'
    );
}

    function showMoveSelection(match) {
    if (
        displayedMatchId === match.id &&
        ui.modal.classList.contains('open')
    ) return;

    displayedMatchId = match.id;
    activeMatchId = match.id;
    matchResultShown = false;
    moveSubmitted = false;

    const opponent = match.players.find(
        player => player.id !== playerId
    );

    openModal(
        '🐱 Кото-КНБ',
        'Ваш соперник: ' +
        (opponent?.nickname || 'котик') +
        '\n\nКакой ход сделаем?',
        Object.entries(moves).map(([key, move]) => ({
            label: move.emoji + ' ' + move.label,
            className: 'primary',
            onClick: () => submitMove(key)
        })),
        '📖 Как играть?\n' +
        '🐾 Лапка бьёт 😼 Царапку.\n' +
        '😼 Царапка рвёт 📦 Коробку.\n' +
        '📦 Коробка накрывает 🐾 Лапку.\n\n' +
        'Одинаковые ходы — ничья! У каждого котика одна попытка.'
    );
}

    let modeSelectionInFlight = false;

function selectGameMode(mode) {
    if (!activeMatchId || modeSelectionInFlight) return;

    modeSelectionInFlight = true;

    request(
        'POST',
        '/api/matches/' +
        encodeURIComponent(activeMatchId) +
        '/mode',
        {
            playerId,
            mode
        },
        (error, result, status) => {
            modeSelectionInFlight = false;

            if (error || !result?.success) {
                if (status === 403 && result?.error === 'BETTING_LOCK_REQUIRED') {
                    showToast(
                        '🔒 Для ставок оба котика должны купить соответствующее улучшение в магазине.'
                    );
                } else {
                    showToast(
                        result?.error || 'Не удалось выбрать режим игры'
                    );
                }

                return;
            }

            if (result.modeMismatch) {
                displayedModeMatchId = null;
            
                showToast(
                    '😺 Режимы не совпали! Выберите режим соперника.'
                );
            
                showModeSelection(currentKnbMatch);
            
                return;
            }

            if (result.waitingForOpponent) {
                openModal(
                    '🐾 Ожидание соперника',
                    mode === 'free'
                        ? 'Вы выбрали бесплатную игру.\n\nЖдём, пока соперник выберет такой же режим...'
                        : 'Вы выбрали игру на мяукоины.\n\nЖдём выбора соперника...',
                    []
                );

                return;
            }

            showToast(
                mode === 'free'
                    ? '🐾 Режим бесплатной игры согласован!'
                    : '💰 Режим ставок согласован!'
            );
        }
    );
}

    function showBetSelection(match) {
    const opponent = match.players.find(
        player => player.id !== playerId
    );

    const opponentBet = opponent?.bet;

    const message =
        'Ваш соперник: ' +
        (opponent?.nickname || 'котик') +
        (
            opponentBet != null
                ? '\n\n🐾 Соперник уже предложил: ' +
                  opponentBet + ' мяукоинов.'
                : '\n\nСоперник ещё не предложил ставку.'
        ) +
        '\n\nВведите размер ставки:';

    // Если окно уже открыто — обновляем текст,
    // не удаляя поле ввода
    if (
        displayedBetMatchId === match.id &&
        (
            ui.modal.classList.contains('open') ||
            ui.modal.classList.contains('minimized')
        )
    ) {
        if (ui.modalBody.firstChild) {
            ui.modalBody.firstChild.textContent = message;
        }
        return;
    }

    displayedBetMatchId = match.id;
    activeMatchId = match.id;

    openModal(
        '💰 Ставка в Кото-КНБ',
        message,
        [
            {
                label: '🐾 Подтвердить ставку',
                className: 'primary',
                onClick: () => {
                    const amount = Number(betInput.value);

                    if (
                        !Number.isSafeInteger(amount) ||
                        amount < 50
                    ) {
                        showToast(
                            'Минимальная ставка — 50 мяукоинов.'
                        );
                        return;
                    }

                    submitBet(amount);
                }
            }
        ],
        'Оба котика должны поставить одинаковую сумму.\n' +
        'Минимальная ставка — 50 мяукоинов.'
    );

    const betInput = document.createElement('input');

    betInput.type = 'number';
    betInput.min = '50';
    betInput.step = '1';
    betInput.placeholder = 'Например, 100';
    betInput.style.cssText =
        'box-sizing:border-box;width:100%;margin-top:14px;' +
        'padding:11px;border:1px solid #806044;border-radius:9px;' +
        'background:#2d251f;color:#fff0dc;font-size:15px;';

    ui.modalBody.appendChild(betInput);
    betInput.focus();
}

    let betSubmissionInFlight = false;

function submitBet(amount) {
    if (!activeMatchId || betSubmissionInFlight) return;

    betSubmissionInFlight = true;

    request(
        'POST',
        '/api/matches/' +
        encodeURIComponent(activeMatchId) +
        '/bet',
        {
            playerId,
            amount
        },
        (error, result) => {
            betSubmissionInFlight = false;

            if (error || !result?.success) {
                const errorMessage = result?.error;

                if (errorMessage === 'INSUFFICIENT_BALANCE') {
                    showToast(
                        '😿 Недостаточно мяукоинов для этой ставки.'
                    );
                } else {
                    showToast(
                        errorMessage || 'Не удалось отправить ставку.'
                    );
                }

                return;
            }

            if (result.waitingForOpponent) {
                displayedBetMatchId = null;
                
                openModal(
                    '🐾 Ожидание соперника',
                    'Ваша ставка: ' + amount +
                    ' мяукоинов.\n\n' +
                    'Ждём, пока соперник предложит такую же сумму...',
                    []
                );

                return;
            }

            if (result.status === 'playing') {
                showToast(
                    '💰 Ставки совпали! Начинаем Кото-КНБ!'
                );

                checkMatch();
            }
        }
    );
}

    function submitMove(move) {
        if (!activeMatchId || moveSubmitted) return;

        moveSubmitted = true;

        openModal(
            '🐾 Ход сделан!',
            'Ваш выбор: ' +
            moves[move].emoji + ' ' + moves[move].label +
            '\n\nЖдём, пока другой котик сделает ход...',
            [
                {
                    label: 'Хорошо',
                    onClick: closeModal
                }
            ]
        );

        request(
            'POST',
            '/api/matches/' +
            encodeURIComponent(activeMatchId) +
            '/move',
            {
                playerId,
                move
            },
            (error, result) => {
                if (error || !result?.success) {
                    moveSubmitted = false;

                    showToast(
                        result?.error || 'Не удалось отправить ход'
                    );

                    return;
                }

                pollMatchResult();
            }
        );
    }

    function checkMatch() {
    request(
        'GET',
        '/api/matches/player/' + encodeURIComponent(playerId),
        null,
        (error, result) => {
            if (error || !result?.success || !result.match) return;

            const match = result.match;

            if (match.status === 'choosing_mode') {
                currentKnbMatch = match;
                showModeSelection(match);
                return;
            }

            if (match.status === 'negotiating') {
                showBetSelection(match);
                return;
            }

            if (match.status === 'playing') {
                displayedBetMatchId = null;
                showMoveSelection(match);
                return;
            }

            if (match.status === 'finished') {
                activeMatchId = match.id;
                pollMatchResult();
            }
        }
    );
}

    function pollMatchResult() {
        if (!activeMatchId || matchResultShown) return;

        request(
            'GET',
            '/api/matches/' +
            encodeURIComponent(activeMatchId) +
            '?playerId=' + encodeURIComponent(playerId),
            null,
            (error, result) => {
                if (error || !result?.success || !result.match) return;

                if (
                    result.match.status === 'finished' &&
                    result.match.players.every(player => player.move)
                ) {
                    showMatchResult(result.match);
                }
            }
        );
    }

    function getPublishedMatches() {
        try {
            const value = JSON.parse(
                localStorage.getItem(STORAGE.publishedMatches) || '[]'
            );

            return Array.isArray(value) ? value : [];
        } catch (_) {
            return [];
        }
    }

    function showMatchResult(match) {
        if (matchResultShown) return;

        matchResultShown = true;
        displayedMatchId = match.id;
        activeMatchId = match.id;

        const first = match.players[0];
        const second = match.players[1];

        const winner = match.winner === 'draw'
            ? '😸 Ничья! Два котика оказались одинаково хитрыми.'
            : match.winner === playerId
                ? '😻 Мяу! Победа за вами!'
                : '😿 В этот раз победил другой котик: ' +
                  (
                      match.players.find(
                          player => player.id === match.winner
                      )?.nickname || 'Неизвестно'
                  );

        const betResult = match.mode === 'betting'
            ? '\n\n💰 Ставка: ' + match.stake +
              ' мяукоинов с каждого.' +
              (
                  match.winner === 'draw'
                      ? '\n🐾 Ничья! Ставки возвращены обоим игрокам.'
                      : match.winner === playerId
                          ? '\n😻 Вы получили банк: ' + match.pot + ' мяукоинов!'
                          : '\n😿 Соперник получил банк: ' + match.pot + ' мяукоинов.'
              )
            : '';
        
        const body =
            first.nickname + ': ' +
            moves[first.move].emoji + ' ' +
            moves[first.move].label +
            '\n' +
            second.nickname + ': ' +
            moves[second.move].emoji + ' ' +
            moves[second.move].label +
            '\n\n' +
            winner +
            betResult;

        const isInitiator = first.id === playerId;
        const alreadyPublished =
            getPublishedMatches().includes(match.id);

        const actions = [];

        if (isInitiator && !alreadyPublished) {
            actions.push({
                label: '📢 Отправить результат в чат',
                className: 'publish',
                onClick: () => publishResult(match)
            });
        } else if (isInitiator) {
            actions.push({
                label: '✓ Уже отправлено в чат',
                disabled: true,
                onClick: () => {}
            });
        }

        actions.push({
            label: 'Закрыть',
            onClick: closeModal
        });

        // openModal автоматически разворачивает окно,
        // даже если пользователь до этого его свернул.
        openModal('🏆 Кото-дуэль завершена', body, actions);
    }

    function publishResult(match) {
        if (match.players[0].id !== playerId) {
            showToast(
                'Опубликовать результат может только инициатор игры'
            );
            return;
        }

        const published = getPublishedMatches();

        if (published.includes(match.id)) {
            showToast('Этот результат уже опубликован');
            return;
        }

        const first = match.players[0];
        const second = match.players[1];

        // Однострочное сообщение с упоминаниями игроков
        const betMessage = match.mode === 'betting'
            ? match.winner === 'draw'
                ? ' | 💰 Ничья — ставки возвращены'
                : ' | 💰 Банк: ' + match.pot + ' мяукоинов'
            : '';
        
        const message =
            '🐱 Кото-КНБ: ' +
            '@' + first.nickname + ' ' +
            moves[first.move].emoji +
            ' vs ' +
            '@' + second.nickname + ' ' +
            moves[second.move].emoji +
            ' | 🏆 ' +
            (match.winner === 'draw'
                ? 'Ничья'
                : '@' + (
                    match.players.find(
                        player => player.id === match.winner
                    )?.nickname || 'Неизвестно'
                )) +
            betMessage;

        const form = document.querySelector('form.cy-chat-f');

        const input = form?.querySelector(
            'input[type="text"], textarea'
        );

        const button = form?.querySelector(
            'button[type="submit"]'
        );

        if (!form || !input || !button) {
            showToast(
                '😿 Не нашли окошко чата. Откройте его и попробуйте снова'
            );
            return;
        }

        if (button.disabled) {
            showToast(
                'Кнопка отправки чата сейчас недоступна'
            );
            return;
        }

        const proto = input.tagName === 'TEXTAREA'
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;

        const setter =
            Object.getOwnPropertyDescriptor(proto, 'value')?.set;

        if (setter) {
            setter.call(input, message);
        } else {
            input.value = message;
        }

        input.dispatchEvent(
            new Event('input', { bubbles: true })
        );

        input.dispatchEvent(
            new Event('change', { bubbles: true })
        );

        button.click();

        published.push(match.id);

        localStorage.setItem(
            STORAGE.publishedMatches,
            JSON.stringify(published.slice(-100))
        );

        showToast('🐾 Результат отправлен в общий чат!');
    }

    // ========================================
    // КОТО-РУЛЕТКА
    // ========================================

    function normalizeRouletteResource(value) {
        if (!value) return null;

        // Сервер возвращает объект ресурса, а не строковый ключ.
        // Поддерживаем оба формата, чтобы обновления сервера не ломали UI.
        if (typeof value === 'object') {
            const id = value.id || value.key || value.resourceId;
            const known = ROULETTE_RESOURCES[id];

            return {
                id: id || value.name || 'unknown',
                name: value.name || known?.name || 'Неизвестно',
                emoji: value.emoji || known?.emoji || '❔',
                points: Number(value.points ?? known?.points ?? 0)
            };
        }

        const known = ROULETTE_RESOURCES[value];
        return known ? { ...known } : {
            id: String(value),
            name: 'Неизвестно',
            emoji: '❔',
            points: 0
        };
    }

    function normalizeRouletteResult(data) {
        const raw = Array.isArray(data?.reels)
            ? data.reels
            : Array.isArray(data?.resources)
                ? data.resources
                : [];

        const reels = raw.map(normalizeRouletteResource);
        const score = Number.isFinite(Number(data?.score))
            ? Number(data.score)
            : reels.reduce((sum, item) => sum + item.points, 0);

        const jackpot = typeof data?.jackpot === 'boolean'
            ? data.jackpot
            : reels.length === 3 && reels.every(item => item.id === reels[0].id);

        const counts = new Map();
        reels.forEach(item => counts.set(item.id, (counts.get(item.id) || 0) + 1));
        const maxCount = Math.max(0, ...counts.values());
        const multiplier = Number(data?.multiplier || (maxCount === 3 ? 2 : maxCount === 2 ? 1.5 : 1));
        return { reels, score, jackpot, multiplier };
    }

    function rouletteResourceText(reels) {
        return (reels || []).map(value => {
            const item = normalizeRouletteResource(value);
            return item ? `${item.emoji} ${item.name}` : '❔';
        }).join(' · ');
    }

    
    function rouletteChatMessage(result) {
        const normalized = normalizeRouletteResult(result);
        const names = normalized.reels.map(item => item.name);
        const emojis = normalized.reels
            .map(item => item.emoji)
            .join(' ');
    
        if (normalized.jackpot && names.length === 3) {
            return `🎰 ДЖЕКПОТ! ${normalized.score} мяукоинов (×2) ${emojis}!`;
        }
    
        if (normalized.multiplier === 1.5) {
            return `🎰 Пара! ${names.join(', ')} — ${normalized.score} мяукоинов (×1.5) ${emojis}!`;
        }
    
        return `🎰 Кото-рулетка: ${names.join(', ')} — ${normalized.score} мяукоинов!`;
    }

    function createRouletteUI() {
        const container = document.createElement('div');
        container.className = 'legion-roulette';

        container.innerHTML = `
            <div class="legion-roulette-title">🎰 Кото-рулетка</div>
            <div class="legion-roulette-hint">
                Три слота, шесть ресурсов и шанс на джекпот!
            </div>
            <div class="legion-roulette-reels">
                <div class="legion-roulette-reel">❔</div>
                <div class="legion-roulette-reel">❔</div>
                <div class="legion-roulette-reel">❔</div>
            </div>
            <div class="legion-roulette-result">🍀 Испытайте удачу, котик!</div>
            <div class="legion-roulette-hint" data-role="balance">Баланс: загрузка...</div>
            <div class="legion-roulette-controls">
                <button class="legion-mini-button" data-action="spin">⛏️ Копать!</button>
                <button class="legion-mini-button" data-action="publish" disabled>📢 В чат</button>
            </div>
            <div class="legion-roulette-hint" data-role="cooldown">
                Попытка доступна раз в 5 минут.
            </div>
            <div class="legion-roulette-hint" style="margin-top:10px">
                🪨 Камушек - 1 · ⚪ Известняк - 2 · ⛓️ Железо - 3<br>
                ⬛ Уголь - 3 · 🟡 Золото - 5 · 💎 Топаз - 8
            </div>
        `;

        const panel = document.getElementById('legion-mini-panel');
        const self = panel.querySelector('.legion-mini-self');
        self.before(container);

        container.querySelector('[data-action="spin"]')
            .addEventListener('click', spinRouletteSolo);
        container.querySelector('[data-action="publish"]')
            .addEventListener('click', publishRouletteSolo);
    }

    function rouletteElements() {
        const container = document.querySelector('.legion-roulette');
        if (!container) return null;

        return {
            reels: [...container.querySelectorAll('.legion-roulette-reel')],
            result: container.querySelector('.legion-roulette-result'),
            spin: container.querySelector('[data-action="spin"]'),
            publish: container.querySelector('[data-action="publish"]'),
            cooldown: container.querySelector('[data-role="cooldown"]'),
            balance: container.querySelector('[data-role="balance"]')
        };
    }

    function updateRouletteCooldownUI() {
        const elements = rouletteElements();
        if (!elements) return;

        const remaining = Math.max(0, Math.ceil((rouletteCooldownUntil - Date.now()) / 1000));

        if (rouletteSpinning) {
            elements.spin.disabled = true;
        } else if (remaining > 0) {
            elements.spin.disabled = true;
            const minutes = Math.floor(remaining / 60);
            const seconds = remaining % 60;
            elements.cooldown.textContent =
                `Следующая попытка через ${minutes}:${String(seconds).padStart(2, '0')}`;
        } else {
            elements.spin.disabled = false;
            elements.cooldown.textContent = '⛏️ Попытка доступна!';
        }
    }

    function loadRouletteStatus() {
        request('GET', '/api/roulette/status/' + encodeURIComponent(playerId), null,
            (error, result) => {
                if (error || !result?.success) return;
                rouletteCooldownUntil = Number(result.nextAt || 0);
                rouletteBalance = Number(result.balance || 0);
                const elements = rouletteElements();
                if (elements?.balance) elements.balance.textContent = `💰 Баланс: ${rouletteBalance} мяукоинов`;
                updateRouletteCooldownUI();
            }
        );
    }

    function animateRoulette(reels, callback) {
        const elements = rouletteElements();
        if (!elements) return callback();

        rouletteTimers.forEach(clearTimeout);
        rouletteTimers = [];
        rouletteSpinning = true;
        elements.spin.disabled = true;
        elements.publish.disabled = true;
        elements.result.textContent = '⛏️ Добываем Находки...';

        elements.reels.forEach((reel, index) => {
            reel.textContent = '❔';
            reel.classList.add('spinning');

            rouletteTimers.push(setTimeout(() => {
                const resource = normalizeRouletteResource(reels[index]);
                reel.classList.remove('spinning');
                reel.textContent = resource?.emoji || '❔';

                if (index === 2) {
                    rouletteSpinning = false;
                    callback();
                    updateRouletteCooldownUI();
                }
            }, 900 + index * 650));
        });
    }
    
    function animateCoopRoulette(reels, callback) {
    const finalReels = reels.map(normalizeRouletteResource);
    const symbols = ['❔', '❔', '❔'];
    const stopped = [false, false, false];

    const availableEmojis = ['🪨', '⚪', '⛓️', '⬛', '🟡', '💎'];

    rouletteSpinning = true;

    function updateModal() {
        ui.modalBody.innerHTML = `
            <div style="text-align:center;">
                <div style="font-size:15px; margin-bottom:18px;">
                    ⛏️ Отправляемся за добычей...
                </div>
                <div style="
                    display:flex;
                    justify-content:center;
                    align-items:center;
                    gap:18px;
                    font-size:42px;
                    line-height:1.5;
                ">
                    ${symbols.map(symbol => `<span>${symbol}</span>`).join('')}
                </div>
            </div>
        `;
    }

    updateModal();

    const animation = setInterval(() => {
        symbols.forEach((_, index) => {
            if (!stopped[index]) {
                symbols[index] = availableEmojis[
                    Math.floor(Math.random() * availableEmojis.length)
                ];
            }
        });

        updateModal();
    }, 100);

    [900, 1450, 2000].forEach((delay, index) => {
        setTimeout(() => {
            stopped[index] = true;
            symbols[index] = finalReels[index]?.emoji || '❔';

            updateModal();

            if (index === 2) {
                clearInterval(animation);
                rouletteSpinning = false;
                callback();
            }
        }, delay);
    });
}

    function spinRouletteSolo() {
        const elements = rouletteElements();
        if (!elements || rouletteSpinning || Date.now() < rouletteCooldownUntil) return;

        elements.spin.disabled = true;
        elements.publish.disabled = true;
        elements.result.textContent = 'Связываемся с шахтой...';

        request('POST', '/api/roulette/solo', { playerId }, (error, result, status) => {
            if (error || !result?.success) {
                elements.result.textContent = result?.error || 'Не удалось запустить рулетку.';
                if (result?.nextAt) rouletteCooldownUntil = Number(result.nextAt);
                updateRouletteCooldownUI();
                return;
            }

            rouletteResult = normalizeRouletteResult(result);
            rouletteCooldownUntil = Number(result.nextAt || 0);

            animateRoulette(rouletteResult.reels, () => {
                const description = rouletteResourceText(rouletteResult.reels);
                const multiplier = Number(result.multiplier || 1);
                rouletteBalance = Number(result.balance ?? rouletteBalance);
                if (elements.balance) elements.balance.textContent = `💰 Баланс: ${rouletteBalance} мяукоинов`;
                const multiplierText = multiplier > 1 ? ` · множитель ×${multiplier}` : '';
                elements.result.textContent = rouletteResult.jackpot
                    ? `🎉 ДЖЕКПОТ! ${description} · ${rouletteResult.score} мяукоинов${multiplierText}`
                    : `${description} · ${rouletteResult.score} мяукоинов${multiplierText}`;
                elements.publish.disabled = false;
            });
        });
    }

    function publishRouletteSolo() {
        if (!rouletteResult) return;
        publishResultToChat(rouletteChatMessage(rouletteResult));
    }

    function publishResultToChat(message) {
        const form = document.querySelector('form.cy-chat-f');
        const input = form?.querySelector('input[type="text"], textarea');
        const button = form?.querySelector('button[type="submit"]');

        if (!form || !input || !button) {
            showToast('😿 Не нашли окошко чата. Откройте его и попробуйте снова');
            return false;
        }
        if (button.disabled) {
            showToast('Кнопка отправки чата сейчас недоступна.');
            return false;
        }

        const proto = input.tagName === 'TEXTAREA'
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(input, message);
        else input.value = message;

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        button.click();
        showToast('🐾 Результат отправлен в чат.');
        return true;
    }

    function sendRouletteInvitation(targetId, targetNickname, button) {
        button.disabled = true;
        button.textContent = '...';

        request('POST', '/api/roulette/invites', { fromId: playerId, toId: targetId },
            (error, result) => {
                if (error || !result?.success) {
                    button.disabled = false;
                    button.textContent = '🎰';
                    showToast(result?.error || '😿 Не получилось позвать котика.');
                    return;
                }
                button.textContent = '✓';
                showToast(`🎰 Приглашение отправлено: ${targetNickname}`);
            }
        );
    }

    function refreshRouletteInvitations() {
        if (rouletteInvite || rouletteMatchId) return;

        request('GET', '/api/roulette/invites/' + encodeURIComponent(playerId), null,
            (error, result) => {
                if (error || !result?.success || !result.invitations?.length) return;

                const invitation = result.invitations.find(item => !rouletteInviteIds.has(item.id));
                if (!invitation) return;

                rouletteInviteIds.add(invitation.id);
                rouletteInvite = invitation;

                openModal(
                    '🎰 Приглашение в Кото-рулетку',
                    `${invitation.fromNickname || 'Игрок'} приглашает вас сыграть вместе!\n\nСначала вы договоритесь о ставке (минимум 50 мяукоинов). Списание произойдёт только после совпадения ставок.`,
                    [
                        { label: '⛏️ Принять', className: 'primary', onClick: () => respondRouletteInvitation(true) },
                        { label: 'Отклонить', onClick: () => respondRouletteInvitation(false) }
                    ]
                );
            }
        );
    }

    function respondRouletteInvitation(accept) {
        if (!rouletteInvite) return;
        const invitation = rouletteInvite;

        request('POST', '/api/roulette/invites/' + encodeURIComponent(invitation.id) + '/respond',
            { playerId, accept },
            (error, result) => {
                rouletteInvite = null;
                closeModal();

                if (error || !result?.success) {
                    showToast(result?.error || 'Не удалось обработать приглашение.');
                    return;
                }
                if (accept) {
                    rouletteMatchId = result.matchId;
                    rouletteHasSpun = false;
                    rouletteResultShown = false;
                    refreshRouletteMatch();
                }
            }
        );
    }

    function refreshRouletteMatch() {
        if (rouletteMatchRequestInFlight) return;
    
        rouletteMatchRequestInFlight = true;
    
        request(
            'GET',
            '/api/roulette/matches/player/' + encodeURIComponent(playerId),
            null,
            (error, result) => {
                rouletteMatchRequestInFlight = false;
    
                if (error || !result?.success || !result.match) return;
    
                const match = result.match;
    
                if (completedRouletteMatches.has(match.id)) return;
    
                rouletteMatchId = match.id;
    
                const me = match.players.find(player => player.id === playerId);
                const opponent = match.players.find(player => player.id !== playerId);
    
                rouletteHasSpun = Boolean(me?.hasSpun);
    
                if (match.status === 'cancelled' || match.status === 'expired') {
                    rememberRouletteMatch(
                        ROULETTE_COMPLETED_KEY,
                        completedRouletteMatches,
                        match.id
                    );
    
                    closeModal();
                    showToast(
                        match.status === 'expired'
                            ? 'Время матча истекло. Зарезервированные ставки возвращены.'
                            : 'Соперник отменил переговоры о ставке.'
                    );
    
                    rouletteMatchId = null;
                    rouletteNegotiationShown = null;
                    rouletteMatchShown = null;
                    rouletteWaitingShown = false;
                    rouletteHasSpun = false;
                    rouletteResultShown = false;
    
                    return;
                }
    
                const newTie =
                    match.lastRound?.winner === 'draw' &&
                    Number(match.round || 0) > rouletteLastTieRoundShown;
                
                if (newTie) {
                    rouletteLastTieRoundShown = Number(match.round || 0);
                    rouletteMatchShown = null;
                    rouletteWaitingShown = false;
                    rouletteHasSpun = false;
                    rouletteResultShown = false;
                
                    showToast('🤝 Ничья! Начинается следующий раунд.');
                }
    
                if (match.status === 'finished') {
                    rouletteWaitingShown = false;
                    rouletteHasSpun = false;
                
                    showRouletteMatchResult(match);
                    return;
                }
    
                if (match.status === 'negotiating') {
                    showRouletteNegotiation(match);
                    return;
                }
    
                if (match.status === 'playing' && !rouletteHasSpun) {
                    showRouletteMatch(match, opponent, match);
                    return;
                }
    
                if (match.status === 'playing' && rouletteHasSpun) {
                    if (!rouletteWaitingShown) {
                        rouletteWaitingShown = true;
                        showRouletteWaiting(opponent);
                    }
                }
            }
        );
    }

    function showRouletteNegotiation(match) {
        if (rouletteNegotiationShown === match.id) return;
        rouletteNegotiationShown = match.id;
        const me = match.players.find(player => player.id === playerId);
        const opponent = match.players.find(player => player.id !== playerId);
        const myOffer = me?.offer == null ? 'ещё не предложена' : `${me.offer} мяукоинов`;
        const theirOffer = opponent?.offer == null ? 'ещё не предложена' : `${opponent.offer} мяукоинов`;
        openModal(
            '🎰 Согласование ставки',
            `Соперник: ${opponent?.nickname || 'котик'}\n\nВаша Кото-ставка: ${myOffer}\nКото-ставка соперника: ${theirOffer}\n\nМинимальная Кото-ставка — 50 мяукоинов. Баланс: ${rouletteBalance}. Мяукоины не списываются, пока ставки не совпадут.`,
            [
                { label: '💰 Предложить / изменить ставку', className: 'primary', onClick: () => submitRouletteOffer(match.id) },
                { label: 'Отказаться', onClick: () => declineRouletteNegotiation(match.id) },
                { label: 'Свернуть', onClick: minimizeModal }
            ]
        );
    }

    function submitRouletteOffer(matchId) {
        rouletteNegotiationShown = null;
        const value = prompt('Введите ставку в мяукоинах (минимум 50):', '50');
        if (value === null) return;
        const amount = Number(value.trim());
        if (!Number.isSafeInteger(amount) || amount < 50) {
            showToast('Минимальная Кото-ставка — 50 целых мяукоинов.');
            return;
        }
        request('POST', `/api/roulette/matches/${encodeURIComponent(matchId)}/offer`, { playerId, amount },
            (error, result) => {
                if (error || !result?.success) {
                    showToast(result?.error || 'Не удалось отправить ставку.');
                    return;
                }
                if (result.balance !== undefined) rouletteBalance = Number(result.balance);
                closeModal();
                if (result.status === 'playing') {
                    rouletteWaitingShown = false;
                    rouletteHasSpun = false;
                    showToast(`Ставки совпали! Общий банк: ${result.pot} мяукоинов.`);
                } else {
                    showToast('🐾 Ваша ставка записана! Ждём ответа второго котика.');
                }
                refreshRouletteMatch();
                loadRouletteStatus();
            }
        );
    }

    function declineRouletteNegotiation(matchId) {
        request('POST', `/api/roulette/matches/${encodeURIComponent(matchId)}/decline`, { playerId },
            (error, result) => {
                if (error || !result?.success) {
                    showToast(result?.error || 'Не удалось отказаться от игры.');
                    return;
                }
                rouletteMatchId = null;
                rouletteNegotiationShown = null;
                rouletteMatchShown = null;
                closeModal();
                showToast('Переговоры отменены.');
            }
        );
    }

    function showRouletteMatch(match, opponent, fullMatch) {
        if (rouletteMatchShown === match.id) return;
        rouletteMatchShown = match.id;
        rouletteWaitingShown = false;
        openModal(
            '🎰 Совместная Кото-рулетка',
            `Ваш соперник: ${opponent?.nickname || 'котик'}\n\nКото-ставка каждого: ${fullMatch?.stake || '—'} мяукоинов\nОбщий банк: ${fullMatch?.pot || '—'} мяукоинов\nРаунд: ${fullMatch?.round || 1}\n\nСделайте бросок. Победитель заберёт весь банк.`,
            [
                { label: '⛏️ Крутить!', className: 'primary', onClick: spinRouletteCoop },
                { label: 'Свернуть', onClick: minimizeModal }
            ]
        );
    }

    function showRouletteWaiting(opponent) {
        openModal(
            '🎰 Ожидание соперника',
            `🐾 Ваш бросок готов!\n\nЖдём, когда ${opponent?.nickname || 'второй котик'} сделает свой ход.`,
            [{ label: 'Свернуть', onClick: minimizeModal }]
        );
    }

    function spinRouletteCoop() {
    if (!rouletteMatchId || rouletteHasSpun || rouletteSpinning) return;

    rouletteSpinning = true;

    openModal('🎰 Совместная рулетка', '⛏️ Отправляемся за добычей...', [
        { label: 'Свернуть', onClick: minimizeModal }
    ]);

    request(
        'POST',
        '/api/roulette/matches/' + encodeURIComponent(rouletteMatchId) + '/spin',
        { playerId },
        (error, result) => {
            rouletteSpinning = false;

            if (error || !result?.success) {
                showToast(result?.error || 'Не удалось выполнить бросок.');
                refreshRouletteMatch();
                return;
            }

            rouletteHasSpun = true;

            const spin = normalizeRouletteResult(result);

            animateCoopRoulette(spin.reels, () => {
                const multiplierText = spin.multiplier > 1
                    ? `\nМножитель: ×${spin.multiplier}`
                    : '';

                const resultText =
                    `${rouletteResourceText(spin.reels)}\n\n` +
                    `⭐ Ваша добыча: ${spin.score} мяукоинов${multiplierText}`;

                if (result.status === 'finished') {
                    rouletteWaitingShown = false;
                    rouletteHasSpun = false;
                
                    const finishedMatch = {
                        id: rouletteMatchId,
                        status: 'finished',
                        winner: result.lastRound?.winner,
                        players: result.lastRound?.players || []
                    };
                
                    if (finishedMatch.players.length === 2) {
                        showRouletteMatchResult(finishedMatch);
                    } else {
                        showToast('😿 Не получилось узнать итоги. Проверяем результат ещё раз...');
                        refreshRouletteMatch();
                    }
                
                    return;
                }

                if (result.status === 'draw') {
                    rouletteHasSpun = false;
                    rouletteWaitingShown = false;
                    rouletteMatchShown = null;

                    openModal(
                        '🤝 Ничья!',
                        resultText +
                        '\n\nОдинаковое количество мяукоинов! Начинается следующий раунд.',
                        [{ label: 'Свернуть', onClick: minimizeModal }]
                    );

                    refreshRouletteMatch();
                    return;
                }

                rouletteWaitingShown = true;

                openModal(
                    '🎰 Ваша добыча',
                    resultText + '\n\nОжидаем второго игрока...',
                    [{ label: 'Свернуть', onClick: minimizeModal }]
                );

                refreshRouletteMatch();
            });
        }
    );
}

    function showRouletteMatchResult(match) {
        if (!match?.players || match.players.length !== 2) {
            console.error('[Кото-рулетка] Некорректные данные матча:', match);
            showToast('😿 Не получилось узнать итоги кото-дуэли.');
            return;
        }
        if (rouletteResultShown && rouletteResultMatchId === match.id) return;
    
        rouletteResultShown = true;
        rouletteResultMatchId = match.id;
        rouletteWaitingShown = false;

        const first = match.players[0];
        const second = match.players[1];

        const firstScore = Number(first.score || 0);
        const secondScore = Number(second.score || 0);
        const difference = Math.abs(firstScore - secondScore);

        const winnerPlayer = match.winner === 'draw'
            ? null
            : match.players.find(player => player.id === match.winner);

        const winnerText = !winnerPlayer
            ? '🤝 Ничья! У котиков одинаковое количество мяукоинов.'
            : match.winner === playerId
                ? `🏆 Вы победили с преимуществом в ${difference} мяук.`
                : `🏆 Победитель: ${winnerPlayer.nickname} (разница ${difference} мяук.)`;

        const firstMultiplier = normalizeRouletteResult({ reels: first.reels || [], score: firstScore }).multiplier;
        const secondMultiplier = normalizeRouletteResult({ reels: second.reels || [], score: secondScore }).multiplier;
        const body = [
            `${first.nickname}:`,
            `${rouletteResourceText(first.reels || [])} — ${firstScore} мяукоинов${firstMultiplier > 1 ? ` (×${firstMultiplier})` : ''}`,
            '',
            `${second.nickname}:`,
            `${rouletteResourceText(second.reels || [])} — ${secondScore} мяукоинов${secondMultiplier > 1 ? ` (×${secondMultiplier})` : ''}`,
            '',
            winnerText
        ].join('\n');

        const alreadyPublished = publishedRouletteMatches.has(match.id);

        const actions = [];

        actions.push({
            label: alreadyPublished ? '✓ Результат уже опубликован' : '📢 Опубликовать результат',
            className: 'publish',
            disabled: alreadyPublished,
            onClick: () => publishRouletteMatchResult(match)
        });

        actions.push({
            label: 'Закрыть',
            onClick: () => {
                rememberRouletteMatch(
                    ROULETTE_COMPLETED_KEY,
                    completedRouletteMatches,
                    match.id
                );

                rouletteMatchId = null;
                rouletteNegotiationShown = null;
                rouletteMatchShown = null;
                rouletteResultMatchId = null;
                rouletteWaitingShown = false;
                rouletteHasSpun = false;
                rouletteResultShown = false;

                closeModal();
            }
        });

        openModal('🏆 Итоги Кото-рулетки', body, actions);
    }

    function publishRouletteMatchResult(match) {
        if (publishedRouletteMatches.has(match.id)) {
            showToast('Этот результат уже опубликован.');
            return;
        }

        const first = match.players[0];
        const second = match.players[1];
        const firstScore = Number(first.score || 0);
        const secondScore = Number(second.score || 0);
        const difference = Math.abs(firstScore - secondScore);

        const winnerPlayer = match.winner === 'draw'
            ? null
            : match.players.find(player => player.id === match.winner);

        const message = match.winner === 'draw'
            ? `🎰 Кото-рулетка: @${first.nickname} — ${firstScore} мяукоинов, @${second.nickname} — ${secondScore} мяукоинов. 🤝 Ничья!`
            : `🎰 Кото-рулетка: 🏆 @${winnerPlayer?.nickname || 'Победитель'} победил с разницей ${difference} мяук. (${first.nickname}: ${firstScore}, ${second.nickname}: ${secondScore})`;

        const sent = publishResultToChat(message);
        if (!sent) return;

        rememberRouletteMatch(
            ROULETTE_PUBLISHED_KEY,
            publishedRouletteMatches,
            match.id
        );
    }

    function closeLeaderboard() {
        ui.leaderboardModal.classList.remove('open');
    }

    // ========================================
    // МАГАЗИН КОТИКОВ
    // ========================================
    
    function openShop() {
    ui.shopModal.classList.add('open');

    ui.shopBalance.textContent = '💰 Баланс: загружаем...';
    ui.shopContent.replaceChildren();

    ui.shopContent.appendChild(
        createLeaderboardElement(
            'div',
            'legion-leaderboard-loading',
            '🛒 Загружаем товары котиков...'
        )
    );

    request(
        'GET',
        '/api/shop/' + encodeURIComponent(playerId),
        null,
        (error, result) => {
            if (!ui.shopModal.classList.contains('open')) {
                return;
            }

            if (error || !result?.success) {
                ui.shopBalance.textContent = '💰 Не удалось загрузить баланс';

                ui.shopContent.replaceChildren();

                ui.shopContent.appendChild(
                    createLeaderboardElement(
                        'div',
                        'legion-leaderboard-empty',
                        result?.error ||
                        '😿 Не удалось загрузить магазин. Попробуйте позже.'
                    )
                );

                return;
            }

            renderShop(result);
        }
    );
}
    
    function closeShop() {
        ui.shopModal.classList.remove('open');
    }

    function renderShop(data) {
        ui.shopBalance.textContent =
            `💰 Ваш баланс: ${data.balance} мяукоинов`;
    
        ui.shopContent.replaceChildren();
    
        if (!data.items || data.items.length === 0) {
            ui.shopContent.appendChild(
                createLeaderboardElement(
                    'div',
                    'legion-leaderboard-empty',
                    'Пока в магазине нет товаров.'
                )
            );
    
            return;
        }
    
        data.items.forEach(item => {
            const card = createLeaderboardElement(
                'div',
                'legion-shop-item'
            );
    
            const name = createLeaderboardElement(
                'div',
                'legion-shop-item-name',
                item.name
            );
    
            const description = createLeaderboardElement(
                'div',
                'legion-shop-item-description',
                item.description
            );
    
            const price = createLeaderboardElement(
                'div',
                'legion-shop-item-price',
                `💰 ${item.price} мяукоинов`
            );
    
            const status = createLeaderboardElement(
                'div',
                'legion-shop-item-status',
                item.owned ? '✓ Уже куплено' : 'Доступно для покупки'
            );
    
            const buyButton = document.createElement('button');
            buyButton.className = 'legion-shop-buy';
            
            if (item.owned) {
                buyButton.textContent = '✓ Куплено';
                buyButton.disabled = true;
            } else if (data.balance < item.price) {
                buyButton.textContent = 'Недостаточно мяукоинов';
                buyButton.disabled = true;
            } else {
                buyButton.textContent = 'Купить';
            
                buyButton.addEventListener('click', () => {
                    purchaseShopItem(item, buyButton);
                });
            }
            
            card.append(
                name,
                description,
                price,
                status,
                buyButton
            );
            
            ui.shopContent.appendChild(card);
        });
    }

    function purchaseShopItem(item, button) {
        const confirmed = confirm(
            `Купить «${item.name}» за ${item.price} мяукоинов?\n\n` +
            'После покупки деньги будут списаны с вашего баланса.'
        );
    
        if (!confirmed) return;
    
        button.disabled = true;
        button.textContent = 'Покупаем...';
    
        request(
            'POST',
            '/api/shop/purchase',
            {
                playerId,
                itemCode: item.code
            },
            (error, result) => {
                if (error || !result?.success) {
                    showToast(
                        result?.error || '😿 Не удалось совершить покупку.'
                    );
    
                    openShop();
                    return;
                }
    
                showToast('🐾 Покупка успешно совершена!');
                openShop();
            }
        );
    }

    function createLeaderboardElement(tag, className, text = '') {
        const element = document.createElement(tag);
    
        if (className) {
            element.className = className;
        }
    
        element.textContent = text;
    
        return element;
    }

    function createLeaderboardSection(title) {
        const section = createLeaderboardElement(
            'div',
            'legion-leaderboard-section'
    );

    section.appendChild(
        createLeaderboardElement(
            'div',
            'legion-leaderboard-section-title',
            title
        )
    );

    return section;
}

function createLeaderboardRow(rank, nickname, value, isSelf = false) {
    const row = createLeaderboardElement(
        'div',
        'legion-leaderboard-row' +
            (isSelf ? ' legion-leaderboard-self' : '')
    );

    row.appendChild(
        createLeaderboardElement(
            'div',
            'legion-leaderboard-rank',
            rank
        )
    );

    row.appendChild(
        createLeaderboardElement(
            'div',
            'legion-leaderboard-name',
            nickname
        )
    );

    row.appendChild(
        createLeaderboardElement(
            'div',
            'legion-leaderboard-value',
            value
        )
    );

    return row;
}

function renderLeaderboard(data) {
    const content = ui.leaderboardContent;
    content.replaceChildren();

    // ========================================
    // ЛИЧНАЯ СТАТИСТИКА
    // ========================================

    const personal = data.personal;

    const personalSection = createLeaderboardSection(
        '🐾 Ваша статистика'
    );

    const personalCard = createLeaderboardElement(
        'div',
        'legion-leaderboard-personal'
    );

    const personalStats = [
        ['Баланс', `${personal.balance} мяукоинов`],
        ['Всего заработано', `${personal.total_earned} мяукоинов`],
        ['Всего бросков', personal.total_spins],
        ['Джекпоты', personal.jackpots],
        ['Личный рекорд', `${personal.personal_max_jackpot} мяукоинов`]
    ];

    personalStats.forEach(([label, value]) => {
        const row = createLeaderboardElement(
            'div',
            'legion-leaderboard-personal-row'
        );

        row.appendChild(
            createLeaderboardElement('span', '', label)
        );

        row.appendChild(
            createLeaderboardElement('strong', '', String(value))
        );

        personalCard.appendChild(row);
    });

    personalSection.appendChild(personalCard);
    content.appendChild(personalSection);

    // ========================================
    // ТОП ПО БАЛАНСУ
    // ========================================

    const balanceSection = createLeaderboardSection(
        '💰 Богатейшие котики'
    );

    if (data.leaderboard.length) {
        data.leaderboard.forEach((player, index) => {
            balanceSection.appendChild(
                createLeaderboardRow(
                    `${index + 1}.`,
                    player.nickname,
                    `${player.balance} мяукоинов`,
                    player.player_id === playerId
                )
            );
        });
    } else {
        balanceSection.appendChild(
            createLeaderboardElement(
                'div',
                'legion-leaderboard-empty',
                'Пока здесь никого нет.'
            )
        );
    }

    content.appendChild(balanceSection);

    // ========================================
    // МИРОВОЙ РЕКОРД ДЖЕКПОТА
    // ========================================

    const jackpotSection = createLeaderboardSection(
        '💎 Самый большой джекпот'
    );

    if (data.maxJackpot) {
        const record = createLeaderboardElement(
            'div',
            'legion-leaderboard-record'
        );

        record.appendChild(
            createLeaderboardElement(
                'div',
                'legion-leaderboard-record-name',
                `🏆 ${data.maxJackpot.score} мяукоинов`
            )
        );

        data.maxJackpot.players.forEach(player => {
            const reels = (player.reels || [])
                .map(item => item.emoji || item.name || '?')
                .join(' ');

            const details = createLeaderboardElement(
                'div',
                'legion-leaderboard-record-details',
                `${player.nickname} — ${reels}`
            );

            record.appendChild(details);
        });

        jackpotSection.appendChild(record);
    } else {
        jackpotSection.appendChild(
            createLeaderboardElement(
                'div',
                'legion-leaderboard-empty',
                'Джекпотов пока не было.'
            )
        );
    }

    content.appendChild(jackpotSection);

    // ========================================
    // САМЫЕ УДАЧЛИВЫЕ КОТИКИ
    // ========================================

    const luckiestSection = createLeaderboardSection(
        '🍀 Самые удачливые котики'
    );

    if (data.luckiest.length) {
        data.luckiest.forEach((player, index) => {
            luckiestSection.appendChild(
                createLeaderboardRow(
                    `${index + 1}.`,
                    player.nickname,
                    `${player.jackpots} джекп.`
                )
            );
        });
    } else {
        luckiestSection.appendChild(
            createLeaderboardElement(
                'div',
                'legion-leaderboard-empty',
                'Пока нет джекпотов.'
            )
        );
    }

    content.appendChild(luckiestSection);
}

// ========================================
// ОТКРЫТИЕ ТАБЛИЦЫ ЛИДЕРОВ
// ========================================

function openLeaderboard() {
    ui.leaderboardModal.classList.add('open');

    ui.leaderboardContent.replaceChildren();

    ui.leaderboardContent.appendChild(
        createLeaderboardElement(
            'div',
            'legion-leaderboard-loading',
            '🏆 Загружаем достижения котиков...'
        )
    );

    request(
        'GET',
        '/api/roulette/leaderboard/' + encodeURIComponent(playerId),
        null,
        (error, result) => {
            if (!ui.leaderboardModal.classList.contains('open')) {
                return;
            }

            if (error || !result?.success) {
                ui.leaderboardContent.replaceChildren();

                ui.leaderboardContent.appendChild(
                    createLeaderboardElement(
                        'div',
                        'legion-leaderboard-empty',
                        result?.error ||
                        '😿 Не получилось загрузить зал славы. Попробуйте чуть позже.'
                    )
                );

                return;
            }

            renderLeaderboard(result);
        }
    );
}

    function init() {
        if (document.getElementById('legion-mini-widget')) return;

        console.log(
            '[Legion Кото-игры] Version 2.0.7 loaded'
        );

        ui = createInterface();

        updateDoNotDisturbUI();
        createRouletteUI();
        loadRouletteStatus();

        heartbeat();
        refreshPlayers();
        refreshInvitations();
        checkMatch();

        setInterval(
            heartbeat,
            CONFIG.heartbeatInterval
        );

        setInterval(
            refreshPlayers,
            CONFIG.playersRefreshInterval
        );

        setInterval(
            refreshInvitations,
            CONFIG.invitationsRefreshInterval
        );

        setInterval(
            checkMatch,
            CONFIG.matchRefreshInterval
        );

        setInterval(
            pollMatchResult,
            CONFIG.matchRefreshInterval
        );

        setInterval(refreshRouletteInvitations, CONFIG.invitationsRefreshInterval);
        setInterval(refreshRouletteMatch, CONFIG.rouletteRefreshInterval);
        setInterval(loadRouletteStatus, 30000);
        setInterval(updateRouletteCooldownUI, 1000);
    }

    // Запускаем интерфейс только после получения никнейма
    (async function startAfterNickname() {
        nickname = await waitForNickname();

        if (!nickname) {
            console.error(
                '[Legion Кото-игры] Не удалось получить ник Multidonate. ' +
                'Проверьте, что вы авторизованы и на странице есть элемент span.who.'
            );
            return;
        }

        localStorage.setItem(STORAGE.nickname, nickname);

        console.log(
            '[Legion Кото-игры] Никнейм обнаружен: ' + nickname
        );

        init();
    })();

})();
