// ===== State =====
const state = {
    agents: [],
    topic: '',
    model: '',
    research: {},
    transcript: '',
    debateTurns: [],
    sessionId: null,
    consensusData: null,
    followUps: [],
};

const AGENT_COLORS = ['#6b5ce7', '#2d9d5e', '#c08a19', '#3b82c4', '#c4507a'];

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    renderAgentConfigs(3);
    document.getElementById('agent-count').addEventListener('change', (e) => {
        renderAgentConfigs(parseInt(e.target.value));
    });
    // Allow Enter to send follow-up (Shift+Enter for newline)
    document.getElementById('followup-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendFollowUp();
        }
    });
    loadSessionList();
});

function renderAgentConfigs(count) {
    const container = document.getElementById('agent-configs');
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const placeholderNames = ['e.g. Seb Krier', 'e.g. Tyler Cowen', 'e.g. A Marxist Economist', 'e.g. FDA Regulator', 'e.g. Elon Musk'];
        const card = document.createElement('div');
        card.className = 'agent-config';
        card.innerHTML = `
            <div class="agent-config-header">
                <div class="agent-color-dot bg-agent-${i}"></div>
                <input type="text" id="agent-name-${i}" value="" placeholder="${placeholderNames[i]}">
            </div>
            <div class="form-group" style="margin-bottom:0">
                <label for="agent-role-${i}">Role Description</label>
                <textarea id="agent-role-${i}" rows="3" placeholder="Describe this agent's role in detail. Who are they? What perspective do they represent? What is their intellectual background?"></textarea>
            </div>
        `;
        container.appendChild(card);
    }
}

// ===== Step Navigation =====
function showStep(stepId) {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById(stepId).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showFinalView() {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById('step-debate').classList.add('active');
    document.getElementById('step-consensus').classList.add('active');
    document.getElementById('step-followup').classList.add('active');
    window.scrollTo({ top: document.getElementById('step-consensus').offsetTop - 20, behavior: 'smooth' });
}

// ===== Start Parliament =====
async function startParliament() {
    const topic = document.getElementById('topic').value.trim();
    if (!topic) {
        alert('Please enter a topic for the parliament to debate.');
        return;
    }

    const model = document.getElementById('model-select').value;
    const count = parseInt(document.getElementById('agent-count').value);
    const agents = [];

    for (let i = 0; i < count; i++) {
        const name = document.getElementById(`agent-name-${i}`).value.trim();
        const role = document.getElementById(`agent-role-${i}`).value.trim();
        if (!name || !role) {
            alert(`Please fill in both name and role for all agents.`);
            return;
        }
        agents.push({ name, role });
    }

    state.topic = topic;
    state.model = model;
    state.agents = agents;
    state.followUps = [];
    state.sessionId = null;

    document.getElementById('btn-start').disabled = true;

    try {
        showStep('step-research');
        await runResearch();

        showStep('step-debate');
        await runDebate();

        showFinalView();
        await runConsensus();

        // Auto-save session
        await saveSession();
    } catch (err) {
        console.error('Parliament error:', err);
        alert('An error occurred: ' + err.message + '\n\nCheck that your ANTHROPIC_API_KEY is set and the server is running.');
        document.getElementById('btn-start').disabled = false;
        showStep('step-setup');
    }
}

// ===== Research Phase =====
async function runResearch() {
    const container = document.getElementById('research-progress');
    container.innerHTML = '';

    state.agents.forEach((agent, i) => {
        const card = document.createElement('div');
        card.className = 'research-card';
        card.id = `research-card-${i}`;
        card.innerHTML = `
            <div class="research-card-header">
                <div class="agent-color-dot bg-agent-${i}"></div>
                <span class="agent-name">${agent.name}</span>
                <div class="research-status" id="research-status-${i}">
                    <span>Pending</span>
                </div>
            </div>
            <div class="research-preview" id="research-preview-${i}"></div>
        `;
        container.appendChild(card);
    });

    const response = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: state.agents, topic: state.topic, model: state.model }),
    });

    await processStream(response, handleResearchEvent);
}

function handleResearchEvent(event) {
    if (event.type === 'research_start') {
        const idx = state.agents.findIndex(a => a.name === event.agent);
        if (idx >= 0) {
            document.getElementById(`research-status-${idx}`).innerHTML = `<div class="spinner"></div><span>Researching...</span>`;
        }
    } else if (event.type === 'research_complete') {
        const idx = state.agents.findIndex(a => a.name === event.agent);
        if (idx >= 0) {
            state.research[event.agent] = event.research;
            state.agents[idx].research = event.research;
            document.getElementById(`research-card-${idx}`).classList.add('complete');
            const status = document.getElementById(`research-status-${idx}`);
            status.className = 'research-status done';
            status.innerHTML = `<span>&#10003; Complete</span>`;
            document.getElementById(`research-preview-${idx}`).textContent = event.research.substring(0, 300) + '...';
        }
    }
}

