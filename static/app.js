// ===== State =====
const state = {
    agents: [],
    topic: '',
    model: '',
    research: {},
    transcript: '',
    debateTurns: [],
};

const AGENT_COLORS = ['#6b5ce7', '#2d9d5e', '#c08a19', '#3b82c4', '#c4507a'];

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    renderAgentConfigs(3);
    document.getElementById('agent-count').addEventListener('change', (e) => {
        renderAgentConfigs(parseInt(e.target.value));
    });
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
    // Show both debate and consensus sections for the final state
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById('step-debate').classList.add('active');
    document.getElementById('step-consensus').classList.add('active');
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

    document.getElementById('btn-start').disabled = true;

    try {
        // Step 2: Research
        showStep('step-research');
        await runResearch();

        // Step 3: Debate
        showStep('step-debate');
        await runDebate();

        // Step 4: Consensus — show both debate and consensus
        showFinalView();
        await runConsensus();
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

    // Create cards
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
        body: JSON.stringify({
            agents: state.agents,
            topic: state.topic,
            model: state.model,
        }),
    });

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
            try {
                const event = JSON.parse(line);
                handleResearchEvent(event);
            } catch (e) {
                // skip parse errors
            }
        }
    }
}

function handleResearchEvent(event) {
    if (event.type === 'research_start') {
        const idx = state.agents.findIndex(a => a.name === event.agent);
        if (idx >= 0) {
            const status = document.getElementById(`research-status-${idx}`);
            status.innerHTML = `<div class="spinner"></div><span>Researching...</span>`;
        }
    } else if (event.type === 'research_complete') {
        const idx = state.agents.findIndex(a => a.name === event.agent);
        if (idx >= 0) {
            state.research[event.agent] = event.research;
            state.agents[idx].research = event.research;

            const card = document.getElementById(`research-card-${idx}`);
            card.classList.add('complete');

            const status = document.getElementById(`research-status-${idx}`);
            status.className = 'research-status done';
            status.innerHTML = `<span>&#10003; Complete</span>`;

            const preview = document.getElementById(`research-preview-${idx}`);
            preview.textContent = event.research.substring(0, 300) + '...';
        }
    }
}

