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

    // ========================================
    // CONFIGURATION
    // ========================================

    const CONFIG = {
        serverUrl: 'https://legion-server.onrender.com'
    };

    // ========================================
    // INTERFACE
    // ========================================

    function createStatusIndicator() {
        const indicator = document.createElement('div');

        indicator.id = 'legion-mini-status';

        indicator.innerHTML = `
            <span class="legion-status-dot"></span>
            <span class="legion-status-text">Подключение...</span>
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
                background: rgba(35, 35, 39, 0.95);
                border: 1px solid #48484e;
                border-radius: 10px;
                color: #eeeeee;
                font: 13px Arial, sans-serif;
                box-shadow: 0 4px 15px rgba(0,0,0,0.25);
                pointer-events: none;
            }

            #legion-mini-status .legion-status-dot {
                width: 9px;
                height: 9px;
                border-radius: 50%;
                background: #d6a64a;
                flex-shrink: 0;
            }

            #legion-mini-status.connected .legion-status-dot {
                background: #55c878;
            }

            #legion-mini-status.disconnected .legion-status-dot {
                background: #e05b5b;
            }

            #legion-mini-status .legion-status-text {
                white-space: nowrap;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(indicator);

        return indicator;
    }

    function updateStatus(indicator, status, text) {
        indicator.className = status;
        indicator.querySelector('.legion-status-text').textContent = text;
    }

    // ========================================
    // SERVER CONNECTION
    // ========================================

    function connectToServer(indicator) {
        if (typeof io === 'undefined') {
            updateStatus(
                indicator,
                'disconnected',
                'Ошибка загрузки Socket.IO'
            );

            console.error('[Legion Mini-Games] Socket.IO not loaded!');
            return;
        }

        console.log('[Legion Mini-Games] Connecting to server...');

        const socket = io(CONFIG.serverUrl, {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 3000,
            reconnectionDelayMax: 10000,
            timeout: 20000
        });

        socket.on('connect', () => {
            console.log('[Legion Mini-Games] Connected:', socket.id);

            updateStatus(
                indicator,
                'connected',
                'Сервер онлайн'
            );
        });

        socket.on('server:ready', (data) => {
            console.log('[Legion Mini-Games] Server ready:', data.message);
        });

        socket.on('disconnect', (reason) => {
            console.log('[Legion Mini-Games] Disconnected:', reason);

            updateStatus(
                indicator,
                'disconnected',
                'Соединение потеряно'
            );
        });

        socket.on('connect_error', (error) => {
            console.warn('[Legion Mini-Games] Connection error:', error.message);

            updateStatus(
                indicator,
                '',
                'Сервер запускается...'
            );
        });

        return socket;
    }

    // ========================================
    // INITIALIZATION
    // ========================================

    function init() {
        if (document.getElementById('legion-mini-status')) {
            return;
        }

        console.log('[Legion Mini-Games] Extension loaded!');

        const indicator = createStatusIndicator();

        connectToServer(indicator);
    }

    init();

})();
