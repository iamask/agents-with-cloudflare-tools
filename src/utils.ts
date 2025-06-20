// via https://github.com/vercel/ai/blob/main/examples/next-openai/app/api/use-chat-human-in-the-loop/utils.ts

import { formatDataStreamPart, type Message } from "@ai-sdk/ui-utils";
import {
  convertToCoreMessages,
  type DataStreamWriter,
  type ToolExecutionOptions,
  type ToolSet,
} from "ai";
import type { z } from "zod";
import { APPROVAL } from "./shared";

function isValidToolName<K extends PropertyKey, T extends object>(
  key: K,
  obj: T
): key is K & keyof T {
  return key in obj;
}

/**
 * Debug utility to print tool definitions
 */
export function printToolDefinitions(tools: ToolSet) {
  console.log("[DEBUG] Tool definitions:");
  for (const [name, toolDef] of Object.entries(tools)) {
    // @ts-ignore - accessing tool description and parameters
    console.log(
      `[DEBUG] Tool: ${name}, Description: ${toolDef.description || "No description"}`
    );
    try {
      // @ts-ignore - accessing tool parameters
      if (toolDef.parameters) {
        // @ts-ignore - accessing tool parameters
        console.log(
          `[DEBUG] Parameters: ${JSON.stringify(toolDef.parameters.shape || {})}`
        );
      }
    } catch (error) {
      console.error(`[DEBUG] Error printing parameters for ${name}:`, error);
    }
    // @ts-ignore - checking if execute function exists
    console.log(`[DEBUG] Has execute function: ${!!toolDef.execute}`);
  }
}

/**
 * Helper to analyze and validate messages for tool calling
 */
export function analyzeToolCallingMessages(messages: Message[]) {
  console.log("[DEBUG] Analyzing message content for tool calling potential:");

  // Look at the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") {
      console.log(`[DEBUG] Last user message: "${message.content}"`);

      // Extract key terms that might indicate tool use
      const content =
        typeof message.content === "string"
          ? message.content.toLowerCase()
          : "";
      const weatherTerms = [
        "weather",
        "temperature",
        "rainy",
        "sunny",
        "forecast",
      ];
      const timeTerms = ["time", "hour", "clock", "current time"];
      const scheduleTerms = [
        "schedule",
        "reminder",
        "set up",
        "appointment",
        "meeting",
      ];
      const imageTerms = [
        "image",
        "picture",
        "photo",
        "draw",
        "create",
        "generate",
        "make a",
        "create a",
        "visualize",
        "render",
      ];

      // Add terms for callDoWorker tool
      const doWorkerTerms = [
        "do worker",
        "call worker",
        "call do-worker",
        "service binding",
        "test worker",
        "hello world from worker",
      ];

      // Check for potential tool matches
      const potentialWeather = weatherTerms.some((term) =>
        content.includes(term)
      );
      const potentialTime = timeTerms.some((term) => content.includes(term));
      const potentialSchedule = scheduleTerms.some((term) =>
        content.includes(term)
      );
      const potentialImage = imageTerms.some((term) => content.includes(term));
      const potentialDoWorker = doWorkerTerms.some((term) =>
        content.includes(term)
      );

      console.log(`[DEBUG] Potential weather tool use: ${potentialWeather}`);
      console.log(`[DEBUG] Potential time tool use: ${potentialTime}`);
      console.log(`[DEBUG] Potential schedule tool use: ${potentialSchedule}`);
      console.log(
        `[DEBUG] Potential image generation tool use: ${potentialImage}`
      );
      console.log(`[DEBUG] Potential do-worker tool use: ${potentialDoWorker}`);

      // Log specific pattern matches for image generation
      if (potentialImage) {
        console.log("[DEBUG] Detected image generation request pattern");

        // Try to extract the subject of the image
        const subjects = content
          .replace(/generate|create|make|draw|an?|image|picture|of|photo/g, "")
          .trim();
        if (subjects) {
          console.log(`[DEBUG] Potential image subject: "${subjects}"`);
        }
      }

      break;
    }
  }
}

/**
 * Processes tool invocations where human input is required, executing tools when authorized.
 *
 * @param options - The function options
 * @param options.tools - Map of tool names to Tool instances that may expose execute functions
 * @param options.dataStream - Data stream for sending results back to the client
 * @param options.messages - Array of messages to process
 * @param executionFunctions - Map of tool names to execute functions
 * @returns Promise resolving to the processed messages
 */
export async function processToolCalls<
  Tools extends ToolSet,
  ExecutableTools extends {
    // biome-ignore lint/complexity/noBannedTypes: it's fine
    [Tool in keyof Tools as Tools[Tool] extends { execute: Function }
      ? never
      : Tool]: Tools[Tool];
  },
