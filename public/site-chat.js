/* Shared chat for About, Works and project detail pages. */
(() => {
    'use strict';
    if (document.getElementById('site-chat-widget')) return;

    const widget = document.createElement('div');
    widget.id = 'site-chat-widget';
    widget.className = 'site-chat-widget';
    // Only this fixed, local template uses HTML; all conversation text uses textContent.
    widget.innerHTML = `
        <section id="site-chat-panel" class="site-chat-panel" role="dialog" aria-labelledby="site-chat-title" hidden>
            <div class="site-chat-header">
                <span id="site-chat-title">HNKL AI</span>
                <div class="site-chat-controls">
                    <button type="button" class="site-chat-window-button" data-chat-action="minimize" aria-label="최소화"><img src="/assets/Min_2.svg?v=20261010-1" alt="" class="site-chat-icon"></button>
                    <button type="button" class="site-chat-window-button" data-chat-action="close" aria-label="닫기"><img src="/assets/Close_2.svg?v=20261010-1" alt="" class="site-chat-icon"></button>
                </div>
            </div>
            <div class="site-chat-messages" role="log" aria-live="polite" aria-relevant="additions text" aria-label="대화 내용">
                <div class="site-chat-message site-chat-message-bot" data-chat-greeting></div>
                <div class="site-chat-message site-chat-message-bot" data-chat-loading role="status" aria-label="답변 작성 중" hidden><div class="site-chat-typing" aria-hidden="true"><span></span><span></span><span></span></div></div>
            </div>
            <form class="site-chat-composer">
                <input type="text" class="site-chat-input" aria-label="질문" placeholder="질문을 입력하세요..." maxlength="2000" autocomplete="off" enterkeyhint="send">
                <button type="submit" class="site-chat-send" aria-label="보내기"><img src="/assets/Send_2.svg?v=20261010-3" alt="" class="site-chat-icon"></button>
            </form>
        </section>
        <button type="button" class="site-chat-launcher" aria-label="HNKL AI와 대화" aria-controls="site-chat-panel" aria-expanded="false"><img src="/assets/Chat_1.svg?v=20261010-1" alt=""></button>`;
    document.body.appendChild(widget);

    const panel = widget.querySelector('.site-chat-panel');
    const launcher = widget.querySelector('.site-chat-launcher');
    const messages = widget.querySelector('.site-chat-messages');
    const greeting = widget.querySelector('[data-chat-greeting]');
    const loading = widget.querySelector('[data-chat-loading]');
    const input = widget.querySelector('.site-chat-input');
    const send = widget.querySelector('.site-chat-send');
    const composer = widget.querySelector('form');
    const compactQuery = matchMedia('(max-width: 767px), (pointer: coarse) and (max-width: 1023px)');
    const dock = document.querySelector('.floating-dock');
    const copy = {
        kr: {
            greeting: '안녕하세요! 저는 이 사이트의 AI 도우미입니다. 궁금한 점을 물어보세요.',
            open: 'HNKL AI와 대화', minimize: '최소화', close: '닫기', log: '대화 내용',
            loading: '답변 작성 중', question: '질문', placeholder: '질문을 입력하세요...', send: '보내기',
            empty: '죄송해요, 답변을 못 들었어요.', error: '오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
        },
        en: {
            greeting: "Hello! I'm this site's AI assistant. Ask me anything.",
            open: 'Chat with HNKL AI', minimize: 'Minimize', close: 'Close', log: 'Conversation',
            loading: 'Preparing a reply', question: 'Question', placeholder: 'Ask a question...', send: 'Send',
            empty: "Sorry, I didn't receive a reply.", error: 'Something went wrong. Please try again shortly.'
        }
    };
    const language = () => document.body.dataset.lang === 'en' ? 'en' : 'kr';
    let pending = false;
    let composing = false;

    function syncLanguage() {
        const text = copy[language()];
        widget.lang = language() === 'en' ? 'en' : 'ko';
        greeting.textContent = text.greeting;
        launcher.setAttribute('aria-label', text.open);
        messages.setAttribute('aria-label', text.log);
        loading.setAttribute('aria-label', text.loading);
        input.setAttribute('aria-label', text.question);
        input.placeholder = text.placeholder;
        send.setAttribute('aria-label', text.send);
        widget.querySelector('[data-chat-action="minimize"]').setAttribute('aria-label', text.minimize);
        widget.querySelector('[data-chat-action="close"]').setAttribute('aria-label', text.close);
    }

    // Use the visible viewport, including its offset during iOS keyboard panning.
    // Keep compact chat controls above the dock; desktop only needs that space when they overlap horizontally.
    function positionChat() {
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft ?? 0;
        const top = viewport?.offsetTop ?? 0;
        const width = viewport?.width ?? innerWidth;
        const height = viewport?.height ?? innerHeight;
        const compact = compactQuery.matches;
        const safe = getComputedStyle(widget);
        const rightInset = parseFloat(safe.paddingRight) || 0;
        const leftInset = parseFloat(safe.paddingLeft) || 0;
        const bottomInset = parseFloat(safe.paddingBottom) || 0;
        const topInset = parseFloat(safe.paddingTop) || 0;
        const dockRect = dock?.getBoundingClientRect();
        const usableBottom = top + height;

        function bottomFor(x, elementWidth, gap) {
            let bottom = usableBottom - Math.max(gap, bottomInset);
            if (dockRect && dockRect.width && dockRect.top >= top && dockRect.top < usableBottom &&
                dockRect.bottom > top && (compact || (dockRect.left < x + elementWidth && dockRect.right > x))) {
                bottom = Math.min(bottom, dockRect.top - 12);
            }
            return bottom;
        }

        const side = compact ? 12 : 40;
        const panelWidth = Math.max(0, Math.min(compact ? width : 360, width - Math.max(side, leftInset) - Math.max(side, rightInset)));
        const panelX = left + width - Math.max(side, rightInset) - panelWidth;
        const panelBottom = bottomFor(panelX, panelWidth, compact ? 12 : 40);
        const panelHeight = Math.max(0, Math.min(compact ? 520 : 500, panelBottom - top - Math.max(12, topInset)));
        panel.classList.toggle('site-chat-short', panelHeight < 200);
        Object.assign(panel.style, { left: `${panelX}px`, top: `${panelBottom - panelHeight}px`, right: 'auto', bottom: 'auto', width: `${panelWidth}px`, height: `${panelHeight}px` });

        const launcherSize = compact ? 52 : 60;
        const launcherX = left + width - Math.max(compact ? 20 : 40, rightInset) - launcherSize;
        const launcherBottom = bottomFor(launcherX, launcherSize, compact ? 20 : 40);
        Object.assign(launcher.style, { left: `${launcherX}px`, top: `${launcherBottom - launcherSize}px`, right: 'auto', bottom: 'auto' });
    }

    function openChat() {
        panel.hidden = false;
        launcher.hidden = true;
        launcher.setAttribute('aria-expanded', 'true');
        positionChat();
        input.focus({ preventScroll: true });
        messages.scrollTop = messages.scrollHeight;
    }

    function closeChat() {
        input.blur();
        panel.hidden = true;
        launcher.hidden = false;
        launcher.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('site-chat-pointer');
        positionChat();
        launcher.focus({ preventScroll: true });
    }

    function appendMessage(text, author) {
        const message = document.createElement('div');
        message.className = `site-chat-message site-chat-message-${author}`;
        message.textContent = text;
        messages.insertBefore(message, loading);
        messages.scrollTop = messages.scrollHeight;
        return message;
    }

    composer.addEventListener('submit', async event => {
        event.preventDefault();
        const prompt = input.value.trim();
        if (!prompt || pending || composing) return;
        pending = true;
        send.disabled = true;
        const requestCopy = copy[language()];
        appendMessage(prompt, 'user');
        input.value = '';
        loading.hidden = false;
        messages.scrollTop = messages.scrollHeight;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const data = await window.HNKLAI.ask(prompt, controller.signal);
            const message = appendMessage(data.reply, 'bot');
            window.HNKLAI.appendActions(message, data.actions);
        } catch {
            appendMessage(requestCopy.error, 'bot');
        } finally {
            clearTimeout(timeout);
            loading.hidden = true;
            pending = false;
            send.disabled = false;
            messages.scrollTop = messages.scrollHeight;
        }
    });

    launcher.addEventListener('click', openChat);
    widget.querySelectorAll('[data-chat-action]').forEach(button => button.addEventListener('click', closeChat));
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229 || composing)) event.preventDefault();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !panel.hidden) {
            event.preventDefault();
            closeChat();
        }
    });
    // Keep the shared jelly cursor on the launcher; use the native pointer for
    // reading, selecting text and composing messages inside the open panel.
    panel.addEventListener('pointerover', () => document.body.classList.add('site-chat-pointer'));
    panel.addEventListener('pointerout', event => {
        if (!panel.contains(event.relatedTarget)) document.body.classList.remove('site-chat-pointer');
    });
    new MutationObserver(syncLanguage).observe(document.body, { attributes: true, attributeFilter: ['data-lang'] });
    if (dock && typeof ResizeObserver !== 'undefined') new ResizeObserver(positionChat).observe(dock);
    window.addEventListener('resize', positionChat);
    window.visualViewport?.addEventListener('resize', positionChat);
    window.visualViewport?.addEventListener('scroll', positionChat);
    compactQuery.addEventListener('change', positionChat);
    document.fonts?.ready.then(positionChat);
    syncLanguage();
    positionChat();
})();
