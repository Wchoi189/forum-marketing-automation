## Conversation Snippet which discusses recommended frameworks and Copilot integration opportunities. Some suggestions may already be implemented.

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


Let’s get the foundation right. Since your goal is to move from manual coordination to an "AI-First" agentic workflow, starting with the **Data Schema** and the **Copilot Action** is the most logical path. This allows your AI agent to have a "body" (the database) and "hands" (the actions).

---

## 1. The Database Skeleton (Drizzle/PostgreSQL)
For a subscription business like **SharePlan**, the schema needs to handle "State" (where the user is in the funnel) and "Identity" (linking Kakao IDs to emails).

```typescript
// schema.ts
import { pgTable, serial, text, integer, timestamp, varchar } from 'drizzle-orm/pg-core';

export const inquiries = pgTable('inquiries', {
  id: serial('id').primaryKey(),
  kakaoUserId: varchar('kakao_user_id', { length: 255 }).notNull(),
  rawUtterance: text('raw_utterance').notNull(),
  intent: varchar('intent', { length: 50 }), // e.g., 'NEW_SUBSCRIPTION', 'TECH_SUPPORT'
  extractedEmail: varchar('extracted_email', { length: 255 }),
  fontStatus: varchar('font_status', { length: 50 }), // e.g., 'LARGE_FONT_DETECTED'
  status: varchar('status', { length: 20 }).default('PENDING'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => inquiries.id),
  serviceType: varchar('service_type', { length: 50 }), // YouTube, Coursera
  durationMonths: integer('duration_months'),
  pricePaid: integer('price_paid'),
  startDate: timestamp('start_date'),
  endDate: timestamp('end_date'),
});
```


---

## 2. Integrating Copilot Kit
This is where it gets practical. Instead of writing a standard "Admin UI," you build a **Co-pilotable Dashboard**.

### A. Making the data "Readable"
You tell the Copilot what it's looking at so it can answer your questions about the business.
```typescript
import { useCopilotReadable } from "@copilotkit/react-core";

// Inside your Subscription Dashboard Component
const { data: allSubscriptions } = useSubscriptions();

useCopilotReadable({
  description: "A list of current active subscriptions including end dates and user types.",
  value: allSubscriptions,
});
```

### B. Creating the "Action" (The Automated Response)
This is the most "obvious" feature. You define an action that lets the AI send your **Mutual Trust Discount** message through your Kakao backend.

```typescript
import { useCopilotAction } from "@copilotkit/react-core";

useCopilotAction({
  name: "applySpecialDiscountAndNotify",
  description: "Applies the 30k KRW special price and sends a Kakao notification to the user.",
  parameters: [
    { name: "kakaoUserId", type: "string", description: "The ID of the user to notify." },
    { name: "discountReason", type: "string", description: "Why the discount is being applied (e.g., Senior support)." }
  ],
  handler: async ({ kakaoUserId, discountReason }) => {
    // 1. Update DB to reflect 30,000 KRW price
    // 2. Trigger your Node.js/Kakao API sender
    console.log(`Applying discount for ${kakaoUserId} due to ${discountReason}`);
    await sendKakaoMessage(kakaoUserId, "특별 할인이 적용되었습니다. 12개월 3만원에 이용 가능합니다.");
  },
});
```

---

## 3. Order of Operations for your Agent
If you are grounding your AI agent now to start building, give it this **Step-by-Step implementation guide**:

1.  **Infrastructure Sync:** Confirm the `ocr-recsys-dev` container can talk to the PostgreSQL instance.
2.  **Schema Migration:** Deploy the `inquiries` and `subscriptions` tables.
3.  **Webhook Ingestion:** Write the Express route in `marketing-automation` that `INSERT`s every Kakao message into the `inquiries` table.
4.  **LLM Enrichment:** Add a background worker that takes "PENDING" inquiries, runs them through GPT-4o to extract the `intent` and `fontStatus`, and updates the row.
5.  **Copilot UI:** Build a simple Next.js page that displays these rows and add the `applySpecialDiscount` action.



