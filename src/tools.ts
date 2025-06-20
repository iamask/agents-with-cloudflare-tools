/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool } from "ai";
import { z } from "zod";

import type { Chat } from "./server";
import { getCurrentAgent } from "agents";

/**
 * Weather information tool that requires human confirmation
 * When invoked, this will present a confirmation dialog to the user
 * The actual implementation is in the executions object below
 */
const getWeatherInformation = tool({
  description:
    "Get the current weather information for a specified city. Use this tool when a user asks about the weather in a particular location.",
  parameters: z.object({
    city: z
      .string()
      .describe("The name of the city to get weather information for"),
  }),
  // Omitting execute function makes this tool require human confirmation
});

/**
 * Local time tool that executes automatically
 * Since it includes an execute function, it will run without user confirmation
 * This is suitable for low-risk operations that don't need oversight
 */
const getLocalTime = tool({
  description:
    "Get the local time for a specified location. ONLY use this tool when a user EXPLICITLY asks what time it is in a particular city or place.",
  parameters: z.object({
    location: z
      .string()
      .describe("The name of the location to get the local time for"),
  }),
  execute: async ({ location }) => {
    console.log(`Getting local time for ${location}`);
    // For demonstration purposes, returning a fixed time
    // In a real app, you would calculate the actual time for the location
    const now = new Date();
    return `The current local time in ${location} is approximately ${now.toLocaleTimeString()} (note: this is a simulated response for demo purposes).`;
  },
});

const generateImage = tool({
  description:
    "Generate an image from a text description using Cloudflare Workers AI. Use this when a user asks for an image to be created.",
  parameters: z.object({
    prompt: z
      .string()
      .min(1)
      .max(2048)
      .describe("A text description of the image you want to generate"),
    steps: z.coerce
      .number()
      .min(1)
      .max(8)
      .optional()
      .default(4)
      .describe(
        "Number of diffusion steps (1-8). Higher values can improve quality but take longer"
      ),
  }),
  execute: async ({ prompt, steps }) => {
    try {
      // Ensure steps is a number
      const numSteps =
        typeof steps === "string" ? parseInt(steps, 10) : steps || 4;
      const validSteps = Math.min(Math.max(numSteps, 1), 8); // Clamp between 1-8

      console.log(
        "[Image Generation] Starting with prompt:",
        prompt,
        "steps:",
        validSteps
      );

      // Get the agent from the current context
      const { agent } = getCurrentAgent<Chat>();
      if (!agent) {
        console.error("[Image Generation] No agent found in context");
        throw new Error("No agent found");
      }

      console.log("[Image Generation] Agent context found, calling AI.run...");

      // Access AI binding through the environment
      // Cast to any to avoid TypeScript errors with protected properties
      const aiBinding = (agent as any).env.AI;
      const response = await aiBinding.run(
        "@cf/black-forest-labs/flux-1-schnell",
        {
          prompt,
          steps: validSteps,
        },
        {
          gateway: {
            id: "agents",
            skipCache: false,
            cacheTtl: 3360,
            metadata: {
              application: "openai-wrapper",
              user: "aj",
              dev: true,
            },
          },
        }
      );

      // console.log("[Image Generation] AI.run response received:", {
      //   hasImage: !!response?.image,
      //   responseKeys: Object.keys(response || {}),
      //   responseType: typeof response,
      //   imageType: response?.image ? typeof response.image : "undefined",
      //   imageLength: response?.image ? response.image.length : 0,
      //   firstFewChars: response?.image
      //     ? response.image.substring(0, 50) + "..."
      //     : "none",
      // });

      if (!response?.image) {
        console.error("[Image Generation] No image in response:", response);
        throw new Error("No image generated in response");
      }

      // Generate a unique filename using timestamp and random string
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 8);
      const filename = `${timestamp}-${randomString}.jpg`;
      const key = `ai-generated/${filename}`;

      // Convert base64 to ArrayBuffer
      const base64Data = response.image;
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Save to R2
      console.log("[Image Generation] Saving image to R2");
      // Cast to any to access env and PUBLIC_BUCKET
      const publicBucket = (agent as any).env.PUBLIC_BUCKET;
      await publicBucket.put(key, bytes, {
        httpMetadata: {
          contentType: "image/jpeg",
          cacheControl: "public, max-age=31536000",
        },
      });

      // Generate public URL
      const publicUrl = `https://r2.zxc.co.in/${key}`;
      console.log("[Image Generation] Image saved successfully:", {
        publicUrl,
      });

      // Return a simple string result to avoid AI model reinterpreting the output
      return `I've generated an image based on your prompt "${prompt}". View it here: ${publicUrl}`;
    } catch (error) {
      console.error("[Image Generation] Error:", error);
      return `Failed to generate image. Error: ${error}`;
    }
  },
});

