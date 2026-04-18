**Problem Statement** and a **Feature Roadmap** tailored for **SharePlan**.

This structure will serve as the ground truth for your AI agent, moving it from "abstract ideas" to "concrete engineering requirements."

---

## 1. Problem Statement: The "Manual Bottleneck"
*Repurposing Section 1 of the case study.*

Currently, SharePlan operates on a "High-Touch, Manual Data Entry" model. As the service grows, this creates three critical failure points:

* **P1: Fragmentation of Inquiry & Intent:** Customer inquiries (subscriptions, extensions, technical issues) are buried in Kakao chat logs. Searching for "Who asked for what" across multiple channels (SharePlan & SharePlan-dev) is a high-latency task, leading to missed sales opportunities.
* **P2: Data Integrity & Entry Fatigue:** Manual copying of account IDs, payment amounts, and subscription durations into a database/Excel is prone to human error (3–5% error rate). In a subscription model, one wrong digit in an email ID leads to a service failure.
* **P3: Hidden Business Intelligence:** Because data isn't structured in real-time, calculating "Churn Rate," "Most Popular Duration (6 vs 12 months)," or "Discount Efficiency (Senior/Family)" requires manual post-processing, making agile decision-making impossible.

---

## 2. Core Feature Implementation Plan
*Repurposing Section 2 (Solution Design) for your Technical Stack.*

To solve these, the AI agent must implement the following "Three Pillars of Automation":

### [Feature 1] Real-time Webhook Persistence (The Data Pipe)
* **Mechanism:** Connect the Kakao i Open Builder Skill to the `ocr-recsys-dev` container via the ngrok tunnel.
* **Function:** Automatically intercept every `userRequest` and pipe the JSON payload into a PostgreSQL `inquiry_logs` table.
* **Success Metric:** Zero manual "scrolling" required to see current user intents.

### [Feature 2] GPT-powered Intent & Entity Extraction (The Logic)
* **Mechanism:** A Node.js middleware within `marketing-automation` that sends the raw `utterance` to an LLM.
* **Function:** Extract specific fields from unstructured Korean text:
    * **Intent:** (NEW_JOIN, EXTENSION, TECH_SUPPORT, DISCOUNT_INQUIRY)
    * **Entities:** `service_type` (Youtube, Canva, etc.), `period` (6, 12), `email_id`.
* **Specific Handling:** Implement logic to detect "Senior/Family" context based on phrasing (e.g., "부모님 선물", "노안") to trigger the **Mutual Trust Discount** workflow.

### [Feature 3] Automated State & Dashboard Integration (The Interface)
* **Mechanism:** A "Service Manager" dashboard (or structured DB view).
* **Function:** Visualize the "Funnel" from inquiry to payment.
    * **Status Tracking:** Automatically mark a user as `WAITING_FOR_PAYMENT` once the GPT parser extracts valid order details.
    * **Notification:** Trigger an alert to the admin (you) only when a payment needs verification, removing the need to monitor the chat 24/7.

---

## 3. Order of Operations (The Agent's Roadmap)
*Repurposing Section 4 (Execution Guide).*

1.  **Phase: Identification & Port Mapping:** Confirm port 3000 visibility in Docker Desktop. (Targeting `ocr-recsys-dev`).
2.  **Phase: Baseline Data Schema:** Draft the PostgreSQL table schemas for `users`, `subscriptions`, and `chat_logs`.
3.  **Phase: Webhook "Hello World":** Confirm the ngrok -> Docker -> Node.js flow is returning a `200 OK` to Kakao.
4.  **Phase: Pilot Automation:** Implement the "12-month Special Discount" logic for a single test user to verify the "Mutual Trust" branch works correctly.

---

### Implementation Context for your AI Agent
When you prompt your AI to start the work, you can now say:

> "Base our implementation on the **SharePlan Problem Statement**. We are moving from manual Kakao management to an automated pipeline. Our first priority is **Feature 1**: Setting up the PostgreSQL log table and connecting the Webhook inside the `ocr-recsys-dev` container at port 3000. Refer to the **Order of Operations** for Phase 1."

