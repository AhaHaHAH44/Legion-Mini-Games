
// ==UserScript==
// @name         Legion - Мини-игры
// @namespace    https://github.com/AhaHaHAH44/Legion-Mini-Games
// @version      1.3.0
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
        playersRefreshInterval: 10000
    };

    const STORAGE = {
        playerId: 'legion_mini_player_id',
        nickname: 'legion_mini_nickname'
    };

    let playerId = localStorage.getItem(STORAGE.playerId);
    let nickname = localStorage.getItem(STORAGE.nickname);

    if (!playerId) {
        playerId = crypto.randomUUID();
        localStorage.setItem(STORAGE.playerId, playerId);
    }

    if (!nickname) {
        nickname = prompt('Введите ваш игровой ник:');

        if (!nickname || !nickname.trim()) {
            console.warn('[Legion Mini-Games] Nickname not set.');
            return;
        }

        nickname = nickname.trim().slice(0, 32);
        localStorage.setItem(STORAGE.nickname, nickname);
    }

    // ========================================
    // HTTP REQUEST
    // ========================================

    function request(method, path, data, callback) {
        GM_xmlhttpRequest({
            method,
            url: CONFIG.serverUrl + path,
            headers: data ? {
                'Content-Type': 'application/json'
            } : {},
            data: data ? JSON.stringify(data) : undefined,
            timeout: 20000,

            onload(response) {
                try {
                    callback(null, JSON.parse(response.responseText), response.status);
                } catch (error) {
                    callback(error, null, response.status);
                }
            },

            onerror() {
                callback(new Error('Connection failed'));
            },

            ontimeout() {
                callback(new Error('Request timeout'));
            }
        });
    }

    // ========================================
    // INTERFACE
    // ========================================

    function createInterface() {
        const style = document.createElement('style');

        style.textContent = `
            #legion-mini-widget {
                position: fixed;
                right: 20px;
                bottom: 20px;
                z-index: 999999;
                color: #eeeeee;
                font-family: Arial, sans-serif;
            }

            #legion-mini-toggle {
                border: 1px solid #505057;
                border-radius: 10px;
                padding: 11px 16px;
                background: #29292f;
                color: #eeeeee;
                cursor: pointer;
                font-size: 13px;
                box-shadow: 0 4px 15px #0005;
            }

            #legion-mini-toggle:hover {
                background: #38383f;
            }

            #legion-mini-panel {
                display: none;
                width: 270px;
                margin-bottom: 10px;
                padding: 16px;
                border: 1px solid #505057;
                border-radius: 12px;
                background: rgba(32, 32, 37, .97);
                box-shadow: 0 6px 24px #0007;
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
                font-size: 15px;
                font-weight: bold;
            }

            .legion-mini-status {
                margin-bottom: 12px;
                color: #d6a64a;
                font-size: 12px;
            }

            .legion-mini-status.online {
                color: #62cb82;
            }

            .legion-mini-player {
                display: flex;
                align-items: center;
                gap: 9px;
                padding: 9px 0;
                border-top: 1px solid #414149;
                font-size: 13px;
            }

            .legion-mini-dot {
                width: 8px;
                height: 8px;
                flex-shrink: 0;
                border-radius: 50%;
                background: #62cb82;
            }

            .legion-mini-empty {
                padding: 12px 0;
                color: #9999a3;
                font-size: 12px;
                text-align: center;
            }

            .legion-mini-self {
                color: #b9b9c2;
                font-size: 11px;
            }
        `;

        document.head.appendChild(style);

        const widget = document.createElement('div');
        widget.id = 'legion-mini-widget';

        widget.innerHTML = `
            <div id="legion-mini-panel">
                <div class="legion-mini-heading">
                    <span>Legion — Мини-игры</span>
                    <span>🎮</span>
                </div>

                <div id="legion-mini-status" class="legion-mini-status">
                    Подключение к серверу...
                </div>

                <div style="font-size:12px;margin-bottom:8px;">
                    Игроки онлайн
                    <span id="legion-mini-count">(0)</span>
                </div>

                <div id="legion-mini-players">
                    <div class="legion-mini-empty">
                        Загружаем список...
                    </div>
                </div>

                <div class="legion-mini-self" id="legion-mini-self"></div>
            </div>

            <button id="legion-mini-toggle">
                🎮 Мини-игры
            </button>
        `;

        document.body.appendChild(widget);

        widget.querySelector('#legion-mini-toggle')
            .addEventListener('click', () => {
                widget.querySelector('#legion-mini-panel')
                    .classList.toggle('open');
            });

        widget.querySelector('#legion-mini-self').textContent =
            'Вы вошли как: ' + nickname;

        return {
            status: widget.querySelector('#legion-mini-status'),
            count: widget.querySelector('#legion-mini-count'),
            players: widget.querySelector('#legion-mini-players')
        };
    }

    // ========================================
    // PLAYER REGISTRATION
    // ========================================

    function heartbeat(ui) {
        request('POST', '/api/players/heartbeat', {
            id: playerId,
            nickname
        }, (error, result) => {
            if (error || !result || !result.success) {
                ui.status.textContent = 'Сервер запускается или недоступен';
                ui.status.classList.remove('online');
                return;
            }

            ui.status.textContent = '● Сервер онлайн';
            ui.status.classList.add('online');
        });
    }

    // ========================================
    // ONLINE PLAYERS
    // ========================================

    function refreshPlayers(ui) {
        request('GET', '/api/players', null, (error, result) => {
            if (error || !result || !result.success) {
                return;
            }

            ui.count.textContent = '(' + result.count + ')';
            ui.players.replaceChildren();

            if (result.players.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'legion-mini-empty';
                empty.textContent = 'Пока никого нет онлайн';
                ui.players.appendChild(empty);
                return;
            }

            result.players.forEach(player => {
                const item = document.createElement('div');
                item.className = 'legion-mini-player';

                const dot = document.createElement('span');
                dot.className = 'legion-mini-dot';

                const name = document.createElement('span');
                name.textContent = player.nickname;

                if (player.id === playerId) {
                    name.textContent += ' (Вы)';
                }

                item.append(dot, name);
                ui.players.appendChild(item);
            });
        });
    }

    // ========================================
    // INITIALIZATION
    // ========================================

    function init() {
        if (document.getElementById('legion-mini-widget')) {
            return;
        }

        console.log('[Legion Mini-Games] Version 1.3.0 loaded');

        const ui = createInterface();

        heartbeat(ui);
        refreshPlayers(ui);

        setInterval(() => heartbeat(ui), CONFIG.heartbeatInterval);
        setInterval(() => refreshPlayers(ui), CONFIG.playersRefreshInterval);
    }

    init();

})();
