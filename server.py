"""Mind Parliament - Multi-Agent Debate Server"""

import json
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from anthropic import AsyncAnthropic

BASE_DIR = Path(__file__).resolve().parent

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
    return f"""You have just observed a full parliamentary debate in the Mind Parliament. Your task is to produce the final consensus deliberation.

TOPIC: {topic}

PARTICIPANTS:
{agents_text}

FULL DEBATE TRANSCRIPT:
{transcript}

Produce a comprehensive final deliberation that:

1. **Core Question**: Restate what was being debated and why it matters.

2. **Key Positions**: Summarize each agent's core position and their strongest arguments. Note which arguments were most compelling and why.

3. **Critical Tensions**: Identify the fundamental disagreements that emerged. Where do the perspectives genuinely conflict, and where were apparent disagreements actually about different things?

4. **Points of Convergence**: Where did agents agree, either explicitly or implicitly? What shared assumptions or conclusions emerged?

5. **Synthesis / Consensus Position**: Provide the most well-reasoned answer to the original question that holds the tensions of the different perspectives. This should not be a wishy-washy "both sides have points" - take a substantive position that integrates the strongest insights from the debate. If genuine consensus is impossible, explain exactly why and what the irreducible disagreements are.

6. **Key Takeaways**: The 3-5 most important insights or conclusions from the debate that the reader should walk away with.

Be information-dense. Every sentence should carry weight. Cite specific arguments and moments from the debate."""


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
        consensus_text = response.content[0].text

        yield json.dumps({
            "type": "consensus_complete",
            "consensus": consensus_text,
        }) + "\n"

    return StreamingResponse(stream_consensus(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
