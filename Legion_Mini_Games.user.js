// ==UserScript==
// @name         Legion - Мини-игры
// @namespace    https://github.com/AhaHaHAH44/Legion-Mini-Games
// @version      1.4.0
// @description  Multiplayer mini-games for Multidonate
// @author       Sectwi1l
// @homepageURL  https://github.com/AhaHaHAH44/Legion-Mini-Games
// @supportURL   https://github.com/AhaHaHAH44/Legion-Mini-Games/issues
// @updateURL    https://raw.githubusercontent.com/AhaHaHAH44/Legion-Mini-Games/main/Legion_Mini_Games.user.js
// @downloadURL  https://raw.githubusercontent.com/AhaHaHAH44/Legion-Mini-Games/main/Legion_Mini_Games.user.js
// @match        https://play.multidonate.ru/*
/* @run-at       document-idle */
// @grant        GM_xmlhttpRequest
// @connect      legion-server.onrender.com
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        serverUrl: 'https://legion-server.onrender.com',
        heartbeatInterval: 20000,
        playersRefreshInterval: 10000,
        invitationsRefreshInterval: 5000
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

        if (!nickname || !nickname.trim()) return;

        nickname = nickname.trim().slice(0, 32);
        localStorage.setItem(STORAGE.nickname, nickname);
    }

    const shownInvitations = new Set();
    let activeInvitation = null;

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
                callback(new Error('Connection failed'));
            },

            ontimeout() {
                callback(new Error('Request timeout'));
            }
        });
    }

    // ========================================
    // STYLES
    // ========================================

    function addStyles() {
        const style = document.createElement('style');

        style.textContent = `
            #legion-mini-widget {
                position: fixed;
                right: 20px;
                bottom: 20px;
                z-index: 999999;
                color: #eee;
                font-family: Arial, sans-serif;
            }

            #legion-mini-toggle {
                border: 1px solid #505057;
                border-radius: 10px;
                padding: 11px 16px;
                background: #29292f;
                color: #eee;
                cursor: pointer;
                font-size: 13px;
                box-shadow: 0 4px 15px #0005;
            }

            #legion-mini-toggle:hover,
            .legion-mini-invite-button:hover {
                background: #414149;
            }

            #legion-mini-panel {
                display: none;
                width: 300px;
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
                gap: 8px;
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

            .legion-mini-player-name {
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .legion-mini-invite-button {
                padding: 6px 9px;
                border: 1px solid #55555e;
                border-radius: 7px;
                background: #303037;
                color: #eee;
                cursor: pointer;
                font-size: 11px;
                white-space: nowrap;
            }

            .legion-mini-invite-button:disabled {
                opacity: .5;
                cursor: default;
            }

            .legion-mini-empty {
                padding: 12px 0;
                color: #9999a3;
                font-size: 12px;
                text-align: center;
            }

            .legion-mini-self {
                margin-top: 12px;
                color: #9999a3;
                font-size: 11px;
            }

            #legion-mini-notification {
                display: none;
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 1000001;
                width: min(320px, calc(100vw - 40px));
                padding: 20px;
                border: 1px solid #55555e;
                border-radius: 14px;
                background: #25252b;
                color: #eee;
                font-family: Arial, sans-serif;
                box-shadow: 0 10px 40px #0009;
                text-align: center;
            }

            #legion-mini-notification.open {
                display: block;
            }

            .legion-mini-invite-actions {
                display: flex;
                gap: 10px;
                margin-top: 18px;
            }

            .legion-mini-invite-actions button {
                flex: 1;
                padding: 10px;
                border: 1px solid #55555e;
                border-radius: 8px;
                background: #35353d;
                color: #eee;
                cursor: pointer;
            }

            .legion-mini-invite-actions .accept {
                background: #315c40;
                border-color: #477b59;
            }

            #legion-mini-toast {
                position: fixed;
                right: 20px;
                bottom: 75px;
                z-index: 1000002;
                max-width: 300px;
                padding: 11px 15px;
                border: 1px solid #505057;
                border-radius: 9px;
                background: #29292f;
                color: #eee;
                font: 13px Arial, sans-serif;
                box-shadow: 0 4px 15px #0005;
                display: none;
            }

            #legion-mini-toast.open {
                display: block;
            }
        `;

        document.head.appendChild(style);
    }

    // ========================================
    // NOTIFICATIONS
    // ========================================

    function showToast(message) {
        const toast = document.getElementById('legion-mini-toast');

        toast.textContent = message;
        toast.classList.add('open');

        clearTimeout(toast.timer);

        toast.timer = setTimeout(() => {
            toast.classList.remove('open');
        }, 4000);
    }

    // ========================================
    // INTERFACE
    // ========================================

    function createInterface() {
        addStyles();

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

                <div class="legion-mini-self"></div>
            </div>

            <button id="legion-mini-toggle">
                🎮 Мини-игры
            </button>
        `;

        document.body.appendChild(widget);

        const notification = document.createElement('div');
        notification.id = 'legion-mini-notification';

        notification.innerHTML = `
            <div style="font-size:25px;margin-bottom:10px;">🎮</div>
            <div style="font-weight:bold;margin-bottom:8px;">
                Приглашение в игру
            </div>
            <div id="legion-mini-invite-text"></div>
            <div class="legion-mini-invite-actions">
                <button class="accept" id="legion-mini-accept">
                    Принять
                </button>
                <button id="legion-mini-reject">
                    Отклонить
                </button>
            </div>
        `;

        document.body.appendChild(notification);

        const toast = document.createElement('div');
        toast.id = 'legion-mini-toast';
        document.body.appendChild(toast);

        widget.querySelector('#legion-mini-toggle')
            .addEventListener('click', () => {
                widget.querySelector('#legion-mini-panel')
                    .classList.toggle('open');
            });

        widget.querySelector('.legion-mini-self').textContent =
            'Вы вошли как: ' + nickname;

        notification.querySelector('#legion-mini-accept')
            .addEventListener('click', () => respondToInvitation(true));

        notification.querySelector('#legion-mini-reject')
            .addEventListener('click', () => respondToInvitation(false));

        return {
            status: widget.querySelector('#legion-mini-status'),
            count: widget.querySelector('#legion-mini-count'),
            players: widget.querySelector('#legion-mini-players'),
            notification
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
    // SEND INVITATION
    // ========================================

    function sendInvitation(targetId, targetNickname, button) {
        button.disabled = true;
        button.textContent = 'Отправка...';

        request('POST', '/api/invites', {
            fromId: playerId,
            toId: targetId
        }, (error, result, status) => {
            if (error || !result || !result.success) {
                button.disabled = false;
                button.textContent = 'Пригласить';

                if (status === 409) {
                    showToast('Приглашение этому игроку уже отправлено');
                } else {
                    showToast(
                        result?.error || 'Не удалось отправить приглашение'
                    );
                }

                return;
            }

            button.textContent = 'Отправлено';
            showToast('Приглашение отправлено: ' + targetNickname);
        });
    }

    // ========================================
    // ONLINE PLAYERS
    // ========================================

    function refreshPlayers(ui) {
        request('GET', '/api/players', null, (error, result) => {
            if (error || !result || !result.success) return;

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
                name.className = 'legion-mini-player-name';
                name.textContent = player.nickname;

                item.append(dot, name);

                if (player.id === playerId) {
                    name.textContent += ' (Вы)';
                } else {
                    const button = document.createElement('button');
                    button.className = 'legion-mini-invite-button';
                    button.textContent = 'Пригласить';

                    button.addEventListener('click', () => {
                        sendInvitation(player.id, player.nickname, button);
                    });

                    item.appendChild(button);
                }

                ui.players.appendChild(item);
            });
        });
    }

    // ========================================
    // INCOMING INVITATIONS
    // ========================================

    function refreshInvitations(ui) {
        request(
            'GET',
            '/api/invites/' + encodeURIComponent(playerId),
            null,
            (error, result) => {
                if (error || !result || !result.success) return;

                if (activeInvitation) return;

                const invitation = result.invitations.find(item =>
                    !shownInvitations.has(item.id)
                );

                if (!invitation) return;

                shownInvitations.add(invitation.id);
                activeInvitation = invitation;

                ui.notification.querySelector('#legion-mini-invite-text')
                    .textContent =
                    invitation.fromNickname + ' приглашает вас сыграть!';

                ui.notification.classList.add('open');
            }
        );
    }

    // ========================================
    // INVITATION RESPONSE
    // ========================================

    function respondToInvitation(accept) {
        if (!activeInvitation) return;

        const invitation = activeInvitation;

        request(
            'POST',
            '/api/invites/' + encodeURIComponent(invitation.id) + '/respond',
            {
                playerId,
                accept
            },
            (error, result) => {
                activeInvitation = null;

                document.getElementById('legion-mini-notification')
                    .classList.remove('open');

                if (error || !result || !result.success) {
                    showToast(
                        result?.error || 'Не удалось обработать приглашение'
                    );
                    return;
                }

                if (accept) {
                    showToast(
                        'Вы приняли приглашение от ' +
                        invitation.fromNickname
                    );
                } else {
                    showToast('Приглашение отклонено');
                }
            }
        );
    }

    // ========================================
    // INITIALIZATION
    // ========================================

    function init() {
        if (document.getElementById('legion-mini-widget')) return;

        console.log('[Legion Mini-Games] Version 1.4.0 loaded');

        const ui = createInterface();

        heartbeat(ui);
        refreshPlayers(ui);
        refreshInvitations(ui);

        setInterval(() => heartbeat(ui), CONFIG.heartbeatInterval);
        setInterval(() => refreshPlayers(ui), CONFIG.playersRefreshInterval);
        setInterval(() => refreshInvitations(ui), CONFIG.invitationsRefreshInterval);
    }

    init();

})();