// ===== Debate Phase =====
async function runDebate() {
    document.getElementById('debate-turns').innerHTML = '';
    state.debateTurns = [];

    const response = await fetch('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: state.agents, topic: state.topic, model: state.model }),
    });

    await processStream(response, handleDebateEvent);
}

function handleDebateEvent(event) {
    if (event.type === 'turn') {
        state.debateTurns.push(event);
        renderDebateTurn(event);
    } else if (event.type === 'debate_complete') {
        state.transcript = event.transcript;
        const status = document.getElementById('debate-status');
        status.className = 'debate-status concluded';
        status.innerHTML = `<span>&#10003; Debate concluded</span>`;
        document.getElementById('transcript-container').style.display = 'block';
        document.getElementById('transcript-content').innerHTML = renderMarkdown(event.transcript);
    }
}

function renderDebateTurn(turn) {
    const container = document.getElementById('debate-turns');
    const agentIdx = state.agents.findIndex(a => a.name === turn.speaker);
    const isModerator = turn.speaker === 'Moderator';
    const color = isModerator ? 'var(--amber)' : (agentIdx >= 0 ? AGENT_COLORS[agentIdx] : 'var(--text)');

    const div = document.createElement('div');
    div.className = 'debate-turn';

    div.innerHTML = `
        <div class="turn-header">
            ${!isModerator ? `<div class="agent-color-dot" style="background:${color}"></div>` : ''}
            <span class="turn-speaker" style="color:${color}">${turn.speaker}</span>
            ${isModerator ? '<span class="turn-badge moderator">Moderator</span>' : ''}
            <span class="turn-round">Round ${turn.turn_number}</span>
        </div>
        <div class="turn-text">${formatText(turn.text)}</div>
    `;

    container.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ===== Consensus Phase =====
async function runConsensus() {
    const container = document.getElementById('consensus-content');
    container.innerHTML = `<div class="consensus-loading"><div class="spinner"></div><span>Generating final consensus deliberation...</span></div>`;

    const response = await fetch('/api/consensus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: state.agents, topic: state.topic, transcript: state.transcript, model: state.model }),
    });

    await processStream(response, (event) => {
        if (event.type === 'consensus_complete') {
            if (event.structured) {
                state.consensusData = event.data;
                container.innerHTML = renderStructuredConsensus(event.data);
            } else {
                state.consensusData = event.consensus;
                container.innerHTML = renderMarkdown(event.consensus);
            }
        }
    });
}

