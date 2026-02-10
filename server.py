"""Mind Parliament - Multi-Agent Debate Server"""

import json
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from anthropic import AsyncAnthropic

BASE_DIR = Path(__file__).resolve().parent
SESSIONS_DIR = BASE_DIR / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Mind Parliament")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

client = AsyncAnthropic()

AVAILABLE_MODELS = [
    {"id": "claude-opus-4-20250514", "name": "Claude Opus 4.6"},
    {"id": "claude-sonnet-4-5-20250514", "name": "Claude Sonnet 4.5"},
]


def build_research_prompt(agent_name: str, agent_role: str, topic: str) -> str:
    return f"""You are a research assistant. Your task is to provide comprehensive background knowledge for an AI agent that will play a specific role in a debate.

Agent Name: {agent_name}
Agent Role Description: {agent_role}
Debate Topic: {topic}

Based on the role description, provide thorough background research:

1. If this is a SPECIFIC NAMED PERSON:
   - Their key published works, papers, books
   - Their known philosophical positions and intellectual commitments
   - Their intellectual genealogy (who influenced them, who they cite)
   - Their recent public statements, interviews, or writings on relevant topics
   - Their likely stance on the debate topic based on their known views

2. If this is a REPRESENTATIVE OF AN IDEOLOGY/VIEW/PROFESSION:
   - The foundational texts and thinkers of this tradition
   - Key principles and axioms this perspective holds
   - How these ideas have evolved over time
   - The strongest arguments this perspective typically makes
   - Common sources and authorities this perspective cites
   - How this perspective would likely approach the debate topic

Provide this as a detailed briefing document that will allow the agent to argue authentically and with depth. This is critical:
- Include SPECIFIC citations: author names, paper/book titles, publication years, and key findings.
- Reference concrete empirical data: studies, statistics, experiments, and their results.
- For named persons: compile direct quotes from their actual writings, interviews, tweets/X posts, blog posts, and public statements. Note which publications or platforms these appeared on.
- For ideological/professional representatives: list the canonical texts and landmark papers in the tradition, with specific chapter/section references where relevant.
- Identify the key data points, case studies, and real-world examples this perspective relies on.

Be exhaustive - this research will form the foundation of the agent's knowledge and its ability to make evidence-based arguments."""


def build_agent_system_prompt(agent_name: str, agent_role: str, research: str, topic: str) -> str:
    return f"""You are {agent_name}, participating in a parliamentary debate called "Mind Parliament."

YOUR ROLE: {agent_role}

BACKGROUND RESEARCH ON YOUR PERSPECTIVE:
{research}

DEBATE TOPIC: {topic}

INSTRUCTIONS:
- Stay fully in character at all times. Argue from your assigned perspective with conviction and depth.
- ALWAYS CITE YOUR SOURCES. Every substantive claim must be backed by specific evidence:
  * Reference papers, books, and articles by author, title, and year (e.g., "As Kahneman showed in Thinking, Fast and Slow (2011)...")
  * Point to specific empirical findings, statistics, and data (e.g., "The 2019 RCT by Banerjee and Duflo found that...")
  * If you represent a real person, directly quote their actual writings, tweets/X posts, interviews, and public statements (e.g., "As I wrote in my 2023 Substack post...")
  * Reference real-world case studies and historical examples with specifics (dates, places, outcomes)
- Be intellectually rigorous - no logical fallacies, no strawmen, no ad hominem.
- Be willing to be confrontational and push back hard on positions you disagree with.
- Engage directly with what other agents say - quote them, challenge their premises, probe their assumptions.
- When challenging others, demand evidence: "What's your source for that claim?" "Which study shows that?"
- Use Socratic questioning to expose weaknesses in others' reasoning.
- If you genuinely agree with a point, acknowledge it, but show your own independent reasoning for why.
- Be persuasive. You are trying to make the strongest possible case for your perspective.
- Keep responses focused and substantive (2-4 paragraphs per turn). Do not ramble.
- Do NOT break character or add meta-commentary about being an AI."""