Does this framing provide the concrete objectives you were looking for to ground your agent?

---


Since you are an AI Engineer focusing on **MLOps** and **document intelligence**, and your project lives in a **Next.js/TypeScript** stack with a **PostgreSQL** backend, there are some very high-leverage frameworks that fit your specific "SharePlan" automation plan.

---

## 1. Recommended Frameworks for the Job

To move away from "manual" and toward "agentic," these three layers are essential:

* **Logic Layer: LangChain (or LangGraph):**
    * **Why:** For your "GPT-powered Intent Extraction," LangChain handles the heavy lifting of prompt templates and output parsing (turning raw chat into structured JSON).
    * **Agentic Edge:** **LangGraph** is particularly good for the "subscription state machine" (e.g., if a user asks for a discount, the agent enters a "verification" state).
* **Database Layer: Prisma or Drizzle ORM:**
    * **Why:** Since you are using PostgreSQL and TypeScript, you need type-safety. **Drizzle** is currently favored in the Next.js community for its "SQL-like" feel and performance.
* **Automation/Task Layer: BullMQ or Inngest:**
    * **Why:** Subscription management involves **time**. You need a way to schedule a task to check if a user's 6-month period is over and automatically send a Kakao message. BullMQ handles these background jobs perfectly.

---

## 2. Practical Use Cases for Copilot Kit

**Copilot Kit** is essentially a framework for building "AI-native" user interfaces. For SharePlan, it's the bridge between your **PostgreSQL data** and **Actionable AI**.

Here are the most obvious and practical features for your implementation:

### A. The "Smart" Subscription Dashboard (`CopilotReadable`)
Instead of you manually looking for "who is due for a renewal," you can make your internal dashboard "readable" to the AI.
* **Feature:** Use `useCopilotReadable` to feed your subscription table data into the Copilot.
* **Benefit:** You can ask the chat sidebar: *"Who in the 12-month tier is expiring this week?"* or *"Summarize the most common issues from today's Kakao logs."*

### B. Bulk Messaging & Actions (`CopilotAction`)
This is where the "Automation" really hits. You can define actions that the AI can execute on your behalf.
* **Feature:** Define a `CopilotAction` called `sendRenewalNotice`.
* **Benefit:** You can tell the AI: *"Send the '12-month special discount' offer to all users who mentioned 'parents' or 'eyesight' in their logs today."* The AI will then call your Kakao API backend for each user.

### C. The "Co-Authoring" CS Response
Since you want to maintain your "natural style" but be professional:
* **Feature:** Use `useCopilotChat` to draft responses.
* **Benefit:** When a user has a complex "double padding" or "country mismatch" error (like in your screenshots), the Copilot can draft the technical explanation based on your past successful fixes stored in the DB.

---

## 3. The "Agentic" Skeleton (Putting it together)

1.  **Ingestion:** Kakao Webhook → `ocr-recsys-dev` (Node.js) → PostgreSQL.
2.  **Intelligence:** LangChain parses the intent (e.g., "Senior Discount Inquiry").
3.  **Interface:** You open your **Next.js Dashboard**.
4.  **Interaction:** **Copilot Kit** sees the new inquiry. It suggests: *"I found a new senior discount inquiry. Based on the 36pt font in their screenshot, should I apply the 30,000 KRW special price?"*
5.  **Action:** You click "Yes" (or tell the AI to do it), and it triggers the automated Kakao response.



### Pro-Tip for `ocr-recsys-dev`
Since your container is already named "OCR," you can eventually use **Tesseract** or **LayoutLM** within this same stack to automatically scan the screenshots users send (like the "Country Mismatch" error) and have the AI diagnose the problem before you even open the chat.

Would you like to start by defining a `CopilotAction` for your subscription renewal logic, or should we look at the **Prisma/Drizzle** schema first to support this?
