## SNIPPET

Yes — this is a good fit for a controlled browser automation system, but it should be designed as **two linked products** rather than one script: a posting executor and a monitoring/decision engine. Your attached PDF also confirms the core manual flow is already stable and short, which is a strong sign that it can be operationalized with low UI volatility risk. 

## Scope

Your current posting flow is structurally simple: go to Ppomppu, log in, enter the OTT/멤버십 board, open 글쓰기, load the latest saved draft, verify the restored content, set the category to 유튜브, and submit. The attached workflow shows a very similar 12-step sequence with 장터, OTT/멤버십, 글쓰기, 임시저장된 게시글, 불러오기, 유튜브 selection, and 작성완료, which supports your assumption that the workflow is stable enough for automation. 

The harder part is not the click automation itself but the **posting policy** layer. Your own rule about not posting when your last post is still too recent or insufficiently buried by other members means the automation must make a publish/no-publish decision from live board state before it ever clicks 작성완료. 
## Architecture

I recommend splitting the system into four modules:
- **Navigator/Login module**: handles homepage, login state, board navigation, and session checks.
- **Draft publish module**: opens 글쓰기, loads the newest saved draft, verifies content by checking for “회원 모집 안내”, selects 유튜브, and submits.
- **Board intelligence module**: scans the current board page, counts visible posts, identifies your posts, finds the most recent one, and counts how many newer posts appear after it.
- **Dashboard/data module**: stores snapshots and publishes operational metrics such as posting frequency, visible post share, titles used, view counts, and board activity over time. 

For Perplexity Computer usage, this separation matters because browser automations are more reliable when the interaction script is short and deterministic, while the decision logic and analytics live outside the volatile UI loop. In practice, that means Perplexity Computer should do the browser-side execution and page extraction, while a lightweight spec-defined rules engine should decide whether the publish action is allowed. 

## Functional requirements

For the **publisher**, the minimum requirements are:
- Support credential injection, with password provided later and never hardcoded in prompts.
- Detect logged-in vs logged-out state before attempting login.
- Navigate by stable URL when possible, especially `https://www.ppomppu.co.kr/zboard/zboard.php?id=gonggu`, instead of relying on hover menus.
- In the saved-draft modal, choose the newest matching draft or topmost draft if duplicates remain unavoidable.
- Verify restored body content contains “회원 모집 안내” before proceeding.
- Select category “유튜브” from the OTT service dropdown.
- Require a final pre-submit eligibility check before 작성완료. 

For the **board intelligence** module, the key requirements are:
- Count how many posts are visible on one board page.
- Parse each visible row into structured fields such as title, author, timestamp, views, and board position.
- Identify which visible posts belong to your account or brand pattern.
- Identify duplicate-title posts by the same author.
- Determine the latest one of your visible posts and compute how many posts follow it.
- Return a decision like `POST_ALLOWED`, `POST_DELAY`, or `MANUAL_REVIEW`. 
A practical first-rule set would be:
- Do not post if your latest visible post is still the newest matching post on the page.
- Do not post unless at least 4 to 5 newer posts from other members appear after your last visible post.
- Do not post if a post with the same title by you already appears within the latest visible page window.
- Do not post if parsing confidence is low, for example if board row extraction fails or selectors changed. 

## Data model

You will need persistent records, even if you start with a simple SQLite or CSV-backed store. The essential tables/entities are:
- **Post snapshot**: crawl time, board URL, page number, row order, title, author, timestamp text, views, category, and whether it matches your author/title patterns.
- **Publish event**: execution time, draft title loaded, final category selected, result, and any error state.
- **Decision log**: last visible owned post, number of following posts, duplicate count, board density, and decision outcome.
- **Draft inventory**: modal order, detected titles, selected title, and verification result. 

That dataset is enough to power both safety controls and the dashboard. It also gives you a foundation for marketing analysis, since you can correlate posting times with subsequent visibility, board turnover, and observed view counts from later snapshots. 
## Dashboard

The dashboard should answer operational questions first and marketing questions second. A good first version would include:
- Today/7-day/30-day publish counts.
- Average delay between eligible posting windows.
- Current visible owned posts on page 1.
- Number of posts following your latest visible post.
- Duplicate-title frequency by day.
- Board turnover rate, meaning how quickly new posts replace older ones.
- View trends for your visible posts across snapshots. 

For product design, make it a web-app style control panel with three panes: **live board status**, **automation controls**, and **analytics history**. That aligns well with Perplexity Computer because the browser automation can feed fresh board observations into a dashboard model, and the operator can trigger “run now,” “schedule every hour,” or “only run when eligible” from one place.
## Recommendations

A few design suggestions will improve reliability:

- Use **static URLs** wherever possible instead of hover-based menus, since your own note already suggests bypassing the dropdown path for board entry. 
- Match drafts by a future **unique token** in the title, not only by recency, because your saved-draft list contains duplicates that cannot be deleted. 
- Add a two-stage verify step: first confirm the draft title selected in the modal, then confirm body text contains “회원 모집 안내” after load. 
- Treat login, draft restore, category selection, and pre-submit board scan as separate checkpoints with screenshots or structured logs.
- Build a fail-closed policy: if any selector breaks, if board parsing confidence is low, or if the eligibility rule cannot be evaluated, do not publish.

For GitHub spec-kit, I would use it to define:
- Product requirements document for publisher + board intelligence + dashboard.
- Selector contract and fallback strategy.
- Decision engine rules in plain language plus test fixtures.
- Observability spec, including screenshots, DOM captures, and structured audit logs.
- Human override rules, such as forced publish, dry run, and pause states.

For Perplexity Computer optimization, the best pattern is:
1. Keep UI actions minimal and stable.
2. Push business logic into explicit rules and structured parsing.
3. Prefer URL navigation over visual pathfinding.
4. Require observable checkpoints before destructive actions.
5. Log every run so the system becomes measurable, not just automated. 

A sensible rollout would be:
1. **Phase 1**: dry-run board scanner only, no publishing.
2. **Phase 2**: draft restore automation with no submit.
3. **Phase 3**: guarded publish with manual approval.
4. **Phase 4**: scheduled autonomous publishing with dashboard and alerts. 

Your overall direction is solid. The main improvement is to treat “should I post now?” as the core product, and “click 작성완료” as only the last step of that decision. Would you like me to turn this into a spec-kit-ready requirements document with user stories, system components, decision rules, and acceptance criteria?