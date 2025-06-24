# 🤖 Chat Agent Starter Kit

![agents-header](https://github.com/user-attachments/assets/f6d99eeb-1803-4495-9c5e-3cf07a37b402)

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/agents-starter"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"/></a>

## Quick Start

1. Create a new project:

```bash
npm create cloudflare@latest -- --template cloudflare/agents-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up your environment:

Create a `.dev.vars` file:

```env
# Cloudflare API Configuration
CLOUDFLARE_API_TOKEN="your_cloudflare_api_token_here"
CLOUDFLARE_ZONE_ID="your_cloudflare_zone_id_here"
CLOUDFLARE_RULESET_ID="your_cloudflare_ruleset_id_here"

# Google Chat Webhook Configuration
GOOGLE_CHAT_WEBHOOK_URL="your_google_chat_webhook_url_here"
```

4. Deploy secrets to Cloudflare:

```bash
wrangler secret bulk .dev.vars
```

5. Run locally:

```bash
npm start
```

6. Deploy:

```bash
npm run deploy
```

## Available Tools

The following tools are available in this chat agent:

- **getWeatherInformation** - Get current weather information for a specified city (requires confirmation)
- **getLocalTime** - Get the local time for a specified location
- **generateImage** - Generate an image from a text description using Cloudflare Workers AI
- **searchPokemon** - Search for Pokémon details by name or ID using the PokeAPI
- **sendWebhook** - Send a message to a configured webhook URL
- **callDoWorker** - Call the do-worker Cloudflare Worker and return its response
- **callgraphqlWorker** - Call the graphql worker to get total user agent information
- **addCloudflareCustomRule** - Create and add custom rules to Cloudflare using the API

## Adding New Tools

Add new tools in `tools.ts` using the tool builder:

```typescript
// Example of a tool that requires confirmation
const searchDatabase = tool({
  description: "Search the database for user records",
  parameters: z.object({
    query: z.string(),
    limit: z.number().optional(),
  }),
  // No execute function = requires confirmation
});

// Example of an auto-executing tool
const getCurrentTime = tool({
  description: "Get current server time",
  parameters: z.object({}),
  execute: async () => new Date().toISOString(),
});

// Scheduling tool implementation
const scheduleTask = tool({
  description:
    "schedule a task to be executed at a later time. 'when' can be a date, a delay in seconds, or a cron pattern.",
  parameters: z.object({
    type: z.enum(["scheduled", "delayed", "cron"]),
    when: z.union([z.number(), z.string()]),
    payload: z.string(),
  }),
  execute: async ({ type, when, payload }) => {
    // ... see the implementation in tools.ts
  },
});
```

To handle tool confirmations, add execution functions to the `executions` object:

```typescript
export const executions = {
  searchDatabase: async ({
    query,
    limit,
  }: {
    query: string;
    limit?: number;
  }) => {
    // Implementation for when the tool is confirmed
    const results = await db.search(query, limit);
    return results;
  },
  // Add more execution handlers for other tools that require confirmation
};
```

Tools can be configured in two ways:

1. With an `execute` function for automatic execution
2. Without an `execute` function, requiring confirmation and using the `executions` object to handle the confirmed action
