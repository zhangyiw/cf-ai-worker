export interface Env {
	AI: Ai;
	OPENAI_API_KEY?: string;
}

// OpenAI compatible message interface
interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

// OpenAI compatible request body
interface ChatCompletionRequest {
	model: string;
	messages: ChatMessage[];
	temperature?: number;
	max_tokens?: number;
	top_p?: number;
	stream?: boolean;
}

// OpenAI Responses API content item
interface ResponseContentItem {
	type: 'input_text' | 'input_image' | 'output_text';
	text?: string;
}

// OpenAI Responses API input item
interface ResponseInputItem {
	role: 'user' | 'assistant' | 'system';
	content: string | ResponseContentItem[];
}

// OpenAI Responses API request body
interface ResponsesRequest {
	model: string;
	input: string | ResponseInputItem[];
	instructions?: string;
	temperature?: number;
	max_output_tokens?: number;
	top_p?: number;
	stream?: boolean;
	store?: boolean;
}

// Validate API key from Authorization header
function validateApiKey(request: Request, env: Env): Response | null {
	// If OPENAI_API_KEY is not set, skip validation
	if (!env.OPENAI_API_KEY) {
		return null;
	}

	const authHeader = request.headers.get('Authorization');
	if (!authHeader) {
		return new Response(
			JSON.stringify({
				error: {
					message: 'Missing Authorization header',
					type: 'authentication_error',
				},
			}),
			{ status: 401, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// Extract Bearer token
	const match = authHeader.match(/^Bearer\s+(.+)$/i);
	if (!match) {
		return new Response(
			JSON.stringify({
				error: {
					message: 'Invalid Authorization header format. Expected: Bearer <token>',
					type: 'authentication_error',
				},
			}),
			{ status: 401, headers: { 'Content-Type': 'application/json' } }
		);
	}

	const token = match[1];
	if (token !== env.OPENAI_API_KEY) {
		return new Response(
			JSON.stringify({
				error: {
					message: 'Invalid API key',
					type: 'authentication_error',
				},
			}),
			{ status: 401, headers: { 'Content-Type': 'application/json' } }
		);
	}

	return null;
}

// Model mapping: OpenAI model name -> Cloudflare AI model name
// Available models: https://developers.cloudflare.com/workers-ai/models/
const MODEL_MAPPING: Record<string, string> = {
	'gpt-4': '@cf/meta/llama-3.1-70b-instruct',
	'gpt-4o': '@cf/meta/llama-3.1-70b-instruct',
	'gpt-4o-mini': '@cf/meta/llama-3.1-8b-instruct',
	'gpt-3.5-turbo': '@cf/meta/llama-3.1-8b-instruct',
	'llama-3.1-8b': '@cf/meta/llama-3.1-8b-instruct',
	'llama-3.1-70b': '@cf/meta/llama-3.1-70b-instruct',
	// DeepSeek models
	'deepseek-r1': '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
	'deepseek-chat': '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
};

function getCloudflareModel(model: string): string {
	return MODEL_MAPPING[model] || '@cf/meta/llama-3.1-8b-instruct';
}

function convertMessagesToPrompt(messages: ChatMessage[]): string {
	return messages
		.map((msg) => {
			switch (msg.role) {
				case 'system':
					return `[System]\n${msg.content}`;
				case 'user':
					return `[User]\n${msg.content}`;
				case 'assistant':
					return `[Assistant]\n${msg.content}`;
				default:
					return `${msg.content}`;
			}
		})
		.join('\n\n');
}

// Convert Responses API input to prompt string
function convertInputToPrompt(input: string | ResponseInputItem[]): string {
	if (typeof input === 'string') {
		return `[User]\n${input}`;
	}

	return input
		.map((item) => {
			const role = item.role;
			let content = '';

			if (typeof item.content === 'string') {
				content = item.content;
			} else if (Array.isArray(item.content)) {
				// Extract text from content items
				content = item.content
					.filter((c) => c.type === 'input_text' || c.type === 'output_text')
					.map((c) => c.text || '')
					.join('');
			}

			switch (role) {
				case 'system':
					return `[System]\n${content}`;
				case 'user':
					return `[User]\n${content}`;
				case 'assistant':
					return `[Assistant]\n${content}`;
				default:
					return content;
			}
		})
		.join('\n\n');
}

function createOpenAIResponse(
	model: string,
	content: string,
	usage?: { prompt_tokens?: number; completion_tokens?: number }
): object {
	const promptTokens = usage?.prompt_tokens || 0;
	const completionTokens = usage?.completion_tokens || 0;

	return {
		id: `chatcmpl-${crypto.randomUUID()}`,
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				message: {
					role: 'assistant',
					content,
				},
				finish_reason: 'stop',
			},
		],
		usage: {
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			total_tokens: promptTokens + completionTokens,
		},
	};
}

// Create Responses API compatible response
function createResponsesResponse(
	model: string,
	content: string,
	usage?: { prompt_tokens?: number; completion_tokens?: number }
): object {
	const promptTokens = usage?.prompt_tokens || 0;
	const completionTokens = usage?.completion_tokens || 0;

	return {
		id: `resp_${crypto.randomUUID().replace(/-/g, '')}`,
		object: 'response',
		created_at: Math.floor(Date.now() / 1000),
		model,
		output: [
			{
				type: 'message',
				id: `msg_${crypto.randomUUID().replace(/-/g, '')}`,
				role: 'assistant',
				content: [
					{
						type: 'output_text',
						text: content,
					},
				],
			},
		],
		usage: {
			input_tokens: promptTokens,
			output_tokens: completionTokens,
			total_tokens: promptTokens + completionTokens,
		},
	};
}

// Create Responses API stream event: response.created
function createResponsesCreatedEvent(responseId: string, model: string): string {
	return `data: ${JSON.stringify({
		type: 'response.created',
		response: {
			id: responseId,
			object: 'response',
			created_at: Math.floor(Date.now() / 1000),
			model,
			status: 'in_progress',
			error: null,
			incomplete_details: null,
			instructions: null,
			max_output_tokens: null,
			output: [],
			parallel_tool_calls: true,
			previous_response_id: null,
			reasoning: { effort: 'medium', generate_summary: null },
			store: true,
			temperature: 1.0,
			text: { format: { type: 'text' } },
			tool_choice: 'auto',
			tools: [],
			top_p: 1.0,
			truncation: 'disabled',
			usage: null,
			user: null,
			metadata: {},
		},
	})}\n\n`;
}

// Create Responses API stream event: response.output_item.added
function createResponsesOutputItemAddedEvent(responseId: string, itemId: string, outputIndex: number): string {
	return `data: ${JSON.stringify({
		type: 'response.output_item.added',
		output_index: outputIndex,
		item: {
			id: itemId,
			type: 'message',
			role: 'assistant',
			content: [],
			status: 'in_progress',
		},
	})}\n\n`;
}

// Create Responses API stream event: response.content_part.added
function createResponsesContentPartAddedEvent(itemId: string, outputIndex: number, contentIndex: number): string {
	return `data: ${JSON.stringify({
		type: 'response.content_part.added',
		item_id: itemId,
		output_index: outputIndex,
		content_index: contentIndex,
		part: {
			type: 'output_text',
			text: '',
		},
	})}\n\n`;
}

// Create Responses API stream event: response.output_text.delta
function createResponsesOutputTextDeltaEvent(itemId: string, outputIndex: number, contentIndex: number, delta: string): string {
	return `data: ${JSON.stringify({
		type: 'response.output_text.delta',
		item_id: itemId,
		output_index: outputIndex,
		content_index: contentIndex,
		delta,
	})}\n\n`;
}

// Create Responses API stream event: response.output_text.done
function createResponsesOutputTextDoneEvent(itemId: string, outputIndex: number, contentIndex: number, text: string): string {
	return `data: ${JSON.stringify({
		type: 'response.output_text.done',
		item_id: itemId,
		output_index: outputIndex,
		content_index: contentIndex,
		text,
	})}\n\n`;
}

// Create Responses API stream event: response.content_part.done
function createResponsesContentPartDoneEvent(itemId: string, outputIndex: number, contentIndex: number): string {
	return `data: ${JSON.stringify({
		type: 'response.content_part.done',
		item_id: itemId,
		output_index: outputIndex,
		content_index: contentIndex,
		part: {
			type: 'output_text',
			text: '',
		},
	})}\n\n`;
}

// Create Responses API stream event: response.output_item.done
function createResponsesOutputItemDoneEvent(itemId: string, outputIndex: number): string {
	return `data: ${JSON.stringify({
		type: 'response.output_item.done',
		output_index: outputIndex,
		item: {
			id: itemId,
			type: 'message',
			role: 'assistant',
			content: [],
			status: 'completed',
		},
	})}\n\n`;
}

// Create Responses API stream event: response.completed
function createResponsesCompletedEvent(responseId: string, model: string, inputTokens: number, outputTokens: number): string {
	return `data: ${JSON.stringify({
		type: 'response.completed',
		response: {
			id: responseId,
			object: 'response',
			created_at: Math.floor(Date.now() / 1000),
			model,
			status: 'completed',
			error: null,
			incomplete_details: null,
			instructions: null,
			max_output_tokens: null,
			output: [],
			parallel_tool_calls: true,
			previous_response_id: null,
			reasoning: { effort: 'medium', generate_summary: null },
			store: true,
			temperature: 1.0,
			text: { format: { type: 'text' } },
			tool_choice: 'auto',
			tools: [],
			top_p: 1.0,
			truncation: 'disabled',
			usage: {
				input_tokens: inputTokens,
				output_tokens: outputTokens,
				total_tokens: inputTokens + outputTokens,
				input_tokens_details: { cached_tokens: 0 },
				output_tokens_details: { reasoning_tokens: 0 },
			},
			user: null,
			metadata: {},
		},
	})}\n\n`;
}

function createStreamChunk(model: string, content: string, isDone: boolean = false): string {
	const chunk = {
		id: `chatcmpl-${crypto.randomUUID()}`,
		object: 'chat.completion.chunk',
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				delta: isDone
					? {}
					: {
							content,
						},
				finish_reason: isDone ? 'stop' : null,
			},
		],
	};
	return `data: ${JSON.stringify(chunk)}\n\n`;
}

