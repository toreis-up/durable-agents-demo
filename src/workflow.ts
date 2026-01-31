import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";
import OpenAI from 'openai'
import {
	tools,
	searchReposTool,
	getRepoTool,
	type SearchReposInput,
	type GetRepoInput,
} from './tools'

type Params = { task: string }

export class AgentWorkflow extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		const client = new OpenAI({
			apiKey: this.env.OPENAI_API_KEY,
			baseURL: this.env.OPENAI_API_BASE_URL,
		})

		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: 'user', content: event.payload.task }];

		const toolDefinitions = tools.map(
			({ run, ...rest }) => ({ type: 'function', function: { ...rest } })
		);

		for (let turn = 0; turn < 10; turn++) {
			const response = (await step.do(`llm-turn-${turn}`, { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } }, async () => {
				const msg = await client.chat.completions.create({
					model: 'workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct',
					max_completion_tokens: 1024,
					tool_choice: 'auto',
					tools: toolDefinitions,
					messages,
				});

				return JSON.parse(JSON.stringify(msg))
			}))

			const choice = response.choices?.[0];
			const message = choice?.message;
			if (!response || !choice || !message) continue;

			messages.push(message);

			if (choice.finish_reason === "stop") {
				return {
					status: 'complete',
					turns: turn + 1,
					result : message.content ?? null,
				}
			}

			const toolResults: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = []

			if (choice.finish_reason === "tool_calls") {
				for (const call of message.tool_calls ?? []) {
					const callId = call.id
					const result = await step.do(
						`tool-${turn}-${call.id}`,
						{ retries: { limit: 2, delay: "5 seconds" } },
						async () => {
							switch (call.function.name) {
								case "search_repos":
									return searchReposTool.run(JSON.parse(call.function.arguments) as SearchReposInput)
								case "get_repo":
									return getRepoTool.run(JSON.parse(call.function.arguments) as GetRepoInput)
								default:
									return `Unknown tool: ${call.function.name}`
							}
						}
					)

					toolResults.push({
						role: "tool",
						tool_call_id: callId,
						content: JSON.stringify(result)
					})
				}
			}

			messages.push(...toolResults)
		}

		return {status: "max_turns_exceeded", turns: 10 }
	}
}
