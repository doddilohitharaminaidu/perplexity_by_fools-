document.addEventListener('DOMContentLoaded', () => {
    // ============================
    // Element References
    // ============================
    const signInModal = document.getElementById('signInModal');
    const closeModalBtn = document.getElementById('closeModal');
    const signInBtn = document.getElementById('signInBtn');
    const modalBackdrop = document.getElementById('modalBackdrop');
    const emailInput = document.getElementById('emailInput');
    const emailBtn = document.getElementById('emailBtn');
    const searchInput = document.getElementById('searchInput');
    const submitBtn = document.getElementById('submitBtn');
    const threadList = document.getElementById('threadList');
    const newThreadBtn = document.getElementById('newThreadBtn');
    const brandBtn = document.getElementById('brandBtn');
    const historyBtn = document.getElementById('historyBtn');
    const mainContent = document.getElementById('mainContent');
    const chatHistoryEl = document.getElementById('chatHistory');
    const heroSection = document.getElementById('heroSection');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('sidebar');
    const uploadBtn = document.getElementById('uploadBtn');
    const pdfFileInput = document.getElementById('pdfFileInput');
    const pdfIndicator = document.getElementById('pdfIndicator');
    const pdfFileName = document.getElementById('pdfFileName');
    const pdfPageCount = document.getElementById('pdfPageCount');
    const removePdfBtn = document.getElementById('removePdfBtn');

    let uploadedPdfContext = null; // { filename, pages, context_key }

    // ============================
    // LaTeX Sanitizer
    // ============================
    function sanitizeLatex(text) {
        text = text.replace(/\$\$([^$]+?)\$\$/g, (m, inner) => convertLatexToHtml(inner));
        text = text.replace(/\$([^$\d][^$]*?)\$/g, (m, inner) => convertLatexToHtml(inner));
        text = text.replace(/\\\[([\\s\S]*?)\\\]/g, (m, inner) => convertLatexToHtml(inner));
        text = text.replace(/\\\(([\\s\S]*?)\\\)/g, (m, inner) => convertLatexToHtml(inner));
        return text;
    }

    function convertLatexToHtml(latex) {
        let r = latex.trim();
        r = r.replace(/\^{([^}]+)}/g, '<sup>$1</sup>');
        r = r.replace(/\^(\w)/g, '<sup>$1</sup>');
        r = r.replace(/_{([^}]+)}/g, '<sub>$1</sub>');
        r = r.replace(/_(\w)/g, '<sub>$1</sub>');
        r = r.replace(/\\frac{([^}]+)}{([^}]+)}/g, '($1/$2)');
        r = r.replace(/\\sqrt{([^}]+)}/g, 'sqrt($1)');
        r = r.replace(/\\sum/g, 'Σ'); r = r.replace(/\\int/g, '∫');
        r = r.replace(/\\infty/g, '∞'); r = r.replace(/\\pi/g, 'π');
        r = r.replace(/\\alpha/g, 'α'); r = r.replace(/\\beta/g, 'β');
        r = r.replace(/\\gamma/g, 'γ'); r = r.replace(/\\delta/g, 'δ');
        r = r.replace(/\\theta/g, 'θ'); r = r.replace(/\\lambda/g, 'λ');
        r = r.replace(/\\mu/g, 'μ'); r = r.replace(/\\sigma/g, 'σ');
        r = r.replace(/\\omega/g, 'ω'); r = r.replace(/\\times/g, '×');
        r = r.replace(/\\cdot/g, '·'); r = r.replace(/\\leq/g, '≤');
        r = r.replace(/\\geq/g, '≥'); r = r.replace(/\\neq/g, '≠');
        r = r.replace(/\\rightarrow/g, '→'); r = r.replace(/\\leftarrow/g, '←');
        r = r.replace(/\\(?:text|mathrm|mathbf|mathit|textbf){([^}]+)}/g, '$1');
        r = r.replace(/\\([a-zA-Z]+)/g, '$1');
        return r;
    }

    let chatHistory = [];
    let currentThreadId = null;

    // ============================
    // Modal Logic
    // ============================
    function openModal() { signInModal.classList.remove('hidden'); }
    function closeModal() { signInModal.classList.add('hidden'); }

    signInBtn.addEventListener('click', (e) => { e.preventDefault(); openModal(); });
    closeModalBtn.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !signInModal.classList.contains('hidden')) closeModal();
    });

    // ============================
    // Email Validation
    // ============================
    emailInput.addEventListener('input', (e) => {
        const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value.trim());
        if (isValid) { emailBtn.removeAttribute('disabled'); emailBtn.classList.add('active'); }
        else { emailBtn.setAttribute('disabled', 'true'); emailBtn.classList.remove('active'); }
    });

    // ============================
    // Mobile Menu
    // ============================
    mobileMenuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
    mainContent.addEventListener('click', () => {
        if (sidebar.classList.contains('open')) sidebar.classList.remove('open');
    });

    // ============================
    // Textarea Auto-resize
    // ============================
    searchInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    // ============================
    // Suggestion Items & Pills — click to search
    // ============================
    document.querySelectorAll('.list-item[data-query], .pill[data-query]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            searchInput.value = item.getAttribute('data-query');
            handleSearch();
        });
    });


    // ============================
    // PDF Upload
    // ============================
    uploadBtn.addEventListener('click', () => {
        pdfFileInput.click();
    });

    pdfFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.pdf')) {
            alert('Please upload a PDF file.');
            pdfFileInput.value = '';
            return;
        }

        // Show uploading state
        pdfIndicator.classList.remove('hidden');
        pdfFileName.textContent = file.name;
        pdfPageCount.textContent = 'Uploading...';

        const formData = new FormData();
        formData.append('file', file);
        if (currentThreadId) formData.append('thread_id', currentThreadId);

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (res.ok) {
                uploadedPdfContext = {
                    filename: data.filename,
                    pages: data.pages,
                    context_key: data.context_key
                };
                pdfFileName.textContent = data.filename;
                pdfPageCount.textContent = `(${data.pages} pages, ${Math.round(data.chars/1000)}k chars)`;
                pdfIndicator.classList.add('active');
            } else {
                alert('PDF Error: ' + (data.error || 'Upload failed'));
                pdfIndicator.classList.add('hidden');
                uploadedPdfContext = null;
            }
        } catch (err) {
            console.error('Upload error:', err);
            alert('Failed to upload PDF.');
            pdfIndicator.classList.add('hidden');
            uploadedPdfContext = null;
        }

        pdfFileInput.value = '';
    });

    removePdfBtn.addEventListener('click', () => {
        uploadedPdfContext = null;
        pdfIndicator.classList.add('hidden');
        pdfIndicator.classList.remove('active');
        pdfFileInput.value = '';
    });

    // ============================
    // Threads
    // ============================
    async function loadThreads() {
        try {
            const res = await fetch('/api/threads');
            const data = await res.json();
            threadList.innerHTML = '';
            
            if (!data.threads || data.threads.length === 0) {
                threadList.innerHTML = '<div class="recent-text">Recent and active threads will appear here.</div>';
                return;
            }

            data.threads.forEach(thread => {
                const threadDiv = document.createElement('div');
                threadDiv.className = `thread-item${currentThreadId === thread.id ? ' active' : ''}`;
                threadDiv.innerHTML = `<span class="thread-title">${thread.title || 'Untitled Chat'}</span><button class="thread-delete" title="Delete thread"><i class="ph ph-trash"></i></button>`;
                
                // Click thread title to load
                threadDiv.querySelector('.thread-title').addEventListener('click', () => {
                    loadThread(thread.id);
                    sidebar.classList.remove('open');
                });
                
                // Delete thread
                threadDiv.querySelector('.thread-delete').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm('Delete this thread?')) {
                        await fetch(`/api/threads/${thread.id}`, { method: 'DELETE' });
                        if (currentThreadId === thread.id) resetToHome();
                        else loadThreads();
                    }
                });
                
                threadList.appendChild(threadDiv);
            });
        } catch (e) {
            console.error('Error loading threads:', e);
            threadList.innerHTML = '<div class="recent-text">Could not load threads.</div>';
        }
    }

    async function loadThread(threadId) {
        currentThreadId = threadId;
        chatHistory = [];
        mainContent.classList.add('chat-active');
        chatHistoryEl.classList.remove('hidden');
        chatHistoryEl.innerHTML = '';

        try {
            const res = await fetch(`/api/threads/${threadId}`);
            const data = await res.json();
            
            data.messages.forEach(msg => {
                if (msg.role === 'user') {
                    appendUserMessage(msg.content);
                    chatHistory.push({ role: 'user', parts: [msg.content] });
                } else if (msg.role === 'model') {
                    appendAIMessage(msg.content, msg.sources);
                    chatHistory.push({ role: 'model', parts: [msg.content] });
                }
            });
            scrollToBottom();
            loadThreads();
        } catch (e) {
            console.error('Error loading thread:', e);
        }
    }

    newThreadBtn.addEventListener('click', (e) => { e.preventDefault(); resetToHome(); sidebar.classList.remove('open'); });
    brandBtn.addEventListener('click', (e) => { e.preventDefault(); resetToHome(); sidebar.classList.remove('open'); });
    historyBtn.addEventListener('click', (e) => { e.preventDefault(); loadThreads(); });

    function resetToHome() {
        currentThreadId = null;
        chatHistory = [];
        chatHistoryEl.innerHTML = '';
        mainContent.classList.remove('chat-active');
        chatHistoryEl.classList.add('hidden');
        searchInput.value = '';
        searchInput.focus();
        uploadedPdfContext = null;
        pdfIndicator.classList.add('hidden');
        pdfIndicator.classList.remove('active');
        loadThreads();
    }

    loadThreads();

    // ============================
    // Chat Logic
    // ============================
    async function handleSearch() {
        const prompt = searchInput.value.trim();
        if (!prompt) return;

        mainContent.classList.add('chat-active');
        chatHistoryEl.classList.remove('hidden');
        searchInput.value = '';
        searchInput.style.height = 'auto';

        // Show PDF attachment indicator in the user message if PDF is active
        if (uploadedPdfContext) {
            appendUserMessage(prompt, uploadedPdfContext.filename);
        } else {
            appendUserMessage(prompt);
        }

        const aiMessageDiv = document.createElement('div');
        aiMessageDiv.className = 'message ai';
        aiMessageDiv.innerHTML = `
            <div class="response-header">
                <i class="ph-fill ph-asterisk" style="color: var(--brand-color);"></i>
                <span>Answer</span>
            </div>
            <div class="response-content">
                <div class="loading-indicator">
                    <div class="loading-dots"><span></span><span></span><span></span></div>
                    <span>Searching the web & generating answer...</span>
                </div>
            </div>
        `;
        chatHistoryEl.appendChild(aiMessageDiv);
        scrollToBottom();

        searchInput.disabled = true;
        submitBtn.disabled = true;

        try {
            const bodyPayload = { prompt: prompt, history: chatHistory };
            if (currentThreadId) bodyPayload.thread_id = currentThreadId;

            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload)
            });

            const data = await res.json();
            const contentDiv = aiMessageDiv.querySelector('.response-content');
            
            if (res.ok) {
                if (!currentThreadId && data.thread_id) {
                    currentThreadId = data.thread_id;
                    loadThreads();
                }
                
                contentDiv.innerHTML = marked.parse(sanitizeLatex(data.response));
                
                if (data.sources && data.sources.length > 0) {
                    const sourcesDiv = document.createElement('div');
                    sourcesDiv.className = 'sources-container';
                    sourcesDiv.innerHTML = '<div class="sources-label"><i class="ph ph-globe"></i> Sources</div>';
                    data.sources.forEach((src, idx) => {
                        const pill = document.createElement('a');
                        pill.href = src.url;
                        pill.target = '_blank';
                        pill.rel = 'noopener noreferrer';
                        pill.className = 'source-pill';
                        pill.innerHTML = `<span class="source-num">${idx+1}</span> ${src.title}`;
                        sourcesDiv.appendChild(pill);
                    });
                    contentDiv.appendChild(sourcesDiv);
                }

                chatHistory.push({ role: 'user', parts: [prompt] });
                chatHistory.push({ role: 'model', parts: [data.response] });
            } else {
                contentDiv.innerHTML = `<p style="color: #ff6b6b;">Error: ${data.error}</p>`;
            }
        } catch (error) {
            console.error('Fetch error:', error);
            aiMessageDiv.querySelector('.response-content').innerHTML = `<p style="color: #ff6b6b;">Error: Failed to connect to server.</p>`;
        } finally {
            searchInput.disabled = false;
            submitBtn.disabled = false;
            searchInput.focus();
            scrollToBottom();
        }
    }

    // ============================
    // DOM Helpers
    // ============================
    function appendUserMessage(text, pdfFilename) {
        const div = document.createElement('div');
        div.className = 'message user';
        if (pdfFilename) {
            div.innerHTML = `<div class="pdf-attachment"><i class="ph ph-file-pdf"></i> ${pdfFilename}</div>${text}`;
        } else {
            div.textContent = text;
        }
        chatHistoryEl.appendChild(div);
    }
    
    function appendAIMessage(text, sources) {
        const aiMessageDiv = document.createElement('div');
        aiMessageDiv.className = 'message ai';
        
        const header = document.createElement('div');
        header.className = 'response-header';
        header.innerHTML = `<i class="ph-fill ph-asterisk" style="color: var(--brand-color);"></i><span>Answer</span>`;

        const content = document.createElement('div');
        content.className = 'response-content';
        content.innerHTML = marked.parse(sanitizeLatex(text));

        if (sources && sources.length > 0) {
            const sourcesDiv = document.createElement('div');
            sourcesDiv.className = 'sources-container';
            sourcesDiv.innerHTML = '<div class="sources-label"><i class="ph ph-globe"></i> Sources</div>';
            sources.forEach((src, idx) => {
                const pill = document.createElement('a');
                pill.href = src.url;
                pill.target = '_blank';
                pill.rel = 'noopener noreferrer';
                pill.className = 'source-pill';
                pill.innerHTML = `<span class="source-num">${idx+1}</span> ${src.title}`;
                sourcesDiv.appendChild(pill);
            });
            content.appendChild(sourcesDiv);
        }

        aiMessageDiv.appendChild(header);
        aiMessageDiv.appendChild(content);
        chatHistoryEl.appendChild(aiMessageDiv);
    }

    function scrollToBottom() {
        mainContent.scrollTop = mainContent.scrollHeight;
    }

    // ============================
    // Event Bindings
    // ============================
    submitBtn.addEventListener('click', handleSearch);
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(); }
    });
});