const searchPokemon = tool({
  description:
    "Search for Pokémon details by name or ID using the public PokeAPI. Returns summary info including name, id, height, weight, types, abilities, and a sprite image.",
  parameters: z.object({
    nameOrId: z
      .string()
      .min(1)
      .describe(
        "The name or ID of the Pokémon to search for, e.g. 'ditto' or '25'."
      ),
  }),
  execute: async ({ nameOrId }) => {
    try {
      const url = `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(nameOrId)}`;
      const res = await fetch(url);
      if (!res.ok) {
        return `No Pokémon found for '${nameOrId}'. (Status: ${res.status})`;
      }
      const data: any = await res.json();
      const name = data.name;
      const id = data.id;
      const height = data.height;
      const weight = data.weight;
      const types =
        data.types?.map((t: any) => t.type.name).join(", ") || "N/A";
      const abilities =
        data.abilities?.map((a: any) => a.ability.name).join(", ") || "N/A";
      const sprite = data.sprites?.front_default;
      let result = `Pokémon: ${name} (ID: ${id})\nHeight: ${height}\nWeight: ${weight}\nTypes: ${types}\nAbilities: ${abilities}`;
      if (sprite) {
        result += `\nSprite: ${sprite}`;
      }
      return result;
    } catch (error) {
      return `Error fetching Pokémon details: ${error}`;
    }
  },
});