def build_moderator_prompt(topic: str, agent_descriptions: list[dict]) -> str:
    agents_text = "\n".join([f"- {a['name']}: {a['role']}" for a in agent_descriptions])
    return f"""You are the moderator of a Mind Parliament debate. Your role is to facilitate productive discussion.

TOPIC: {topic}

PARTICIPANTS:
{agents_text}

Your job:
1. Open the debate by framing the topic and inviting the first agent to present their position.
2. After each round, identify the most productive tensions and direct specific agents to respond to specific points.
3. Push agents to go deeper - ask them to address counterarguments they've avoided.
4. When the debate reaches a natural stopping point (arguments are cycling, positions are clear, key tensions have been explored), declare the debate concluded.
5. Keep your interventions brief and focused. You are a facilitator, not a participant.

When you believe the debate has reached a stable end state, end your message with exactly: [DEBATE_CONCLUDED]"""


def build_consensus_prompt(topic: str, agent_descriptions: list[dict], transcript: str) -> str:
    agents_text = "\n".join([f"- {a['name']}: {a['role']}" for a in agent_descriptions])
    return f"""You have just observed a full parliamentary debate in the Mind Parliament. Your task is to produce the final consensus deliberation as a JSON object.

TOPIC: {topic}

PARTICIPANTS:
{agents_text}

FULL DEBATE TRANSCRIPT:
{transcript}

You MUST respond with valid JSON and nothing else. Use this exact structure:

{{
  "summary": "A 2-3 paragraph synthesis that directly answers the original question, integrating the strongest insights. Take a substantive position — do not be wishy-washy. If genuine consensus is impossible, explain exactly why.",

  "key_arguments": [
    {{
      "agent": "Agent Name",
      "position": "One-sentence summary of their core position",
      "strongest_argument": "The single most compelling argument this agent made (2-3 sentences)",
      "direct_quote": "Copy-paste an exact passage from this agent's debate turns that best captures their key point. This must be a real quote from the transcript above."
    }}
  ],

  "tensions": [
    {{
      "description": "One-sentence description of the fundamental disagreement",
      "sides": [
        {{
          "agent": "Agent Name",
          "stance": "Their position on this tension (1-2 sentences)",
          "direct_quote": "Copy-paste an exact passage from their debate turns on this point."
        }}
      ]
    }}
  ],

  "convergence": "Where did agents agree, either explicitly or implicitly? What shared assumptions or conclusions emerged? (1-2 paragraphs)",

  "key_takeaways": [
    "Takeaway 1: a concrete, information-dense insight",
    "Takeaway 2: ...",
    "Takeaway 3: ..."
  ],

  "sources_cited": [
    {{
      "title": "Title of paper, book, article, or post",
      "author": "Author name(s)",
      "year": "Year if known, or empty string",
      "cited_by": "Which agent cited this",
      "relevance": "One sentence on why this source matters to the debate"
    }}
  ]
}}

IMPORTANT:
- The "direct_quote" fields must be EXACT text copied from the transcript — do not paraphrase.
- The "sources_cited" should include ALL papers, books, articles, studies, blog posts, tweets, and other references that were mentioned during the debate.
- Include 3-5 key_takeaways.
- Include one entry in key_arguments for each participant (not the Moderator).
- Include 2-4 tensions.
- Respond with ONLY the JSON object, no markdown code fences, no extra text."""


@app.get("/", response_class=HTMLResponse)
async def index():
    with open(BASE_DIR / "static" / "index.html") as f:
        return f.read()


@app.get("/api/models")
async def get_models():
    return AVAILABLE_MODELS


