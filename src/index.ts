export { AgentWorkflow } from './workflow';

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		const instanceId = url.searchParams.get('instanceId');
		if (instanceId) {
			const instance = await env.AGENT_WORKFLOW.get(instanceId);
			const status = await instance.status();

			return Response.json({
				status: status.status,
				output: status.output,
			});
		}

		if (request.method === 'POST') {
			const { task } = await request.json<{ task: string }>();
			const instance = await env.AGENT_WORKFLOW.create({
				params: { task },
			});
			return Response.json({ instanceId: instance.id });
		}

		return new Response('POST a task to start an agent', { status: 400 });
	},
} satisfies ExportedHandler<Env>;