### Why this is perfect for your situation:
* **Scannability:** You can look at your dashboard and just see the "Large Font" tag the AI applied.
* **Natural Style:** You can tell the Copilot, *"Draft a message for this user about their country mismatch error, but keep it in my usual casual-but-polite style."*

Does this "Next.js + Drizzle + Copilot Kit" stack feel like the right level of complexity for your current dev environment?



To effectively bridge the gap between your **`ocr-recsys-dev`** backend and your **Next.js** frontend, you should view Copilot Kit as a "Contextual Glue."

In an agentic workflow for **SharePlan**, integration happens at four distinct levels. Here is the technical breakdown of how to map these points to your specific business logic.

---

### 1. The Knowledge Point (`useCopilotReadable`)
This is how your AI agent "sees" the state of your business without you having to explain it every time.

* **Business Context:** Feeding the AI the active Kakao chat logs, pending payments, or subscription tiers.
* **Implementation:** You wrap your data fetching logic in this hook.
* **Practical Example:** * *Input:* The last 10 messages from a specific Kakao user.
    * *AI Knowledge:* The AI now "knows" that User A is frustrated with a "Country Mismatch" error and hasn't paid yet. It doesn't need to ask you for the history.

### 2. The Command Point (`useCopilotAction`)
This is the most critical integration point for **SharePlan**. It allows the AI to move from "talking" to "doing."

* **Business Context:** Transitioning a user from "Inquiry" to "Active" or triggering a custom discount.
* **Practical Use Cases:**
    * **`updateSubscriptionStatus`**: Updates the PostgreSQL DB when you or the AI confirms a payment.
    * **`sendKakaoInvite`**: Calls your Node.js backend to trigger a Google Family invitation link.
    * **`applyTrustDiscount`**: A specialized action that overrides the standard 50,000 KRW price to 30,000 KRW based on "Mutual Trust" criteria (like identifying the large font).

### 3. The Interface Point (`CopilotSidebar` / `CopilotChat`)
This is where the agent "lives" inside your admin dashboard.

* **The "Co-Pilot" Role:** Instead of a standalone chatbot, the Sidebar sits next to your list of subscribers.
* **Contextual Interaction:** Because it’s integrated, you can select a specific user row in your Next.js table and say to the Sidebar: *"Draft a renewal notice for this person in my natural style."* * **Multi-Modal integration:** Since your container is `ocr-recsys-dev`, you can integrate a feature where you drag a user's screenshot into the chat, and the agent uses your OCR logic to diagnose the error code.

### 4. The Runtime Point (`CopilotRuntime`)
This is the server-side integration point (the "Brain"). Since you are using a Dockerized environment, this is where the `ocr-recsys-dev` container shines.

* **Backend Routing:** The Runtime connects your frontend actions to the LLM (GPT-4o or Claude).
* **Agentic Orchestration:** If a task is too complex for one prompt (e.g., *"Find all users whose names match this payment list and activate them"*), the Runtime manages the "loops" required to finish the job.

---

### A Concrete Example: The "Senior Support" Workflow
Here is how these integration points work together in a real-life SharePlan scenario:

1.  **Detection:** A new message arrives in the `inquiries` table.
2.  **Readability:** `useCopilotReadable` syncs this new row to the dashboard.
3.  **Suggestion:** The Copilot Sidebar pops up: *"User '정주현' sent a screenshot with 36pt font. This likely qualifies for the Mutual Trust discount. Should I draft an offer?"*
4.  **Action:** You click "Approve."
5.  **Execution:** `useCopilotAction` triggers the `sendKakaoMessage` function in your `marketing-automation` project, sending the Korean text we refined earlier.

---

### Which point should you start with?
The **most obvious and immediate value** for you is **`useCopilotAction`**.

By defining your manual tasks (Sending invites, applying discounts, updating DB) as "Actions," you effectively give your AI Agent a "API" to control your business. Even if you don't automate the *decision* yet, being able to say *"Agent, activate this user"* is a massive productivity boost.

**Would you like to try writing a `CopilotAction` specifically for handling the "Country Mismatch" error resolution?** It's a great way to codify your technical knowledge so the agent can handle it next time.