// ===== Follow-up Chat =====
async function sendFollowUp() {
    const input = document.getElementById('followup-input');
    const message = input.value.trim();
    if (!message) return;

    input.value = '';
    document.getElementById('btn-followup').disabled = true;

    const messagesContainer = document.getElementById('followup-messages');

    // Show user message
    const userDiv = document.createElement('div');
    userDiv.className = 'followup-user';
    userDiv.innerHTML = `<div class="followup-user-label">You</div><div class="followup-user-text">${escapeHtml(message)}</div>`;
    messagesContainer.appendChild(userDiv);

    // Loading indicator
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'followup-loading';
    loadingDiv.innerHTML = `<div class="spinner"></div><span>Agents are responding...</span>`;
    messagesContainer.appendChild(loadingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    const followUpEntry = { user_message: message, responses: [] };

    const response = await fetch('/api/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agents: state.agents,
            topic: state.topic,
            transcript: state.transcript,
            message: message,
            follow_up_history: state.followUps,
            model: state.model,
        }),
    });

    await processStream(response, (event) => {
        if (event.type === 'followup_response') {
            // Remove loading indicator on first response
            if (loadingDiv.parentNode) loadingDiv.remove();

            const agentIdx = state.agents.findIndex(a => a.name === event.agent);
            const color = agentIdx >= 0 ? AGENT_COLORS[agentIdx] : 'var(--text)';

            const agentDiv = document.createElement('div');
            agentDiv.className = 'followup-agent';
            agentDiv.innerHTML = `
                <div class="followup-agent-header">
                    <div class="agent-color-dot" style="background:${color}"></div>
                    <strong style="color:${color}">${escapeHtml(event.agent)}</strong>
                </div>
                <div class="followup-agent-text">${formatText(event.text)}</div>
            `;
            messagesContainer.appendChild(agentDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;

            followUpEntry.responses.push({ agent: event.agent, text: event.text });
        } else if (event.type === 'followup_complete') {
            if (loadingDiv.parentNode) loadingDiv.remove();
            document.getElementById('btn-followup').disabled = false;
        }
    });

    state.followUps.push(followUpEntry);

    // Update saved session with follow-ups
    if (state.sessionId) {
        fetch(`/api/sessions/${state.sessionId}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ follow_ups: state.followUps }),
        });
    }

    document.getElementById('btn-followup').disabled = false;
}

// ===== Session Management =====
async function saveSession() {
    const resp = await fetch('/api/sessions/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            topic: state.topic,
            model: state.model,
            agents: state.agents,
            transcript: state.transcript,
            consensus: state.consensusData,
            follow_ups: state.followUps,
        }),
    });
    const result = await resp.json();
    state.sessionId = result.id;
    loadSessionList();
}

async function loadSessionList() {
    const resp = await fetch('/api/sessions');
    const sessions = await resp.json();
    const container = document.getElementById('session-list');

    if (sessions.length === 0) {
        container.innerHTML = '<p class="session-list-empty">No past sessions yet.</p>';
        return;
    }

    container.innerHTML = '';
    for (const s of sessions) {
        const div = document.createElement('div');
        div.className = 'session-item';
        div.onclick = () => loadSession(s.id);
        div.innerHTML = `
            <div class="session-item-topic">${escapeHtml(s.topic.substring(0, 80))}${s.topic.length > 80 ? '...' : ''}</div>
            <div class="session-item-meta">
                <span>${escapeHtml(s.agents.join(', '))}</span>
                <span>${escapeHtml(s.created_at)}</span>
            </div>
        `;
        container.appendChild(div);
    }
}

async function loadSession(sessionId) {
    toggleSidebar();
    const resp = await fetch(`/api/sessions/${sessionId}`);
    const session = await resp.json();

    state.topic = session.topic;
    state.model = session.model;
    state.agents = session.agents;
    state.transcript = session.transcript;
    state.consensusData = session.consensus;
    state.sessionId = session.id;
    state.followUps = session.follow_ups || [];

    // Render debate turns from transcript
    document.getElementById('debate-turns').innerHTML = '';
    state.debateTurns = [];

    const debateStatus = document.getElementById('debate-status');
    debateStatus.className = 'debate-status concluded';
    debateStatus.innerHTML = `<span>&#10003; Debate concluded</span>`;

    document.getElementById('transcript-container').style.display = 'block';
    document.getElementById('transcript-content').innerHTML = renderMarkdown(session.transcript);

    // Render consensus
    const consensusContainer = document.getElementById('consensus-content');
    if (session.consensus && typeof session.consensus === 'object') {
        consensusContainer.innerHTML = renderStructuredConsensus(session.consensus);
    } else if (session.consensus) {
        consensusContainer.innerHTML = renderMarkdown(session.consensus);
    }

    // Render follow-ups
    const followupContainer = document.getElementById('followup-messages');
    followupContainer.innerHTML = '';
    for (const fu of state.followUps) {
        const userDiv = document.createElement('div');
        userDiv.className = 'followup-user';
        userDiv.innerHTML = `<div class="followup-user-label">You</div><div class="followup-user-text">${escapeHtml(fu.user_message)}</div>`;
        followupContainer.appendChild(userDiv);

        for (const resp of (fu.responses || [])) {
            const agentIdx = state.agents.findIndex(a => a.name === resp.agent);
            const color = agentIdx >= 0 ? AGENT_COLORS[agentIdx] : 'var(--text)';
            const agentDiv = document.createElement('div');
            agentDiv.className = 'followup-agent';
            agentDiv.innerHTML = `
                <div class="followup-agent-header">
                    <div class="agent-color-dot" style="background:${color}"></div>
                    <strong style="color:${color}">${escapeHtml(resp.agent)}</strong>
                </div>
                <div class="followup-agent-text">${formatText(resp.text)}</div>
            `;
            followupContainer.appendChild(agentDiv);
        }
    }

    showFinalView();
}

// ===== Sidebar =====
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('open');
    loadSessionList();
}

// ===== Transcript Toggle =====
function toggleTranscript() {
    const content = document.getElementById('transcript-content');
    const toggle = document.querySelector('.transcript-toggle');
    const isOpen = content.style.display !== 'none';
    content.style.display = isOpen ? 'none' : 'block';
    toggle.classList.toggle('open', !isOpen);
}

// ===== Reset =====
function resetParliament() {
    state.agents = [];
    state.topic = '';
    state.model = '';
    state.research = {};
    state.transcript = '';
    state.debateTurns = [];
    state.sessionId = null;
    state.consensusData = null;
    state.followUps = [];

    document.getElementById('topic').value = '';
    document.getElementById('btn-start').disabled = false;
    document.getElementById('debate-turns').innerHTML = '';
    document.getElementById('consensus-content').innerHTML = '';
    document.getElementById('transcript-container').style.display = 'none';
    document.getElementById('transcript-content').style.display = 'none';
    document.getElementById('transcript-content').innerHTML = '';
    document.getElementById('followup-messages').innerHTML = '';
    document.getElementById('followup-input').value = '';

    const debateStatus = document.getElementById('debate-status');
    debateStatus.className = 'debate-status';
    debateStatus.innerHTML = '<div class="spinner"></div><span>Debate in progress...</span>';

    renderAgentConfigs(parseInt(document.getElementById('agent-count').value));
    showStep('step-setup');
}

// ===== Utilities =====
async function processStream(response, handler) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            if (!line.trim()) continue;
            try { handler(JSON.parse(line)); } catch (e) {}
        }
    }
}