async function handleChatCompletion(
	request: Request,
	env: Env
): Promise<Response> {
	try {
		const body = (await request.json()) as ChatCompletionRequest;
		const { model, messages, temperature, max_tokens, stream } = body;

		if (!messages || !Array.isArray(messages) || messages.length === 0) {
			return new Response(
				JSON.stringify({
					error: {
						message: 'Messages array is required',
						type: 'invalid_request_error',
					},
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		const cfModel = getCloudflareModel(model);
		const prompt = convertMessagesToPrompt(messages);

		// Build AI options
		const aiOptions: Record<string, unknown> = { prompt };
		if (temperature !== undefined) aiOptions.temperature = temperature;
		if (max_tokens !== undefined) aiOptions.max_tokens = max_tokens;

		const aiResponse = (await env.AI.run(cfModel, aiOptions)) as {
			response?: string;
			text?: string;
			usage?: { prompt_tokens?: number; completion_tokens?: number };
		};

		const content = aiResponse.response || aiResponse.text || '';

		if (stream) {
			// Streaming response
			const encoder = new TextEncoder();
			const streamContent = content;
			let index = 0;

			const readableStream = new ReadableStream({
				start(controller) {
					const sendChunk = () => {
						if (index < streamContent.length) {
							const chunk = streamContent.slice(index, index + 4);
							controller.enqueue(
								encoder.encode(createStreamChunk(model || cfModel, chunk))
							);
							index += 4;
							setTimeout(sendChunk, 20);
						} else {
							controller.enqueue(
								encoder.encode(createStreamChunk(model || cfModel, '', true))
							);
							controller.enqueue(encoder.encode('data: [DONE]\n\n'));
							controller.close();
						}
					};
					sendChunk();
				},
			});

			return new Response(readableStream, {
				headers: {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive',
				},
			});
		}

		// Non-streaming response
		const response = createOpenAIResponse(model || cfModel, content, aiResponse.usage);
		return new Response(JSON.stringify(response), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return new Response(
			JSON.stringify({
				error: {
					message: errorMessage,
					type: 'internal_error',
				},
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}
}

// Handle OpenAI Responses API
async function handleResponses(
	request: Request,
	env: Env
): Promise<Response> {
	try {
		const body = (await request.json()) as ResponsesRequest;
		const { model, input, instructions, temperature, max_output_tokens, stream } = body;

		if (!input) {
			return new Response(
				JSON.stringify({
					error: {
						message: 'Input is required',
						type: 'invalid_request_error',
					},
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		const cfModel = getCloudflareModel(model);
		let prompt = convertInputToPrompt(input);

		// Add instructions if provided
		if (instructions) {
			prompt = `[System]\n${instructions}\n\n${prompt}`;
		}

		// Build AI options
		const aiOptions: Record<string, unknown> = { prompt };
		if (temperature !== undefined) aiOptions.temperature = temperature;
		if (max_output_tokens !== undefined) aiOptions.max_tokens = max_output_tokens;

		const aiResponse = (await env.AI.run(cfModel, aiOptions)) as {
			response?: string;
			text?: string;
			usage?: { prompt_tokens?: number; completion_tokens?: number };
		};

		const content = aiResponse.response || aiResponse.text || '';

		if (stream) {
			// Streaming response with proper event sequence
			const encoder = new TextEncoder();
			const streamContent = content;
			const responseId = `resp_${crypto.randomUUID().replace(/-/g, '')}`;
			const itemId = `msg_${crypto.randomUUID().replace(/-/g, '')}`;
			const outputIndex = 0;
			const contentIndex = 0;
			let index = 0;

			const readableStream = new ReadableStream({
				start(controller) {
					// Send initial events
					controller.enqueue(
						encoder.encode(createResponsesCreatedEvent(responseId, model || cfModel))
					);
					controller.enqueue(
						encoder.encode(createResponsesOutputItemAddedEvent(responseId, itemId, outputIndex))
					);
					controller.enqueue(
						encoder.encode(createResponsesContentPartAddedEvent(itemId, outputIndex, contentIndex))
					);

					const sendChunk = () => {
						if (index < streamContent.length) {
							const chunk = streamContent.slice(index, index + 4);
							controller.enqueue(
								encoder.encode(createResponsesOutputTextDeltaEvent(itemId, outputIndex, contentIndex, chunk))
							);
							index += 4;
							setTimeout(sendChunk, 20);
						} else {
							// Send completion events
							controller.enqueue(
								encoder.encode(createResponsesOutputTextDoneEvent(itemId, outputIndex, contentIndex, streamContent))
							);
							controller.enqueue(
								encoder.encode(createResponsesContentPartDoneEvent(itemId, outputIndex, contentIndex))
							);
							controller.enqueue(
								encoder.encode(createResponsesOutputItemDoneEvent(itemId, outputIndex))
							);
							controller.enqueue(
								encoder.encode(createResponsesCompletedEvent(
									responseId,
									model || cfModel,
									aiResponse.usage?.prompt_tokens || 0,
									aiResponse.usage?.completion_tokens || Math.ceil(streamContent.length / 4)
								))
							);
							controller.close();
						}
					};
					sendChunk();
				},
			});

			return new Response(readableStream, {
				headers: {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive',
				},
			});
		}

		// Non-streaming response
		const response = createResponsesResponse(model || cfModel, content, aiResponse.usage);
		return new Response(JSON.stringify(response), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return new Response(
			JSON.stringify({
				error: {
					message: errorMessage,
					type: 'internal_error',
				},
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}
}

// List available models (OpenAI compatible)
function handleListModels(): Response {
	const models = [
		{ id: 'gpt-4', object: 'model', owned_by: 'openai' },
		{ id: 'gpt-4o', object: 'model', owned_by: 'openai' },
		{ id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
		{ id: 'gpt-3.5-turbo', object: 'model', owned_by: 'openai' },
		{ id: 'llama-3.1-8b', object: 'model', owned_by: 'meta' },
		{ id: 'llama-3.1-70b', object: 'model', owned_by: 'meta' },
		{ id: 'deepseek-r1', object: 'model', owned_by: 'deepseek-ai' },
		{ id: 'deepseek-chat', object: 'model', owned_by: 'deepseek-ai' },
	];

	return new Response(
		JSON.stringify({
			object: 'list',
			data: models,
		}),
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// CORS headers
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		// Validate API key for protected endpoints
		const protectedEndpoints = ['/v1/chat/completions', '/v1/responses', '/api/ai'];
		if (protectedEndpoints.includes(url.pathname) && request.method === 'POST') {
			const authError = validateApiKey(request, env);
			if (authError) {
				// Add CORS headers to error response
				Object.entries(corsHeaders).forEach(([key, value]) => {
					authError.headers.set(key, value);
				});
				return authError;
			}
		}

		let response: Response;

		if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
			response = await handleChatCompletion(request, env);
		} else if (url.pathname === '/v1/responses' && request.method === 'POST') {
			response = await handleResponses(request, env);
		} else if (url.pathname === '/v1/models' && request.method === 'GET') {
			response = handleListModels();
		} else if (url.pathname === '/api/ai' && request.method === 'POST') {
			// Legacy endpoint (redirect to OpenAI compatible)
			response = await handleChatCompletion(request, env);
		} else {
			// Return OpenAI-compatible error for unknown endpoints
			response = new Response(
				JSON.stringify({
					error: {
						message: `Invalid endpoint: ${url.pathname}`,
						type: 'invalid_request_error',
					},
				}),
				{ status: 404, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Add CORS headers to response
		Object.entries(corsHeaders).forEach(([key, value]) => {
			response.headers.set(key, value);
		});

		return response;
	},
};
