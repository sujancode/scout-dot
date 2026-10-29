# Scout (a market-research dot)

A dot you talk to about companies and stocks. Its **front** answers by voice, chat, in a Google
Meet or through the API: a quick question (a price now) it answers itself; research it gives to
its **work session**, which runs it as a task, one at a time, and writes what it found.

| Skill | Input | It… | Writes |
|---|---|---|---|
| `research_company` | `company`, `focus?` | reads the stock's numbers, two weeks of news, what the web and Hacker News say | `brief.md`: summary, numbers, stories, what people say, risks, sources |
| `compare_companies` | `companies` (2–5, comma-separated) | the numbers and a week of news for each | `comparison.csv`: one row a company |

Its sources are its own tools (`tools/index.ts`), each a `fetch` to a real API with a key from the
environment's variables: never in the code, never in the deployment.

| Tool | API | Key |
|---|---|---|
| `stock_snapshot`, `company_news` (each takes a name or a ticker) | [Finnhub](https://finnhub.io/register) (free: 60 calls a minute, US stocks) | `FINNHUB_KEY` |
| `web_search` | [Tavily](https://app.tavily.com) (free: 1 000 searches a month) | `TAVILY_KEY` |
| `hn_mentions` | Hacker News search (Algolia) | none |

## From GitHub

On the dashboard, start a dot from this repository: Harnesses → Scout → Use this. Then, in the
dot's **Secrets**, add `FINNHUB_KEY` and `TAVILY_KEY` to each environment you talk to (test
first), and open **Test**: they reach the conversations and tasks started after that.

## Run it from your machine

```bash
cd sdk/examples/scout-dot
export VOICEAGENT_KEY=va_test_…
node ../../bin/voiceagent.mjs deploy                                  # to test
echo "$FINNHUB_KEY" | node ../../bin/voiceagent.mjs vars set FINNHUB_KEY
echo "$TAVILY_KEY" | node ../../bin/voiceagent.mjs vars set TAVILY_KEY
node ../../bin/voiceagent.mjs task run research_company company=Nvidia --wait
node ../../bin/voiceagent.mjs session                                 # what it is doing now
```

Or talk to it (the link the deploy prints, or Test on the dashboard):

- "What's Nvidia trading at?": it looks it up there and then.
- "Dig into Nvidia for me, especially the data-centre business.": it starts `research_company`;
  the dot's Session and Live pages show each step as it goes.
- "How's it going?": what it has found so far.
- Once it is done: "What's the biggest risk?", "Where did that number come from?": from its brief.
- "Now compare it with AMD and Intel.": a second task, a table.

It gives research, not financial advice.