function formatText(text) {
    return text.split('\n\n').map(p => `<p>${escapeHtml(p.trim())}</p>`).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getAgentColor(agentName) {
    const idx = state.agents.findIndex(a => a.name === agentName);
    return idx >= 0 ? AGENT_COLORS[idx] : 'var(--text)';
}

function toggleExpandable(id) {
    const body = document.getElementById(id);
    const arrow = document.getElementById('arrow-' + id);
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    arrow.classList.toggle('expanded', !isOpen);
}

function renderStructuredConsensus(data) {
    let html = '';

    html += `<div class="consensus-section"><h2>Synthesis</h2><p>${escapeHtml(data.summary)}</p></div>`;

    html += `<div class="consensus-section"><h2>Strongest Arguments</h2><div class="expandable-list">`;
    for (const arg of (data.key_arguments || [])) {
        const color = getAgentColor(arg.agent);
        const id = 'arg-' + Math.random().toString(36).substr(2, 9);
        html += `
        <div class="expandable-card">
            <div class="expandable-header" onclick="toggleExpandable('${id}')">
                <div class="expandable-header-left">
                    <div class="agent-color-dot" style="background:${color}"></div>
                    <strong style="color:${color}">${escapeHtml(arg.agent)}</strong>
                    <span class="expandable-summary">${escapeHtml(arg.position)}</span>
                </div>
                <span class="expand-arrow" id="arrow-${id}">&#9654;</span>
            </div>
            <div class="expandable-body" id="${id}" style="display:none;">
                <div class="expandable-argument"><div class="expandable-label">Strongest Argument</div><p>${escapeHtml(arg.strongest_argument)}</p></div>
                <div class="expandable-quote"><div class="expandable-label">Direct Quote from Debate</div><blockquote>${escapeHtml(arg.direct_quote)}</blockquote></div>
            </div>
        </div>`;
    }
    html += `</div></div>`;

    html += `<div class="consensus-section"><h2>Key Tensions</h2><div class="expandable-list">`;
    for (const tension of (data.tensions || [])) {
        const id = 'tension-' + Math.random().toString(36).substr(2, 9);
        html += `
        <div class="expandable-card">
            <div class="expandable-header" onclick="toggleExpandable('${id}')">
                <div class="expandable-header-left"><strong>${escapeHtml(tension.description)}</strong></div>
                <span class="expand-arrow" id="arrow-${id}">&#9654;</span>
            </div>
            <div class="expandable-body" id="${id}" style="display:none;">`;
        for (const side of (tension.sides || [])) {
            const color = getAgentColor(side.agent);
            html += `<div class="tension-side"><div class="tension-side-header"><div class="agent-color-dot" style="background:${color}"></div><strong style="color:${color}">${escapeHtml(side.agent)}</strong></div><p>${escapeHtml(side.stance)}</p><blockquote>${escapeHtml(side.direct_quote)}</blockquote></div>`;
        }
        html += `</div></div>`;
    }
    html += `</div></div>`;

    if (data.convergence) {
        html += `<div class="consensus-section"><h2>Points of Convergence</h2><p>${escapeHtml(data.convergence)}</p></div>`;
    }

    html += `<div class="consensus-section"><h2>Key Takeaways</h2><ol class="takeaways-list">`;
    for (const t of (data.key_takeaways || [])) { html += `<li>${escapeHtml(t)}</li>`; }
    html += `</ol></div>`;

    if (data.sources_cited && data.sources_cited.length > 0) {
        html += `<div class="consensus-section sources-section"><h2>Sources Cited in the Debate</h2><div class="sources-list">`;
        for (const src of data.sources_cited) {
            const c = getAgentColor(src.cited_by);
            html += `<div class="source-item"><div class="source-title">${escapeHtml(src.title)}${src.year ? ' (' + escapeHtml(src.year) + ')' : ''}</div><div class="source-author">${escapeHtml(src.author)}</div><div class="source-meta"><span class="source-cited-by">Cited by <strong style="color:${c}">${escapeHtml(src.cited_by)}</strong></span><span class="source-relevance">${escapeHtml(src.relevance)}</span></div></div>`;
        }
        html += `</div></div>`;
    }

    return html;
}

function renderMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^(?!<[hulo]|<block|<li)(.+)$/gm, '<p>$1</p>');
    html = html.replace(/\n/g, '');
    return html;
}