const sendWebhook = tool({
  description: "send a message to the webhook",
  parameters: z.object({ message: z.string() }),
  execute: async ({ message }) => {
    // Use environment variable instead of hardcoded URL
    const hookurl = process.env.GOOGLE_CHAT_WEBHOOK_URL || "";
    try {
      console.log("Preparing to send webhook message:", message);

      const payload = JSON.stringify({ text: message });
      console.log("Payload:", payload);

      const response = await fetch(hookurl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: payload,
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `HTTP error! status: ${response.status}, body: ${responseText}`
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `Message successfully sent to the webhook.`,
          },
        ],
      };
    } catch (error) {
      console.error("Error sending webhook:", error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to send message to the webhook. Error: ${error}`,
          },
        ],
      };
    }
  },
});

const callDoWorker = tool({
  description:
    "Call the do-worker Cloudflare Worker return its response. Use this to get a hello world message from the do-worker.",
  parameters: z.object({ message: z.string() }), // No parameters needed for hello world
  execute: async ({ message }) => {
    console.log("Calling do-worker with message:", message);
    try {
      const { agent } = getCurrentAgent<Chat>();
      if (!agent) {
        throw new Error("No agent found");
      }
      // Access the WORKER binding from the environment
      const workerBinding = (agent as any).env.WORKER;
      if (!workerBinding) {
        throw new Error("WORKER binding not found in environment");
      }
      let newRequest = new Request("https://valid-url.com/object/test", {
        method: "GET",
      });
      // Use HTTP service binding to call /hello on do-worker
      const response = await workerBinding.fetch(newRequest);
      const text = await response.text();
      return text;
    } catch (error) {
      return `Failed to call do-worker via HTTP service binding: ${error}`;
    }
  },
});

const callgraphqlWorker = tool({
  description:
    "Call the Cloudflare Worker return its response. Use this to get total user agent from graphql api.",
  parameters: z.object({ message: z.string() }), // No parameters needed for hello world
  execute: async ({ message }) => {
    console.log("Calling worker with message:", message);
    try {
      const { agent } = getCurrentAgent<Chat>();
      if (!agent) {
        throw new Error("No agent found");
      }
      // Access the WORKER binding from the environment
      const workerBinding = (agent as any).env.WORKER_ORIGIN;
      if (!workerBinding) {
        throw new Error("WORKER binding not found in environment");
      }
      let newRequest = new Request("https://valid-url.com/object/test", {
        method: "GET",
      });
      // Use HTTP service binding to call /hello on do-worker
      const response = await workerBinding.fetch(newRequest);
      const text = await response.text();
      return text;
    } catch (error) {
      return `Failed to call origin error worker via HTTP service binding: ${error}`;
    }
  },
});

const CLOUDFLARE_ZONE_ID =
  process.env.CLOUDFLARE_ZONE_ID || "a37b5b3eca17274d2ca0cbc97a950636";
const CLOUDFLARE_RULESET_ID =
  process.env.CLOUDFLARE_RULESET_ID || "f252f8e1e67e42db970584d5e67b9c59"; // TODO: Replace with actual ruleset ID

const addCloudflareCustomRule = tool({
  description: `
You are an AI agent for creating Cloudflare custom rules, interacting with the Cloudflare API to add rules to the pre-configured ruleset (Zone ID: ${process.env.CLOUDFLARE_ZONE_ID || "bcbaeaa288da7324b61d91b0e41adc90"}, Ruleset ID: ${process.env.CLOUDFLARE_RULESET_ID || "ab811bb77a694282bc7252073c972f83"}).

**Knowledge:** Cloudflare rules evaluate conditions against HTTP requests using fields, values, and operators, structured with parentheses.

**Values:** Strings (quoted/raw), booleans, arrays/maps (from fields), lists (named $list_name, inline {}).

**Operators:**
- Comparison: eq, ne, lt, gt, contains (case-sensitive string), wildcard (case-insensitive string, * matches zero or more), strict wildcard (case-sensitive string, * matches zero or more), matches (regular expression - Business/Enterprise), in (checks if the field's value is present in a set or list).
- Logical: not (!), and (&&), xor (^^), or (||). Precedence: not > and > xor > or. Use parentheses to override precedence.
- Grouping Symbols: use Parentheses () for all conditions and controlling the order in which logical operators are evaluated.
- **CRITICAL: Always wrap the entire rule expression in parentheses, e.g., (cf.waf.score < 20 and ip.src.country ne "JP").**

**Tool:** Use addCloudflareCustomRule (description, expression, action)

**Key Fields:**

* Bot Management: cf.bot_management.corporate_proxy, cf.bot_management.ja3_hash/ja4, cf.bot_management.score, cf.bot_management.static_resource, cf.bot_management.verified_bot, cf.client.bot, cf.verified_bot_category.
* Edge/Network: cf.edge.server_ip, cf.edge.server_port.
* LLM Detection: cf.llm.prompt.detected/pii_detected/pii_categories.
* WAF: cf.waf.score.
* HTTP Request: cf.ray_id, http.cookie, http.host, http.referer, http.request.accepted_languages, http.request.body.*, http.request.cookies, http.request.full_uri, http.request.headers.*, http.request.method, http.request.uri*, http.request.version, http.user_agent, http.x_forwarded_for.
* IP/Geo: ip.src, ip.src.asnum, ip.src.* (city, region, country, etc.), ip.src.lat/lon.

**Workflow:** Understand user intent, construct the rule expression (using the tool and manual combination), use the internal API tool to add the rule, and respond to the user.

**Example Interaction:**

User: "I want to block requests with the user agent 'BadBot/1.0'."

You:
  1. Construct Expression: http.user_agent eq "BadBot/1.0"
  2. Response: Successfully added a rule to block requests with the user agent 'BadBot/1.0'.

User: "create a custom rule to give manage challenge for all request with bot score less than 20 and request coming outside of india"

You:
  1. Construct Expression: cf.bot_management.score lt 20 and ip.src.country ne "IN"
  2. Response: Successfully added a rule to block requests with bot score less than 20 and from outside India.

`,
  parameters: z.object({
    rule: z.union([
      z.object({
        action: z.string(),
        description: z.string(),
        expression: z.string(),
      }),
      z.object({
        type: z.literal("object"),
        value: z.object({
          action: z.string(),
          description: z.string(),
          expression: z.string(),
        }),
      }),
      z.string(), // Accept stringified JSON as well
    ]),
  }),
  execute: async ({ rule }) => {
    console.log(
      "[addCloudflareCustomRule] Raw rule input:",
      rule,
      "Type:",
      typeof rule
    );
    // If rule is a string, try to parse it as JSON
    if (typeof rule === "string") {
      try {
        rule = JSON.parse(rule);
        console.log(
          "[addCloudflareCustomRule] Parsed rule object:",
          rule,
          "Type:",
          typeof rule
        );
      } catch (e) {
        // Attempt to fix common escaping issues (replace inner unescaped double quotes with escaped ones)
        //example :  { "expression": "http.user_agent eq "BadBot/1.0"" }
        try {
          if (typeof rule === "string") {
            // Replace: key: "value with unescaped quotes" => key: \"value with unescaped quotes\"
            // Only replace quotes inside values, not the outer quotes
            const fixed = rule.replace(
              /: (\")(.*?)(?<!\\)\1/g,
              (match: string) => {
                // Replace inner quotes with escaped quotes
                return match.replace(/"/g, '\\"');
              }
            );
            rule = JSON.parse(fixed);
          } else {
            return "Invalid rule format: could not parse string as JSON.";
          }
        } catch (e2) {
          return "Invalid rule format: could not parse string as JSON, even after attempting to fix escaping.";
        }
      }
    }
    // Unwrap if rule is wrapped in { type: "object", value: ... }
    if (
      rule &&
      typeof rule === "object" &&
      "type" in rule &&
      rule.type === "object" &&
      "value" in rule
    ) {
      rule = rule.value as {
        action: string;
        description: string;
        expression: string;
      };
    }
    // Ensure the expression is always wrapped in parentheses
    //for dashboard expression builder we need to wrap the expression in parentheses
    if (rule && typeof rule === "object" && "expression" in rule) {
      let expr = rule.expression.trim();
      if (!(expr.startsWith("(") && expr.endsWith(")"))) {
        rule.expression = `(${expr})`;
      }
    }
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!apiToken) {
      return "CLOUDFLARE_API_TOKEN is not set in environment variables.";
    }
    const url = `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/rulesets/${CLOUDFLARE_RULESET_ID}/rules`;
    const headers = new Headers({
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    });
    const body = JSON.stringify(rule);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        redirect: "follow",
      });
      const data: any = await response.json();
      if (!response.ok) {
        return `Error from Cloudflare API: ${data.errors ? JSON.stringify(data.errors) : response.statusText}`;
      }
      return data;
    } catch (error) {
      console.error("Error adding Cloudflare custom rule:", error);
      return `Error adding Cloudflare custom rule: ${error}`;
    }
  },
});

/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */
export const tools = {
  getWeatherInformation,
  getLocalTime,
  generateImage,
  searchPokemon,
  sendWebhook,
  callDoWorker,
  callgraphqlWorker,
  addCloudflareCustomRule,
};

/**
 * Implementation of confirmation-required tools
 * This object contains the actual logic for tools that need human approval
 * Each function here corresponds to a tool above that doesn't have an execute function
 */
export const executions = {
  getWeatherInformation: async ({ city }: { city: string }) => {
    console.log(`Getting weather information for ${city}`);
    // For demonstration purposes, returning a sample response
    // In a real app, you would call a weather API
    return `The weather in ${city} is sunny with a temperature of 72°F (22°C). Humidity is at 45% with a light breeze from the southwest at 5 mph.`;
  },
};