>({
  tools,
  dataStream,
  messages,
  executions,
}: {
  tools: Tools; // used for type inference
  dataStream: DataStreamWriter;
  messages: Message[];
  executions: {
    [K in keyof Tools & keyof ExecutableTools]?: (
      args: z.infer<ExecutableTools[K]["parameters"]>,
      context: ToolExecutionOptions
    ) => Promise<unknown>;
  };
}): Promise<Message[]> {
  console.log("[DEBUG] processToolCalls: Processing messages", messages.length);

  // Print tool definitions for debugging
  printToolDefinitions(tools);

  // Analyze messages for potential tool usage
  analyzeToolCallingMessages(messages);

  const lastMessage = messages[messages.length - 1];
  const parts = lastMessage.parts;

  if (!parts) {
    console.log("[DEBUG] processToolCalls: No parts found in last message");
    return messages;
  }

  console.log(
    "[DEBUG] processToolCalls: Found parts in last message",
    parts.length
  );

  const processedParts = await Promise.all(
    parts.map(async (part) => {
      // Only process tool invocations parts
      if (part.type !== "tool-invocation") {
        console.log(
          "[DEBUG] processToolCalls: Part is not a tool invocation",
          part.type
        );
        return part;
      }

      const { toolInvocation } = part;
      const toolName = toolInvocation.toolName;

      console.log(
        `[DEBUG] processToolCalls: Processing tool invocation for ${toolName}`,
        {
          state: toolInvocation.state,
          args: toolInvocation.args,
        }
      );

      // Only continue if we have an execute function for the tool (meaning it requires confirmation) and it's in a 'result' state
      if (!(toolName in executions) || toolInvocation.state !== "result") {
        console.log(
          `[DEBUG] processToolCalls: Skipping tool ${toolName} - not in executions or not in result state`
        );
        return part;
      }

      let result: unknown;

      if (toolInvocation.result === APPROVAL.YES) {
        console.log(`[DEBUG] processToolCalls: User approved tool ${toolName}`);

        // Get the tool and check if the tool has an execute function.
        if (
          !isValidToolName(toolName, executions) ||
          toolInvocation.state !== "result"
        ) {
          console.log(
            `[DEBUG] processToolCalls: Tool ${toolName} is not valid or not in result state`
          );
          return part;
        }

        const toolInstance = executions[toolName];
        if (toolInstance) {
          console.log(
            `[DEBUG] processToolCalls: Executing tool ${toolName} with args:`,
            toolInvocation.args
          );
          try {
            result = await toolInstance(toolInvocation.args, {
              messages: convertToCoreMessages(messages),
              toolCallId: toolInvocation.toolCallId,
            });
            console.log(
              `[DEBUG] processToolCalls: Tool ${toolName} executed successfully with result:`,
              result
            );
          } catch (error) {
            console.error(
              `[DEBUG] processToolCalls: Error executing tool ${toolName}:`,
              error
            );
            result = `Error executing tool: ${error}`;
          }
        } else {
          console.log(
            `[DEBUG] processToolCalls: No execute function found for tool ${toolName}`
          );
          result = "Error: No execute function found on tool";
        }
      } else if (toolInvocation.result === APPROVAL.NO) {
        console.log(
          `[DEBUG] processToolCalls: User denied access to tool ${toolName}`
        );
        result = "Error: User denied access to tool execution";
      } else {
        // For any unhandled responses, return the original part.
        console.log(
          `[DEBUG] processToolCalls: Unhandled result for tool ${toolName}`
        );
        return part;
      }

      // Forward updated tool result to the client.
      console.log(
        `[DEBUG] processToolCalls: Writing tool result for ${toolName} to dataStream`
      );
      dataStream.write(
        formatDataStreamPart("tool_result", {
          toolCallId: toolInvocation.toolCallId,
          result,
        })
      );

      // Return updated toolInvocation with the actual result.
      return {
        ...part,
        toolInvocation: {
          ...toolInvocation,
          result,
        },
      };
    })
  );

  console.log("[DEBUG] processToolCalls: Finished processing parts");

  // Finally return the processed messages
  return [...messages.slice(0, -1), { ...lastMessage, parts: processedParts }];
}

// export function getToolsRequiringConfirmation<
//   T extends ToolSet
//   // E extends {
//   //   [K in keyof T as T[K] extends { execute: Function } ? never : K]: T[K];
//   // },
// >(tools: T): string[] {
//   return (Object.keys(tools) as (keyof T)[]).filter((key) => {
//     const maybeTool = tools[key];
//     return typeof maybeTool.execute !== "function";
//   }) as string[];
// }
