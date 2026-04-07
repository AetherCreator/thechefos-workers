# The Hunter — Demand Signal Hunting Prompt
Version: 1.0.0
Purpose: Template for Locke Lamora's active hunting via SearXNG + Agent-Reach + Gemini Flash
Used by: Foundry heartbeat (weekly) or manual /hunt trigger

---

## Hunting Strategy (3-phase)

### Phase 1: Cast the Net (SearXNG)

Search queries rotate through pain-signal patterns:

```python
HUNT_QUERIES = [
    # Direct pain signals
    'site:reddit.com "I wish there was" tool app',
    'site:reddit.com "I spend hours" manual workflow',
    'site:reddit.com "there has to be a better way"',
    'site:news.ycombinator.com "Show HN" AND ("looking for feedback" OR "weekend project")',
    
    # Competition signals
    'site:reddit.com "{competitor}" AND ("alternative" OR "sucks" OR "too expensive")',
    'site:reddit.com "switched from" AND "because"',
    
    # Niche-specific (rotated from seed domains)
    '{seed_domain} AND ("spreadsheet hell" OR "manual process" OR "time consuming")',
    '{seed_domain} AND ("wish" OR "need" OR "looking for") AND "tool"',
    
    # Indie builder chatter
    'site:reddit.com/r/SaaS "validated" OR "first paying customer"',
    'site:reddit.com/r/indiehackers "revenue" AND "solo"',
]
```

Return top 10 results per query. Deduplicate by URL.

### Phase 2: Read the Room (Agent-Reach)

For each promising thread (>5 comments, emotional language detected):

```
Agent-Reach action: extract_reddit_thread
Input: {thread_url}
Extract:
  - Original post (full text)
  - Top 10 comments sorted by upvotes
  - Comment sentiment distribution
  - Any mentioned tools/products (both positive and negative)
  - Specific dollar amounts or time costs mentioned
```

### Phase 3: Profile the Mark (Gemini Flash)

**System Prompt:**
```
You are a demand signal analyst. You receive raw forum threads and extract structured product opportunity data.

Rules:
- Focus on PAIN, not features. What is the person suffering from?
- Profile WHO is hurting (role, industry, budget signals)
- Identify existing solutions and WHY they fail
- Estimate willingness to pay based on context clues
- Be brutally honest about signal strength. One person complaining ≠ a market.
- Flag Long Con patterns: same pain appearing across different communities
```

**User Prompt:**
```
Analyze these threads for product demand signals:

{THREAD_DATA}

For each potential opportunity, return JSON:
{
  "lead_id": "slug-name",
  "source_threads": ["url1", "url2"],
  "mark_profile": "Who is hurting and how much money they have",
  "pain_statement": "What they're doing manually or poorly",
  "pain_frequency": "daily|weekly|monthly|once",
  "pain_intensity": "annoying|painful|critical",
  "existing_solutions": [{"name": "X", "weakness": "why it fails"}],
  "angle": "What a simple product would look like",
  "estimated_price": "$X/mo",
  "market_size_signal": "niche|solid|large",
  "confidence": "low|medium|high",
  "pattern_type": "single_signal|repeated|long_con",
  "thread_count": N,
  "total_upvotes": N,
  "locke_notes": "Your one-sentence take in Locke Lamora's voice"
}

Only return leads with confidence >= medium. 
Discard: feature requests for existing products, complaints without spending power, already-crowded markets with clear winners.
```

## Locke's Brief Generation

After hunting, compose a Telegram brief using the Lamora voice:

```
You are Locke Lamora reporting to Tyler. Write a brief about tonight's hunting.

SOUL: {load LOCKE-LAMORA-SOUL.md}

LEADS FOUND: {JSON array of leads}

Format: Use the briefing format from your SOUL.md.
Tone: Witty, confident, narrative. Not bullet points. Stories.
Sign off: — L

If no leads found: Report honestly with personality. "Worked four taverns. Slim pickings."
```

## Hunt Schedule

- **Weekly automated:** Every Sunday at midnight (catch weekend hobby-builders and Monday-morning complainers)
- **Manual trigger:** Tyler sends `/hunt` to @LockeLamoraBot
- **Seed refresh:** Every 2 weeks, check if hunt queries need new seed domains from Librarian wiki

## Anti-Spam Rules

- Never hunt the same subreddit twice in one session
- Deduplicate leads against existing leads in `leads/` directory
- Max 5 leads per hunt (quality over quantity)
- If confidence < medium after Phase 3 analysis, discard