@app.post("/api/research")
async def research_agents(request: Request):
    data = await request.json()
    agents = data["agents"]
    topic = data["topic"]
    model = data.get("model", "claude-sonnet-4-5-20250514")

    async def run_research():
        results = {}
        for agent in agents:
            prompt = build_research_prompt(agent["name"], agent["role"], topic)
            yield json.dumps({"type": "research_start", "agent": agent["name"]}) + "\n"

            response = await client.messages.create(
                model=model,
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}],
            )
            research_text = response.content[0].text
            results[agent["name"]] = research_text
            yield json.dumps({
                "type": "research_complete",
                "agent": agent["name"],
                "research": research_text,
            }) + "\n"

        yield json.dumps({"type": "all_research_complete", "results": results}) + "\n"

    return StreamingResponse(run_research(), media_type="text/event-stream")


@app.post("/api/debate")
async def run_debate(request: Request):
    data = await request.json()
    agents = data["agents"]  # [{name, role, research}, ...]
    topic = data["topic"]
    model = data.get("model", "claude-sonnet-4-5-20250514")

    agent_system_prompts = {}
    for agent in agents:
        agent_system_prompts[agent["name"]] = build_agent_system_prompt(
            agent["name"], agent["role"], agent["research"], topic
        )

    moderator_system = build_moderator_prompt(topic, agents)

    async def run_debate_stream():
        transcript_lines = []
        debate_history = []  # Shared context for all agents
        max_rounds = 20
        concluded = False

        # Moderator opens
        mod_response = await client.messages.create(
            model=model,
            max_tokens=1024,
            system=moderator_system,
            messages=[{"role": "user", "content": f"Please open the debate on the topic: {topic}"}],
        )
        mod_text = mod_response.content[0].text
        transcript_lines.append(f"**Moderator**: {mod_text}")
        debate_history.append(f"Moderator: {mod_text}")

        yield json.dumps({
            "type": "turn",
            "speaker": "Moderator",
            "text": mod_text,
            "turn_number": 0,
        }) + "\n"

        for round_num in range(1, max_rounds + 1):
            # Each agent takes a turn
            for agent in agents:
                context = "\n\n".join(debate_history)
                agent_messages = [
                    {
                        "role": "user",
                        "content": f"Here is the debate so far:\n\n{context}\n\nIt is now your turn to speak. Respond to what has been said, advance your position, and challenge others where appropriate.",
                    }
                ]

                response = await client.messages.create(
                    model=model,
                    max_tokens=2048,
                    system=agent_system_prompts[agent["name"]],
                    messages=agent_messages,
                )
                agent_text = response.content[0].text
                transcript_lines.append(f"**{agent['name']}**: {agent_text}")
                debate_history.append(f"{agent['name']}: {agent_text}")

                yield json.dumps({
                    "type": "turn",
                    "speaker": agent["name"],
                    "text": agent_text,
                    "turn_number": round_num,
                }) + "\n"

            # Moderator reflects and decides whether to continue
            mod_context = "\n\n".join(debate_history)
            mod_messages = [
                {
                    "role": "user",
                    "content": f"Here is the debate so far:\n\n{mod_context}\n\nReflect on the current state of the debate. Direct agents to address specific points, push for depth, or if the debate has reached a stable end state, conclude it. Remember to end with [DEBATE_CONCLUDED] if the debate should end.",
                }
            ]

            mod_response = await client.messages.create(
                model=model,
                max_tokens=1024,
                system=moderator_system,
                messages=mod_messages,
            )
            mod_text = mod_response.content[0].text
            transcript_lines.append(f"**Moderator**: {mod_text}")
            debate_history.append(f"Moderator: {mod_text}")

            yield json.dumps({
                "type": "turn",
                "speaker": "Moderator",
                "text": mod_text,
                "turn_number": round_num,
            }) + "\n"

            if "[DEBATE_CONCLUDED]" in mod_text:
                concluded = True
                break

        full_transcript = "\n\n".join(transcript_lines)
        yield json.dumps({
            "type": "debate_complete",
            "transcript": full_transcript,
        }) + "\n"

    return StreamingResponse(run_debate_stream(), media_type="text/event-stream")


