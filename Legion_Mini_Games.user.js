
// ==UserScript==
// @name         Legion - Мини-игры
// @namespace    https://github.com/AhaHaHAH44/Legion-Mini-Games
// @version      1.2.0
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

    const SERVER_URL = 'https://legion-server.onrender.com';

    // ========================================
    // INTERFACE
    // ========================================

    function createIndicator() {
        const indicator = document.createElement('div');

        indicator.id = 'legion-mini-status';

        indicator.innerHTML = `
            <span class="dot"></span>
            <span class="status-text">Проверка сервера...</span>
        `;

        const style = document.createElement('style');

        style.textContent = `
            #legion-mini-status {
                position: fixed;
                right: 20px;
                bottom: 20px;
                z-index: 999999;
                display: flex;
                align-items: center;
                gap: 9px;
                padding: 10px 15px;
                background: rgba(35, 35, 39, .96);
                border: 1px solid #48484e;
                border-radius: 10px;
                color: #eee;
                font: 13px Arial, sans-serif;
                box-shadow: 0 4px 15px rgba(0,0,0,.25);
            }

            #legion-mini-status .dot {
                width: 9px;
                height: 9px;
                border-radius: 50%;
                background: #d6a64a;
            }

            #legion-mini-status.online .dot {
                background: #55c878;
            }

            #legion-mini-status.offline .dot {
                background: #e05b5b;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(indicator);

        return indicator;
    }

    function setStatus(indicator, state, message) {
        indicator.className = state;

        indicator.querySelector('.status-text').textContent = message;
    }

    // ========================================
    // SERVER CHECK
    // ========================================

    function checkServer(indicator) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: SERVER_URL + '/health',
            timeout: 20000,

            onload(response) {
                if (response.status === 200) {
                    setStatus(indicator, 'online', 'Сервер онлайн');

                    console.log(
                        '[Legion Mini-Games] Server is online'
                    );
                } else {
                    setStatus(indicator, 'offline', 'Ошибка сервера');
                }
            },

            onerror() {
                setStatus(indicator, 'offline', 'Нет соединения');

                console.error(
                    '[Legion Mini-Games] Request failed'
                );
            },

            ontimeout() {
                setStatus(
                    indicator,
                    'offline',
                    'Время ожидания истекло'
                );
            }
        });
    }

    // ========================================
    // INITIALIZATION
    // ========================================

    function init() {
        if (document.getElementById('legion-mini-status')) {
            return;
        }

        console.log('[Legion Mini-Games] Extension loaded!');

        const indicator = createIndicator();

        checkServer(indicator);
    }

    init();

})();
