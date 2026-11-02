// ==UserScript==
// @name         Legion - Кото-игры
// @namespace    https://github.com/AhaHaHAH44/Legion-Mini-Games
// @version      1.8.2
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
        const element = document.querySelector('span.who');
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
    let moveSubmitted = false;
    let ui;

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
                position: fixed;
                right: 20px;
                bottom: 20px;
                z-index: 1000002;
                padding: 11px 15px;
                border: 1px solid #a17b50;
                border-radius: 12px;
                background: #34291f;
                color: #fff0dc;
                font: 13px Arial, sans-serif;
                box-shadow: 0 5px 18px #0008;
                cursor: pointer;
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
                    Подключаемся к игровому клубу...
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

                <div id="legion-mini-players">
                    <div class="legion-mini-empty">
                        Ищем котиков...
                    </div>
                </div>

                <div class="legion-mini-self"></div>
            </div>

            <button id="legion-mini-toggle">
                🐾 Кото-игры
            </button>
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

        const restoreButton = document.createElement('button');
        restoreButton.id = 'legion-mini-restore';
        restoreButton.type = 'button';
        restoreButton.textContent = '🐾 Вернуться к игре';

        document.body.appendChild(restoreButton);

        const toast = document.createElement('div');
        toast.id = 'legion-mini-toast';

        document.body.appendChild(toast);

        widget.querySelector('#legion-mini-toggle')
            .addEventListener('click', () => {
                widget.querySelector('#legion-mini-panel')
                    .classList.toggle('open');
            });

        widget.querySelector('#legion-mini-dnd-toggle')
            .addEventListener('click', toggleDoNotDisturb);

        modal.querySelector('#legion-mini-minimize')
            .addEventListener('click', minimizeModal);

        restoreButton.addEventListener('click', restoreModal);

        widget.querySelector('.legion-mini-self').textContent =
            'Вы играете как: ' + nickname;

        return {
            status: widget.querySelector('#legion-mini-status'),
            count: widget.querySelector('#legion-mini-count'),
            players: widget.querySelector('#legion-mini-players'),
            dndTitle: widget.querySelector('#legion-mini-dnd-title'),
            dndHint: widget.querySelector('#legion-mini-dnd-hint'),
            dndButton: widget.querySelector('#legion-mini-dnd-toggle'),

            modal,
            restoreButton,

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
                        'Игровой клуб пока не отвечает';

                    ui.status.classList.remove('online');
                } else {
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
                        '● Игровой клуб на связи';

                    ui.status.classList.add('online');
                }
            }
        );
    }

    function sendInvitation(targetId, targetNickname, button) {
        button.disabled = true;
        button.textContent = 'Отправка...';

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
                    button.textContent = 'Пригласить';

                    showToast(
                        status === 403
                            ? 'Этот котик сейчас отдыхает и не принимает приглашения 😴'
                            : status === 409
                                ? 'Котик уже играет или приглашение уже отправлено'
                                : result?.error || 'Не удалось отправить приглашение'
                    );

                    return;
                }

                button.textContent = 'Отправлено';

                showToast(
                    '🐾 Игровой вызов отправлен: ' + targetNickname
                );
            }
        );
    }

    function refreshPlayers() {
        request(
            'GET',
            '/api/players',
            null,
            (error, result) => {
                if (error || !result?.success) return;

                ui.count.textContent = '(' + result.count + ')';
                ui.players.replaceChildren();

                if (!result.players.length) {
                    const empty = document.createElement('div');

                    empty.className = 'legion-mini-empty';
                    empty.textContent =
                        'Пока ни одного котика не видно...';

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
                        player.nickname +
                        (player.id === playerId ? ' (это вы)' : '');

                    item.append(dot, name);

                    if (player.id !== playerId && player.doNotDisturb) {
                        const resting = document.createElement('span');

                        resting.className =
                            'legion-mini-player-resting';

                        resting.textContent = '😴 Отдыхает';

                        item.appendChild(resting);
                    } else if (player.id !== playerId) {
                        const button = document.createElement('button');

                        button.className = 'legion-mini-button';
                        button.textContent = 'Пригласить';

                        button.addEventListener('click', () => {
                            sendInvitation(
                                player.id,
                                player.nickname,
                                button
                            );
                        });

                        item.appendChild(button);
                    }

                    ui.players.appendChild(item);
                });
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
                            label: 'Играть',
                            className: 'primary',
                            onClick: () => respondToInvitation(true)
                        },
                        {
                            label: 'Отказаться',
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
                        ? '🐱 Вызов принят! Вперёд играть!'
                        : 'Вызов отклонён. Может, в другой раз!'
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

    function showGame(match) {
        // Не открываем повторно уже показанный матч:
        // он может быть свёрнут или закрыт пользователем.
        if (displayedMatchId === match.id) return;

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
        openModal('🐾 Дуэль окончена', body, actions);
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
                ));

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

    function init() {
        if (document.getElementById('legion-mini-widget')) return;

        console.log(
            '[Legion Кото-игры] Version 1.8.2 loaded'
        );

        ui = createInterface();

        updateDoNotDisturbUI();

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