// ===== Debate Phase =====
async function runDebate() {
    const turnsContainer = document.getElementById('debate-turns');
    turnsContainer.innerHTML = '';
    state.debateTurns = [];

    const response = await fetch('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agents: state.agents,
            topic: state.topic,
            model: state.model,
        }),
    });

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
            try {
                const event = JSON.parse(line);
                handleDebateEvent(event);
            } catch (e) {
                // skip parse errors
            }
        }
    }
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

        // Show transcript toggle
        const transcriptContainer = document.getElementById('transcript-container');
        transcriptContainer.style.display = 'block';
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

    let badgeHtml = '';
    if (isModerator) {
        badgeHtml = '<span class="turn-badge moderator">Moderator</span>';
    }

    div.innerHTML = `
        <div class="turn-header">
            ${!isModerator ? `<div class="agent-color-dot" style="background:${color}"></div>` : ''}
            <span class="turn-speaker" style="color:${color}">${turn.speaker}</span>
            ${badgeHtml}
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
    container.innerHTML = `
        <div class="consensus-loading">
            <div class="spinner"></div>
            <span>Generating final consensus deliberation...</span>
        </div>
    `;

    const response = await fetch('/api/consensus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agents: state.agents,
            topic: state.topic,
            transcript: state.transcript,
            model: state.model,
        }),
    });

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
            try {
                const event = JSON.parse(line);
                if (event.type === 'consensus_complete') {
                    if (event.structured) {
                        container.innerHTML = renderStructuredConsensus(event.data);
                    } else {
                        container.innerHTML = renderMarkdown(event.consensus);
                    }
                }
            } catch (e) {
                // skip
            }
        }
    }
}

function getAgentColor(agentName) {
    const idx = state.agents.findIndex(a => a.name === agentName);
    return idx >= 0 ? AGENT_COLORS[idx] : 'var(--text)';
}

function renderStructuredConsensus(data) {
    let html = '';

    // Summary
    html += `<div class="consensus-section">
        <h2>Synthesis</h2>
        <p>${escapeHtml(data.summary)}</p>
    </div>`;

    // Key Arguments (expandable)
    html += `<div class="consensus-section">
        <h2>Strongest Arguments</h2>
        <div class="expandable-list">`;

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
                <div class="expandable-argument">
                    <div class="expandable-label">Strongest Argument</div>
                    <p>${escapeHtml(arg.strongest_argument)}</p>
                </div>
                <div class="expandable-quote">
                    <div class="expandable-label">Direct Quote from Debate</div>
                    <blockquote>${escapeHtml(arg.direct_quote)}</blockquote>
                </div>
            </div>
        </div>`;
    }
    html += `</div></div>`;

    // Tensions (expandable)
    html += `<div class="consensus-section">
        <h2>Key Tensions</h2>
        <div class="expandable-list">`;

    for (const tension of (data.tensions || [])) {
        const id = 'tension-' + Math.random().toString(36).substr(2, 9);
        html += `
        <div class="expandable-card">
            <div class="expandable-header" onclick="toggleExpandable('${id}')">
                <div class="expandable-header-left">
                    <strong>${escapeHtml(tension.description)}</strong>
                </div>
                <span class="expand-arrow" id="arrow-${id}">&#9654;</span>
            </div>
            <div class="expandable-body" id="${id}" style="display:none;">`;

        for (const side of (tension.sides || [])) {
            const color = getAgentColor(side.agent);
            html += `
                <div class="tension-side">
                    <div class="tension-side-header">
                        <div class="agent-color-dot" style="background:${color}"></div>
                        <strong style="color:${color}">${escapeHtml(side.agent)}</strong>
                    </div>
                    <p>${escapeHtml(side.stance)}</p>
                    <blockquote>${escapeHtml(side.direct_quote)}</blockquote>
                </div>`;
        }
        html += `</div></div>`;
    }
    html += `</div></div>`;

    // Convergence
    if (data.convergence) {
        html += `<div class="consensus-section">
            <h2>Points of Convergence</h2>
            <p>${escapeHtml(data.convergence)}</p>
        </div>`;
    }

    // Key Takeaways
    html += `<div class="consensus-section">
        <h2>Key Takeaways</h2>
        <ol class="takeaways-list">`;
    for (const takeaway of (data.key_takeaways || [])) {
        html += `<li>${escapeHtml(takeaway)}</li>`;
    }
    html += `</ol></div>`;

    // Sources Cited
    if (data.sources_cited && data.sources_cited.length > 0) {
        html += `<div class="consensus-section sources-section">
            <h2>Sources Cited in the Debate</h2>
            <div class="sources-list">`;
        for (const src of data.sources_cited) {
            const citedByColor = getAgentColor(src.cited_by);
            html += `
            <div class="source-item">
                <div class="source-title">${escapeHtml(src.title)}${src.year ? ' (' + escapeHtml(src.year) + ')' : ''}</div>
                <div class="source-author">${escapeHtml(src.author)}</div>
                <div class="source-meta">
                    <span class="source-cited-by">Cited by <strong style="color:${citedByColor}">${escapeHtml(src.cited_by)}</strong></span>
                    <span class="source-relevance">${escapeHtml(src.relevance)}</span>
                </div>
            </div>`;
        }
        html += `</div></div>`;
    }

    return html;
}

function toggleExpandable(id) {
    const body = document.getElementById(id);
    const arrow = document.getElementById('arrow-' + id);
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    arrow.classList.toggle('expanded', !isOpen);
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

    document.getElementById('topic').value = '';
    document.getElementById('btn-start').disabled = false;
    document.getElementById('debate-turns').innerHTML = '';
    document.getElementById('consensus-content').innerHTML = '';
    document.getElementById('transcript-container').style.display = 'none';
    document.getElementById('transcript-content').style.display = 'none';
    document.getElementById('transcript-content').innerHTML = '';

    const debateStatus = document.getElementById('debate-status');
    debateStatus.className = 'debate-status';
    debateStatus.innerHTML = '<div class="spinner"></div><span>Debate in progress...</span>';

    renderAgentConfigs(parseInt(document.getElementById('agent-count').value));
    showStep('step-setup');
}

// ===== Text Formatting =====
function formatText(text) {
    return text
        .split('\n\n')
        .map(p => `<p>${escapeHtml(p.trim())}</p>`)
        .join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderMarkdown(text) {
    // Simple markdown rendering
    let html = escapeHtml(text);

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Unordered lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Numbered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Paragraphs (lines not already wrapped)
    html = html.replace(/^(?!<[hulo]|<block|<li)(.+)$/gm, '<p>$1</p>');

    // Clean up extra newlines
    html = html.replace(/\n/g, '');

    return html;
}
