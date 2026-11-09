// ==UserScript==
// @name         Legion - Кото-игры
// @namespace    https://github.com/AhaHaHAH44/Legion-Mini-Games
// @version      2.1.2
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
    let displayedModeMismatch = false;
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
    let rouletteSessionId = null;
    let rouletteRerollAvailable = false;
    let rouletteRerollUsed = false;
    let rouletteSelectedReelIndex = null;
    let rouletteCompleting = false;
    let rouletteCompleted = false;
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
    const ROULETTE_SOLO_PUBLISHED_KEY = 'legion_mini_roulette_solo_published';
    
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
    const publishedSoloRouletteSessions = getStoredRouletteIds(
        ROULETTE_SOLO_PUBLISHED_KEY
    );
    
    function rememberPublishedSoloRouletteSession(sessionId) {
        if (!sessionId) return;
    
        publishedSoloRouletteSessions.add(sessionId);
    
        localStorage.setItem(
            ROULETTE_SOLO_PUBLISHED_KEY,
            JSON.stringify([...publishedSoloRouletteSessions].slice(-100))
        );
    }

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
            },
            
            onabort() {
                callback(new Error('Request aborted'), null, 0);
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

            #legion-mini-panel {
                display: none;
                width: 310px;
                max-width: calc(100vw - 40px);
                position: absolute;
                right: 0;
                bottom: 55px;
                margin-bottom: 0;
                max-height: min(82vh, 760px);
                overflow-y: auto;
                overscroll-behavior: contain;
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
                transition: border-color .16s ease, box-shadow .16s ease, background .16s ease, transform .16s ease;
                cursor: default;
                user-select: none;
            }
            
            .legion-roulette-reel.selectable {
                cursor: pointer;
            }
            
            .legion-roulette-reel.selectable:hover {
                border-color: #d6ad62;
                background: #30271d;
            }
            
            .legion-roulette-reel.selected {
                border: 2px solid #f2c45f;
                background: #3a2d1b;
                box-shadow: 0 0 0 2px #f2c45f33, 0 0 14px #f2c45f66, inset 0 0 12px #0006;
                transform: translateY(-2px);
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
            
            .legion-roulette-controls[hidden] {
                display: none !important;
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
               SHOP — уютная кото-лавка
            ======================================== */
            
            #legion-shop-modal {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 1000004;
                align-items: center;
                justify-content: center;
                padding: 18px;
                background: rgba(17, 12, 9, .78);
                backdrop-filter: blur(5px);
                font-family: Arial, sans-serif;
                color: #f5eadb;
            }
            
            #legion-shop-modal.open {
                display: flex;
            }
            
            #legion-shop-card {
                position: relative;
                width: min(540px, calc(100vw - 36px));
                max-height: calc(100vh - 36px);
                overflow-y: auto;
                padding: 22px;
                border: 1px solid #a47a50;
                border-radius: 20px;
                background:
                    radial-gradient(ellipse at 8% 0%, rgba(218, 174, 111, .13), transparent 42%),
                    linear-gradient(145deg, #493626 0%, #35291f 52%, #29231f 100%);
                box-shadow:
                    0 18px 55px rgba(0,0,0,.62),
                    inset 0 0 0 3px rgba(224,183,126,.045);
                scrollbar-width: thin;
                scrollbar-color: #896746 #30251d;
            }
            
            #legion-shop-card::-webkit-scrollbar {
                width: 8px;
            }
            
            #legion-shop-card::-webkit-scrollbar-track {
                background: #30251d;
                border-radius: 8px;
            }
            
            #legion-shop-card::-webkit-scrollbar-thumb {
                background: #896746;
                border-radius: 8px;
            }
            
            #legion-shop-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin: -2px -2px 17px;
                padding: 0 0 14px;
                border-bottom: 1px solid rgba(205, 160, 105, .32);
            }
            
            #legion-shop-title {
                color: #ffe2b5;
                font-size: 20px;
                font-weight: 800;
                letter-spacing: .2px;
                text-shadow: 0 2px 10px rgba(226, 172, 103, .18);
            }
            
            #legion-shop-close {
                flex: 0 0 34px;
                width: 34px;
                height: 34px;
                border: 1px solid #98734f;
                border-radius: 10px;
                background: rgba(87, 63, 43, .85);
                color: #ffe9d0;
                font-size: 20px;
                cursor: pointer;
                transition: background .18s, transform .18s, border-color .18s;
            }
            
            #legion-shop-close:hover {
                background: #765438;
                border-color: #d0a16c;
                transform: rotate(5deg);
            }
            
            #legion-shop-balance {
                margin-bottom: 19px;
                padding: 13px 15px;
                border: 1px solid rgba(211, 166, 105, .55);
                border-radius: 13px;
                background: linear-gradient(
                    110deg,
                    rgba(111, 79, 45, .72),
                    rgba(66, 52, 38, .9)
                );
                color: #ffe4ae;
                font-size: 14px;
                font-weight: 800;
                box-shadow:
                    inset 0 1px rgba(255,255,255,.045),
                    0 5px 14px rgba(0,0,0,.15);
            }
            
            #legion-shop-content {
                font-size: 13px;
                line-height: 1.55;
            }
            
            .legion-shop-section {
                margin-bottom: 22px;
            }
            
            .legion-shop-section-title {
                margin-bottom: 5px;
                padding: 0 0 9px 2px;
                border-bottom: 1px solid rgba(190, 145, 94, .38);
                color: #ffdda9;
                font-size: 17px;
                font-weight: 800;
            }
            
            .legion-shop-section-description {
                margin-bottom: 12px;
                color: #cbb69c;
                font-size: 12px;
            }
            
            /* Карточки товаров */

            .legion-shop-item {
                position: relative;
                margin-bottom: 13px;
                padding: 15px;
                overflow: hidden;
            
                border: 1px solid #806044;
                border-radius: 15px;
            
                background:
                    linear-gradient(
                        135deg,
                        rgba(117, 83, 54, .22),
                        transparent 65%
                    ),
                    linear-gradient(145deg, #443326, #332820);
            
                box-shadow:
                    0 4px 12px rgba(0, 0, 0, .18),
                    inset 0 1px rgba(255, 255, 255, .035);
            
                transition:
                    transform .2s ease,
                    border-color .2s ease,
                    box-shadow .2s ease;
            }
            
            .legion-shop-item:hover {
                transform: translateY(-2px);
                border-color: #bd9567;
            
                box-shadow:
                    0 7px 18px rgba(0, 0, 0, .27),
                    0 0 13px rgba(218, 174, 111, .08);
            }
            
            /* Название товара */
            
            .legion-shop-item-name {
                color: #ffe3bd;
                font-size: 15px;
                font-weight: 800;
                line-height: 1.4;
            }
            
            /* Описание */
            
            .legion-shop-item-description {
                margin-top: 7px;
                color: #cbb69c;
                font-size: 12px;
                line-height: 1.5;
            }
            
            /* Цена */
            
            .legion-shop-item-price {
                display: inline-block;
                margin-top: 12px;
                padding: 6px 10px;
            
                border: 1px solid rgba(205, 162, 105, .35);
                border-radius: 8px;
            
                background: rgba(119, 83, 47, .32);
            
                color: #ffdc9e;
                font-size: 12px;
                font-weight: 800;
            }
            
            /* Статус товара */
            
            .legion-shop-item-status {
                margin-top: 9px;
                color: #bda98f;
                font-size: 11px;
            }
            
            /* Кнопка покупки */
            
            .legion-shop-buy {
                width: 100%;
                margin-top: 12px;
                padding: 11px 13px;
            
                border: 1px solid #b18a5c;
                border-radius: 10px;
            
                background: linear-gradient(
                    180deg,
                    #80603e,
                    #63472f
                );
            
                color: #fff0d9;
                font-size: 13px;
                font-weight: 800;
            
                cursor: pointer;
            
                box-shadow:
                    inset 0 1px rgba(255,255,255,.12),
                    0 3px 8px rgba(0,0,0,.18);
            
                transition:
                    filter .18s ease,
                    transform .18s ease,
                    box-shadow .18s ease;
            }
            
            .legion-shop-buy:hover:not(:disabled) {
                filter: brightness(1.16);
                transform: translateY(-1px);
            
                box-shadow:
                    0 5px 13px rgba(0,0,0,.25),
                    0 0 12px rgba(218,174,111,.12);
            }
            
            .legion-shop-buy:active:not(:disabled) {
                transform: translateY(0);
            }
            
            .legion-shop-buy:disabled {
                opacity: .48;
                filter: grayscale(.3);
                cursor: not-allowed;
                box-shadow: none;
            }

            /* Заголовок кото-лавки */

            .legion-shop-heading {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            
            .legion-shop-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 46px;
                height: 46px;
                flex-shrink: 0;
                border: 1px solid #a98258;
                border-radius: 13px;
                background: linear-gradient(145deg, #735338, #493526);
                font-size: 25px;
                box-shadow: inset 0 1px rgba(255,255,255,.1);
            }
            
            .legion-shop-heading-text {
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            
            .legion-shop-name {
                color: #ffe2b5;
                font-size: 20px;
                font-weight: 800;
            }
            
            .legion-shop-subtitle {
                color: #c6ad91;
                font-size: 11px;
                font-weight: normal;
            }

            /* ========================================
               ЦВЕТОВЫЕ АКЦЕНТЫ КАТЕГОРИЙ
            ======================================== */
            
            /* Механики — медь и золото */
            
            .legion-shop-section-unlock .legion-shop-section-title {
                color: #f0c58e;
                border-bottom-color: rgba(196, 139, 83, .5);
            }
            
            .legion-shop-section-unlock .legion-shop-item {
                border-left: 3px solid #b9824e;
            }
            
            .legion-shop-section-unlock .legion-shop-item-price {
                border-color: rgba(196, 139, 83, .45);
                background: rgba(142, 91, 48, .22);
                color: #f5c58b;
            }
            
            /* Косметика — мягкий янтарный оттенок */
            
            .legion-shop-section-cosmetic .legion-shop-section-title {
                color: #f5d6a5;
                border-bottom-color: rgba(213, 174, 112, .5);
            }
            
            .legion-shop-section-cosmetic .legion-shop-item {
                border-left: 3px solid #c49b65;
            }
            
            .legion-shop-section-cosmetic .legion-shop-item-price {
                border-color: rgba(213, 174, 112, .45);
                background: rgba(164, 127, 74, .2);
                color: #ffe0a9;
            }
            
            /* Прочее — спокойный древесный стиль */
            
            .legion-shop-section-other .legion-shop-section-title {
                color: #d9c2a6;
                border-bottom-color: rgba(166, 132, 99, .4);
            }
            
            .legion-shop-section-other .legion-shop-item {
                border-left: 3px solid #947456;
            }
            
            .legion-shop-section-other .legion-shop-item-price {
                border-color: rgba(166, 132, 99, .4);
                background: rgba(115, 86, 59, .2);
                color: #e4c9a6;
            }
            
            @media (max-width: 520px) {
                #legion-shop-modal {
                    padding: 10px;
                }
            
                #legion-shop-card {
                    width: calc(100vw - 20px);
                    max-height: calc(100vh - 20px);
                    padding: 17px;
                    border-radius: 16px;
                }
            
                #legion-shop-title {
                    font-size: 18px;
                }
            
                .legion-shop-item {
                    padding: 12px;
                }

                /* Декоративное оформление категорий */

                .legion-shop-section {
                    position: relative;
                    margin-bottom: 25px;
                }
                
                .legion-shop-section-title {
                    position: relative;
                    padding-bottom: 10px;
                }
                
                .legion-shop-section-title::after {
                    content: "✦";
                    position: absolute;
                    right: 3px;
                    bottom: -8px;
                    padding: 0 7px;
                    background: #35291f;
                    color: #c49b65;
                    font-size: 12px;
                }
                
                .legion-shop-section-description {
                    padding-left: 2px;
                    line-height: 1.5;
                }

                /* Пустой магазин */

                .legion-shop-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                
                    padding: 35px 20px;
                    margin: 8px 0;
                
                    border: 1px dashed #806044;
                    border-radius: 16px;
                
                    background: rgba(80, 57, 39, .28);
                    text-align: center;
                }
                
                .legion-shop-empty-icon {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                
                    width: 68px;
                    height: 68px;
                    margin-bottom: 15px;
                
                    border: 1px solid #94704c;
                    border-radius: 20px;
                
                    background: linear-gradient(145deg, #65482f, #403025);
                
                    font-size: 34px;
                    box-shadow: 0 5px 15px rgba(0,0,0,.2);
                }
                
                .legion-shop-empty-title {
                    color: #ffe2b5;
                    font-size: 16px;
                    font-weight: 800;
                }
                
                .legion-shop-empty-description {
                    max-width: 300px;
                    margin-top: 8px;
                
                    color: #c6ad91;
                    font-size: 12px;
                    line-height: 1.6;
                }

                /* ========================================
                   ПЕРЕКЛЮЧАЕМЫЕ КАТЕГОРИИ
                ======================================== */
                
                .legion-shop-tabs {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-bottom: 17px;
                    padding-bottom: 13px;
                    border-bottom: 1px solid rgba(190, 145, 94, .35);
                }
                
                .legion-shop-tab {
                    flex: 1 1 auto;
                    min-width: 0;
                    padding: 10px 12px;
                
                    border: 1px solid #76583d;
                    border-radius: 10px;
                
                    background: linear-gradient(145deg, #463426, #35291f);
                
                    color: #cbb69c;
                    font-size: 12px;
                    font-weight: 800;
                
                    cursor: pointer;
                
                    transition:
                        background .18s,
                        color .18s,
                        border-color .18s,
                        transform .18s;
                }
                
                .legion-shop-tab:hover {
                    border-color: #b18a5c;
                    color: #ffe2b5;
                    transform: translateY(-1px);
                }
                
                .legion-shop-tab.active {
                    border-color: #c49b65;
                    background: linear-gradient(145deg, #80603e, #62472f);
                    color: #fff0d9;
                
                    box-shadow:
                        inset 0 1px rgba(255,255,255,.1),
                        0 3px 10px rgba(0,0,0,.18);
                }
                
                /* Описание выбранной категории */
                
                .legion-shop-tab-content {
                    min-height: 100px;
                    animation: legionShopFade .2s ease;
                }
                
                @keyframes legionShopFade {
                    from {
                        opacity: 0;
                        transform: translateY(5px);
                    }
                
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                
                /* Акценты товаров выбранной категории */
                
                .legion-shop-tab-content[data-category="unlock"]
                .legion-shop-item {
                    border-left: 3px solid #b9824e;
                }
                
                .legion-shop-tab-content[data-category="cosmetic"]
                .legion-shop-item {
                    border-left: 3px solid #c49b65;
                }
                
                .legion-shop-tab-content[data-category="other"]
                .legion-shop-item {
                    border-left: 3px solid #947456;
                }

                /* Заголовок карточки товара */

                .legion-shop-item-heading {
                    display: flex;
                    align-items: center;
                    gap: 11px;
                    min-width: 0;
                }
                
                /* Значок товара */
                
                .legion-shop-item-icon {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                
                    width: 40px;
                    height: 40px;
                    flex-shrink: 0;
                
                    border: 1px solid #98734f;
                    border-radius: 11px;
                
                    background: linear-gradient(
                        145deg,
                        #62472f,
                        #403025
                    );
                
                    font-size: 20px;
                
                    box-shadow:
                        inset 0 1px rgba(255,255,255,.08),
                        0 3px 8px rgba(0,0,0,.15);
                }
                
                /* Название занимает оставшееся место */
                
                .legion-shop-item-heading .legion-shop-item-name {
                    flex: 1;
                    min-width: 0;
                    overflow-wrap: anywhere;
                }
                
                /* Разные оттенки значков */
                
                .legion-shop-tab-content[data-category="unlock"]
                .legion-shop-item-icon {
                    border-color: #b9824e;
                    background: linear-gradient(145deg, #765034, #493326);
                }
                
                .legion-shop-tab-content[data-category="cosmetic"]
                .legion-shop-item-icon {
                    border-color: #c49b65;
                    background: linear-gradient(145deg, #75603e, #493b2b);
                }
                
                .legion-shop-tab-content[data-category="other"]
                .legion-shop-item-icon {
                    border-color: #947456;
                    background: linear-gradient(145deg, #65503b, #403025);
                }
            }

            /* ========================================
               INVENTORY
            ======================================== */
            
            #legion-inventory-modal {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 1000005;
                align-items: center;
                justify-content: center;
                padding: 18px;
                background: #100d0bcc;
                font-family: Arial, sans-serif;
                color: #f4eadb;
            }
            
            #legion-inventory-modal.open {
                display: flex;
            }
            
            #legion-inventory-card {
                width: min(560px, calc(100vw - 36px));
                max-height: calc(100vh - 36px);
                overflow-y: auto;
                padding: 20px;
                border: 1px solid #806044;
                border-radius: 18px;
                background: linear-gradient(145deg, #382d23, #292626);
                box-shadow: 0 12px 45px #000a;
            }
            
            #legion-inventory-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin-bottom: 18px;
            }
            
            #legion-inventory-title {
                color: #ffe0b8;
                font-size: 19px;
                font-weight: bold;
            }
            
            #legion-inventory-close {
                width: 32px;
                height: 32px;
                border: 1px solid #806044;
                border-radius: 9px;
                background: #34291f;
                color: #fff1df;
                font-size: 22px;
                cursor: pointer;
            }
            
            #legion-inventory-close:hover {
                background: #51402f;
            }
            
            #legion-inventory-content {
                display: grid;
                gap: 10px;
            }
            
            .legion-inventory-item {
                padding: 12px;
                border: 1px solid #68513d;
                border-radius: 11px;
                background: #302920;
            }
            
            .legion-inventory-item-name {
                color: #ffe0b8;
                font-weight: bold;
            }
            
            .legion-inventory-item-description {
                margin-top: 5px;
                color: #cdb99f;
                font-size: 12px;
            }
            
            .legion-inventory-item-details {
                display: flex;
                justify-content: space-between;
                gap: 10px;
                margin-top: 9px;
                color: #e8cba8;
                font-size: 12px;
            }

            /* ========================================
               INVENTORY SLOTS
            ======================================== */
            
            .legion-inventory-section-title {
                margin: 12px 0 4px;
                color: #ffe0b8;
                font-size: 15px;
                font-weight: bold;
            }
            
            .legion-inventory-slots {
                display: grid;
                gap: 8px;
            }
            
            .legion-inventory-slot {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 11px 12px;
                border: 1px solid #68513d;
                border-radius: 11px;
                background: #302920;
            }
            
            .legion-inventory-slot-info {
                min-width: 0;
            }
            
            .legion-inventory-slot-name {
                color: #ffe0b8;
                font-weight: bold;
            }
            
            .legion-inventory-slot-number {
                margin-top: 4px;
                color: #b9a28b;
                font-size: 11px;
            }
            
            .legion-inventory-slot-item {
                color: #e8cba8;
                text-align: right;
                font-size: 12px;
            }
            
            .legion-inventory-slot-empty {
                color: #99836c;
                font-style: italic;
            }

            .legion-inventory-action {
                margin-top: 10px;
                padding: 8px 12px;
                border: 1px solid #8c6748;
                border-radius: 8px;
                background: #51402f;
                color: #fff1df;
                font-size: 12px;
                cursor: pointer;
                transition: .18s;
            }
            
            .legion-inventory-action:hover:not(:disabled) {
                background: #735638;
            }
            
            .legion-inventory-action:disabled {
                opacity: .5;
                cursor: not-allowed;
            }
            
            .legion-inventory-slot {
                flex-wrap: wrap;
            }
            
            .legion-inventory-slot .legion-inventory-action {
                margin-top: 0;
            }

            /* ========================================
               ОКНО ПОКУПКИ КОТО-ЛАВКИ
            ======================================== */
            
            #legion-purchase-modal {
                position: fixed;
                inset: 0;
                z-index: 100002;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 20px;
                background: rgba(25, 17, 12, 0.72);
                backdrop-filter: blur(7px);
            }
            
            #legion-purchase-modal.open {
                display: flex;
                animation: purchaseFadeIn 0.2s ease;
            }
            
            #legion-purchase-card {
                position: relative;
                width: 100%;
                max-width: 390px;
                padding: 30px 25px 24px;
                overflow: hidden;
                text-align: center;
                color: #563b27;
                background: linear-gradient(145deg, #fff8e9, #f1dfbd);
                border: 2px solid #c69a5c;
                border-radius: 25px;
                box-shadow:
                    0 18px 55px rgba(0, 0, 0, 0.4),
                    inset 0 0 25px rgba(255, 255, 255, 0.55);
                animation: purchasePopIn 0.25s ease;
            }
            
            .legion-purchase-decoration {
                position: absolute;
                top: 12px;
                right: 17px;
                font-size: 23px;
                opacity: 0.35;
                transform: rotate(15deg);
            }
            
            .legion-purchase-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 76px;
                height: 76px;
                margin: 0 auto 15px;
                font-size: 38px;
                background: linear-gradient(145deg, #ffe7a9, #e8bd70);
                border: 2px solid #c99b55;
                border-radius: 23px;
                box-shadow: 0 5px 12px rgba(115, 75, 30, 0.18);
            }
            
            .legion-purchase-title {
                font-size: 21px;
                font-weight: 800;
                color: #684527;
            }
            
            .legion-purchase-name {
                margin-top: 9px;
                font-size: 18px;
                font-weight: 800;
                color: #9a672d;
            }
            
            .legion-purchase-description {
                margin-top: 7px;
                font-size: 13px;
                line-height: 1.5;
                color: #856c52;
            }
            
            .legion-purchase-info {
                display: flex;
                gap: 10px;
                margin-top: 22px;
            }
            
            .legion-purchase-price,
            .legion-purchase-balance {
                display: flex;
                flex: 1;
                flex-direction: column;
                gap: 6px;
                padding: 12px 8px;
                background: rgba(255, 255, 255, 0.55);
                border: 1px solid rgba(173, 129, 70, 0.3);
                border-radius: 14px;
            }
            
            .legion-purchase-info span {
                font-size: 11px;
                color: #987c5c;
            }
            
            .legion-purchase-info strong {
                font-size: 15px;
                color: #76502d;
            }
            
            .legion-purchase-question {
                margin-top: 20px;
                font-size: 13px;
                color: #80664b;
            }
            
            .legion-purchase-actions {
                display: flex;
                gap: 10px;
                margin-top: 20px;
            }
            
            .legion-purchase-actions button {
                flex: 1;
                padding: 12px 8px;
                font-size: 14px;
                font-weight: 800;
                border: none;
                border-radius: 13px;
                cursor: pointer;
                transition: 0.2s ease;
            }
            
            #legion-purchase-cancel {
                color: #795d42;
                background: #e8d8bd;
            }
            
            #legion-purchase-confirm {
                color: #fff8e9;
                background: linear-gradient(135deg, #bd8744, #95602d);
                box-shadow: 0 4px 10px rgba(126, 79, 34, 0.2);
            }
            
            #legion-purchase-confirm:hover {
                filter: brightness(1.1);
                transform: translateY(-2px);
            }
            
            #legion-purchase-cancel:hover {
                background: #ddc7a5;
            }
            
            .legion-purchase-actions button:disabled {
                opacity: 0.55;
                cursor: not-allowed;
                transform: none;
            }
            
            @keyframes purchaseFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            @keyframes purchasePopIn {
                from {
                    opacity: 0;
                    transform: translateY(12px) scale(0.94);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            /* ========================================
               АНИМАЦИЯ УСПЕШНОЙ ПОКУПКИ
            ======================================== */
            
            #legion-purchase-card.success {
                animation: purchaseSuccess 0.5s ease;
                border-color: #e2ad45;
                box-shadow:
                    0 0 20px rgba(255, 197, 77, 0.4),
                    0 0 55px rgba(255, 176, 46, 0.25),
                    0 18px 55px rgba(0, 0, 0, 0.4);
            }
            
            #legion-purchase-card.success::before,
            #legion-purchase-card.success::after {
                position: absolute;
                top: 20px;
                font-size: 25px;
                pointer-events: none;
                animation: purchaseCoins 1.8s ease-in-out infinite;
            }
            
            #legion-purchase-card.success::before {
                content: '🪙';
                left: 25px;
            }
            
            #legion-purchase-card.success::after {
                content: '✨';
                right: 25px;
                animation-delay: 0.4s;
            }
            
            #legion-purchase-card.success .legion-purchase-icon {
                animation: purchaseIconGlow 1.4s ease-in-out infinite alternate;
                border-color: #e2ad45;
                box-shadow: 0 0 25px rgba(255, 190, 65, 0.55);
            }
            
            #legion-purchase-card.success .legion-purchase-name {
                color: #b47a2c;
            }
            
            #legion-purchase-card.success #legion-purchase-confirm {
                background: linear-gradient(135deg, #d9a342, #a66b2e);
            }
            
            @keyframes purchaseSuccess {
                0% {
                    transform: scale(0.94);
                }
                60% {
                    transform: scale(1.035);
                }
                100% {
                    transform: scale(1);
                }
            }
            
            @keyframes purchaseIconGlow {
                from {
                    transform: scale(1);
                    filter: brightness(1);
                }
                to {
                    transform: scale(1.09) rotate(5deg);
                    filter: brightness(1.2);
                }
            }
            
            @keyframes purchaseCoins {
                0%, 100% {
                    transform: translateY(0) rotate(-10deg);
                    opacity: 0.45;
                }
                50% {
                    transform: translateY(-12px) rotate(15deg);
                    opacity: 1;
                }
            }

            /* ========================================
               КОТО-ЛАВКА — СТИЛИ ВКЛАДОК КАТЕГОРИЙ
            ======================================== */
            
            #legion-shop-modal .legion-shop-tabs {
                display: flex;
                flex-wrap: wrap;
                gap: 9px;
                margin: 18px 0;
            }
            
            #legion-shop-modal .legion-shop-tab {
                flex: 1;
                min-width: 100px;
                padding: 11px 14px;
            
                color: #76502f !important;
                background: linear-gradient(145deg, #f8e8cb, #e8d1aa) !important;
            
                border: 1px solid #c9a16b !important;
                border-radius: 13px !important;
            
                font-weight: 700;
                cursor: pointer;
                transition: all 0.2s ease;
                box-shadow: 0 3px 7px rgba(91, 57, 25, 0.12);
            }
            
            #legion-shop-modal .legion-shop-tab:hover {
                color: #5b381e !important;
                background: linear-gradient(145deg, #ffefd2, #f0d5a8) !important;
                border-color: #b98543 !important;
                transform: translateY(-2px);
            }
            
            #legion-shop-modal .legion-shop-tab.active {
                color: #fff8e9 !important;
                background: linear-gradient(145deg, #b98242, #87552d) !important;
                border: 1px solid #87552d !important;
                box-shadow: 0 4px 12px rgba(117, 72, 31, 0.25);
            }
            
            #legion-shop-modal .legion-shop-tab.active:hover {
                background: linear-gradient(145deg, #c89350, #986337) !important;
            }

            /* ========================================
               КОМПАКТНАЯ ПАНЕЛЬ КОТО-ИГР
            ======================================== */
            
            #legion-mini-widget {
                --launcher-bg: rgba(52, 41, 31, 0.68);
                --launcher-bg-hover: rgba(81, 64, 47, 0.88);
                --launcher-border: rgba(161, 123, 80, 0.85);
                --launcher-text: #fff0dc;
            }
            
            /* Убираем общую подложку */
            
            .legion-mini-launcher {
                display: flex !important;
                flex-direction: column;
                align-items: center;
                gap: 5px !important;
                width: max-content;
                margin-left: auto;
            }
            
            /* Верхняя кнопка возврата */
            
            .legion-mini-return-row {
                display: flex;
                justify-content: center;
                width: 100%;
            }
            
            #legion-mini-widget #legion-mini-restore {
                display: none;
                width: auto;
                height: 29px;
                min-width: 0;
                padding: 0 13px;
            
                border: 1px solid rgba(177, 138, 93, 0.85);
                border-radius: 10px;
            
                background: rgba(52, 41, 31, 0.68);
                color: var(--launcher-text);
            
                font: bold 11px Arial, sans-serif;
                white-space: nowrap;
            
                backdrop-filter: blur(9px);
                -webkit-backdrop-filter: blur(9px);
            
                box-shadow: 0 3px 12px rgba(0, 0, 0, 0.25);
                transition: 0.2s ease;
            }
            
            #legion-mini-widget #legion-mini-restore.open {
                display: block;
            }
            
            #legion-mini-widget #legion-mini-restore:hover {
                background: var(--launcher-bg-hover);
                border-color: #d1a875;
                transform: translateY(-1px);
            }
            
            /* Нижний ряд */
            
            .legion-mini-button-row {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }
            
            .legion-mini-side {
                display: flex;
                align-items: center;
                gap: 5px;
            }
            
            /* Маленькие кнопки */
            
            #legion-mini-widget .legion-mini-icon-button {
                display: flex;
                align-items: center;
                justify-content: center;
            
                width: 37px;
                height: 37px;
                padding: 0;
            
                color: var(--launcher-text);
                background: var(--launcher-bg);
                border: 1px solid var(--launcher-border);
                border-radius: 12px;
            
                font-size: 17px;
                cursor: pointer;
            
                backdrop-filter: blur(9px);
                -webkit-backdrop-filter: blur(9px);
            
                box-shadow: 0 4px 13px rgba(0, 0, 0, 0.25);
                transition: 0.2s ease;
            }
            
            #legion-mini-widget .legion-mini-icon-button:hover {
                background: var(--launcher-bg-hover);
                border-color: #d1a875;
                transform: translateY(-2px);
                box-shadow: 0 6px 17px rgba(0, 0, 0, 0.3);
            }
            
            #legion-mini-widget .legion-mini-icon-button:active {
                transform: scale(0.94);
            }
            
            /* Центральная кнопка */
            
            #legion-mini-widget .legion-mini-main-button {
                display: flex;
                align-items: center;
                justify-content: center;
            
                min-width: 132px;
                height: 43px;
                padding: 0 16px;
            
                color: var(--launcher-text);
            
                background: linear-gradient(
                    145deg,
                    rgba(75, 57, 42, 0.86),
                    rgba(48, 37, 29, 0.82)
                );
            
                border: 1px solid #b18a5d;
                border-radius: 14px;
            
                font: bold 13px Arial, sans-serif;
                white-space: nowrap;
                cursor: pointer;
            
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
            
                box-shadow:
                    0 4px 15px rgba(0, 0, 0, 0.28),
                    inset 0 1px rgba(255, 255, 255, 0.09);
            
                transition: 0.2s ease;
            }
            
            #legion-mini-widget .legion-mini-main-button:hover {
                background: linear-gradient(
                    145deg,
                    rgba(99, 73, 51, 0.92),
                    rgba(65, 48, 36, 0.9)
                );
            
                border-color: #d1a875;
                transform: translateY(-2px);
            }
            
            #legion-mini-widget .legion-mini-main-button:active {
                transform: scale(0.97);
            }
            
            /* Узкие экраны */
            
            @media (max-width: 480px) {
                .legion-mini-button-row {
                    gap: 4px;
                }
            
                .legion-mini-side {
                    gap: 4px;
                }
            
                #legion-mini-widget .legion-mini-icon-button {
                    width: 34px;
                    height: 34px;
                    font-size: 15px;
                }
            
                #legion-mini-widget .legion-mini-main-button {
                    min-width: 116px;
                    height: 40px;
                    padding: 0 10px;
                    font-size: 12px;
                }
            }

            #legion-mini-widget .legion-mini-icon-button,
            #legion-mini-widget .legion-mini-main-button {
                box-sizing: border-box;
                flex-shrink: 0;
            }
            
            #legion-mini-widget .legion-mini-button-row {
                width: max-content;
                margin: 0 auto;
            }
            
            #legion-mini-widget .legion-mini-return-row:empty {
                display: none;
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

                <div class="legion-mini-return-row">
                    <!-- Кнопка добавляется сюда через JavaScript -->
                </div>
            
                <div class="legion-mini-button-row">
            
                    <div class="legion-mini-side legion-mini-side-left">
            
                        <button id="legion-mini-leaderboard-button"
                                class="legion-mini-icon-button"
                                type="button"
                                title="Зал славы котиков">
                            🏆
                        </button>
            
                        <button id="legion-mini-shop-button"
                                class="legion-mini-icon-button"
                                type="button"
                                title="Магазин котиков">
                            🛒
                        </button>
            
                    </div>
            
                    <button id="legion-mini-toggle"
                            class="legion-mini-main-button"
                            type="button">
                        🐾 Кото-игры
                    </button>
            
                    <div class="legion-mini-side legion-mini-side-right">
            
                        <button id="legion-mini-inventory-button"
                                class="legion-mini-icon-button"
                                type="button"
                                title="Инвентарь котика">
                            🧺
                        </button>
            
                    </div>
            
                </div>
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
                        <div class="legion-shop-heading">
                            <span class="legion-shop-icon">🐱</span>
                    
                            <div class="legion-shop-heading-text">
                                <div class="legion-shop-name">Кото-лавка</div>
                                <div class="legion-shop-subtitle">
                                    Магазин новых механик, косметики и прочего
                                </div>
                            </div>
                        </div>
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

        const purchaseModal = document.createElement('div');
        purchaseModal.id = 'legion-purchase-modal';
        
        purchaseModal.innerHTML = `
            <div id="legion-purchase-card">
                <div class="legion-purchase-decoration">🐾</div>
        
                <div class="legion-purchase-icon" id="legion-purchase-icon">
                    📦
                </div>
        
                <div class="legion-purchase-title">
                    Покупка товара
                </div>
        
                <div class="legion-purchase-name" id="legion-purchase-name"></div>
        
                <div class="legion-purchase-description" id="legion-purchase-description"></div>
        
                <div class="legion-purchase-info">
                    <div class="legion-purchase-price">
                        <span>Стоимость</span>
                        <strong id="legion-purchase-price"></strong>
                    </div>
        
                    <div class="legion-purchase-balance">
                        <span>Ваш баланс</span>
                        <strong id="legion-purchase-balance"></strong>
                    </div>
                </div>
        
                <div class="legion-purchase-question">
                    Хочешь приобрести этот товар?
                </div>
        
                <div class="legion-purchase-actions">
                    <button id="legion-purchase-cancel">Отмена</button>
                    <button id="legion-purchase-confirm">🐾 Купить</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(purchaseModal);
        
        document.body.appendChild(shopModal);

        const inventoryModal = document.createElement('div');
        inventoryModal.id = 'legion-inventory-modal';
        
        inventoryModal.innerHTML = `
            <div id="legion-inventory-card">
        
                <div id="legion-inventory-header">
                    <div id="legion-inventory-title">
                        🧺 Инвентарь котика
                    </div>
        
                    <button id="legion-inventory-close"
                            type="button"
                            title="Закрыть">
                        ×
                    </button>
                </div>
        
                <div id="legion-inventory-content">
                    <div class="legion-leaderboard-loading">
                        Загружаем инвентарь...
                    </div>
                </div>
        
            </div>
        `;
        
        document.body.appendChild(inventoryModal);

        const restoreButton = document.createElement('button');
        restoreButton.id = 'legion-mini-restore';
        restoreButton.type = 'button';
        restoreButton.textContent = '🐾 Вернуться к игре';

        widget.querySelector('.legion-mini-return-row')
            .appendChild(restoreButton);

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

        widget.querySelector('#legion-mini-inventory-button')
            .addEventListener('click', openInventory);

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

        purchaseModal.addEventListener('click', event => {
            if (event.target === purchaseModal) {
                purchaseModal.classList.remove('open');
            }
        });

        inventoryModal.querySelector('#legion-inventory-close')
            .addEventListener('click', closeInventory);
        
        inventoryModal.addEventListener('click', event => {
            if (event.target === inventoryModal) {
                closeInventory();
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
            purchaseModal,
            purchaseIcon: purchaseModal.querySelector('#legion-purchase-icon'),
            purchaseName: purchaseModal.querySelector('#legion-purchase-name'),
            purchaseDescription: purchaseModal.querySelector('#legion-purchase-description'),
            purchasePrice: purchaseModal.querySelector('#legion-purchase-price'),
            purchaseBalance: purchaseModal.querySelector('#legion-purchase-balance'),
            purchaseCancel: purchaseModal.querySelector('#legion-purchase-cancel'),
            purchaseConfirm: purchaseModal.querySelector('#legion-purchase-confirm'),

            inventoryModal,
            inventoryContent: inventoryModal.querySelector(
                '#legion-inventory-content'
            ),

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

    let cancelMatchInFlight = false;

    function cancelKnbMatch() {
        if (!activeMatchId || cancelMatchInFlight) return;
    
        cancelMatchInFlight = true;
    
        request(
            'POST',
            '/api/matches/' +
            encodeURIComponent(activeMatchId) +
            '/cancel',
            {
                playerId
            },
            (error, result) => {
                cancelMatchInFlight = false;
    
                if (error || !result?.success) {
                    showToast(
                        result?.error || 'Не удалось отменить игру'
                    );
                    return;
                }
    
                closeModal();
    
                activeMatchId = null;
                currentKnbMatch = null;
                displayedModeMatchId = null;
                displayedModeMismatch = false;
                displayedBetMatchId = null;
    
                showToast('🐾 Вы отказались от игры.');
            }
        );
    }

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
            },
            {
                label: '❌ Отказаться',
                onClick: cancelKnbMatch
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
                displayedModeMismatch = true;
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
            },
            {
                label: '❌ Отменить игру',
                onClick: cancelKnbMatch
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
                    [
                        {
                            label: '❌ Отменить игру',
                            onClick: cancelKnbMatch
                        }
                    ]
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

            if (match.status === 'cancelled') {
                const wasCurrentMatch =
                    activeMatchId === match.id ||
                    currentKnbMatch?.id === match.id;
            
                if (wasCurrentMatch) {
                    closeModal();
            
                    showToast('🐾 Соперник отказался от игры.');
                }
            
                activeMatchId = null;
                currentKnbMatch = null;
                displayedModeMatchId = null;
                displayedModeMismatch = false;
                displayedBetMatchId = null;
            
                return;
            }

            if (match.status !== 'choosing_mode') {
                displayedModeMismatch = false;
            }

            if (match.status === 'choosing_mode') {
                currentKnbMatch = match;
            
                const modesMismatch =
                    match.players.every(player => player.mode !== null) &&
                    match.players[0].mode !== match.players[1].mode;
            
                if (modesMismatch && !displayedModeMismatch) {
                    displayedModeMismatch = true;
                    displayedModeMatchId = null;
            
                    showModeSelection(match);
                } else if (!modesMismatch) {
                    displayedModeMismatch = false;
                    showModeSelection(match);
                }
            
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
                <button class="legion-mini-button" data-action="reroll" disabled hidden>
                    🔄 Перебросить
                </button>
                <button class="legion-mini-button" data-action="publish" disabled>
                    📢 В чат
                </button>
            </div>
            
            <div class="legion-roulette-hint" data-role="reroll-hint" hidden>
                Выбери символ выше, который хочешь заменить.
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

                const rerollButton = container.querySelector('[data-action="reroll"]');

                container.querySelectorAll('.legion-roulette-reel').forEach((reel, index) => {
                    reel.setAttribute('role', 'button');
                    reel.setAttribute('tabindex', '-1');
                    reel.setAttribute('aria-label', `Выбрать ${index + 1}-й слот для переброса`);
                
                    const selectReel = () => selectRouletteReel(index);
                
                    reel.addEventListener('click', selectReel);
                
                    reel.addEventListener('keydown', event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectReel();
                        }
                    });
                });
                
                rerollButton.addEventListener('click', () => {
                    if (rerollButton.disabled || rouletteSelectedReelIndex === null) return;
                    rerollRouletteSolo(rouletteSelectedReelIndex);
                });
    }

    function rouletteElements() {
        const container = document.querySelector('.legion-roulette');
        if (!container) return null;

        return {
            reels: [...container.querySelectorAll('.legion-roulette-reel')],
            result: container.querySelector('.legion-roulette-result'),
            spin: container.querySelector('[data-action="spin"]'),
            reroll: container.querySelector('[data-action="reroll"]'),
            rerollHint: container.querySelector('[data-role="reroll-hint"]'),
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

    function updateRouletteRerollUI() {
        const elements = rouletteElements();
        if (!elements) return;
    
        const canReroll = Boolean(
            rouletteRerollAvailable &&
            rouletteResult &&
            rouletteSessionId &&
            !rouletteRerollUsed &&
            !rouletteSpinning &&
            !rouletteCompleting
        );
    
        elements.reroll.hidden = !canReroll;
        elements.reroll.disabled = !canReroll || rouletteSelectedReelIndex === null;
        elements.rerollHint.hidden = !canReroll;
    
        elements.reels.forEach((reel, index) => {
            reel.classList.toggle('selectable', canReroll);
            reel.classList.toggle('selected', canReroll && rouletteSelectedReelIndex === index);
            reel.setAttribute('aria-pressed', String(canReroll && rouletteSelectedReelIndex === index));
            reel.setAttribute('tabindex', canReroll ? '0' : '-1');
        });
    }
    
    function selectRouletteReel(index) {
        if (
            ![0, 1, 2].includes(index) ||
            !rouletteRerollAvailable ||
            !rouletteResult ||
            !rouletteSessionId ||
            rouletteRerollUsed ||
            rouletteSpinning ||
            rouletteCompleting
        ) {
            return;
        }
    
        rouletteSelectedReelIndex =
            rouletteSelectedReelIndex === index ? null : index;
    
        updateRouletteRerollUI();
    }

    function loadRouletteRerollAvailability() {
        request(
            'GET',
            '/api/inventory/' + encodeURIComponent(playerId),
            null,
            (error, result) => {
                if (error || !result?.success) {
                    rouletteRerollAvailable = false;
                    updateRouletteRerollUI();
                    return;
                }
    
                const rerollItem = result.items?.find(item =>
                    item.code === 'roulette_mod_reroll'
                );
    
                rouletteRerollAvailable = Boolean(
                    rerollItem &&
                    rerollItem.equipped &&
                    Number(rerollItem.quantity) > 0
                );
    
                updateRouletteRerollUI();
            }
        );
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
                    updateRouletteRerollUI();
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

    if (
        !elements ||
        rouletteSpinning ||
        rouletteCompleting ||
        Date.now() < rouletteCooldownUntil
    ) {
        return;
    }

    elements.spin.disabled = true;
    elements.publish.disabled = true;
    elements.result.textContent = 'Связываемся с шахтой...';

    rouletteSessionId = null;
    rouletteResult = null;
    rouletteCompleted = false;
    rouletteCompleting = false;
    rouletteRerollUsed = false;
    rouletteSelectedReelIndex = null;

    updateRouletteRerollUI();

    // Запрашиваем вращение у сервера.
    function requestNewSpin() {
        request(
            'POST',
            '/api/roulette/solo',
            { playerId },
            (error, result) => {
                if (error || !result?.success) {
                    elements.result.textContent =
                        result?.error || 'Не удалось запустить рулетку.';

                    if (result?.nextAt) {
                        rouletteCooldownUntil = Number(result.nextAt);
                    }

                    rouletteSpinning = false;
                    updateRouletteCooldownUI();
                    updateRouletteRerollUI();
                    return;
                }

                const nextAt = Number(result.nextAt || 0);

                // Сервер вернул старую незавершённую сессию,
                // а её кулдаун уже закончился.
                if (result.pending && nextAt <= Date.now()) {
                    rouletteSessionId = result.sessionId;
                    rouletteResult = normalizeRouletteResult(result);
                    rouletteRerollUsed = Boolean(result.rerollUsed);

                    if (!rouletteSessionId) {
                        elements.result.textContent =
                            '😿 Не удалось восстановить предыдущую сессию.';
                        rouletteSpinning = false;
                        updateRouletteCooldownUI();
                        return;
                    }

                    elements.result.textContent =
                        '📦 Завершаем предыдущую добычу...';

                    rouletteCompleting = true;
                    updateRouletteRerollUI();

                    request(
                        'POST',
                        '/api/roulette/solo/complete',
                        {
                            playerId,
                            sessionId: rouletteSessionId
                        },
                        (completeError, completeResult) => {
                            rouletteCompleting = false;

                            if (
                                completeError ||
                                !completeResult?.success
                            ) {
                                elements.result.textContent =
                                    completeResult?.error ||
                                    'Не удалось сохранить предыдущую добычу.';

                                elements.publish.disabled = false;
                                updateRouletteCooldownUI();
                                updateRouletteRerollUI();
                                return;
                            }

                            // Предыдущая награда успешно начислена.
                            rouletteCompleted = true;
                            rouletteResult =
                                normalizeRouletteResult(completeResult);

                            rouletteBalance = Number(
                                completeResult.balance ?? rouletteBalance
                            );

                            if (elements.balance) {
                                elements.balance.textContent =
                                    `💰 Баланс: ${rouletteBalance} мяукоинов`;
                            }

                            loadRouletteStatus();
                            loadRouletteRerollAvailability();

                            // Старая сессия закрыта.
                            // Теперь запрашиваем совершенно новое вращение.
                            rouletteSessionId = null;
                            rouletteResult = null;
                            rouletteCompleted = false;
                            rouletteRerollUsed = false;
                            rouletteSelectedReelIndex = null;

                            elements.result.textContent =
                                '⛏️ Предыдущая добыча сохранена! Начинаем новое вращение...';

                            requestNewSpin();
                        }
                    );

                    return;
                }

                // Получен новый результат.
                rouletteResult = normalizeRouletteResult(result);
                rouletteCooldownUntil = nextAt;
                rouletteSessionId = result.sessionId;

                if (!rouletteSessionId) {
                    elements.result.textContent =
                        '😿 Сервер не вернул ID вращения.';
                    elements.publish.disabled = true;
                    rouletteSpinning = false;
                    updateRouletteCooldownUI();
                    return;
                }

                rouletteCompleted = false;
                rouletteCompleting = false;
                rouletteRerollUsed = Boolean(result.rerollUsed);
                rouletteSelectedReelIndex = null;

                updateRouletteRerollUI();

                animateRoulette(rouletteResult.reels, () => {
                    const description =
                        rouletteResourceText(rouletteResult.reels);

                    const multiplier = Number(result.multiplier || 1);

                    rouletteBalance = Number(
                        result.balance ?? rouletteBalance
                    );

                    if (elements.balance) {
                        elements.balance.textContent =
                            `💰 Баланс: ${rouletteBalance} мяукоинов`;
                    }

                    const multiplierText = multiplier > 1
                        ? ` · множитель ×${multiplier}`
                        : '';

                    elements.result.textContent =
                        rouletteResult.jackpot
                            ? `🎉 ДЖЕКПОТ! ${description} · ${rouletteResult.score} мяукоинов${multiplierText}`
                            : `${description} · ${rouletteResult.score} мяукоинов${multiplierText}`;

                    updateRouletteRerollUI();
                    loadRouletteRerollAvailability();

                    elements.publish.disabled = false;
                });
            }
        );
    }

    requestNewSpin();
}

    function rerollRouletteSolo(index) {
        const elements = rouletteElements();
    
        if (
            !elements ||
            !rouletteResult ||
            !rouletteSessionId ||
            rouletteRerollUsed ||
            rouletteSpinning ||
            rouletteCompleting ||
            !rouletteRerollAvailable
        ) {
            return;
        }
    
        if (![0, 1, 2].includes(index)) return;
    
        elements.reroll.disabled = true;
        rouletteSelectedReelIndex = null;
        updateRouletteRerollUI();
        elements.publish.disabled = true;
        elements.result.textContent = '🔄 Перебрасываем выбранный слот...';
    
        request(
            'POST',
            '/api/roulette/solo/reroll',
            {
                playerId,
                sessionId: rouletteSessionId,
                index
            },
            (error, result) => {
                if (error || !result?.success) {
                    elements.result.textContent =
                        result?.error || 'Не удалось выполнить переброс.';
    
                    updateRouletteRerollUI();
                    elements.publish.disabled = false;
                    return;
                }
    
                rouletteRerollUsed = true;
                rouletteResult = normalizeRouletteResult(result);
    
                animateRoulette(rouletteResult.reels, () => {
                    const description = rouletteResourceText(
                        rouletteResult.reels
                    );
    
                    const multiplierText = rouletteResult.multiplier > 1
                        ? ` · множитель ×${rouletteResult.multiplier}`
                        : '';
    
                    elements.result.textContent = rouletteResult.jackpot
                        ? `🎉 ДЖЕКПОТ! ${description} · ${rouletteResult.score} мяукоинов${multiplierText}`
                        : `${description} · ${rouletteResult.score} мяукоинов${multiplierText}`;
    
                    rouletteSelectedReelIndex = null;
                    updateRouletteRerollUI();
                    elements.publish.disabled = false;
                    
                    loadRouletteRerollAvailability();
                });
            }
        );
    }

    function publishRouletteSolo() {
        if (!rouletteResult || rouletteCompleting) return;
    
        const elements = rouletteElements();
        if (!elements) return;
    
        if (
            rouletteSessionId &&
            publishedSoloRouletteSessions.has(rouletteSessionId)
        ) {
            elements.publish.disabled = true;
            return;
        }
    
        // Если награда уже начислена, повторно отправляем только сообщение.
        if (rouletteCompleted) {
            let sent = false;
    
            try {
                sent = publishResultToChat(
                    rouletteChatMessage(rouletteResult)
                );
            } catch (error) {
                console.error('[Legion] Chat publish failed:', error);
            }
    
            if (sent) {
                rememberPublishedSoloRouletteSession(rouletteSessionId);
                elements.publish.disabled = true;
            }
    
            return;
        }
    
        if (!rouletteSessionId) {
            showToast('😿 Не найдена сессия вращения.');
            return;
        }
    
        rouletteCompleting = true;
        elements.publish.disabled = true;
        elements.result.textContent = '⛏️ Завершаем вращение...';
    
        request(
            'POST',
            '/api/roulette/solo/complete',
            {
                playerId,
                sessionId: rouletteSessionId
            },
            (error, result) => {
                rouletteCompleting = false;
    
                if (error || !result?.success) {
                    elements.result.textContent =
                        result?.error ||
                        'Не удалось завершить вращение. Попробуйте ещё раз.';
    
                    // Разрешаем повторить запрос.
                    elements.publish.disabled = false;
                    return;
                }
    
                // Сервер подтвердил начисление награды.
                rouletteCompleted = true;
                rouletteResult = normalizeRouletteResult(result);
                rouletteBalance = Number(
                    result.balance ?? rouletteBalance
                );
    
                if (elements.balance) {
                    elements.balance.textContent =
                        `💰 Баланс: ${rouletteBalance} мяукоинов`;
                }
    
                elements.result.textContent =
                    `🎉 Награда начислена: ${rouletteResult.score} мяукоинов!`;
    
                if (result.modifierDrop?.granted) {
                    showToast(
                        `🎁 Получен модификатор «${result.modifierDrop.name}»!`
                    );
                }
    
                // Обновляем данные независимо от чата.
                loadRouletteStatus();
                loadRouletteRerollAvailability();
    
                // Отправляем результат в чат.
                let sent = false;
    
                try {
                    sent = publishResultToChat(
                        rouletteChatMessage(rouletteResult)
                    );
                } catch (error) {
                    console.error('[Legion] Chat publish failed:', error);
                }
    
                if (sent) {
                    rememberPublishedSoloRouletteSession(rouletteSessionId);
                    elements.publish.disabled = true;
                } else {
                    elements.publish.disabled = false;
                    elements.result.textContent =
                        `🎉 Награда начислена: ${rouletteResult.score} мяукоинов! ` +
                        'Не удалось отправить сообщение в чат. Попробуйте ещё раз.';
                }
            }
        );
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

    function openInventory() {
    ui.inventoryModal.classList.add('open');

    ui.inventoryContent.replaceChildren();

    ui.inventoryContent.appendChild(
        createLeaderboardElement(
            'div',
            'legion-leaderboard-loading',
            '🎒 Загружаем вещи котика...'
        )
    );

    request(
        'GET',
        '/api/inventory/' + encodeURIComponent(playerId),
        null,
        (error, result) => {
            if (!ui.inventoryModal.classList.contains('open')) {
                return;
            }

            if (error || !result?.success) {
                ui.inventoryContent.replaceChildren();

                ui.inventoryContent.appendChild(
                    createLeaderboardElement(
                        'div',
                        'legion-leaderboard-empty',
                        result?.error ||
                        '😿 Не удалось загрузить инвентарь.'
                    )
                );

                return;
            }

            renderInventory(result);
        }
    );
}

function closeInventory() {
    ui.inventoryModal.classList.remove('open');
}

    function equipInventoryItem(item, slots) {
    // Ищем свободный слот подходящей категории
    const availableSlot = slots.find(slot =>
        !slot.item_code &&
        slot.accepted_categories.includes(item.category)
    );

    if (!availableSlot) {
        showToast('😿 Нет свободного подходящего слота!');
        return;
    }

    request(
        'POST',
        '/api/inventory/equip',
        {
            playerId,
            itemCode: item.code,
            slotType: availableSlot.slot_type,
            slotNumber: availableSlot.slot_number
        },
        (error, result) => {
            if (error || !result?.success) {
                showToast(
                    '😿 Не удалось экипировать предмет: ' +
                    (result?.error || 'ошибка соединения')
                );
                return;
            }

            showToast('🐾 Предмет успешно экипирован!');
            openInventory();
        }
    );
}

function unequipInventorySlot(slot) {
    request(
        'POST',
        '/api/inventory/unequip',
        {
            playerId,
            slotType: slot.slot_type,
            slotNumber: slot.slot_number
        },
        (error, result) => {
            if (error || !result?.success) {
                showToast(
                    '😿 Не удалось снять предмет: ' +
                    (result?.error || 'ошибка соединения')
                );
                return;
            }

            showToast('🎒 Предмет возвращён в инвентарь!');
            openInventory();
        }
    );
}

function renderInventory(data) {
    ui.inventoryContent.replaceChildren();

    // ========================================
    // СЛОТЫ ЭКИПИРОВКИ
    // ========================================

    const slotsTitle = createLeaderboardElement(
        'div',
        'legion-inventory-section-title',
        '⚙️ Экипировка'
    );

    ui.inventoryContent.appendChild(slotsTitle);

    const slotsContainer = createLeaderboardElement(
        'div',
        'legion-inventory-slots'
    );

    if (data.slots && data.slots.length > 0) {
        data.slots.forEach(slot => {
            const slotElement = createLeaderboardElement(
                'div',
                'legion-inventory-slot'
            );

            const info = createLeaderboardElement(
                'div',
                'legion-inventory-slot-info'
            );

            const slotName = createLeaderboardElement(
                'div',
                'legion-inventory-slot-name',
                slot.slot_name
            );

            const slotNumber = createLeaderboardElement(
                'div',
                'legion-inventory-slot-number',
                `Слот №${slot.slot_number}`
            );

            const itemName = createLeaderboardElement(
                'div',
                slot.item_code
                    ? 'legion-inventory-slot-item'
                    : 'legion-inventory-slot-item legion-inventory-slot-empty',
                slot.item_code
                    ? `${slot.item_icon || '📦'} ${slot.item_name}`
                    : 'Пусто'
            );

            info.append(slotName, slotNumber);
            slotElement.append(info, itemName);
            
            // Кнопка снятия предмета
            if (slot.item_code) {
                const unequipButton = createLeaderboardElement(
                    'button',
                    'legion-inventory-action',
                    'Снять'
                );
            
                unequipButton.type = 'button';
            
                unequipButton.addEventListener('click', () => {
                    unequipInventorySlot(slot);
                });
            
                slotElement.appendChild(unequipButton);
            }
            
            slotsContainer.appendChild(slotElement);
        });
    } else {
        slotsContainer.appendChild(
            createLeaderboardElement(
                'div',
                'legion-inventory-empty',
                'Слоты экипировки не найдены.'
            )
        );
    }

    ui.inventoryContent.appendChild(slotsContainer);

    // ========================================
    // ПРЕДМЕТЫ В ИНВЕНТАРЕ
    // ========================================

    const itemsTitle = createLeaderboardElement(
        'div',
        'legion-inventory-section-title',
        '🎒 Предметы'
    );

    ui.inventoryContent.appendChild(itemsTitle);

    if (!data.items || data.items.length === 0) {
        ui.inventoryContent.appendChild(
            createLeaderboardElement(
                'div',
                'legion-leaderboard-empty',
                'Пока в инвентаре нет предметов.'
            )
        );

        return;
    }

    data.items.forEach(item => {
        const card = createLeaderboardElement(
            'div',
            'legion-inventory-item'
        );

        const name = createLeaderboardElement(
            'div',
            'legion-inventory-item-name',
            `${item.icon || '📦'} ${item.name}`
        );

        const description = createLeaderboardElement(
            'div',
            'legion-inventory-item-description',
            item.description || 'Описание отсутствует.'
        );

        const details = createLeaderboardElement(
            'div',
            'legion-inventory-item-details'
        );

        const quantity = createLeaderboardElement(
            'span',
            '',
            `Количество: ${item.quantity}`
        );

        const status = createLeaderboardElement(
            'span',
            '',
            item.equipped ? '✓ Экипировано' : 'В инвентаре'
        );

        details.append(quantity, status);
        card.append(name, description, details);
        
        // Не показываем кнопку, если предмет уже экипирован
        if (!item.equipped) {
            const equipButton = createLeaderboardElement(
                'button',
                'legion-inventory-action',
                'Экипировать'
            );
        
            equipButton.type = 'button';
        
            equipButton.addEventListener('click', () => {
                equipInventoryItem(item, data.slots || []);
            });
        
            card.appendChild(equipButton);
        }
        
        ui.inventoryContent.appendChild(card);
    });
}

    function renderShop(data) {
    ui.shopBalance.textContent =
        `💰 Ваш баланс: ${data.balance} мяукоинов`;

    ui.shopContent.replaceChildren();

    if (!data.items || data.items.length === 0) {
        const emptyState = createLeaderboardElement(
            'div',
            'legion-shop-empty'
        );

        const icon = createLeaderboardElement(
            'div',
            'legion-shop-empty-icon',
            '🐈'
        );

        const title = createLeaderboardElement(
            'div',
            'legion-shop-empty-title',
            'Лавка пока пустует'
        );

        const description = createLeaderboardElement(
            'div',
            'legion-shop-empty-description',
            'Наш котик ещё готовит товары для шахтёров. Загляни сюда немного позже!'
        );

        emptyState.append(icon, title, description);
        ui.shopContent.appendChild(emptyState);

        return;
    }

    const categories = [
        {
            id: 'unlock',
            title: '⚙️ Механики',
            description: 'Разблокировки игровых возможностей'
        },
        {
            id: 'cosmetic',
            title: '✨ Косметика',
            description: 'Визуальные эффекты и оформление'
        },
        {
            id: 'other',
            title: '📦 Прочее',
            description: 'Другие товары магазина'
        }
    ];

    // Распределяем товары по категориям
    const categoryItems = {
        unlock: data.items.filter(item => item.category === 'unlock'),
        cosmetic: data.items.filter(item => item.category === 'cosmetic'),
        other: data.items.filter(item =>
            !['unlock', 'cosmetic'].includes(item.category)
        )
    };

    // Оставляем только категории, в которых есть товары
    const availableCategories = categories.filter(
        category => categoryItems[category.id].length > 0
    );

    let activeCategory = availableCategories[0].id;

    // Панель переключения категорий
    const tabs = createLeaderboardElement(
        'div',
        'legion-shop-tabs'
    );

    // Область содержимого выбранной категории
    const content = createLeaderboardElement(
        'div',
        'legion-shop-tab-content'
    );

    function renderCategory(categoryId) {
        const category = categories.find(
            item => item.id === categoryId
        );

        const items = categoryItems[categoryId];

        content.replaceChildren();
        content.dataset.category = categoryId;

        const description = createLeaderboardElement(
            'div',
            'legion-shop-section-description',
            category.description
        );

        content.appendChild(description);

        items.forEach(item => {
            const card = createLeaderboardElement(
                'div',
                'legion-shop-item'
            );

            const nameRow = createLeaderboardElement(
                'div',
                'legion-shop-item-heading'
            );
            
            const categoryIcon = {
                unlock: '⚙️',
                cosmetic: '✨',
                other: '📦'
            };
            
            const icon = createLeaderboardElement(
                'div',
                'legion-shop-item-icon',
                categoryIcon[categoryId] || '🐾'
            );
            
            const name = createLeaderboardElement(
                'div',
                'legion-shop-item-name',
                item.name
            );
            
            nameRow.append(icon, name);

            const itemDescription = createLeaderboardElement(
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
                item.owned
                    ? '✓ Уже куплено'
                    : 'Доступно для покупки'
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
                    openPurchaseModal(item, data.balance, buyButton);
                });
            }

            card.append(
                nameRow,
                itemDescription,
                price,
                status,
                buyButton
            );

            content.appendChild(card);
        });
    }

    // Создаём кнопки вкладок
    availableCategories.forEach(category => {
        const tab = document.createElement('button');

        tab.type = 'button';
        tab.className = 'legion-shop-tab';
        tab.textContent = category.title;

        if (category.id === activeCategory) {
            tab.classList.add('active');
        }

        tab.addEventListener('click', () => {
            if (activeCategory === category.id) return;

            activeCategory = category.id;

            tabs.querySelectorAll('.legion-shop-tab').forEach(
                button => button.classList.remove('active')
            );

            tab.classList.add('active');

            renderCategory(activeCategory);
        });

        tabs.appendChild(tab);
    });

    ui.shopContent.append(tabs, content);

    // Показываем первую доступную категорию
    renderCategory(activeCategory);
}

    function showPurchaseSuccess(item) {
        const card = ui.purchaseModal.querySelector('#legion-purchase-card');
    
        card.classList.add('success');
    
        ui.purchaseIcon.textContent = '🎉';
    
        ui.purchaseName.textContent = item.name;
    
        ui.purchaseDescription.textContent =
            'Поздравляем! Товар успешно приобретён и добавлен в твои владения.';
    
        ui.purchaseModal.querySelector('.legion-purchase-title')
            .textContent = 'Покупка совершена!';
    
        ui.purchaseModal.querySelector('.legion-purchase-info').style.display = 'none';
    
        ui.purchaseModal.querySelector('.legion-purchase-question')
            .textContent = 'Отличное приобретение!';
    
        ui.purchaseCancel.style.display = 'none';
    
        ui.purchaseConfirm.disabled = false;
        ui.purchaseConfirm.textContent = '🐾 Замечательно!';
    
        ui.purchaseConfirm.onclick = () => {
            card.classList.remove('success');
            ui.purchaseModal.classList.remove('open');
            openShop();
        };
    
        ui.purchaseModal.classList.add('open');
    }

    function purchaseShopItem(item, button) {
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

            showPurchaseSuccess(item);
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
            '[Legion Кото-игры] Version 2.1.2 loaded'
        );

        ui = createInterface();

        updateDoNotDisturbUI();
        createRouletteUI();
        loadRouletteStatus();
        loadRouletteRerollAvailability();

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
        setInterval(loadRouletteRerollAvailability, 30000);
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
