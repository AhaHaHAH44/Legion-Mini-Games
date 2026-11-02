// ==UserScript==
// @name         Legion - Мини-игры
// @namespace    https://github.com/AhaHaHAH44/Legion-Mini-Games
// @version      1.6.0
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
        matchRefreshInterval: 2000
    };

    const STORAGE = {
        playerId: 'legion_mini_player_id',
        nickname: 'legion_mini_nickname',
        publishedMatches: 'legion_mini_published_matches'
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
    let activeMatchId = null;
    let displayedMatchId = null;
    let matchResultShown = false;
    let moveSubmitted = false;
    let ui;

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
                callback(new Error('Connection failed'), null, 0);
            },

            ontimeout() {
                callback(new Error('Request timeout'), null, 0);
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
            .legion-mini-button:hover {
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

            .legion-mini-button {
                padding: 7px 10px;
                border: 1px solid #55555e;
                border-radius: 7px;
                background: #303037;
                color: #eee;
                cursor: pointer;
                font-size: 12px;
            }

            .legion-mini-button:disabled {
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

            #legion-mini-modal {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 1000001;
                align-items: center;
                justify-content: center;
                background: #0009;
                font-family: Arial, sans-serif;
                color: #eee;
            }

            #legion-mini-modal.open {
                display: flex;
            }

            #legion-mini-modal-card {
                width: min(380px, calc(100vw - 36px));
                padding: 22px;
                border: 1px solid #55555e;
                border-radius: 14px;
                background: #25252b;
                box-shadow: 0 10px 40px #0009;
                text-align: center;
            }

            #legion-mini-modal-title {
                font-size: 18px;
                font-weight: bold;
                margin-bottom: 12px;
            }

            #legion-mini-modal-body {
                font-size: 14px;
                line-height: 1.6;
                white-space: pre-line;
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
                border: 1px solid #55555e;
                border-radius: 8px;
                background: #35353d;
                color: #eee;
                cursor: pointer;
            }

            .legion-mini-actions .primary {
                background: #315c40;
                border-color: #477b59;
            }

            .legion-mini-actions .publish {
                background: #725522;
                border-color: #a17b35;
            }

            .legion-mini-actions button:disabled {
                opacity: .5;
                cursor: default;
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

        if (!toast) return;

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

                <div style="font-size:12px;margin-bottom:8px">
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

        const modal = document.createElement('div');
        modal.id = 'legion-mini-modal';

        modal.innerHTML = `
            <div id="legion-mini-modal-card">
                <div id="legion-mini-modal-title"></div>
                <div id="legion-mini-modal-body"></div>
                <div id="legion-mini-modal-actions"
                     class="legion-mini-actions"></div>
            </div>
        `;

        document.body.appendChild(modal);

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

        return {
            status: widget.querySelector('#legion-mini-status'),
            count: widget.querySelector('#legion-mini-count'),
            players: widget.querySelector('#legion-mini-players'),
            modal,
            modalTitle: modal.querySelector('#legion-mini-modal-title'),
            modalBody: modal.querySelector('#legion-mini-modal-body'),
            modalActions: modal.querySelector('#legion-mini-modal-actions')
        };
    }

    function openModal(title, body, actions) {
        ui.modalTitle.textContent = title;
        ui.modalBody.textContent = body;
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

    function closeModal() {
        ui.modal.classList.remove('open');
    }

    // ========================================
    // PLAYER REGISTRATION
    // ========================================

    function heartbeat() {
        request('POST', '/api/players/heartbeat', {
            id: playerId,
            nickname
        }, (error, result) => {
            if (error || !result?.success) {
                ui.status.textContent =
                    'Сервер запускается или недоступен';

                ui.status.classList.remove('online');
            } else {
                ui.status.textContent = '● Сервер онлайн';
                ui.status.classList.add('online');
            }
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
            if (error || !result?.success) {
                button.disabled = false;
                button.textContent = 'Пригласить';

                showToast(
                    status === 409
                        ? 'Игрок уже участвует в матче или приглашение отправлено'
                        : (result?.error || 'Не удалось отправить приглашение')
                );

                return;
            }

            button.textContent = 'Отправлено';
            showToast('Приглашение отправлено: ' + targetNickname);
        });
    }

    // ========================================
    // ONLINE PLAYERS
    // ========================================

    function refreshPlayers() {
        request('GET', '/api/players', null, (error, result) => {
            if (error || !result?.success) return;

            ui.count.textContent = '(' + result.count + ')';
            ui.players.replaceChildren();

            if (!result.players.length) {
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

                name.textContent =
                    player.nickname + (player.id === playerId ? ' (Вы)' : '');

                item.append(dot, name);

                if (player.id !== playerId) {
                    const button = document.createElement('button');

                    button.className = 'legion-mini-button';
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
                    '🎮 Приглашение в игру',
                    invitation.fromNickname +
                    ' приглашает вас сыграть в «Камень, ножницы, бумага»!',
                    [
                        {
                            label: 'Принять',
                            className: 'primary',
                            onClick: () => respondToInvitation(true)
                        },
                        {
                            label: 'Отклонить',
                            onClick: () => respondToInvitation(false)
                        }
                    ]
                );
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
                closeModal();

                if (error || !result?.success) {
                    showToast(
                        result?.error || 'Не удалось обработать приглашение'
                    );

                    return;
                }

                showToast(
                    accept
                        ? 'Приглашение принято!'
                        : 'Приглашение отклонено'
                );

                if (accept) checkMatch();
            }
        );
    }

    // ========================================
    // ROCK PAPER SCISSORS
    // ========================================

    const moves = {
        rock: {
            label: 'Камень',
            emoji: '✊'
        },

        scissors: {
            label: 'Ножницы',
            emoji: '✌️'
        },

        paper: {
            label: 'Бумага',
            emoji: '✋'
        }
    };

    function showGame(match) {
        if (
            displayedMatchId === match.id &&
            ui.modal.classList.contains('open')
        ) {
            return;
        }

        displayedMatchId = match.id;
        activeMatchId = match.id;
        matchResultShown = false;
        moveSubmitted = false;

        const opponent = match.players.find(player =>
            player.id !== playerId
        );

        openModal(
            '✊ Камень, ножницы, бумага',
            'Ваш соперник: ' +
            (opponent?.nickname || 'Игрок') +
            '\n\nВыберите свой ход:',
            Object.entries(moves).map(([key, move]) => ({
                label: move.emoji + ' ' + move.label,
                className: 'primary',
                onClick: () => submitMove(key)
            }))
        );
    }

    function submitMove(move) {
        if (!activeMatchId || moveSubmitted) return;

        moveSubmitted = true;

        openModal(
            'Ход отправлен',
            'Вы выбрали: ' +
            moves[move].emoji + ' ' + moves[move].label +
            '\n\nОжидаем ход соперника...',
            [
                {
                    label: 'Ожидать',
                    onClick: closeModal
                }
            ]
        );

        request(
            'POST',
            '/api/matches/' + encodeURIComponent(activeMatchId) + '/move',
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

    // ========================================
    // MATCH CHECK
    // ========================================

    function checkMatch() {
        request(
            'GET',
            '/api/matches/player/' + encodeURIComponent(playerId),
            null,
            (error, result) => {
                if (error || !result?.success || !result.match) return;

                const match = result.match;

                if (
                    match.status === 'playing' &&
                    match.id !== displayedMatchId
                ) {
                    showGame(match);
                }

                if (match.status === 'finished') {
                    activeMatchId = match.id;
                    pollMatchResult();
                }
            }
        );
    }

    // ========================================
    // MATCH RESULT POLLING
    // ========================================

    function pollMatchResult() {
        if (!activeMatchId || matchResultShown) return;

        request(
            'GET',
            '/api/matches/' + encodeURIComponent(activeMatchId) +
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

    // ========================================
    // PUBLISHED MATCHES
    // ========================================

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

    // ========================================
    // SHOW MATCH RESULT
    // ========================================

    function showMatchResult(match) {
        if (matchResultShown) return;

        matchResultShown = true;
        displayedMatchId = match.id;
        activeMatchId = match.id;

        const first = match.players[0];
        const second = match.players[1];

        const winner = match.winner === 'draw'
            ? 'Ничья!'
            : 'Победитель: ' +
                (match.players.find(p => p.id === match.winner)?.nickname ||
                'Неизвестно');

        const body =
            first.nickname + ': ' +
            moves[first.move].emoji + ' ' +
            moves[first.move].label +
            '\n' +
            second.nickname + ': ' +
            moves[second.move].emoji + ' ' +
            moves[second.move].label +
            '\n\n' +
            winner;

        const isInitiator = first.id === playerId;

        const alreadyPublished =
            getPublishedMatches().includes(match.id);

        const actions = [];

        if (isInitiator && !alreadyPublished) {
            actions.push({
                label: '📢 Опубликовать результат',
                className: 'publish',
                onClick: () => publishResult(match)
            });
        } else if (isInitiator) {
            actions.push({
                label: '✓ Уже опубликовано',
                disabled: true,
                onClick: () => {}
            });
        }

        actions.push({
            label: 'Закрыть',
            onClick: closeModal
        });

        openModal('🏁 Игра завершена', body, actions);
    }

    // ========================================
    // PUBLISH RESULT TO CHAT
    // ========================================

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

        const winnerText = match.winner === 'draw'
            ? 'Ничья'
            : 'Победитель: ' +
                (match.players.find(p => p.id === match.winner)?.nickname ||
                'Неизвестно');

        const message =
            '🎮 Камень, ножницы, бумага!\n' +
            first.nickname + ' — ' +
            moves[first.move].emoji + ' ' +
            moves[first.move].label + '\n' +
            second.nickname + ' — ' +
            moves[second.move].emoji + ' ' +
            moves[second.move].label + '\n' +
            '🏆 ' + winnerText;

        const form = document.querySelector('form.cy-chat-f');

        const input = form?.querySelector(
            'input[type="text"], textarea'
        );

        const button = form?.querySelector(
            'button[type="submit"]'
        );

        if (!form || !input || !button) {
            showToast(
                'Не удалось найти форму чата. Откройте чат и попробуйте снова'
            );

            return;
        }

        if (button.disabled) {
            showToast('Кнопка отправки чата сейчас недоступна');
            return;
        }

        const proto = input.tagName === 'TEXTAREA'
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;

        const setter = Object.getOwnPropertyDescriptor(
            proto,
            'value'
        )?.set;

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

        // Отправка только после нажатия игроком кнопки публикации.
        button.click();

        published.push(match.id);

        localStorage.setItem(
            STORAGE.publishedMatches,
            JSON.stringify(published.slice(-100))
        );

        showToast('Результат отправлен в общий чат!');
        showMatchResult(match);
    }

    // ========================================
    // INITIALIZATION
    // ========================================

    function init() {
        if (document.getElementById('legion-mini-widget')) return;

        console.log(
            '[Legion Mini-Games] Version 1.6.0 loaded'
        );

        ui = createInterface();

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
    }

    init();

})();