@app.post("/api/consensus")
async def generate_consensus(request: Request):
    data = await request.json()
    agents = data["agents"]
    topic = data["topic"]
    transcript = data["transcript"]
    model = data.get("model", "claude-sonnet-4-5-20250514")

    prompt = build_consensus_prompt(topic, agents, transcript)

    async def stream_consensus():
        yield json.dumps({"type": "consensus_start"}) + "\n"

        response = await client.messages.create(
            model=model,
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = response.content[0].text

        # Try to parse as structured JSON; fall back to plain text
        try:
            # Strip markdown code fences if present
            cleaned = raw_text.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1]
                cleaned = cleaned.rsplit("```", 1)[0]
            consensus_data = json.loads(cleaned)
            yield json.dumps({
                "type": "consensus_complete",
                "structured": True,
                "data": consensus_data,
            }) + "\n"
        except (json.JSONDecodeError, KeyError):
            yield json.dumps({
                "type": "consensus_complete",
                "structured": False,
                "consensus": raw_text,
            }) + "\n"

    return StreamingResponse(stream_consensus(), media_type="text/event-stream")


@app.post("/api/sessions/save")
async def save_session(request: Request):
    data = await request.json()
    session_id = str(int(time.time() * 1000))
    session = {
        "id": session_id,
        "topic": data["topic"],
        "model": data["model"],
        "agents": data["agents"],
        "transcript": data["transcript"],
        "consensus": data.get("consensus"),
        "follow_ups": data.get("follow_ups", []),
        "created_at": time.strftime("%Y-%m-%d %H:%M"),
    }
    with open(SESSIONS_DIR / f"{session_id}.json", "w") as f:
        json.dump(session, f)
    return {"id": session_id}


@app.post("/api/sessions/{session_id}/update")
async def update_session(session_id: str, request: Request):
    path = SESSIONS_DIR / f"{session_id}.json"
    if not path.exists():
        return {"error": "not found"}
    data = await request.json()
    with open(path) as f:
        session = json.load(f)
    session["follow_ups"] = data.get("follow_ups", session.get("follow_ups", []))
    with open(path, "w") as f:
        json.dump(session, f)
    return {"ok": True}


@app.get("/api/sessions")
async def list_sessions():
    sessions = []
    for p in sorted(SESSIONS_DIR.glob("*.json"), reverse=True):
        with open(p) as f:
            s = json.load(f)
        sessions.append({
            "id": s["id"],
            "topic": s["topic"],
            "agents": [a["name"] for a in s["agents"]],
            "created_at": s["created_at"],
        })
    return sessions


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    path = SESSIONS_DIR / f"{session_id}.json"
    if not path.exists():
        return {"error": "not found"}
    with open(path) as f:
        return json.load(f)


@app.post("/api/followup")
async def followup(request: Request):
    data = await request.json()
    agents = data["agents"]
    topic = data["topic"]
    transcript = data["transcript"]
    user_message = data["message"]
    follow_up_history = data.get("follow_up_history", [])
    model = data.get("model", "claude-sonnet-4-5-20250514")

    async def run_followup():
        # Build context from prior follow-ups
        prior_context = ""
        for fu in follow_up_history:
            prior_context += f"\nYou (user): {fu['user_message']}\n"
            for resp in fu.get("responses", []):
                prior_context += f"{resp['agent']}: {resp['text']}\n"

        for agent in agents:
            system = build_agent_system_prompt(
                agent["name"], agent["role"], agent.get("research", ""), topic
            )
            prompt = f"""Here is the full debate transcript that already took place:

{transcript}
{prior_context}
The user has now responded with a follow-up message directed at all participants:

"{user_message}"

Provide your brief take on what the user said (1-2 paragraphs). Stay in character. Respond directly to their point. Cite evidence where relevant."""

            response = await client.messages.create(
                model=model,
                max_tokens=1024,
                system=system,
                messages=[{"role": "user", "content": prompt}],
            )
            agent_text = response.content[0].text
            yield json.dumps({
                "type": "followup_response",
                "agent": agent["name"],
                "text": agent_text,
            }) + "\n"

        yield json.dumps({"type": "followup_complete"}) + "\n"

    return StreamingResponse(run_followup(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
