import { routeAgentRequest, type Schedule } from "agents";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  createDataStreamResponse,
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import {
  printToolDefinitions,
  analyzeToolCallingMessages,
  processToolCalls,
} from "./utils";
import { tools, executions } from "./tools";
// import { env } from "cloudflare:workers";

/**
 * Validator function to determine if a tool should be used based on the message content
 * This prevents tools from being used for general conversation
 */
//optional can be implemented here

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   * @param onFinish - Callback function executed when streaming completes
   */

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ) {
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.unstable_getAITools(),
    };

    console.log("[DEBUG] Available tools:", Object.keys(allTools));
    printToolDefinitions(allTools);

    // Create a streaming response that handles both text and tool outputs
    const dataStreamResponse = createDataStreamResponse({
      execute: async (dataStream) => {
        // Get the last user message for debugging
        const lastUserMessage = this.messages
          .filter((m) => m.role === "user")
          .pop();
        const lastUserContent = lastUserMessage?.content || "";
        console.log(
          "[DEBUG] Last user message:",
          typeof lastUserContent === "string"
            ? lastUserContent.substring(0, 100) +
                (lastUserContent.length > 100 ? "..." : "")
            : "Not a string"
        );

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: this.messages,
          dataStream,
          tools: allTools,
          executions,
        });
        console.log(
          "[DEBUG] Processed messages:",
          JSON.stringify(processedMessages)
        );
        // Log the processed messages for debugging
        try {
          console.log(
            "[DEBUG] Processed messages count:",
            processedMessages.length
          );
          if (processedMessages.length > 0) {
            const lastMsg = processedMessages[processedMessages.length - 1];
            console.log("[DEBUG] Last message role:", lastMsg.role);
            console.log(
              "[DEBUG] Last message content type:",
              typeof lastMsg.content
            );

            if (typeof lastMsg.content === "string") {
              console.log(
                "[DEBUG] Last message content:",
                lastMsg.content.substring(0, 100) +
                  (lastMsg.content.length > 100 ? "..." : "")
              );
            }
          }

          // Analyze the messages for tool calling potential
          analyzeToolCallingMessages(processedMessages);
        } catch (error) {
          console.error("[DEBUG] Error logging messages:", error);
        }

        // Create a Workers AI instance using the binding from env
        const workersai = createWorkersAI({ binding: this.env.AI });
        // Use Cloudflare Workers AI model
        const model = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast");

        //@cf/meta/llama-3.3-70b-instruct-fp8-fast
        //@cf/meta/llama-4-scout-17b-16e-instruct
        //@cf/deepseek-ai/deepseek-r1-distill-qwen-32b

        //@hf/nousresearch/hermes-2-pro-mistral-7b

        console.log(
          "[DEBUG] Using model: @cf/meta/llama-3.3-70b-instruct-fp8-fast"
        );

        // Create a simple, direct system prompt with no toolExamples or toolDescriptions
        const systemPrompt = `You are a helpful, conversational AI assistant. Always respond to the user's questions in a friendly and informative way.

For normal conversation (greetings, general questions, chit-chat, or questions about general topics like 'How are you'), always answer directly and conversationally. Do not use tools for these unless the user specifically asks for something that requires a tool.

ONLY use tools if the user clearly requests an action that matches a tool's function, such as:
- Generating an image
- Getting the weather in a specific location
- Asking for the time in a specific place
- Getting Pokémon details by name or ID (e.g., 'Tell me about Pikachu' or 'Show me Pokémon #25')
- Sending a webhook message
- send request to a Cloudflare Worker via callDoWorker tools
- call callgraphqlWorker to check for total user agent

If you use a tool, always explain the result in a friendly, detailed way.

For example:
- If you use a tool to generate an image, send the image URL along with a helpful message, e.g.: 'I created the image, here is the URL: https://r2.zxc.co.in/ai-generated/1747129509395-m29mub.jpg'
- If you use the searchPokemon tool and get:
  "Pokémon: pikachu (ID: 25)\nHeight: 4\nWeight: 60\nTypes: electric\nAbilities: static, lightning-rod\nSprite: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png"
  You should say:
  "Pikachu is a Pokémon with ID 25. It is an Electric type, has a height of 4 decimetres and weighs 60 hectograms. Its abilities include static and lightning-rod. Here is its sprite: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png"
- If you use the sendWebhook tool and get:
  "Message successfully sent to the webhook."
  You should say:
  "I've sent your message to the webhook successfully! If you need to send another message or check the status, just let me know."

Never just repeat the tool result or show raw JSON. Always provide a helpful, conversational explanation.

Your primary function is to be a helpful, conversational assistant. Only use tools when the user's request clearly requires it. For all other questions, respond directly and helpfully.`;

        console.log("[DEBUG] System prompt length:", systemPrompt.length);

        // Log the tool executions for reference
        console.log(
          "[DEBUG] Available execution tools:",
          Object.keys(executions)
        );

        // Stream the AI response using Workers AI
        const result = streamText({
          model,
          system: systemPrompt,
          messages: processedMessages,
          tools: allTools,
          temperature: 0.0, // Zero temperature to make model more deterministic in following instructions

          onFinish: async (args) => {
            console.log(
              "[DEBUG] Stream finished with tool calls:",
              args.toolCalls?.length || 0
            );
            if (args.toolCalls?.length) {
              console.log(
                "[DEBUG] Last tool call:",
                JSON.stringify(args.toolCalls[args.toolCalls.length - 1])
              );
            }
            onFinish(
              args as Parameters<StreamTextOnFinishCallback<ToolSet>>[0]
            );
            // await this.mcp.closeConnection(mcpConnection.id);
          },
          onError: (error) => {
            console.error("[DEBUG] Error while streaming:", error);
          },
          maxSteps: 10,
        });
        console.log("[DEBUG] result:", await JSON.stringify(result));

        // Merge the AI response stream with tool execution outputs
        result.mergeIntoDataStream(dataStream);
      },
    });

    return dataStreamResponse;
  }
  async executeTask(description: string, task: Schedule<string>) {
    console.log("[DEBUG] Executing scheduled task:", description);
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        content: `Running scheduled task: ${description}`,
        createdAt: new Date(),
      },
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    console.log("[DEBUG] Request received:", url.pathname);
    //dummy
    if (url.pathname === "/check-open-ai-key") {
      return Response.json({
        success: true,
      });
    }

    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
